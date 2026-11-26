import {
  Injectable,
  OnApplicationBootstrap,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  JOB_NAMES,
  PG_BOSS_INSTANCE,
} from '../../../infrastructure/jobs/job-queue.port';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };
import { hashPasswordWithPepper } from '../../auth/utils/password-hasher';
import {
  countActiveAdmins,
  lockAdminUsers,
} from '../../admin-users/admin-users.policy';

export interface AnonymizeAccountJobPayload {
  requestId: number;
}

@Injectable()
export class AnonymizeAccountJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(AnonymizeAccountJob.name);

  constructor(
    @Inject(PG_BOSS_INSTANCE) private readonly boss: PgBoss | null,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.boss) return;

    await this.boss.work(JOB_NAMES.ANONYMIZE_ACCOUNT, async (jobs) => {
      for (const job of jobs) {
        await this.process(job.data as AnonymizeAccountJobPayload, job.id);
      }
    });
  }

  async process(
    data: AnonymizeAccountJobPayload,
    jobId?: string,
  ): Promise<boolean> {
    const requestId = data?.requestId;
    if (typeof requestId !== 'number') {
      return false;
    }

    const randomSecret = crypto.randomBytes(32).toString('base64url');
    const pepper = this.config.get<string>('AUTH_PASSWORD_PEPPER') ?? '';
    const dummyPasswordHash = await hashPasswordWithPepper(
      randomSecret,
      pepper,
    );

    return this.prisma.$transaction(async (tx) => {
      // M1.7c-H1: the M5.3 admin-users lock comes first, the same order as
      // `deletion-request` and the admin mutations.
      await lockAdminUsers(tx);

      // M1.7d lock order: read `userId` without a lock, then lock the `User` row
      // before the request row — the same order the login cancellation path and
      // the admin mutation use, so the three writers serialize instead of
      // deadlocking. `status` and `isPastDue` are re-checked after both locks.
      const lookup = await tx.$queryRaw<Array<{ id: number; userId: number }>>(
        Prisma.sql`
          SELECT id, "userId"
          FROM "AccountDeletionRequest"
          WHERE id = ${requestId}
        `,
      );

      if (lookup.length === 0) {
        this.logger.warn(
          `Account deletion request not found (requestId: ${requestId}, jobId: ${jobId ?? 'unknown'})`,
        );
        return false;
      }

      const userId = lookup[0].userId;

      const lockedUsers = await tx.$queryRaw<Array<{ role: string }>>(
        Prisma.sql`
          SELECT role FROM "User" WHERE id = ${userId} FOR UPDATE
        `,
      );

      const requests = await tx.$queryRaw<
        Array<{
          id: number;
          userId: number;
          status: string;
          isPastDue: boolean;
        }>
      >(Prisma.sql`
        SELECT
          id,
          "userId",
          status,
          ("scheduledAt" <= CURRENT_TIMESTAMP) as "isPastDue"
        FROM "AccountDeletionRequest"
        WHERE id = ${requestId}
        FOR UPDATE
      `);

      if (requests.length === 0) {
        this.logger.warn(
          `Account deletion request disappeared while locking (requestId: ${requestId}, jobId: ${jobId ?? 'unknown'})`,
        );
        return false;
      }

      const request = requests[0];
      if (request.status !== 'requested') {
        // Idempotent: already cancelled or completed
        return true;
      }

      if (!request.isPastDue) {
        this.logger.warn(
          `Account deletion request is not due yet (requestId: ${requestId}, jobId: ${jobId ?? 'unknown'})`,
        );
        throw new Error('Account deletion request is not due yet');
      }

      // M1.7c-H1: a pending admin is no longer counted as active. Should they
      // be the only admin left (another one demoted meanwhile), keep the
      // request `requested` and leave it to an operator instead of deleting
      // the last admin. Login still cancels it as usual.
      if (
        lockedUsers[0]?.role === 'admin' &&
        (await countActiveAdmins(tx)) === 0
      ) {
        this.logger.error(
          `Account deletion of the last admin blocked (requestId: ${requestId}, jobId: ${jobId ?? 'unknown'})`,
        );
        await tx.auditLog.create({
          data: {
            actorId: null,
            action: 'account.anonymize_blocked_last_admin',
            targetType: 'User',
            targetId: String(request.userId),
            afterSummary: { requestId },
          },
        });
        return false;
      }

      const updatedUsers = await tx.$executeRaw(Prisma.sql`
        UPDATE "User"
        SET email = 'deleted+' || id || '@anonymized.invalid',
            name = NULL,
            password = ${dummyPasswordHash},
            status = 'anonymized',
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${request.userId} AND status = 'deletion_pending'
      `);

      if (updatedUsers === 0) {
        throw new Error(
          `Abnormal state: User ${request.userId} is not in deletion_pending for request ${requestId}`,
        );
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE "UserProfile"
        SET "displayName" = NULL,
            "avatarUrl" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "userId" = ${request.userId}
      `);

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "UserSession"
        WHERE "userId" = ${request.userId}
      `);

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "PasswordResetToken"
        WHERE "userId" = ${request.userId}
      `);

      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "EmailVerificationToken"
        WHERE "userId" = ${request.userId}
      `);

      await tx.$executeRaw(Prisma.sql`
        UPDATE "AccountDeletionRequest"
        SET status = 'completed',
            reason = NULL,
            "completedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ${requestId}
      `);

      await tx.auditLog.create({
        data: {
          actorId: request.userId,
          action: 'account.anonymized',
          targetType: 'User',
          targetId: String(request.userId),
          afterSummary: { requestId },
        },
      });

      return true;
    });
  }
}
