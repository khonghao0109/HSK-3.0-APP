import { ConfigService } from '@nestjs/config';
import { MailDeliveryError } from '../../../infrastructure/mail/mailer.port';
import {
  PASSWORD_RESET_SUBJECT,
  SendPasswordResetJob,
} from './send-password-reset.job';

describe('SendPasswordResetJob', () => {
  let job: SendPasswordResetJob;
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
      send: jest.fn().mockResolvedValue({ providerMessageId: 'msg-456' }),
    };

    class MockConfigService extends ConfigService {
      override getOrThrow<T = string>(key: string): T {
        if (key === 'APP_PUBLIC_URL') return 'https://app.example.com' as T;
        throw new Error(`Missing config: ${key}`);
      }
    }
    mockConfig = new MockConfigService();

    job = new SendPasswordResetJob(
      null,
      mockPrisma as never,
      mockMailer,
      mockConfig,
    );
  });

  describe('skip conditions (3 cases)', () => {
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
      });

      const result = await job.process({ userId: 102 });
      expect(result).toBe(false);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockMailer.send).not.toHaveBeenCalled();
    });

    it('skips when user status is not active', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 103,
        email: 'suspended@example.com',
        status: 'suspended',
        deletedAt: null,
      });

      const result = await job.process({ userId: 103 });
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
      });

      const result = await job.process({ userId: 201 });
      expect(result).toBe(true);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockMailer.send).toHaveBeenCalledTimes(1);

      const sendArgs = mockMailer.send.mock.calls[0][0];
      expect(sendArgs.to).toBe('learner@example.com');
      expect(sendArgs.subject).toBe(PASSWORD_RESET_SUBJECT);

      // Verify URL fragment with 43-character token
      const match = sendArgs.text.match(
        /https:\/\/app\.example\.com\/reset-password#token=([A-Za-z0-9_-]+)/,
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
      });

      const retryError = new MailDeliveryError('Delivery temporary failure', {
        retryable: true,
      });
      mockMailer.send.mockRejectedValueOnce(retryError);

      await expect(job.process({ userId: 301 }, 'job-reset-1')).rejects.toThrow(
        retryError,
      );
    });

    it('does NOT throw when error is non-retryable (retryable: false)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 302,
        email: 'permanent-fail@example.com',
        status: 'active',
        deletedAt: null,
      });

      const permanentError = new MailDeliveryError('Address rejected', {
        retryable: false,
      });
      mockMailer.send.mockRejectedValueOnce(permanentError);

      const result = await job.process({ userId: 302 }, 'job-reset-2');
      expect(result).toBe(false);
    });
  });
});
