import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

// @nestjs/throttler 6 does not export the record interface from its index.
type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

export const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
const CLEANUP_BATCH_SIZE = 1_000;
const CLEANUP_MAX_BATCHES = 10;

type CounterRow = { points: number; secondsToExpire: number };

/**
 * `@nestjs/throttler` storage on `RateLimitCounter`, so every replica shares
 * one fixed-window count per key (ADR-008 §2).
 *
 * `increment` is one INSERT ... ON CONFLICT DO UPDATE: PostgreSQL locks the
 * row, so concurrent hits on a key serialize and none is lost. Time comes only
 * from the database clock, at the column's millisecond precision so stored
 * and returned expiry agree. A block is `points > limit` with `expireAt` moved
 * to the end of the block; blocked hits are not counted, and the first hit
 * after `expireAt` starts a new window. Storage errors propagate, so the
 * guard fails closed instead of skipping the limit.
 */
@Injectable()
export class PostgresThrottlerStorage
  implements ThrottlerStorage, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PostgresThrottlerStorage.name);
  private cleanupTimer?: NodeJS.Timeout;
  private cleanupInFlight = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      void this.runScheduledCleanup();
    }, RATE_LIMIT_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): Promise<ThrottlerStorageRecord> {
    assertWholeNumber('ttl', ttl, 1);
    assertWholeNumber('limit', limit, 0);
    assertWholeNumber('blockDuration', blockDuration, 1);

    const rows = await this.prisma.$queryRaw<CounterRow[]>(Prisma.sql`
      INSERT INTO "RateLimitCounter" AS counter ("key", "points", "expireAt")
      VALUES (
        ${key},
        1,
        CURRENT_TIMESTAMP(3) + (CASE WHEN 1 > ${limit}::integer
          THEN ${blockDuration}::integer ELSE ${ttl}::integer END) * INTERVAL '1 millisecond'
      )
      ON CONFLICT ("key") DO UPDATE SET
        "points" = CASE
          WHEN counter."expireAt" <= CURRENT_TIMESTAMP(3) THEN 1
          WHEN counter."points" > ${limit}::integer THEN counter."points"
          ELSE counter."points" + 1
        END,
        "expireAt" = CASE
          WHEN counter."expireAt" <= CURRENT_TIMESTAMP(3) THEN EXCLUDED."expireAt"
          WHEN counter."points" > ${limit}::integer THEN counter."expireAt"
          WHEN counter."points" + 1 > ${limit}::integer
            THEN CURRENT_TIMESTAMP(3) + ${blockDuration}::integer * INTERVAL '1 millisecond'
          ELSE counter."expireAt"
        END
      RETURNING
        "points",
        GREATEST(0, CEIL(EXTRACT(EPOCH FROM ("expireAt" - CURRENT_TIMESTAMP(3)))))::integer
          AS "secondsToExpire"
    `);
    const row = rows[0];
    if (!row) throw new Error('Rate limit counter upsert returned no row.');

    const isBlocked = row.points > limit;
    return {
      totalHits: row.points,
      timeToExpire: row.secondsToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? row.secondsToExpire : 0,
    };
  }

  /**
   * Deletes expired counters in bounded batches. SKIP LOCKED leaves rows that
   * a concurrent increment holds, so replicas can run this at the same time.
   */
  async purgeExpired(): Promise<number> {
    let deleted = 0;
    for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch += 1) {
      const count = await this.prisma.$executeRaw(Prisma.sql`
        DELETE FROM "RateLimitCounter"
        WHERE "key" IN (
          SELECT "key" FROM "RateLimitCounter"
          WHERE "expireAt" <= CURRENT_TIMESTAMP
          LIMIT ${CLEANUP_BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        )
      `);
      deleted += count;
      if (count < CLEANUP_BATCH_SIZE) break;
    }
    return deleted;
  }

  private async runScheduledCleanup(): Promise<void> {
    if (this.cleanupInFlight) return;
    this.cleanupInFlight = true;
    try {
      await this.purgeExpired();
    } catch (error: unknown) {
      this.logger.warn(
        `Rate limit cleanup failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    } finally {
      this.cleanupInFlight = false;
    }
  }
}

function assertWholeNumber(name: string, value: number, minimum: number) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Rate limit ${name} must be an integer >= ${minimum}.`);
  }
}
