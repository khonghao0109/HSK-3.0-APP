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
    user: { count: jest.Mock };
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
  const primeLockSequence = (
    locked: LockedRequestRow = dueRequest(),
    role: 'user' | 'admin' = 'user',
  ) => {
    mockTx.$queryRaw
      .mockResolvedValueOnce([{ id: locked.id, userId: locked.userId }])
      .mockResolvedValueOnce([
        { id: locked.userId, role, status: 'deletion_pending' },
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
      user: { count: jest.fn() },
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
    // Nothing is written: the only raw statement is the admin-users lock.
    const expectOnlyAdvisoryLock = () => {
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      const [lock] = mockTx.$executeRaw.mock.calls[0] as [
        { strings: readonly string[] },
      ];
      expect(lock.strings.join('?')).toContain('pg_advisory_xact_lock');
    };

    it('returns false when requestId is not a number', async () => {
      const result = await job.process({ requestId: 'invalid' as never });
      expect(result).toBe(false);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns false when request is not found in database', async () => {
      mockTx.$queryRaw.mockResolvedValueOnce([]);

      const result = await job.process({ requestId: 99 });
      expect(result).toBe(false);
      expectOnlyAdvisoryLock();
    });

    it('returns true idempotently when request status is already completed', async () => {
      primeLockSequence(dueRequest({ status: 'completed' }));

      const result = await job.process({ requestId: 10 });
      expect(result).toBe(true);
      expectOnlyAdvisoryLock();
    });

    it('returns true idempotently when request status is cancelled', async () => {
      primeLockSequence(dueRequest({ status: 'cancelled' }));

      const result = await job.process({ requestId: 10 });
      expect(result).toBe(true);
      expectOnlyAdvisoryLock();
    });

    it('throws error when request is not past due (grace period active)', async () => {
      primeLockSequence(dueRequest({ isPastDue: false }));

      await expect(job.process({ requestId: 10 })).rejects.toThrow(
        'Account deletion request is not due yet',
      );
      expectOnlyAdvisoryLock();
    });

    it('throws error when user update returns 0 rows', async () => {
      primeLockSequence();
      // The advisory lock, then the `User` update affecting no row.
      mockTx.$executeRaw.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

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
      // Only the admin-users advisory lock ran.
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockTx.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('last active admin (M1.7c-H1, M5.3)', () => {
    const sqlOf = (call: unknown[] | undefined) =>
      (
        (call?.[0] as { strings?: readonly string[] } | undefined)?.strings ??
        []
      ).join('?');

    it('takes the admin-users advisory lock before locking the User row', async () => {
      primeLockSequence();
      mockTx.$executeRaw.mockResolvedValue(1);

      await job.process({ requestId: 10 });

      const lock = mockTx.$executeRaw.mock.calls[0];
      expect(sqlOf(lock)).toContain('pg_advisory_xact_lock');
      expect((lock?.[0] as { values: unknown[] }).values).toEqual([5_300_201]);
      expect(mockTx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockTx.$queryRaw.mock.invocationCallOrder[1],
      );
      expect(mockTx.user.count).not.toHaveBeenCalled();
    });

    it('does not anonymize an admin when no other active admin is left', async () => {
      primeLockSequence(dueRequest(), 'admin');
      mockTx.$executeRaw.mockResolvedValue(1);
      mockTx.user.count.mockResolvedValue(0);

      const result = await job.process({ requestId: 10 });

      expect(result).toBe(false);
      expect(mockTx.user.count).toHaveBeenCalledWith({
        where: { role: 'admin', status: 'active', deletedAt: null },
      });
      // Only the advisory lock: no anonymization, the request stays `requested`.
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockTx.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorId: null,
          action: 'account.anonymize_blocked_last_admin',
          targetType: 'User',
          targetId: '5',
          afterSummary: { requestId: 10 },
        },
      });
    });

    it('anonymizes an admin while another active admin remains', async () => {
      primeLockSequence(dueRequest(), 'admin');
      mockTx.$executeRaw.mockResolvedValue(1);
      mockTx.user.count.mockResolvedValue(1);

      await expect(job.process({ requestId: 10 })).resolves.toBe(true);
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(7);
    });
  });

  describe('successful anonymization', () => {
    it('anonymizes user, clears profile, deletes sessions/tokens, and marks completed', async () => {
      primeLockSequence();
      mockTx.$executeRaw.mockResolvedValue(1);

      const result = await job.process({ requestId: 10 });

      expect(result).toBe(true);
      // Admin-users advisory lock, user update, profile update, session delete, reset token delete, verification token delete, request update = 7 executeRaw calls
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(7);
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
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(7);
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
