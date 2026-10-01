import { ConfigService } from '@nestjs/config';
import { MailDeliveryError } from '../../../infrastructure/mail/mailer.port';
import {
  EMAIL_VERIFICATION_SUBJECT,
  SendEmailVerificationJob,
} from './send-email-verification.job';

describe('SendEmailVerificationJob', () => {
  let job: SendEmailVerificationJob;
  let mockPrisma: {
    user: {
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let mockMailer: {
    send: jest.Mock;
  };
  let mockConfig: ConfigService;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((cb) => {
        const tx = {
          $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        };
        return cb(tx);
      }),
    };

    mockMailer = {
      send: jest.fn().mockResolvedValue({ providerMessageId: 'msg-123' }),
    };

    class MockConfigService extends ConfigService {
      override get<T = string>(key: string): T {
        if (key === 'APP_PUBLIC_URL') return 'https://app.example.com' as T;
        return undefined as T;
      }
    }
    mockConfig = new MockConfigService();

    job = new SendEmailVerificationJob(
      null,
      mockPrisma as never,
      mockMailer,
      mockConfig,
    );
  });

  describe('skip conditions (4 cases)', () => {
    it('skips when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await job.process({ userId: 101 });
      expect(result).toBe(false);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('skips when user is soft-deleted (deletedAt !== null)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 102,
        email: 'deleted@example.com',
        status: 'active',
        deletedAt: new Date(),
        emailVerifiedAt: null,
      });

      const result = await job.process({ userId: 102 });
      expect(result).toBe(false);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('skips when user status is not active', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 103,
        email: 'inactive@example.com',
        status: 'suspended',
        deletedAt: null,
        emailVerifiedAt: null,
      });

      const result = await job.process({ userId: 103 });
      expect(result).toBe(false);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('skips when email is already verified (emailVerifiedAt !== null)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 104,
        email: 'verified@example.com',
        status: 'active',
        deletedAt: null,
        emailVerifiedAt: new Date(),
      });

      const result = await job.process({ userId: 104 });
      expect(result).toBe(false);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockMailer.send).not.toHaveBeenCalled();
    });
  });

  describe('successful processing and link format', () => {
    it('generates 43-character rawToken in URL fragment and sends email', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 201,
        email: 'learner@example.com',
        status: 'active',
        deletedAt: null,
        emailVerifiedAt: null,
      });

      const result = await job.process({ userId: 201 });
      expect(result).toBe(true);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockMailer.send).toHaveBeenCalledTimes(1);

      const sendArgs = mockMailer.send.mock.calls[0][0];
      expect(sendArgs.to).toBe('learner@example.com');
      expect(sendArgs.subject).toBe(EMAIL_VERIFICATION_SUBJECT);

      // Verify URL fragment with 43-character token
      const match = sendArgs.text.match(
        /https:\/\/app\.example\.com\/verify-email#token=([A-Za-z0-9_-]+)/,
      );
      expect(match).not.toBeNull();
      const rawToken = match![1];
      expect(rawToken).toHaveLength(43);
      expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
  });

  describe('error handling and retries', () => {
    it('rethrows when MailDeliveryError is retryable: true', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 301,
        email: 'retry@example.com',
        status: 'active',
        deletedAt: null,
        emailVerifiedAt: null,
      });

      const retryError = new MailDeliveryError('Delivery failed', {
        retryable: true,
      });
      mockMailer.send.mockRejectedValueOnce(retryError);

      await expect(job.process({ userId: 301 }, 'job-1')).rejects.toThrow(
        retryError,
      );
    });

    it('does NOT throw when error is non-retryable (retryable: false)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 302,
        email: 'permanent-fail@example.com',
        status: 'active',
        deletedAt: null,
        emailVerifiedAt: null,
      });

      const permanentError = new MailDeliveryError('Account suspended', {
        retryable: false,
      });
      mockMailer.send.mockRejectedValueOnce(permanentError);

      const result = await job.process({ userId: 302 }, 'job-2');
      expect(result).toBe(false);
    });
  });
});
