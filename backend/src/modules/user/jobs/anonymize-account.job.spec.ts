import { ConfigService } from '@nestjs/config';
import { AnonymizeAccountJob } from './anonymize-account.job';

describe('AnonymizeAccountJob', () => {
  let job: AnonymizeAccountJob;
  let mockTx: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    auditLog: {
      create: jest.Mock;
    };
  };
  let mockPrisma: {
    $transaction: jest.Mock;
  };
  let mockConfig: ConfigService;

  beforeEach(() => {
    mockTx = {
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };

    mockPrisma = {
      $transaction: jest.fn((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
    };

    class MockConfigService extends ConfigService {
      override get<T = string>(key: string): T | undefined {
        if (key === 'AUTH_PASSWORD_PEPPER') return 'test-pepper' as T;
        return undefined;
      }
    }
    mockConfig = new MockConfigService();

    job = new AnonymizeAccountJob(null, mockPrisma as never, mockConfig);
  });

  describe('input validation and skip conditions', () => {
    it('returns false when requestId is not a number', async () => {
      const result = await job.process({ requestId: 'invalid' as never });
      expect(result).toBe(false);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns false when request is not found in database', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([]);

      const result = await job.process({ requestId: 99 });
      expect(result).toBe(false);
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('returns true idempotently when request status is already completed', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([
        { id: 10, userId: 5, status: 'completed', isPastDue: true },
      ]);

      const result = await job.process({ requestId: 10 });
      expect(result).toBe(true);
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('returns true idempotently when request status is cancelled', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([
        { id: 10, userId: 5, status: 'cancelled', isPastDue: true },
      ]);

      const result = await job.process({ requestId: 10 });
      expect(result).toBe(true);
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('throws error when request is not past due (grace period active)', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([
        { id: 10, userId: 5, status: 'requested', isPastDue: false },
      ]);

      await expect(job.process({ requestId: 10 })).rejects.toThrow(
        'Account deletion request is not due yet',
      );
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('throws error when user update returns 0 rows', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([
        { id: 10, userId: 5, status: 'requested', isPastDue: true },
      ]);
      mockTx.$executeRaw.mockResolvedValueOnce(0);

      await expect(job.process({ requestId: 10 })).rejects.toThrow(
        'Abnormal state: User 5 is not in deletion_pending for request 10',
      );
    });
  });

  describe('successful anonymization', () => {
    it('anonymizes user, clears profile, deletes sessions/tokens, and marks completed', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([
        { id: 10, userId: 5, status: 'requested', isPastDue: true },
      ]);
      mockTx.$executeRaw.mockResolvedValue(1);

      const result = await job.process({ requestId: 10 });

      expect(result).toBe(true);
      // User update, profile update, session delete, reset token delete, verification token delete, request update = 6 executeRaw calls
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(6);
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: 5,
          action: 'account.anonymized',
          targetType: 'User',
          targetId: '5',
          afterSummary: { requestId: 10 },
        },
      });
    });
  });
});
