import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import {
  JOB_NAMES,
  JobQueuePort,
} from '../../infrastructure/jobs/job-queue.port';
import { PrismaService } from '../../prisma/prisma.service';
import { verifyPasswordWithPepper } from '../auth/utils/password-hasher';

import { AccountDeletionResponseDto } from './dto/account-deletion-response.dto';
import { RequestAccountDeletionDto } from './dto/request-account-deletion.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { DEFAULT_USER_PROFILE } from './validation/user-profile.validator';

// Never add password, lockout counters or other credential state here.
const USER_ITEM_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type UserItem = Prisma.UserGetPayload<{ select: typeof USER_ITEM_SELECT }>;

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(JobQueuePort) private readonly jobQueue: JobQueuePort,
  ) {}

  async getProfile(userId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'active', deletedAt: null },
      select: USER_ITEM_SELECT,
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return user;
  }

  async getUserProfile(userId: number): Promise<UserProfileResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'active', deletedAt: null },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: {
        displayName: true,
        locale: true,
        timezone: true,
      },
    });

    if (!profile) {
      return {
        displayName: DEFAULT_USER_PROFILE.displayName,
        locale: DEFAULT_USER_PROFILE.locale,
        timezone: DEFAULT_USER_PROFILE.timezone,
      };
    }

    return {
      displayName: profile.displayName,
      locale: profile.locale,
      timezone: profile.timezone,
    };
  }

  async updateUserProfile(
    userId: number,
    dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, status: 'active', deletedAt: null },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const hasDisplayName = dto.displayName !== undefined;
    const hasLocale = dto.locale !== undefined;
    const hasTimezone = dto.timezone !== undefined;

    const trimmedDisplayName =
      dto.displayName !== undefined
        ? dto.displayName === null
          ? null
          : dto.displayName.trim()
        : null;

    const resolvedLocale =
      dto.locale !== undefined ? dto.locale : DEFAULT_USER_PROFILE.locale;

    const resolvedTimezone =
      dto.timezone !== undefined ? dto.timezone : DEFAULT_USER_PROFILE.timezone;

    const rows = await this.prisma.$queryRaw<
      Array<{ displayName: string | null; locale: string; timezone: string }>
    >(Prisma.sql`
      INSERT INTO "UserProfile" ("userId", "displayName", "locale", "timezone", "updatedAt")
      VALUES (
        ${userId},
        ${trimmedDisplayName},
        ${resolvedLocale},
        ${resolvedTimezone},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("userId") DO UPDATE SET
        "displayName" = CASE WHEN ${hasDisplayName} THEN EXCLUDED."displayName" ELSE "UserProfile"."displayName" END,
        "locale" = CASE WHEN ${hasLocale} THEN EXCLUDED."locale" ELSE "UserProfile"."locale" END,
        "timezone" = CASE WHEN ${hasTimezone} THEN EXCLUDED."timezone" ELSE "UserProfile"."timezone" END,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "displayName", "locale", "timezone"
    `);

    const result = rows[0];
    if (!result) {
      throw new NotFoundException('User profile could not be updated.');
    }

    return {
      displayName: result.displayName,
      locale: result.locale,
      timezone: result.timezone,
    };
  }

  async requestAccountDeletion(
    userId: number,
    dto: RequestAccountDeletionDto,
  ): Promise<AccountDeletionResponseDto> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        status: { in: ['active', 'deletion_pending'] },
      },
      select: {
        id: true,
        password: true,
        status: true,
        deletedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (user.status === 'active' && user.deletedAt !== null) {
      throw new NotFoundException('User not found.');
    }

    const pepper = this.configService.get<string>('AUTH_PASSWORD_PEPPER') ?? '';
    const isPasswordValid = await verifyPasswordWithPepper(
      dto.password,
      user.password,
      pepper,
    );

    if (!isPasswordValid) {
      throw new BadRequestException({
        code: 'INVALID_PASSWORD',
        message: 'Invalid password.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. SELECT ... FROM "User" WHERE id = $1 FOR UPDATE
      const lockedUsers = await tx.$queryRaw<
        Array<{ id: number; status: string; deletedAt: Date | null }>
      >(Prisma.sql`
        SELECT id, status, "deletedAt"
        FROM "User"
        WHERE id = ${userId}
        FOR UPDATE
      `);

      if (lockedUsers.length === 0) {
        throw new NotFoundException('User not found.');
      }

      const lockedUser = lockedUsers[0];

      // 2. If already has request status = 'requested', return that request (idempotent)
      const existingRequests = await tx.$queryRaw<
        Array<{ id: number; scheduledAt: Date }>
      >(Prisma.sql`
        SELECT id, "scheduledAt"
        FROM "AccountDeletionRequest"
        WHERE "userId" = ${userId}
          AND status = 'requested'
        ORDER BY id DESC
        LIMIT 1
      `);

      if (existingRequests.length > 0) {
        return {
          requestId: existingRequests[0].id,
          scheduledAt: existingRequests[0].scheduledAt,
        };
      }

      if (lockedUser.status !== 'active' || lockedUser.deletedAt !== null) {
        throw new NotFoundException('User not found.');
      }

      // 3. INSERT AccountDeletionRequest with status = 'requested'
      const insertedRows = await tx.$queryRaw<
        Array<{ id: number; scheduledAt: Date }>
      >(Prisma.sql`
        INSERT INTO "AccountDeletionRequest" (
          "userId",
          status,
          reason,
          "verifiedAt",
          "scheduledAt",
          "createdAt",
          "updatedAt"
        )
        VALUES (
          ${userId},
          'requested',
          ${dto.reason ?? null},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP + INTERVAL '7 days',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING id, "scheduledAt"
      `);

      const { id: requestId, scheduledAt } = insertedRows[0];

      // 4. UPDATE User SET status = 'deletion_pending', "deletedAt" = CURRENT_TIMESTAMP
      await tx.$executeRaw(Prisma.sql`
        UPDATE "User"
        SET status = 'deletion_pending',
            "deletedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${userId}
      `);

      // 5. Revoke all UserSession; delete unused reset and verification tokens
      await tx.$executeRaw(Prisma.sql`
        UPDATE "UserSession"
        SET "revokedAt" = CURRENT_TIMESTAMP
        WHERE "userId" = ${userId} AND "revokedAt" IS NULL
      `);

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "PasswordResetToken"
        WHERE "userId" = ${userId} AND "usedAt" IS NULL
      `);

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "EmailVerificationToken"
        WHERE "userId" = ${userId} AND "usedAt" IS NULL
      `);

      // 6. Enqueue jobs in tx
      await this.jobQueue.send(
        JOB_NAMES.ANONYMIZE_ACCOUNT,
        { requestId },
        {
          startAfter: scheduledAt,
          singletonKey: `anonymize:${requestId}`,
          tx,
        },
      );

      await this.jobQueue.send(
        JOB_NAMES.SEND_ACCOUNT_DELETION_SCHEDULED,
        { requestId },
        {
          singletonKey: `deletion-mail:${requestId}`,
          tx,
        },
      );

      // 7. AuditLog: action = 'account.deletion_requested'
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'account.deletion_requested',
          targetType: 'User',
          targetId: String(userId),
          afterSummary: {
            requestId,
            scheduledAt:
              scheduledAt instanceof Date
                ? scheduledAt.toISOString()
                : scheduledAt,
          },
        },
      });

      return { requestId, scheduledAt };
    });
  }

  async getAllUsers(
    query: PaginationQueryDto,
  ): Promise<ApiSuccessResponse<UserItem[]>> {
    const where = { deletedAt: null } satisfies Prisma.UserWhereInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_ITEM_SELECT,
        orderBy: { id: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      success: true,
      data: items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}
