import {
  Injectable,
  OnApplicationBootstrap,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

export interface SendAccountDeletionScheduledJobPayload {
  requestId: number;
}

export const ACCOUNT_DELETION_SCHEDULED_SUBJECT =
  'Thông báo lịch xoá tài khoản HSK 3.0';

export function formatDeletionScheduledDate(
  date: Date,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function buildAccountDeletionScheduledText(
  scheduledAtFormatted: string,
  loginUrl: string,
): string {
  return (
    `Xin chào,\n\n` +
    `Yêu cầu xoá tài khoản của bạn đã được tiếp nhận. Tài khoản của bạn được lên lịch xoá vĩnh viễn vào lúc:\n` +
    `${scheduledAtFormatted}\n\n` +
    `Để huỷ, hãy đăng nhập lại tại ${loginUrl} trước thời điểm này.\n\n` +
    `Nếu bạn không yêu cầu xoá tài khoản, hãy đăng nhập lại ngay lập tức để bảo vệ tài khoản của mình.\n`
  );
}

@Injectable()
export class SendAccountDeletionScheduledJob implements OnApplicationBootstrap {
  private readonly logger = new Logger(SendAccountDeletionScheduledJob.name);

  constructor(
    @Inject(PG_BOSS_INSTANCE) private readonly boss: PgBoss | null,
    private readonly prisma: PrismaService,
    @Inject(MAILER_PORT) private readonly mailer: MailerPort,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.boss) return;

    await this.boss.work(
      JOB_NAMES.SEND_ACCOUNT_DELETION_SCHEDULED,
      async (jobs) => {
        for (const job of jobs) {
          await this.process(
            job.data as SendAccountDeletionScheduledJobPayload,
            job.id,
          );
        }
      },
    );
  }

  async process(
    data: SendAccountDeletionScheduledJobPayload,
    jobId?: string,
  ): Promise<boolean> {
    const requestId = data?.requestId;
    if (typeof requestId !== 'number') {
      return false;
    }

    const request = await this.prisma.accountDeletionRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        user: {
          select: {
            id: true,
            email: true,
            status: true,
            deletedAt: true,
            profile: {
              select: {
                timezone: true,
                locale: true,
              },
            },
          },
        },
      },
    });

    if (
      !request ||
      request.status !== 'requested' ||
      !request.scheduledAt ||
      !request.user
    ) {
      return false;
    }

    const appPublicUrl = this.config.getOrThrow<string>('APP_PUBLIC_URL');
    const loginUrl = `${appPublicUrl}/login`;
    const timezone = request.user.profile?.timezone || 'Asia/Ho_Chi_Minh';
    const formattedDate = formatDeletionScheduledDate(
      request.scheduledAt,
      timezone,
    );
    const text = buildAccountDeletionScheduledText(formattedDate, loginUrl);

    try {
      await this.mailer.send({
        to: request.user.email,
        subject: ACCOUNT_DELETION_SCHEDULED_SUBJECT,
        text,
      });
      return true;
    } catch (err: unknown) {
      if (err instanceof MailDeliveryError && err.retryable) {
        throw err;
      }
      const errorName = err instanceof Error ? err.name : 'UnknownError';
      this.logger.error(
        `Account deletion notification failed permanently (jobId: ${jobId ?? 'unknown'}, error: ${errorName})`,
      );
      return false;
    }
  }
}
