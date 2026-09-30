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
          `Account deletion request not found (requestId: ${requestId}, jobId: ${jobId ?? 'unknown'})`,
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
