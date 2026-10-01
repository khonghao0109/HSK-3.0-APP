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
