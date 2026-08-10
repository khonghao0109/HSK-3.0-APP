import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';

const STATEMENT_TIMEOUT_MS = 5_000;
const LOCK_TIMEOUT_MS = 3_000;
const TRANSACTION_TIMEOUT_MS = 12_000;
const COORDINATION_TIMEOUT_MS = 2_000;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type TransactionOutcome =
  | { status: 'fulfilled' }
  | { status: 'rejected'; reason: unknown };

type ConcurrentWriteResult = {
  transactionA: TransactionOutcome;
  transactionB: TransactionOutcome;
  transactionBStateBeforeRelease: 'blocked' | 'settled';
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  label: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
      milliseconds,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function asOutcome(promise: Promise<unknown>): Promise<TransactionOutcome> {
  return promise.then(
    () => ({ status: 'fulfilled' as const }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

async function configureTransaction(
  transaction: Prisma.TransactionClient,
): Promise<number> {
  await transaction.$executeRawUnsafe(
    `SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`,
  );
  await transaction.$executeRawUnsafe(
    `SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`,
  );
  await transaction.$executeRawUnsafe(
    "SET LOCAL idle_in_transaction_session_timeout = '7000ms'",
  );

  const [connection] = await transaction.$queryRaw<Array<{ pid: number }>>`
    SELECT pg_backend_pid()::int AS pid
  `;
  return connection.pid;
}

async function waitUntilBlockedOrSettled(
  observer: PrismaClient,
  backendPid: number,
  isSettled: () => boolean,
): Promise<'blocked' | 'settled'> {
  const deadline = Date.now() + COORDINATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (isSettled()) return 'settled';

    const activity = await observer.$queryRaw<
      Array<{ waitEventType: string | null }>
    >`
      SELECT wait_event_type AS "waitEventType"
      FROM pg_stat_activity
      WHERE pid = ${backendPid}
    `;

    if (activity[0]?.waitEventType === 'Lock') return 'blocked';
    await delay(5);
  }

  throw new Error(
    `Transaction B neither settled nor reached a database lock within ${COORDINATION_TIMEOUT_MS}ms`,
  );
}

async function runConcurrentWrites(
  observer: PrismaClient,
  clientA: PrismaClient,
  clientB: PrismaClient,
  writeA: (transaction: Prisma.TransactionClient) => Promise<unknown>,
  writeB: (transaction: Prisma.TransactionClient) => Promise<unknown>,
): Promise<ConcurrentWriteResult> {
  const transactionAReady = createDeferred<void>();
  const releaseTransactionA = createDeferred<void>();

  const transactionARaw = clientA.$transaction(
    async (transaction) => {
      await configureTransaction(transaction);
      await writeA(transaction);
      transactionAReady.resolve();
      await withTimeout(
        releaseTransactionA.promise,
        TRANSACTION_TIMEOUT_MS - 2_000,
        'Transaction A release barrier',
      );
    },
    { maxWait: 5_000, timeout: TRANSACTION_TIMEOUT_MS },
  );
  const transactionAOutcome = asOutcome(transactionARaw);

  await withTimeout(
    transactionAReady.promise,
    TRANSACTION_TIMEOUT_MS,
    'Transaction A setup',
  );

  const transactionBBackendPid = createDeferred<number>();
  let transactionBSettled = false;
  const transactionBRaw = clientB.$transaction(
    async (transaction) => {
      const backendPid = await configureTransaction(transaction);
      transactionBBackendPid.resolve(backendPid);
      await writeB(transaction);
    },
    { maxWait: 5_000, timeout: TRANSACTION_TIMEOUT_MS },
  );
  const transactionBOutcome = asOutcome(transactionBRaw).finally(() => {
    transactionBSettled = true;
  });

  try {
    const backendPid = await withTimeout(
      transactionBBackendPid.promise,
      TRANSACTION_TIMEOUT_MS,
      'Transaction B connection setup',
    );
    const transactionBStateBeforeRelease = await waitUntilBlockedOrSettled(
      observer,
      backendPid,
      () => transactionBSettled,
    );

    releaseTransactionA.resolve();
    const [transactionA, transactionB] = await Promise.all([
      transactionAOutcome,
      transactionBOutcome,
    ]);

    return {
      transactionA,
      transactionB,
      transactionBStateBeforeRelease,
    };
  } catch (error) {
    releaseTransactionA.resolve();
    await Promise.all([transactionAOutcome, transactionBOutcome]);
    throw error;
  }
}

function requireTransactionACommitted(
  scenario: string,
  result: ConcurrentWriteResult,
): void {
  if (result.transactionA.status === 'rejected') {
    throw new Error(`${scenario}: transaction A unexpectedly failed`);
  }
}

function requireSerializedConflict(
  scenario: string,
  result: ConcurrentWriteResult,
): string | undefined {
  try {
    requireTransactionACommitted(scenario, result);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (result.transactionB.status !== 'rejected') {
    return `${scenario}: both concurrent transactions committed; serialization was not enforced`;
  }

  console.log(
    `${scenario}: GREEN (transaction B ${result.transactionBStateBeforeRelease}, then rejected)`,
  );
  return undefined;
}

async function main(): Promise<void> {
  const { databaseName, testDatabaseUrl } = assertDisposableTestDatabase();
  const observer = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  const clientA = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  const clientB = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  const suffix = randomUUID().replace(/-/g, '');

  console.log(`Running P0 two-connection tests on "${databaseName}"`);

  try {
    const failures: string[] = [];
    const [userA, userB] = await Promise.all([
      observer.user.create({
        data: {
          email: `concurrency-a-${suffix}@example.com`,
          password: '$argon2id$concurrency-test-hash',
        },
      }),
      observer.user.create({
        data: {
          email: `concurrency-b-${suffix}@example.com`,
          password: '$argon2id$concurrency-test-hash',
        },
      }),
    ]);
    const level1 = await observer.level.create({
      data: {
        name: 'HSK1',
        code: 'HSK1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        curriculumVersion: 'HSK_3_0',
      },
    });
    const level79 = await observer.level.create({
      data: {
        name: 'HSK7-9',
        code: 'HSK7_9',
        orderIndex: 7,
        minBand: 7,
        maxBand: 9,
        curriculumVersion: 'HSK_3_0',
      },
    });

    const goalLevelRace = await runConcurrentWrites(
      observer,
      clientA,
      clientB,
      (transaction) =>
        transaction.userGoal.create({
          data: {
            userId: userA.id,
            targetLevelId: level1.id,
            targetBand: 1,
            dailyMinutes: 30,
            startDate: new Date(),
          },
        }),
      (transaction) =>
        transaction.level.update({
          where: { id: level1.id },
          data: {
            name: `HSK2 concurrency ${suffix}`,
            code: 'HSK2',
            orderIndex: 2,
            minBand: 2,
            maxBand: 2,
          },
        }),
    );

    const [{ invalidGoalCount }] = await observer.$queryRaw<
      Array<{ invalidGoalCount: number }>
    >`
      SELECT COUNT(*)::int AS "invalidGoalCount"
      FROM "UserGoal" goal
      JOIN "Level" level ON level.id = goal."targetLevelId"
      WHERE goal."targetBand" IS NOT NULL
        AND goal."targetBand" NOT BETWEEN level."minBand" AND level."maxBand"
    `;
    if (invalidGoalCount !== 0) {
      failures.push(
        'UserGoal/Level race: final database state violates the curriculum band invariant',
      );
    } else {
      const failure = requireSerializedConflict(
        'UserGoal/Level race',
        goalLevelRace,
      );
      if (failure) failures.push(failure);
    }

    const test = await observer.test.create({
      data: {
        levelId: level1.id,
        title: `Concurrency result test ${suffix}`,
        slug: `concurrency-result-${suffix}`,
        duration: 600,
      },
    });
    const attempt = await observer.examAttempt.create({
      data: {
        userId: userA.id,
        testId: test.id,
        status: 'submitted',
        startedAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 600_000),
        submittedAt: new Date(),
        remainingSeconds: 0,
        score: 1,
        maxScore: 1,
        scoringVersion: 'hsk-p0-v1',
        idempotencyKey: `concurrency-result-${suffix}`,
      },
    });

    const resultTestRace = await runConcurrentWrites(
      observer,
      clientA,
      clientB,
      (transaction) =>
        transaction.result.create({
          data: {
            userId: userA.id,
            testId: test.id,
            attemptId: attempt.id,
            score: 1,
            awardedBand: 1,
            scoringVersion: 'hsk-p0-v1',
            detailJson: {},
          },
        }),
      (transaction) =>
        transaction.test.update({
          where: { id: test.id },
          data: { levelId: level79.id },
        }),
    );

    const [{ invalidResultCount }] = await observer.$queryRaw<
      Array<{ invalidResultCount: number }>
    >`
      SELECT COUNT(*)::int AS "invalidResultCount"
      FROM "Result" result
      JOIN "Test" test ON test.id = result."testId"
      JOIN "Level" level ON level.id = test."levelId"
      WHERE result."awardedBand" IS NOT NULL
        AND result."awardedBand" NOT BETWEEN level."minBand" AND level."maxBand"
    `;
    if (invalidResultCount !== 0) {
      failures.push(
        'Result/Test race: final database state violates the awarded-band invariant',
      );
    } else {
      const failure = requireSerializedConflict(
        'Result/Test race',
        resultTestRace,
      );
      if (failure) failures.push(failure);
    }

    const word = await observer.word.create({
      data: {
        hanzi: `并${suffix}`,
        pinyin: `bing ${suffix}`,
        pinyinNormalized: `bing ${suffix}`,
      },
    });
    const reviewCard = await observer.reviewCard.create({
      data: { userId: userA.id, wordId: word.id },
    });
    const reviewSession = await observer.reviewSession.create({
      data: { userId: userA.id, mode: 'due', plannedCount: 1 },
    });

    const reviewOwnershipRace = await runConcurrentWrites(
      observer,
      clientA,
      clientB,
      (transaction) =>
        transaction.reviewEvent.create({
          data: {
            cardId: reviewCard.id,
            sessionId: reviewSession.id,
            grade: 'good',
            previousState: 'new',
            nextState: 'review',
            previousDueAt: new Date(),
            nextDueAt: new Date(Date.now() + 86_400_000),
            previousIntervalDays: 0,
            nextIntervalDays: 1,
            previousEaseFactor: 2.5,
            nextEaseFactor: 2.5,
            idempotencyKey: `concurrency-review-${suffix}`,
          },
        }),
      (transaction) =>
        transaction.reviewCard.update({
          where: { id: reviewCard.id },
          data: { userId: userB.id },
        }),
    );

    const [{ invalidReviewCount }] = await observer.$queryRaw<
      Array<{ invalidReviewCount: number }>
    >`
      SELECT COUNT(*)::int AS "invalidReviewCount"
      FROM "ReviewEvent" event
      JOIN "ReviewCard" card ON card.id = event."cardId"
      JOIN "ReviewSession" session ON session.id = event."sessionId"
      WHERE card."userId" <> session."userId"
    `;
    if (invalidReviewCount !== 0) {
      failures.push(
        'Review ownership race: final database state contains a cross-user ReviewEvent',
      );
    } else {
      const failure = requireSerializedConflict(
        'Review ownership race',
        reviewOwnershipRace,
      );
      if (failure) failures.push(failure);
    }

    if (failures.length > 0) {
      for (const failure of failures) console.error(`RED: ${failure}`);
      throw new Error(`${failures.length} concurrency invariant(s) failed`);
    }

    console.log('P0 two-connection concurrency tests passed');
  } finally {
    await Promise.all([
      observer.$disconnect(),
      clientA.$disconnect(),
      clientB.$disconnect(),
    ]);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`P0 concurrency test failed: ${message}`);
  process.exitCode = 1;
});
