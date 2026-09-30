import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { ApiSuccessResponse } from '../../common/interfaces/api-response.interface';
import { PrismaService } from '../../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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
