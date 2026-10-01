import {
  Injectable,
  OnApplicationBootstrap,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  JOB_NAMES,
  PG_BOSS_INSTANCE,
} from '../../../infrastructure/jobs/job-queue.port';
import {
  MAILER_PORT,
  type MailerPort,
  MailDeliveryError,
} from '../../../infrastructure/mail/mailer.port';
import type { PgBoss } from 'pg-boss' with { 'resolution-mode': 'import' };

export interface SendEmailVerificationJobPayload {
  userId: number;
}

export const EMAIL_VERIFICATION_SUBJECT =
  'Xác thực địa chỉ email tài khoản HSK 3.0';

export function buildEmailVerificationText(verificationUrl: string): string {
  return (
    `Xin chào,\n\n` +
    `Vui lòng truy cập liên kết sau để xác thực địa chỉ email của bạn:\n` +
    `${verificationUrl}\n\n` +
    `Liên kết này có hiệu lực trong vòng 24 giờ. Nếu bạn không yêu cầu xác thực này, vui lòng bỏ qua email.\n`
  );
}

@Injectable()
export class SendEmailVerificationJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(SendEmailVerificationJob.name);

  constructor(
    @Inject(PG_BOSS_INSTANCE) private readonly boss: PgBoss | null,
    private readonly prisma: PrismaService,
    @Inject(MAILER_PORT) private readonly mailer: MailerPort,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.boss) return;

    await this.boss.work(JOB_NAMES.SEND_EMAIL_VERIFICATION, async (jobs) => {
      for (const job of jobs) {
        await this.process(job.data as SendEmailVerificationJobPayload, job.id);
      }
    });
  }

  async process(
    data: SendEmailVerificationJobPayload,
    jobId?: string,
  ): Promise<boolean> {
    const userId = data?.userId;
    if (typeof userId !== 'number') {
      return false;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
        emailVerifiedAt: true,
      },
    });

    if (
      !user ||
      user.deletedAt !== null ||
      user.status !== 'active' ||
      user.emailVerifiedAt !== null
    ) {
      return false;
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM "EmailVerificationToken"
         WHERE "userId" = $1 AND "usedAt" IS NULL`,
        user.id,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO "EmailVerificationToken" ("userId", "tokenHash", "expiresAt", "createdAt")
         VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '24 hours', CURRENT_TIMESTAMP)`,
        user.id,
        tokenHash,
      );
    });

    const appPublicUrl = this.config.getOrThrow<string>('APP_PUBLIC_URL');
    const verificationUrl = `${appPublicUrl}/verify-email#token=${rawToken}`;
    const text = buildEmailVerificationText(verificationUrl);

    try {
      await this.mailer.send({
        to: user.email,
        subject: EMAIL_VERIFICATION_SUBJECT,
        text,
      });
      return true;
    } catch (err: unknown) {
      if (err instanceof MailDeliveryError && err.retryable) {
        throw err;
      }
      const errorName = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(
        `Email verification delivery failed permanently (jobId: ${jobId ?? 'unknown'}, error: ${errorName})`,
      );
      return false;
    }
  }
}
