/**
 * M3.2 Pha B (Q254): production-path concurrency evidence for review
 * sessions, proved on the row lock instead of on timing.
 *
 * Every round holds the contended row lock on a third connection, starts two
 * real service calls on two other connections, waits until PostgreSQL reports
 * both of them waiting on a lock (`pg_stat_activity.wait_event_type`), then
 * releases the hold. A round without that observed wait fails.
 *
 *  A  two grades of one card, different keys -> 1 event, one 409 ALREADY_REVIEWED
 *  B  two grades of one card, same key       -> 1 event, both succeed, one replayed
 *  C  two session creates, different keys    -> 1 in_progress session
 *
 * Runs on a disposable database (assertDisposableTestDatabase). Fails on any
 * deadlock, unexpected error or broken invariant.
 */
import { randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { ReviewSessionService } from '../../src/modules/learning/review/review-session.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const ROUNDS = 10;
const LOCK_WAIT_TIMEOUT_MS = 5_000;
const HOLD_TIMEOUT_MS = 15_000;

class ReviewConcurrencyError extends Error {}

type Outcome =
  | { status: 'fulfilled'; value: unknown }
  | { status: 'rejected'; reason: unknown };

function check(condition: boolean, message: string): void {
  if (!condition) throw new ReviewConcurrencyError(message);
}

function errorCode(reason: unknown): string {
  if (reason instanceof HttpException) {
    const body = reason.getResponse();
    if (typeof body === 'object' && body !== null && 'code' in body) {
      return String(body.code);
    }
    return `HTTP_${String(reason.getStatus())}`;
  }
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  return String(reason);
}

async function main(): Promise<void> {
  const { databaseUrl } = assertDisposableTestDatabase();
  const observer = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const prismaA = new PrismaService({
    datasources: { db: { url: databaseUrl } },
  });
  const prismaB = new PrismaService({
    datasources: { db: { url: databaseUrl } },
  });
  const serviceA = new ReviewSessionService(prismaA);
  const serviceB = new ReviewSessionService(prismaB);
  const suffix = randomUUID().replace(/-/gu, '');
  let seq = 0;

  const waitingOnLock = async (): Promise<number> => {
    const [row] = await observer.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    return row.n;
  };

  /** Holds `lockSql` on the observer while `a` and `b` queue behind it. */
  const contend = async (
    lockSql: Prisma.Sql,
    a: () => Promise<unknown>,
    b: () => Promise<unknown>,
  ): Promise<[Outcome, Outcome]> => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const hold = observer.$transaction(
      async (tx) => {
        await tx.$queryRaw(lockSql);
        locked();
        await released;
      },
      { timeout: HOLD_TIMEOUT_MS, maxWait: HOLD_TIMEOUT_MS },
    );
    await lockTaken;
    const settled = Promise.allSettled([a(), b()]);
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    let waiting = 0;
    while (Date.now() < deadline) {
      waiting = await waitingOnLock();
      if (waiting >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    release();
    await hold;
    const outcomes = (await settled) as [Outcome, Outcome];
    check(waiting >= 2, `only ${String(waiting)} backends waited on the lock`);
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') {
        const code = errorCode(outcome.reason);
        check(!code.includes('40P01'), `deadlock: ${code}`);
      }
    }
    return outcomes;
  };

  const newLearnerWithCard = async () => {
    seq += 1;
    const user = await observer.user.create({
      data: {
        email: `review-concurrency-${String(seq)}-${suffix}@example.com`,
        password: 'test-review-harness-hash',
      },
      select: { id: true },
    });
    const word = await observer.word.create({
      data: {
        hanzi: '复习',
        pinyin: `rc${String(seq)}${suffix}`,
        pinyinNormalized: `rc${String(seq)}${suffix}`,
        status: 'published',
        meanings: { create: [{ meaningOrder: 1, meaningEn: 'review' }] },
      },
      select: { id: true },
    });
    await observer.userWord.create({
      data: { userId: user.id, wordId: word.id },
    });
    const card = await observer.reviewCard.create({
      data: {
        userId: user.id,
        wordId: word.id,
        dueAt: new Date(Date.now() - 60_000),
        schedulerVersion: 'sm2-v1',
      },
      select: { id: true },
    });
    return { userId: user.id, cardId: card.id };
  };

  const newSession = async () => {
    const learner = await newLearnerWithCard();
    const created = await serviceA.createSession(
      learner.userId,
      20,
      `rc-setup-${String(seq)}-${suffix}`,
    );
    return { ...learner, sessionId: created.data.session.sessionId };
  };

  const lockSession = (sessionId: number) =>
    Prisma.sql`SELECT id FROM "ReviewSession" WHERE id = ${sessionId} FOR UPDATE`;

  const scenario = async (name: string, run: () => Promise<void>) => {
    for (let round = 1; round <= ROUNDS; round += 1) {
      try {
        await run();
      } catch (error: unknown) {
        throw new ReviewConcurrencyError(
          `${name} round ${String(round)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    console.log(`${name}: ${String(ROUNDS)} rounds GREEN`);
  };

  try {
    await scenario('A two grades, different keys', async () => {
      const { userId, cardId, sessionId } = await newSession();
      const outcomes = await contend(
        lockSession(sessionId),
        () =>
          serviceA.gradeCard(
            userId,
            sessionId,
            { cardId, grade: 'good' },
            `rc-a1-${String(seq)}-${suffix}`,
          ),
        () =>
          serviceB.gradeCard(
            userId,
            sessionId,
            { cardId, grade: 'again' },
            `rc-a2-${String(seq)}-${suffix}`,
          ),
      );
      const ok = outcomes.filter((o) => o.status === 'fulfilled');
      const codes = outcomes.flatMap((o) =>
        o.status === 'rejected' ? [errorCode(o.reason)] : [],
      );
      check(
        ok.length === 1,
        `${String(ok.length)} grades succeeded (expected 1)`,
      );
      check(
        codes.length === 1 && codes[0] === 'REVIEW_CARD_ALREADY_REVIEWED',
        `rejections: ${JSON.stringify(codes)}`,
      );
      const events = await observer.reviewEvent.count({
        where: { sessionId, cardId },
      });
      check(events === 1, `${String(events)} events (expected 1)`);
    });

    await scenario('B two grades, same key', async () => {
      const { userId, cardId, sessionId } = await newSession();
      const key = `rc-b-${String(seq)}-${suffix}`;
      const outcomes = await contend(
        lockSession(sessionId),
        () =>
          serviceA.gradeCard(userId, sessionId, { cardId, grade: 'good' }, key),
        () =>
          serviceB.gradeCard(userId, sessionId, { cardId, grade: 'good' }, key),
      );
      const values = outcomes.map((o) => {
        check(
          o.status === 'fulfilled',
          `a grade failed: ${o.status === 'rejected' ? errorCode(o.reason) : ''}`,
        );
        return (o as { value: { data: { replayed: boolean } } }).value.data
          .replayed;
      });
      check(
        values.filter(Boolean).length === 1,
        `replayed flags: ${JSON.stringify(values)}`,
      );
      const events = await observer.reviewEvent.count({
        where: { sessionId, cardId },
      });
      check(events === 1, `${String(events)} events (expected 1)`);
    });

    await scenario('C two session creates, different keys', async () => {
      const { userId } = await newLearnerWithCard();
      const outcomes = await contend(
        Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`,
        () =>
          serviceA.createSession(userId, 20, `rc-c1-${String(seq)}-${suffix}`),
        () =>
          serviceB.createSession(userId, 20, `rc-c2-${String(seq)}-${suffix}`),
      );
      const created = outcomes.map((o) => {
        check(
          o.status === 'fulfilled',
          `a create failed: ${o.status === 'rejected' ? errorCode(o.reason) : ''}`,
        );
        return (
          o as {
            value: {
              data: { created: boolean; session: { sessionId: number } };
            };
          }
        ).value.data;
      });
      check(
        created.filter((c) => c.created).length === 1,
        `created flags: ${JSON.stringify(created.map((c) => c.created))}`,
      );
      check(
        created[0].session.sessionId === created[1].session.sessionId,
        'the two creates returned different sessions',
      );
      const live = await observer.reviewSession.count({
        where: { userId, status: 'in_progress' },
      });
      check(live === 1, `${String(live)} in_progress sessions (expected 1)`);
    });
    console.log('deadlocks: 0');
    console.log('lock waits observed: yes');
    console.log('RESULT: PASS');
  } finally {
    await Promise.all([
      observer.$disconnect(),
      prismaA.$disconnect(),
      prismaB.$disconnect(),
    ]);
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message.slice(0, 2_000) : String(error),
  );
  process.exitCode = 1;
  console.log('RESULT: FAIL');
});
