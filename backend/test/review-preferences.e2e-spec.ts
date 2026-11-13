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

const DAY = 86_400_000;
const HOUR = 3_600_000;
// UTC+14 all year, so "today" there never matches the UTC day of the run.
const KIRITIMATI = 'Pacific/Kiritimati';
const OFFSET = 14 * HOUR;
const kiritimatiDayStart = (ms: number) => {
  const date = new Date(ms + OFFSET).toISOString().slice(0, 10);
  return Date.parse(`${date}T00:00:00.000Z`) - OFFSET;
};

type Body = Record<string, unknown>;

/** M3.3c: review preferences (Q279–Q282), the retry session (Q278), the overview timezone (Q276). */
describe('Review preferences E2E (M3.3c)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `m33c${Date.now()}`;
  let seq = 0;
  // Level codes are fixed by Level_code_band_check, so the suite borrows three
  // real levels and puts back what it found (suites run in band on one DB).
  const levelCodes = { a: 'HSK4', b: 'HSK6', draft: 'HSK5' };
  const levelIds: number[] = [];
  const levelNames: Record<string, string> = {};
  const restore: Array<() => Promise<unknown>> = [];

  interface Learner {
    id: number;
    token: string;
  }

  const api = () => request(app.getHttpServer());
  const key = (label: string) => `${tag}-${label}-${(seq += 1)}`;
  const auth = (who: Learner) => `Bearer ${who.token}`;
  const getPrefs = (who: Learner) =>
    api().get('/api/v1/review/preferences').set('Authorization', auth(who));
  const putPrefs = (who: Learner, body: unknown) =>
    api()
      .put('/api/v1/review/preferences')
      .set('Authorization', auth(who))
      .send(body as Body);
  const queue = (who: Learner, query = '') =>
    api().get(`/api/v1/review/queue${query}`).set('Authorization', auth(who));
  const create = (who: Learner, body: Body = {}, idem = key('create')) =>
    api()
      .post('/api/v1/review/sessions')
      .set('Authorization', auth(who))
      .set('Idempotency-Key', idem)
      .send(body);
  const current = (who: Learner) =>
    api()
      .get('/api/v1/review/sessions/current')
      .set('Authorization', auth(who));
  const grade = (who: Learner, sessionId: number, cardId: number, g: string) =>
    api()
      .post(`/api/v1/review/sessions/${sessionId}/reviews`)
      .set('Authorization', auth(who))
      .set('Idempotency-Key', key('grade'))
      .send({ cardId, grade: g });
  const complete = (who: Learner, sessionId: number) =>
    api()
      .post(`/api/v1/review/sessions/${sessionId}/complete`)
      .set('Authorization', auth(who));

  async function learner(name: string, timezone?: string): Promise<Learner> {
    const email = `${tag}-${name}@example.com`.toLowerCase();
    const registered = await api()
      .post('/api/v1/auth/register')
      .send({ email, password: 'StrongPassword123!', name })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    if (timezone) {
      await prisma.userProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, timezone },
        update: { timezone },
      });
    }
    return { id: user.id, token: registered.body.data.accessToken as string };
  }

  let wordSeq = 0;
  /** A due card of a saved public word, optionally in one level. */
  async function card(
    who: Learner,
    level: number | null,
    dueAgo = DAY,
  ): Promise<number> {
    wordSeq += 1;
    const pinyin = `${tag}w${String(wordSeq)}`;
    const word = await prisma.word.create({
      data: {
        hanzi: '复习',
        pinyin,
        pinyinNormalized: normalizePinyin(pinyin),
        status: 'published',
        meanings: { create: [{ meaningOrder: 1, meaningEn: pinyin }] },
        ...(level === null
          ? {}
          : { wordLevels: { create: [{ levelId: level }] } }),
      },
      select: { id: true },
    });
    await prisma.userWord.create({ data: { userId: who.id, wordId: word.id } });
    const created = await prisma.reviewCard.create({
      data: {
        userId: who.id,
        wordId: word.id,
        dueAt: new Date(Date.now() - dueAgo - wordSeq),
        schedulerVersion: 'sm2-v1',
      },
      select: { id: true },
    });
    return created.id;
  }

  /** A graded event of `cardId` outside any session, at `at`. */
  async function eventAt(cardId: number, g: ReviewGrade, at: number) {
    await prisma.reviewEvent.create({
      data: {
        cardId,
        grade: g,
        previousState: 'new',
        nextState: 'learning',
        previousDueAt: new Date(at),
        nextDueAt: new Date(at - 1),
        previousIntervalDays: 0,
        nextIntervalDays: 0,
        previousEaseFactor: 2.5,
        nextEaseFactor: 2.5,
        idempotencyKey: key('event'),
        reviewedAt: new Date(at),
      },
    });
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

    for (const [label, code] of Object.entries(levelCodes)) {
      const band = Number(code.slice(3));
      const status = label === 'draft' ? 'draft' : 'published';
      const found = await prisma.level.findUnique({ where: { code } });
      const level = found
        ? await prisma.level.update({
            where: { id: found.id },
            data: { status, deletedAt: null },
          })
        : await prisma.level.create({
            data: {
              code,
              name: `${tag} ${code}`,
              orderIndex: band,
              minBand: band,
              maxBand: band,
              status,
            },
          });
      restore.push(() =>
        found
          ? prisma.level.update({
              where: { id: found.id },
              data: { status: found.status, deletedAt: found.deletedAt },
            })
          : prisma.level.delete({ where: { id: level.id } }),
      );
      levelIds.push(level.id);
      levelNames[code] = level.name;
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.rateLimitCounter.deleteMany();
      for (const undo of restore) await undo();
    }
    if (app) await app.close();
  });

  describe('GET/PUT /review/preferences', () => {
    it('needs a token', async () => {
      await api().get('/api/v1/review/preferences').expect(401);
      await api()
        .put('/api/v1/review/preferences')
        .send({ dailyCardLimit: 10, levelCodes: [] })
        .expect(401);
    });

    it('returns the defaults and the public levels without writing a row', async () => {
      const who = await learner('defaults');
      const response = await getPrefs(who).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.data.dailyCardLimit).toBe(20);
      expect(response.body.data.levelCodes).toEqual([]);
      const codes = (response.body.data.levels as { code: string }[]).map(
        (level) => level.code,
      );
      expect(codes).toEqual(
        expect.arrayContaining([levelCodes.a, levelCodes.b]),
      );
      expect(codes).not.toContain(levelCodes.draft);
      expect(response.body.data.levels).toContainEqual({
        code: levelCodes.a,
        name: levelNames[levelCodes.a],
      });
      expect(
        await prisma.reviewPreference.count({ where: { userId: who.id } }),
      ).toBe(0);
    });

    it('upserts on PUT and reads the saved values back', async () => {
      const who = await learner('upsert');
      const first = await putPrefs(who, {
        dailyCardLimit: 10,
        levelCodes: [levelCodes.a],
      }).expect(200);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.body.data).toMatchObject({
        dailyCardLimit: 10,
        levelCodes: [levelCodes.a],
      });
      await putPrefs(who, {
        dailyCardLimit: 30,
        levelCodes: [levelCodes.b],
      }).expect(200);
      const read = await getPrefs(who).expect(200);
      expect(read.body.data.dailyCardLimit).toBe(30);
      expect(read.body.data.levelCodes).toEqual([levelCodes.b]);
      expect(
        await prisma.reviewPreference.count({ where: { userId: who.id } }),
      ).toBe(1);
    });

    it.each([
      ['an unknown code', { dailyCardLimit: 20, levelCodes: ['NOPE-404'] }],
      ['a draft level', { dailyCardLimit: 20, levelCodes: [levelCodes.draft] }],
      [
        'a duplicated code',
        { dailyCardLimit: 20, levelCodes: [levelCodes.a, levelCodes.a] },
      ],
      [
        'two level codes (Q285)',
        { dailyCardLimit: 20, levelCodes: [levelCodes.a, levelCodes.b] },
      ],
      ['a limit of 15', { dailyCardLimit: 15, levelCodes: [] }],
      ['a non-numeric limit', { dailyCardLimit: 'abc', levelCodes: [] }],
      ['a missing limit', { levelCodes: [] }],
      ['an extra field', { dailyCardLimit: 20, levelCodes: [], userId: 1 }],
    ])('rejects %s with 400 and keeps the stored row', async (_name, body) => {
      const who = await learner(`bad${String((seq += 1))}`);
      await putPrefs(who, { dailyCardLimit: 10, levelCodes: [] }).expect(200);
      await putPrefs(who, body).expect(400);
      const read = await getPrefs(who).expect(200);
      expect(read.body.data).toMatchObject({
        dailyCardLimit: 10,
        levelCodes: [],
      });
    });

    it('keeps learners apart', async () => {
      const one = await learner('isoOne');
      const two = await learner('isoTwo');
      await putPrefs(one, {
        dailyCardLimit: 30,
        levelCodes: [levelCodes.b],
      }).expect(200);
      const read = await getPrefs(two).expect(200);
      expect(read.body.data).toMatchObject({
        dailyCardLimit: 20,
        levelCodes: [],
      });
    });
  });

  describe('queue and sessions honour the level filter and the daily limit', () => {
    it('lists and counts only cards of the chosen levels (Q281)', async () => {
      const who = await learner('levels');
      const inA = await card(who, levelIds[0]);
      const inB = await card(who, levelIds[1]);
      await card(who, null);
      await putPrefs(who, {
        dailyCardLimit: 20,
        levelCodes: [levelCodes.a],
      }).expect(200);
      const filtered = await queue(who, '?limit=50').expect(200);
      expect(filtered.body.data.dueCount).toBe(1);
      expect(filtered.body.data.items.map((i: Body) => i.cardId)).toEqual([
        inA,
      ]);
      expect(filtered.body.data.dailyLimitReached).toBe(false);

      const overview = await api()
        .get('/api/v1/review/overview')
        .set('Authorization', auth(who))
        .expect(200);
      expect(overview.body.data.dueToday).toBe(1);

      await putPrefs(who, { dailyCardLimit: 20, levelCodes: [] }).expect(200);
      const all = await queue(who, '?limit=50').expect(200);
      expect(all.body.data.dueCount).toBe(3);
      expect(all.body.data.items.map((i: Body) => i.cardId)).toEqual(
        expect.arrayContaining([inA, inB]),
      );

      await putPrefs(who, {
        dailyCardLimit: 20,
        levelCodes: [levelCodes.b],
      }).expect(200);
      const created = await create(who).expect(201);
      expect(created.body.data.session.plannedCount).toBe(1);
      const live = await current(who).expect(200);
      expect(live.body.data.items.map((i: Body) => i.cardId)).toEqual([inB]);
    });

    it('falls back to every level when the saved level is unpublished later (Q281)', async () => {
      const who = await learner('unpublished');
      await card(who, levelIds[0]);
      await card(who, null);
      await putPrefs(who, {
        dailyCardLimit: 20,
        levelCodes: [levelCodes.a],
      }).expect(200);
      expect((await queue(who).expect(200)).body.data.dueCount).toBe(1);
      await prisma.level.update({
        where: { id: levelIds[0] },
        data: { status: 'draft' },
      });
      try {
        expect((await queue(who).expect(200)).body.data.dueCount).toBe(2);
        expect((await getPrefs(who).expect(200)).body.data.levelCodes).toEqual(
          [],
        );
      } finally {
        await prisma.level.update({
          where: { id: levelIds[0] },
          data: { status: 'published' },
        });
      }
    });

    it('cuts the queue and a new session at the daily limit in the learner timezone (Q282)', async () => {
      const who = await learner('cap', KIRITIMATI);
      await putPrefs(who, { dailyCardLimit: 10, levelCodes: [] }).expect(200);
      const cards: number[] = [];
      for (let i = 0; i < 14; i += 1) cards.push(await card(who, null));
      const dayStart = kiritimatiDayStart(Date.now());
      // Seven distinct cards graded today (one twice); the oldest card only just before local midnight.
      for (const cardId of cards.slice(7)) {
        await eventAt(cardId, 'good', dayStart + 60_000);
      }
      await eventAt(cards[7], 'again', dayStart + 120_000);
      await eventAt(cards[0], 'good', dayStart - 60_000);

      const capped = await queue(who, '?limit=50').expect(200);
      expect(capped.body.data.items).toHaveLength(3);
      expect(capped.body.data.dueCount).toBe(14);
      expect(capped.body.data.dailyLimitReached).toBe(false);
      expect(
        (await queue(who, '?limit=2').expect(200)).body.data.items,
      ).toHaveLength(2);

      const created = await create(who, { limit: 50 }).expect(201);
      expect(created.body.data.session.plannedCount).toBe(3);
      const sessionId = created.body.data.session.sessionId as number;
      const live = await current(who).expect(200);
      for (const item of live.body.data.items as { cardId: number }[]) {
        await grade(who, sessionId, item.cardId, 'good').expect(201);
      }
      await complete(who, sessionId).expect(200);

      const full = await queue(who, '?limit=50').expect(200);
      expect(full.body.data.items).toEqual([]);
      expect(full.body.data.dailyLimitReached).toBe(true);
      const refused = await create(who).expect(409);
      expect(refused.body.error.code).toBe('REVIEW_DAILY_LIMIT_REACHED');
    });
  });

  describe('POST /review/sessions with retrySessionId (Q278)', () => {
    async function finishedSession(who: Learner, grades: string[]) {
      const cards: number[] = [];
      for (let i = 0; i < grades.length; i += 1)
        cards.push(await card(who, null));
      const created = await create(who, { limit: grades.length }).expect(201);
      const sessionId = created.body.data.session.sessionId as number;
      const live = await current(who).expect(200);
      const order = (live.body.data.items as { cardId: number }[]).map(
        (item) => item.cardId,
      );
      for (const [i, cardId] of order.entries()) {
        await grade(who, sessionId, cardId, grades[i]).expect(201);
      }
      await complete(who, sessionId).expect(200);
      const again = order.filter((_id, i) => grades[i] === 'again');
      return { sessionId, again };
    }

    it('starts a session of exactly the `again` cards of a finished session, past the daily limit', async () => {
      const who = await learner('retry');
      await putPrefs(who, { dailyCardLimit: 10, levelCodes: [] }).expect(200);
      const filler: number[] = [];
      for (let i = 0; i < 7; i += 1) filler.push(await card(who, null, -DAY));
      for (const cardId of filler)
        await eventAt(cardId, 'good', Date.now() - 1000);
      const done = await finishedSession(who, ['again', 'good', 'again']);
      expect((await queue(who).expect(200)).body.data.dailyLimitReached).toBe(
        true,
      );

      const retry = await create(who, {
        retrySessionId: done.sessionId,
      }).expect(201);
      expect(retry.body.data.session.plannedCount).toBe(2);
      const live = await current(who).expect(200);
      expect(
        (live.body.data.items as { cardId: number }[])
          .map((i) => i.cardId)
          .sort(),
      ).toEqual([...done.again].sort());
      const stored = await prisma.reviewSession.findUniqueOrThrow({
        where: { id: retry.body.data.session.sessionId as number },
        select: { mode: true },
      });
      expect(stored.mode).toBe('retry');
    });

    it('hides a session of another learner behind 404', async () => {
      const owner = await learner('retryOwner');
      const done = await finishedSession(owner, ['again']);
      const stranger = await learner('retryStranger');
      await card(stranger, null);
      const response = await create(stranger, {
        retrySessionId: done.sessionId,
      }).expect(404);
      expect(response.body.error.code).toBe('REVIEW_SESSION_NOT_FOUND');
      await create(stranger, { retrySessionId: 2_000_000_000 }).expect(404);
    });

    it('answers 409 REVIEW_NOTHING_DUE when the session had no `again` card', async () => {
      const who = await learner('retryNone');
      const done = await finishedSession(who, ['good']);
      const response = await create(who, {
        retrySessionId: done.sessionId,
      }).expect(409);
      expect(response.body.error.code).toBe('REVIEW_NOTHING_DUE');
    });

    it('rejects a retry of a session that is still in progress', async () => {
      const who = await learner('retryLive');
      await card(who, null);
      const created = await create(who).expect(201);
      const response = await create(who, {
        retrySessionId: created.body.data.session.sessionId,
      }).expect(409);
      expect(response.body.error.code).toBe('REVIEW_SESSION_NOT_ACTIVE');
    });

    it('rejects a non-positive retrySessionId with 400', async () => {
      const who = await learner('retryBad');
      await create(who, { retrySessionId: 0 }).expect(400);
      await create(who, { retrySessionId: 'x' }).expect(400);
    });
  });

  describe('GET /review/overview (Q276)', () => {
    it('returns the timezone the dates are computed in', async () => {
      const ny = await learner('tzNy', 'America/New_York');
      const plain = await learner('tzDefault');
      const one = await api()
        .get('/api/v1/review/overview')
        .set('Authorization', auth(ny))
        .expect(200);
      expect(one.body.data.timezone).toBe('America/New_York');
      const two = await api()
        .get('/api/v1/review/overview')
        .set('Authorization', auth(plain))
        .expect(200);
      expect(two.body.data.timezone).toBe('Asia/Ho_Chi_Minh');
    });
  });
});
