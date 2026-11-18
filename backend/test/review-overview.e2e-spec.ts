/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { ReviewGrade } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { normalizePinyin } from '../src/common/utils/normalize-pinyin';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
// Pacific/Kiritimati is UTC+14 all year (no DST), so its day boundaries never
// match UTC ones and the expected dates are plain offset arithmetic.
const KIRITIMATI = 'Pacific/Kiritimati';
const OFFSET = 14 * HOUR;

/** Local date `YYYY-MM-DD` in UTC+14, computed without the code under test. */
const localDate = (ms: number) =>
  new Date(ms + OFFSET).toISOString().slice(0, 10);
/** UTC instant of 00:00 local (UTC+14) on `date`. */
const localMidnightMs = (date: string) =>
  Date.parse(`${date}T00:00:00.000Z`) - OFFSET;

interface Overview {
  dueToday: number;
  upcoming: { days3: number; days7: number; days14: number };
  retention7d: number | null;
  calendar: { date: string; reviewed: number }[];
  recentSessions: {
    sessionId: number;
    completedAt: string;
    reviewedCount: number;
    retentionPercent: number | null;
  }[];
}

/** M3.3b (Q268): the review overview of the caller, in their timezone. */
describe('Review overview E2E (M3.3b)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `m33o${Date.now()}`;
  const now = Date.now();
  const today = localDate(now);
  const tomorrowStart = localMidnightMs(
    new Date(Date.parse(`${today}T00:00:00.000Z`) + DAY)
      .toISOString()
      .slice(0, 10),
  );

  interface Learner {
    id: number;
    token: string;
  }
  let learner: Learner;
  let other: Learner;
  let empty: Learner;
  let sessionIds: number[];

  function api() {
    return request(app.getHttpServer());
  }
  const overview = (who: Learner) =>
    api()
      .get('/api/v1/review/overview')
      .set('Authorization', `Bearer ${who.token}`);

  async function register(name: string, timezone: string): Promise<Learner> {
    const email = `${tag}-${name}@example.com`;
    const registered = await api()
      .post('/api/v1/auth/register')
      .send({ email, password: 'StrongPassword123!', name })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    await prisma.userProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, timezone },
      update: { timezone },
    });
    return { id: user.id, token: registered.body.data.accessToken as string };
  }

  let wordSeq = 0;
  async function card(who: Learner, dueAt: number): Promise<number> {
    wordSeq += 1;
    const pinyin = `${tag}w${String(wordSeq)}`;
    const word = await prisma.word.create({
      data: {
        hanzi: '复习',
        pinyin,
        pinyinNormalized: normalizePinyin(pinyin),
        status: 'published',
        meanings: { create: [{ meaningOrder: 1, meaningEn: 'review' }] },
      },
      select: { id: true },
    });
    await prisma.userWord.create({ data: { userId: who.id, wordId: word.id } });
    const created = await prisma.reviewCard.create({
      data: { userId: who.id, wordId: word.id, dueAt: new Date(dueAt) },
      select: { id: true },
    });
    return created.id;
  }

  let eventSeq = 0;
  async function event(cardId: number, grade: ReviewGrade, at: number) {
    eventSeq += 1;
    await prisma.reviewEvent.create({
      data: {
        cardId,
        grade,
        previousState: 'new',
        nextState: 'learning',
        previousDueAt: new Date(at),
        nextDueAt: new Date(at + DAY),
        previousIntervalDays: 0,
        nextIntervalDays: 1,
        previousEaseFactor: 2.5,
        nextEaseFactor: 2.5,
        idempotencyKey: `${tag}-e${String(eventSeq)}`,
        reviewedAt: new Date(at),
      },
    });
  }

  async function session(
    who: Learner,
    status: 'completed' | 'in_progress',
    completedAgo: number,
    reviewedCount: number,
    retentionPercent: number | null,
  ): Promise<number> {
    const created = await prisma.reviewSession.create({
      data: {
        userId: who.id,
        status,
        mode: 'due',
        plannedCount: reviewedCount,
        reviewedCount,
        summary: { cardIds: [], requestedLimit: 20, retentionPercent },
        startedAt: new Date(now - completedAgo - 10 * MIN),
        completedAt:
          status === 'completed' ? new Date(now - completedAgo) : null,
      },
      select: { id: true },
    });
    return created.id;
  }

  beforeAll(async () => {
    assertDisposableTestDatabase();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: createSafeValidationException,
      }),
    );
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);

    learner = await register('learner', KIRITIMATI);
    other = await register('other', KIRITIMATI);
    empty = await register('empty', 'Asia/Ho_Chi_Minh');

    // Due today: overdue, and one minute before local midnight.
    await card(learner, now - 3 * DAY);
    await card(learner, tomorrowStart - MIN);
    // Upcoming, counted from tomorrow: day 1, day 3 (last minute), day 4, day 10.
    await card(learner, tomorrowStart + MIN);
    await card(learner, tomorrowStart + 3 * DAY - MIN);
    await card(learner, tomorrowStart + 3 * DAY + MIN);
    await card(learner, tomorrowStart + 10 * DAY);
    // Day 20 is outside every window.
    const far = await card(learner, tomorrowStart + 20 * DAY);
    // A suspended due card does not count.
    const suspended = await card(learner, now - DAY);
    await prisma.reviewCard.update({
      where: { id: suspended },
      data: { state: 'suspended' },
    });
    // Another learner's due cards and events never leak.
    const theirs = await card(other, now - DAY);
    await event(theirs, 'again', now - MIN);
    await event(theirs, 'again', now - 2 * MIN);

    // Retention 7d: 3 good + 1 again inside, one again 8 days ago outside.
    await event(far, 'good', now - MIN);
    await event(far, 'good', now - 2 * DAY);
    await event(far, 'easy', now - 6 * DAY);
    await event(far, 'again', now - 3 * DAY);
    await event(far, 'again', now - 8 * DAY);
    // Calendar edge: one minute before local midnight of today is yesterday.
    await event(far, 'hard', localMidnightMs(today) - MIN);

    sessionIds = [];
    for (let i = 0; i < 6; i += 1) {
      sessionIds.push(
        await session(learner, 'completed', (i + 1) * HOUR, 10 + i, 80 + i),
      );
    }
    await session(learner, 'completed', 31 * DAY, 5, 50);
    await session(learner, 'in_progress', MIN, 3, null);
    await session(other, 'completed', MIN, 9, 90);
  });

  afterAll(async () => {
    await prisma?.rateLimitCounter.deleteMany();
    if (app) await app.close();
  });

  it('needs a token', async () => {
    await api().get('/api/v1/review/overview').expect(401);
  });

  it('counts due and upcoming cards by local day of the learner', async () => {
    const response = await overview(learner).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const data = response.body.data as Overview;
    expect(data.dueToday).toBe(2);
    expect(data.upcoming).toEqual({ days3: 2, days7: 3, days14: 4 });
  });

  it('rounds the 7-day retention of the caller only', async () => {
    const data = (await overview(learner).expect(200)).body.data as Overview;
    // 4 good/easy/hard of 5 in 7 days (hard at local midnight counts too).
    expect(data.retention7d).toBe(80);
  });

  it('lists each day of the local month with its review count', async () => {
    const data = (await overview(learner).expect(200)).body.data as Overview;
    const month = today.slice(0, 7);
    const days = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
    ).getUTCDate();
    expect(data.calendar).toHaveLength(days);
    expect(data.calendar[0]?.date).toBe(`${month}-01`);
    expect(data.calendar.every((day) => day.date.startsWith(month))).toBe(true);
    const counted = (date: string) =>
      data.calendar.find((day) => day.date === date)?.reviewed;
    // Expected per local day, from the fixture instants above.
    const expected = new Map<string, number>();
    for (const at of [
      now - MIN,
      now - 2 * DAY,
      now - 6 * DAY,
      now - 3 * DAY,
      now - 8 * DAY,
      localMidnightMs(today) - MIN,
    ]) {
      const date = localDate(at);
      if (date.startsWith(month)) {
        expected.set(date, (expected.get(date) ?? 0) + 1);
      }
    }
    for (const day of data.calendar) {
      expect([day.date, day.reviewed]).toEqual([
        day.date,
        expected.get(day.date) ?? 0,
      ]);
    }
    expect(counted(today)).toBe(expected.get(today));
  });

  it('returns the five newest completed sessions of the last 30 days', async () => {
    const data = (await overview(learner).expect(200)).body.data as Overview;
    expect(data.recentSessions.map((s) => s.sessionId)).toEqual(
      sessionIds.slice(0, 5),
    );
    expect(data.recentSessions[0]).toMatchObject({
      reviewedCount: 10,
      retentionPercent: 80,
    });
    expect(
      Number.isNaN(Date.parse(data.recentSessions[0]?.completedAt ?? '')),
    ).toBe(false);
  });

  it('is empty and null for a learner with nothing yet', async () => {
    const data = (await overview(empty).expect(200)).body.data as Overview;
    expect(data.dueToday).toBe(0);
    expect(data.upcoming).toEqual({ days3: 0, days7: 0, days14: 0 });
    expect(data.retention7d).toBeNull();
    expect(data.recentSessions).toEqual([]);
    expect(data.calendar.every((day) => day.reviewed === 0)).toBe(true);
  });
});
