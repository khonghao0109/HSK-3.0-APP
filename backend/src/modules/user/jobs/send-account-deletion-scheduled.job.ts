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

/**
 * M1.7d / Q203 + Q204 + Q205: an admin opened the deletion because the account
 * holder is under 16. Unlike the self-service mail, this one has no FAQ/login
 * link and no cancel instruction — the only way out is contacting the operator
 * through privacy policy §11 (Q204: `${APP_PUBLIC_URL}/privacy`, no extra
 * config).
 */
export function buildAdminInitiatedAccountDeletionText(
  scheduledAtFormatted: string,
  privacyUrl: string,
): string {
  return (
    `Xin chào,\n\n` +
    `Tài khoản của bạn đã được quản trị viên lên lịch xoá vĩnh viễn vào lúc:\n` +
    `${scheduledAtFormatted}\n\n` +
    `Lý do: tài khoản thuộc nhóm dưới 16 tuổi.\n\n` +
    `Sau thời điểm trên, tài khoản sẽ được ẩn danh và không thể phục hồi.\n\n` +
    `Nếu bạn cần thêm thông tin, xem mục 11 tại ${privacyUrl}.\n`
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
        initiatedBy: true,
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
    const timezone = request.user.profile?.timezone || 'Asia/Ho_Chi_Minh';
    const formattedDate = formatDeletionScheduledDate(
      request.scheduledAt,
      timezone,
    );
    const text =
      request.initiatedBy === 'admin'
        ? buildAdminInitiatedAccountDeletionText(
            formattedDate,
            `${appPublicUrl}/privacy`,
          )
        : buildAccountDeletionScheduledText(
            formattedDate,
            `${appPublicUrl}/login`,
          );

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
