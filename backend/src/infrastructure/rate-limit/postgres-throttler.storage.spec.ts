import { Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

import {
  PostgresThrottlerStorage,
  RATE_LIMIT_CLEANUP_INTERVAL_MS,
} from './postgres-throttler.storage';

describe('PostgresThrottlerStorage', () => {
  const queryRaw = jest.fn();
  const executeRaw = jest.fn();
  const prisma = {
    $queryRaw: queryRaw,
    $executeRaw: executeRaw,
  } as unknown as PrismaService;
  let storage: PostgresThrottlerStorage;

  beforeEach(() => {
    jest.clearAllMocks();
    storage = new PostgresThrottlerStorage(prisma);
  });

  afterEach(() => {
    storage.onModuleDestroy();
    jest.useRealTimers();
  });

  it('reports an admitted hit with the window expiry', async () => {
    queryRaw.mockResolvedValue([{ points: 20, secondsToExpire: 42 }]);

    await expect(storage.increment('key', 60_000, 20, 60_000)).resolves.toEqual(
      {
        totalHits: 20,
        timeToExpire: 42,
        isBlocked: false,
        timeToBlockExpire: 0,
      },
    );
  });

  it('reports a blocked hit once points exceed the limit', async () => {
    queryRaw.mockResolvedValue([{ points: 21, secondsToExpire: 60 }]);

    await expect(storage.increment('key', 60_000, 20, 60_000)).resolves.toEqual(
      {
        totalHits: 21,
        timeToExpire: 60,
        isBlocked: true,
        timeToBlockExpire: 60,
      },
    );
  });

  it('binds key and durations as parameters in a single upsert', async () => {
    queryRaw.mockResolvedValue([{ points: 1, secondsToExpire: 60 }]);

    await storage.increment("k'; DROP TABLE x; --", 60_000, 20, 30_000);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [sql] = queryRaw.mock.calls[0] as [
      { sql: string; values: unknown[] },
    ];
    expect(sql.sql).toContain('ON CONFLICT ("key") DO UPDATE');
    expect(sql.sql).not.toContain('DROP TABLE');
    expect(sql.values).toEqual(
      expect.arrayContaining(["k'; DROP TABLE x; --", 60_000, 20, 30_000]),
    );
  });

  it.each([
    ['ttl', [0, 20, 60_000]],
    ['limit', [60_000, -1, 60_000]],
    ['blockDuration', [60_000, 20, 0]],
    ['non-integer ttl', [1.5, 20, 60_000]],
  ] as const)(
    'rejects an invalid %s before querying',
    async (_label, [ttl, limit, block]) => {
      await expect(storage.increment('key', ttl, limit, block)).rejects.toThrow(
        'Rate limit',
      );
      expect(queryRaw).not.toHaveBeenCalled();
    },
  );

  it('propagates storage failures so the guard fails closed', async () => {
    queryRaw.mockRejectedValue(new Error('connection lost'));

    await expect(storage.increment('key', 60_000, 20, 60_000)).rejects.toThrow(
      'connection lost',
    );
  });

  it('resets one counter by its bound key', async () => {
    executeRaw.mockResolvedValue(1);

    await storage.reset('login-key');

    const [sql] = executeRaw.mock.calls[0] as [
      { sql: string; values: unknown[] },
    ];
    expect(sql.sql).toContain('DELETE FROM "RateLimitCounter"');
    expect(sql.values).toEqual(['login-key']);
  });

  it('purges in batches until a batch is not full', async () => {
    executeRaw
      .mockResolvedValueOnce(1_000)
      .mockResolvedValueOnce(1_000)
      .mockResolvedValueOnce(7);

    await expect(storage.purgeExpired()).resolves.toBe(2_007);
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  it('bounds one purge run to ten full batches', async () => {
    executeRaw.mockResolvedValue(1_000);

    await expect(storage.purgeExpired()).resolves.toBe(10_000);
    expect(executeRaw).toHaveBeenCalledTimes(10);
  });

  it('runs cleanup on an interval, logs failures and stops on destroy', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    executeRaw.mockRejectedValueOnce(new Error('secret detail'));
    executeRaw.mockResolvedValue(0);

    storage.onModuleInit();
    await jest.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(warn).toHaveBeenCalledWith('Rate limit cleanup failed: Error');

    await jest.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS);
    expect(executeRaw).toHaveBeenCalledTimes(2);

    storage.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(RATE_LIMIT_CLEANUP_INTERVAL_MS * 3);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });
});
