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

export interface SendPasswordResetJobPayload {
  userId: number;
}

export const PASSWORD_RESET_SUBJECT = 'Đặt lại mật khẩu tài khoản HSK 3.0';

export function buildPasswordResetText(resetUrl: string): string {
  return (
    `Xin chào,\n\n` +
    `Vui lòng truy cập liên kết sau để đặt lại mật khẩu của bạn:\n` +
    `${resetUrl}\n\n` +
    `Liên kết này có hiệu lực trong vòng 30 phút. Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.\n`
  );
}

@Injectable()
export class SendPasswordResetJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(SendPasswordResetJob.name);

  constructor(
    @Inject(PG_BOSS_INSTANCE) private readonly boss: PgBoss | null,
    private readonly prisma: PrismaService,
    @Inject(MAILER_PORT) private readonly mailer: MailerPort,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.boss) return;

    await this.boss.work(JOB_NAMES.SEND_PASSWORD_RESET, async (jobs) => {
      for (const job of jobs) {
        await this.process(job.data as SendPasswordResetJobPayload, job.id);
      }
    });
  }

  async process(
    data: SendPasswordResetJobPayload,
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
      },
    });

    if (!user || user.deletedAt !== null || user.status !== 'active') {
      return false;
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM "PasswordResetToken"
         WHERE "userId" = $1 AND "usedAt" IS NULL`,
        user.id,
      );

      await tx.$executeRawUnsafe(
        `INSERT INTO "PasswordResetToken" ("userId", "tokenHash", "expiresAt", "createdAt")
         VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 minutes', CURRENT_TIMESTAMP)`,
        user.id,
        tokenHash,
      );
    });

    const appPublicUrl = this.config.getOrThrow<string>('APP_PUBLIC_URL');
    const resetUrl = `${appPublicUrl}/reset-password#token=${rawToken}`;
    const text = buildPasswordResetText(resetUrl);

    try {
      await this.mailer.send({
        to: user.email,
        subject: PASSWORD_RESET_SUBJECT,
        text,
      });
      return true;
    } catch (err: unknown) {
      if (err instanceof MailDeliveryError && err.retryable) {
        throw err;
      }
      const errorName = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(
        `Password reset delivery failed permanently (jobId: ${jobId ?? 'unknown'}, error: ${errorName})`,
      );
      return false;
    }
  }
}
