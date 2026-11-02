import { ConfigService } from '@nestjs/config';
import { AnonymizeAccountJob } from './anonymize-account.job';

type LockedRequestRow = {
  id: number;
  userId: number;
  status: string;
  isPastDue: boolean;
  initiatedBy: 'user' | 'admin';
};

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

  const dueRequest = (
    overrides: Partial<LockedRequestRow> = {},
  ): LockedRequestRow => ({
    id: 10,
    userId: 5,
    status: 'requested',
    isPastDue: true,
    initiatedBy: 'user',
    ...overrides,
  });

  /**
   * M1.7d lock order: (1) unlocked read of the request for `userId`, (2) lock
   * the user row, (3) lock the request row and re-check `status`/`isPastDue`.
   */
  const primeLockSequence = (locked: LockedRequestRow = dueRequest()) => {
    mockTx.$queryRaw
      .mockResolvedValueOnce([{ id: locked.id, userId: locked.userId }])
      .mockResolvedValueOnce([
        { id: locked.userId, status: 'deletion_pending' },
      ])
      .mockResolvedValueOnce([locked]);
  };

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
      primeLockSequence(dueRequest({ status: 'completed' }));

      const result = await job.process({ requestId: 10 });
      expect(result).toBe(true);
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('returns true idempotently when request status is cancelled', async () => {
      primeLockSequence(dueRequest({ status: 'cancelled' }));

      const result = await job.process({ requestId: 10 });
      expect(result).toBe(true);
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('throws error when request is not past due (grace period active)', async () => {
      primeLockSequence(dueRequest({ isPastDue: false }));

      await expect(job.process({ requestId: 10 })).rejects.toThrow(
        'Account deletion request is not due yet',
      );
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
    });

    it('throws error when user update returns 0 rows', async () => {
      primeLockSequence();
      mockTx.$executeRaw.mockResolvedValueOnce(0);

      await expect(job.process({ requestId: 10 })).rejects.toThrow(
        'Abnormal state: User 5 is not in deletion_pending for request 10',
      );
    });
  });

  describe('lock order and re-check', () => {
    it('locks the User row before the request row', async () => {
      primeLockSequence();
      mockTx.$executeRaw.mockResolvedValue(1);

      await job.process({ requestId: 10 });

      const statements = mockTx.$queryRaw.mock.calls.map(
        ([call]) => (call as { sql: string }).sql,
      );
      const userLock = statements.findIndex((sql) =>
        /FROM "User"[\s\S]*FOR UPDATE/u.test(sql),
      );
      const requestLock = statements.findIndex((sql) =>
        /FROM "AccountDeletionRequest"[\s\S]*FOR UPDATE/u.test(sql),
      );
      expect(userLock).toBeGreaterThanOrEqual(0);
      expect(requestLock).toBeGreaterThan(userLock);
    });

    it('re-checks status after the locks and skips a request cancelled meanwhile', async () => {
      primeLockSequence(dueRequest({ status: 'cancelled' }));

      const result = await job.process({ requestId: 10 });

      expect(result).toBe(true);
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(mockTx.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('successful anonymization', () => {
    it('anonymizes user, clears profile, deletes sessions/tokens, and marks completed', async () => {
      primeLockSequence();
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

    it('anonymizes an admin-initiated request exactly like a user-initiated one', async () => {
      primeLockSequence(dueRequest({ initiatedBy: 'admin' }));
      mockTx.$executeRaw.mockResolvedValue(1);

      const result = await job.process({ requestId: 10 });

      expect(result).toBe(true);
      // The worker does not branch on `initiatedBy`: the deletion lifecycle is
      // identical once the request is due.
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
