import { ConfigService } from '@nestjs/config';
import { MailDeliveryError } from '../../../infrastructure/mail/mailer.port';
import {
  ACCOUNT_DELETION_SCHEDULED_SUBJECT,
  SendAccountDeletionScheduledJob,
} from './send-account-deletion-scheduled.job';

describe('SendAccountDeletionScheduledJob', () => {
  let job: SendAccountDeletionScheduledJob;
  let mockPrisma: {
    accountDeletionRequest: {
      findUnique: jest.Mock;
    };
  };
  let mockMailer: {
    send: jest.Mock;
  };
  let mockConfig: ConfigService;

  beforeEach(() => {
    mockPrisma = {
      accountDeletionRequest: {
        findUnique: jest.fn(),
      },
    };

    mockMailer = {
      send: jest.fn().mockResolvedValue({ providerMessageId: 'msg-del-123' }),
    };

    class MockConfigService extends ConfigService {
      override getOrThrow<T = string>(key: string): T {
        if (key === 'APP_PUBLIC_URL') return 'https://app.example.com' as T;
        throw new Error(`Missing config: ${key}`);
      }
    }
    mockConfig = new MockConfigService();

    job = new SendAccountDeletionScheduledJob(
      null,
      mockPrisma as never,
      mockMailer,
      mockConfig,
    );
  });

  describe('skip conditions', () => {
    it('returns false when requestId is not a number', async () => {
      const result = await job.process({ requestId: 'invalid' as never });
      expect(result).toBe(false);
      expect(
        mockPrisma.accountDeletionRequest.findUnique,
      ).not.toHaveBeenCalled();
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('returns false when request is not found', async () => {
      mockPrisma.accountDeletionRequest.findUnique.mockResolvedValueOnce(null);

      const result = await job.process({ requestId: 101 });
      expect(result).toBe(false);
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('returns false when request status is cancelled', async () => {
      mockPrisma.accountDeletionRequest.findUnique.mockResolvedValueOnce({
        id: 102,
        status: 'cancelled',
        scheduledAt: new Date(),
        user: { id: 1, email: 'u@example.com', profile: null },
      });

      const result = await job.process({ requestId: 102 });
      expect(result).toBe(false);
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('returns false when request status is completed', async () => {
      mockPrisma.accountDeletionRequest.findUnique.mockResolvedValueOnce({
        id: 103,
        status: 'completed',
        scheduledAt: new Date(),
        user: { id: 1, email: 'u@example.com', profile: null },
      });

      const result = await job.process({ requestId: 103 });
      expect(result).toBe(false);
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('returns false when user is null', async () => {
      mockPrisma.accountDeletionRequest.findUnique.mockResolvedValueOnce({
        id: 104,
        status: 'requested',
        scheduledAt: new Date(),
        user: null,
      });

      const result = await job.process({ requestId: 104 });
      expect(result).toBe(false);
      expect(mockMailer.send).not.toHaveBeenCalled();
    });
  });

  describe('successful email delivery', () => {
    it('formats date using user profile timezone and sends email', async () => {
      const fixedDate = new Date('2026-10-07T08:30:00.000Z');
      mockPrisma.accountDeletionRequest.findUnique.mockResolvedValueOnce({
        id: 201,
        status: 'requested',
        scheduledAt: fixedDate,
        user: {
          id: 5,
          email: 'user@example.com',
          profile: { timezone: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' },
        },
      });

      const result = await job.process({ requestId: 201 });

      expect(result).toBe(true);
      expect(mockMailer.send).toHaveBeenCalledTimes(1);
      const call = mockMailer.send.mock.calls[0][0];
      expect(call.to).toBe('user@example.com');
      expect(call.subject).toBe(ACCOUNT_DELETION_SCHEDULED_SUBJECT);
      expect(call.text).toContain('https://app.example.com/login');
      expect(call.text).toContain('2026');
      expect(call.text).not.toContain('reason');
    });

    it('defaults to Asia/Ho_Chi_Minh timezone when user profile is null', async () => {
      const fixedDate = new Date('2026-10-07T08:30:00.000Z');
      mockPrisma.accountDeletionRequest.findUnique.mockResolvedValueOnce({
        id: 202,
        status: 'requested',
        scheduledAt: fixedDate,
        user: {
          id: 6,
          email: 'user2@example.com',
          profile: null,
        },
      });

      const result = await job.process({ requestId: 202 });

      expect(result).toBe(true);
      expect(mockMailer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user2@example.com',
          subject: ACCOUNT_DELETION_SCHEDULED_SUBJECT,
        }),
      );
    });

    it('keeps the user-initiated body byte-identical', async () => {
      const fixedDate = new Date('2026-10-07T08:30:00.000Z');
      mockPrisma.accountDeletionRequest.findUnique.mockResolvedValueOnce({
        id: 203,
        status: 'requested',
        initiatedBy: 'user',
        scheduledAt: fixedDate,
        user: {
          id: 9,
          email: 'user3@example.com',
          profile: { timezone: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' },
        },
      });

      const result = await job.process({ requestId: 203 });

      expect(result).toBe(true);
      const call = mockMailer.send.mock.calls[0][0];
      expect(call.text).toBe(
        `Xin chào,\n\n` +
          `Yêu cầu xoá tài khoản của bạn đã được tiếp nhận. Tài khoản của bạn được lên lịch xoá vĩnh viễn vào lúc:\n` +
          `15:30:00 07/10/2026\n\n` +
          `Để huỷ, hãy đăng nhập lại tại https://app.example.com/login trước thời điểm này.\n\n` +
          `Nếu bạn không yêu cầu xoá tài khoản, hãy đăng nhập lại ngay lập tức để bảo vệ tài khoản của mình.\n`,
      );
    });

    it('sends the admin body without a login link or a cancel instruction', async () => {
      const fixedDate = new Date('2026-10-07T08:30:00.000Z');
      mockPrisma.accountDeletionRequest.findUnique.mockResolvedValueOnce({
        id: 204,
        status: 'requested',
        initiatedBy: 'admin',
        scheduledAt: fixedDate,
        user: {
          id: 10,
          email: 'minor@example.com',
          profile: { timezone: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' },
        },
      });

      const result = await job.process({ requestId: 204 });

      expect(result).toBe(true);
      const call = mockMailer.send.mock.calls[0][0];
      expect(call.to).toBe('minor@example.com');
      expect(call.subject).toBe(ACCOUNT_DELETION_SCHEDULED_SUBJECT);
      // Q205: the admin mail has no way to cancel — no login link, no
      // "log in again" instruction and no cancel wording (diacritics or not).
      expect(call.text).not.toContain('/login');
      expect(call.text).not.toContain('đăng nhập');
      expect(call.text).not.toContain('huỷ');
      expect(call.text).not.toContain('hủy');
      // It names the anonymization date and one contact line to /privacy §11.
      expect(call.text).toContain('15:30:00 07/10/2026');
      expect(call.text).toContain('dưới 16 tuổi');
      expect(call.text).toContain('https://app.example.com/privacy');
      expect(call.text).toContain('mục 11');
      expect(call.text).toContain('ẩn danh');
    });
  });

  describe('error handling', () => {
    it('rethrows retryable MailDeliveryError so pg-boss will retry', async () => {
      mockPrisma.accountDeletionRequest.findUnique.mockResolvedValueOnce({
        id: 301,
        status: 'requested',
        scheduledAt: new Date(),
        user: {
          id: 7,
          email: 'retry@example.com',
          profile: null,
        },
      });
      mockMailer.send.mockRejectedValueOnce(
        new MailDeliveryError('SMTP connection timeout', { retryable: true }),
      );

      await expect(job.process({ requestId: 301 })).rejects.toThrow(
        MailDeliveryError,
      );
    });

    it('returns false and does not rethrow on permanent mail failure', async () => {
      mockPrisma.accountDeletionRequest.findUnique.mockResolvedValueOnce({
        id: 302,
        status: 'requested',
        scheduledAt: new Date(),
        user: {
          id: 8,
          email: 'fail@example.com',
          profile: null,
        },
      });
      mockMailer.send.mockRejectedValueOnce(
        new MailDeliveryError('Invalid recipient mailbox', {
          retryable: false,
        }),
      );

      const result = await job.process({ requestId: 302 });
      expect(result).toBe(false);
    });
  });
});
