/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { normalizePinyin } from '../src/common/utils/normalize-pinyin';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { schedule, SM2_V1_POLICY } from '../src/modules/learning/srs';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

type Body = Record<string, unknown>;

/** M3.2 Pha B (Q253/Q254): review sessions, grading and completion. */
describe('Review session E2E (M3.2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `m32s${Date.now()}`;
  let seq = 0;

  interface Learner {
    id: number;
    token: string;
    cards: { cardId: number; wordId: number }[];
  }

  const api = () => request(app.getHttpServer());
  const key = (label: string) => `${tag}-${label}-${(seq += 1)}`;

  const create = (who: Learner, idempotencyKey?: string, body: Body = {}) => {
    const req = api()
      .post('/api/v1/review/sessions')
      .set('Authorization', `Bearer ${who.token}`);
    if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
    return req.send(body);
  };
  const current = (who: Learner) =>
    api()
      .get('/api/v1/review/sessions/current')
      .set('Authorization', `Bearer ${who.token}`);
  const grade = (
    who: Learner,
    sessionId: number,
    body: Body,
    idempotencyKey?: string,
  ) => {
    const req = api()
      .post(`/api/v1/review/sessions/${sessionId}/reviews`)
      .set('Authorization', `Bearer ${who.token}`);
    if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
    return req.send(body);
  };
  const complete = (who: Learner, sessionId: number) =>
    api()
      .post(`/api/v1/review/sessions/${sessionId}/complete`)
      .set('Authorization', `Bearer ${who.token}`);

  /** A learner with `count` due cards of saved public words, oldest first. */
  async function learner(name: string, count: number): Promise<Learner> {
    const email = `${tag}-${name}@example.com`;
    const registered = await api()
      .post('/api/v1/auth/register')
      .send({ email, password: 'StrongPassword123!', name })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    const cards: Learner['cards'] = [];
    for (let i = 0; i < count; i += 1) {
      const pinyin = `${tag}${name}${i}`;
      const word = await prisma.word.create({
        data: {
          hanzi: '复习',
          pinyin,
          pinyinNormalized: normalizePinyin(pinyin),
          status: 'published',
          meanings: { create: [{ meaningOrder: 1, meaningEn: `${name}${i}` }] },
        },
        select: { id: true },
      });
      await prisma.userWord.create({
        data: { userId: user.id, wordId: word.id },
      });
      const created = await prisma.reviewCard.create({
        data: {
          userId: user.id,
          wordId: word.id,
          dueAt: new Date(Date.now() - (count - i) * DAY),
          schedulerVersion: 'sm2-v1',
        },
        select: { id: true },
      });
      cards.push({ cardId: created.id, wordId: word.id });
    }
    return {
      id: user.id,
      token: registered.body.data.accessToken as string,
      cards,
    };
  }

  async function startSession(who: Learner, body: Body = {}) {
    const response = await create(who, key('start'), body).expect(201);
    return response.body.data.session.sessionId as number;
  }

  async function backdate(sessionId: number, ms: number) {
    await prisma.reviewSession.update({
      where: { id: sessionId },
      data: { startedAt: new Date(Date.now() - ms) },
    });
  }

  const status = async (sessionId: number) =>
    (
      await prisma.reviewSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { status: true },
      })
    ).status;

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
  });

  afterAll(async () => {
    await prisma?.rateLimitCounter.deleteMany();
    if (app) await app.close();
  });

  it('needs a token on every session route', async () => {
    await api().post('/api/v1/review/sessions').expect(401);
    await api().get('/api/v1/review/sessions/current').expect(401);
    await api().post('/api/v1/review/sessions/1/reviews').expect(401);
    await api().post('/api/v1/review/sessions/1/complete').expect(401);
  });

  describe('POST /review/sessions', () => {
    it('needs a valid Idempotency-Key and a limit of 1-50', async () => {
      const who = await learner('val', 1);
      await create(who).expect(400);
      await create(who, 'short').expect(400);
      await create(who, key('l0'), { limit: 0 }).expect(400);
      await create(who, key('l51'), { limit: 51 }).expect(400);
      await create(who, key('lx'), { limit: 'x' }).expect(400);
    });

    it('creates a session from the first due cards (201) without exposing the snapshot or userId', async () => {
      const who = await learner('create', 3);
      const response = await create(who, key('c'), { limit: 2 }).expect(201);
      expect(response.headers['cache-control']).toBe('no-store');
      const { created, session } = response.body.data;
      expect(created).toBe(true);
      expect(session).toMatchObject({
        status: 'in_progress',
        plannedCount: 2,
        reviewedCount: 0,
      });
      expect(new Date(session.expiresAt).getTime()).toBe(
        new Date(session.startedAt).getTime() + DAY,
      );
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('userId');
      expect(serialized).not.toContain('cardIds');

      const stored = await prisma.reviewSession.findUniqueOrThrow({
        where: { id: session.sessionId },
      });
      expect(stored.mode).toBe('due');
      expect((stored.summary as { cardIds: number[] }).cardIds).toEqual(
        who.cards.slice(0, 2).map((c) => c.cardId),
      );
    });

    it('defaults the limit to 20', async () => {
      const who = await learner('default', 21);
      const response = await create(who, key('d')).expect(201);
      expect(response.body.data.session.plannedCount).toBe(20);
    });

    it('replays the same key with 200 and created:false, and rejects it with another limit', async () => {
      const who = await learner('replay', 2);
      const k = key('r');
      const first = await create(who, k, { limit: 2 }).expect(201);
      const again = await create(who, k, { limit: 2 }).expect(200);
      expect(again.body.data.created).toBe(false);
      expect(again.body.data.session.sessionId).toBe(
        first.body.data.session.sessionId,
      );
      const other = await create(who, k, { limit: 1 }).expect(409);
      expect(other.body.error.code).toBe('CONFLICT');
      expect(
        await prisma.reviewSession.count({ where: { userId: who.id } }),
      ).toBe(1);
    });

    it('stores the expiry of a replayed key whose session idled out', async () => {
      const who = await learner('replay-expired', 1);
      const k = key('rx');
      const first = await create(who, k).expect(201);
      const sessionId = first.body.data.session.sessionId as number;
      await backdate(sessionId, DAY);
      const again = await create(who, k).expect(200);
      expect(again.body.data).toMatchObject({
        created: false,
        session: { sessionId, status: 'abandoned', expiresAt: null },
      });
      expect(await status(sessionId)).toBe('abandoned');
    });

    it('returns the live session for a new key (200, created:false)', async () => {
      const who = await learner('live', 2);
      const sessionId = await startSession(who);
      const response = await create(who, key('live2')).expect(200);
      expect(response.body.data).toMatchObject({
        created: false,
        session: { sessionId, status: 'in_progress' },
      });
      expect(
        await prisma.reviewSession.count({ where: { userId: who.id } }),
      ).toBe(1);
    });

    it('answers 409 REVIEW_NOTHING_DUE without due cards', async () => {
      const who = await learner('empty', 0);
      const response = await create(who, key('e')).expect(409);
      expect(response.body.error.code).toBe('REVIEW_NOTHING_DUE');
      expect(
        await prisma.reviewSession.count({ where: { userId: who.id } }),
      ).toBe(0);
    });

    it('abandons an expired live session even when nothing is due any more', async () => {
      const who = await learner('expired-empty', 1);
      const sessionId = await startSession(who);
      await backdate(sessionId, DAY);
      await prisma.reviewCard.update({
        where: { id: who.cards[0].cardId },
        data: { dueAt: new Date(Date.now() + DAY) },
      });
      const response = await create(who, key('ee')).expect(409);
      expect(response.body.error.code).toBe('REVIEW_NOTHING_DUE');
      expect(await status(sessionId)).toBe('abandoned');
    });

    it('abandons an expired live session and starts a new one', async () => {
      const who = await learner('expired-new', 1);
      const old = await startSession(who);
      await backdate(old, DAY + MIN);
      const response = await create(who, key('en')).expect(201);
      expect(response.body.data.session.sessionId).not.toBe(old);
      expect(await status(old)).toBe('abandoned');
    });

    it('keeps a session alive from its last grade, not its start', async () => {
      const who = await learner('last-grade', 2);
      const sessionId = await startSession(who);
      await grade(
        who,
        sessionId,
        { cardId: who.cards[0].cardId, grade: 'good' },
        key('g'),
      ).expect(201);
      await backdate(sessionId, 30 * HOUR);
      const response = await create(who, key('lg')).expect(200);
      expect(response.body.data.session).toMatchObject({
        sessionId,
        status: 'in_progress',
      });
    });
  });

  describe('GET /review/sessions/current', () => {
    it('answers 404 without a live session', async () => {
      const who = await learner('none', 1);
      const response = await current(who).expect(404);
      expect(response.body.error.code).toBe('REVIEW_SESSION_NOT_FOUND');
    });

    it('lists the ungraded available cards in session order with previews', async () => {
      const who = await learner('current', 3);
      const sessionId = await startSession(who);
      await grade(
        who,
        sessionId,
        { cardId: who.cards[0].cardId, grade: 'good' },
        key('cg'),
      ).expect(201);
      await prisma.userWord.deleteMany({
        where: { userId: who.id, wordId: who.cards[2].wordId },
      });

      const response = await current(who).expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const { session, items } = response.body.data;
      expect(session).toMatchObject({
        sessionId,
        reviewedCount: 1,
        plannedCount: 3,
      });
      expect(items.map((i: { cardId: number }) => i.cardId)).toEqual([
        who.cards[1].cardId,
      ]);
      expect(items[0].word.id).toBe(who.cards[1].wordId);
      expect(Object.keys(items[0].preview)).toEqual([
        'again',
        'hard',
        'good',
        'easy',
      ]);
      expect(JSON.stringify(response.body)).not.toContain('userId');
    });

    it('reports an expired session as absent without writing it', async () => {
      const who = await learner('current-expired', 1);
      const sessionId = await startSession(who);
      await backdate(sessionId, DAY);
      await current(who).expect(404);
      expect(await status(sessionId)).toBe('in_progress');
    });
  });

  describe('POST /review/sessions/:sessionId/reviews', () => {
    it('validates the key and the body', async () => {
      const who = await learner('grade-val', 1);
      const sessionId = await startSession(who);
      const cardId = who.cards[0].cardId;
      await grade(who, sessionId, { cardId, grade: 'good' }).expect(400);
      await grade(who, sessionId, { cardId, grade: 'meh' }, key('v1')).expect(
        400,
      );
      await grade(
        who,
        sessionId,
        { cardId: 0, grade: 'good' },
        key('v2'),
      ).expect(400);
      await grade(
        who,
        sessionId,
        { cardId, grade: 'good', durationMs: 600_001 },
        key('v3'),
      ).expect(400);
      await grade(
        who,
        sessionId,
        { cardId, grade: 'good', durationMs: -1 },
        key('v4'),
      ).expect(400);
      expect(await prisma.reviewEvent.count({ where: { sessionId } })).toBe(0);
    });

    it('schedules the card exactly like schedule() and records one event', async () => {
      const who = await learner('grade', 2);
      const sessionId = await startSession(who);
      const cardId = who.cards[0].cardId;
      const before = await prisma.reviewCard.findUniqueOrThrow({
        where: { id: cardId },
      });

      const response = await grade(
        who,
        sessionId,
        { cardId, grade: 'easy', durationMs: 1234 },
        key('gr'),
      ).expect(201);
      expect(response.headers['cache-control']).toBe('no-store');
      const after = await prisma.reviewCard.findUniqueOrThrow({
        where: { id: cardId },
      });
      const expected = schedule(
        before,
        'easy',
        after.lastReviewedAt!,
        SM2_V1_POLICY,
      );
      expect(after).toMatchObject({
        state: expected.state,
        dueAt: expected.dueAt,
        intervalDays: expected.intervalDays,
        easeFactor: expected.easeFactor,
        repetitions: expected.repetitions,
        lapses: expected.lapses,
        schedulerVersion: 'sm2-v1',
      });
      expect(response.body.data).toEqual({
        replayed: false,
        cardId,
        grade: 'easy',
        next: {
          state: expected.state,
          dueAt: expected.dueAt.toISOString(),
          intervalDays: expected.intervalDays,
        },
        session: { reviewedCount: 1, plannedCount: 2 },
      });

      const events = await prisma.reviewEvent.findMany({
        where: { sessionId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        cardId,
        grade: 'easy',
        previousState: before.state,
        nextState: expected.state,
        previousDueAt: before.dueAt,
        nextDueAt: expected.dueAt,
        previousIntervalDays: before.intervalDays,
        nextIntervalDays: expected.intervalDays,
        previousEaseFactor: before.easeFactor,
        nextEaseFactor: expected.easeFactor,
        durationMs: 1234,
        source: 'flashcard',
      });
      expect(
        await prisma.learningEvent.count({
          where: { userId: who.id, type: { not: 'word_saved' } },
        }),
      ).toBe(0);
    });

    it('replays the same key with replayed:true and no second event', async () => {
      const who = await learner('grade-replay', 1);
      const sessionId = await startSession(who);
      const cardId = who.cards[0].cardId;
      const k = key('gp');
      const first = await grade(
        who,
        sessionId,
        { cardId, grade: 'good' },
        k,
      ).expect(201);
      const again = await grade(
        who,
        sessionId,
        { cardId, grade: 'good' },
        k,
      ).expect(201);
      expect(again.body.data).toEqual({ ...first.body.data, replayed: true });
      expect(await prisma.reviewEvent.count({ where: { sessionId } })).toBe(1);

      const changed = await grade(
        who,
        sessionId,
        { cardId, grade: 'hard' },
        k,
      ).expect(409);
      expect(changed.body.error.code).toBe('CONFLICT');
      const timed = await grade(
        who,
        sessionId,
        { cardId, grade: 'good', durationMs: 5 },
        k,
      ).expect(409);
      expect(timed.body.error.code).toBe('CONFLICT');
      expect(await prisma.reviewEvent.count({ where: { sessionId } })).toBe(1);
    });

    it('rejects a second grade of the same card with another key', async () => {
      const who = await learner('grade-twice', 1);
      const sessionId = await startSession(who);
      const cardId = who.cards[0].cardId;
      await grade(who, sessionId, { cardId, grade: 'good' }, key('t1')).expect(
        201,
      );
      const response = await grade(
        who,
        sessionId,
        { cardId, grade: 'again' },
        key('t2'),
      ).expect(409);
      expect(response.body.error.code).toBe('REVIEW_CARD_ALREADY_REVIEWED');
    });

    it('rejects a card outside the session', async () => {
      const who = await learner('outside', 2);
      const sessionId = await startSession(who, { limit: 1 });
      const response = await grade(
        who,
        sessionId,
        { cardId: who.cards[1].cardId, grade: 'good' },
        key('o'),
      ).expect(409);
      expect(response.body.error.code).toBe('REVIEW_CARD_NOT_IN_SESSION');
    });

    it('rejects a card that is no longer available', async () => {
      const who = await learner('unavailable', 3);
      const sessionId = await startSession(who);
      await prisma.userWord.deleteMany({
        where: { userId: who.id, wordId: who.cards[0].wordId },
      });
      await prisma.reviewCard.update({
        where: { id: who.cards[1].cardId },
        data: { state: 'suspended' },
      });
      await prisma.word.update({
        where: { id: who.cards[2].wordId },
        data: { isPure: false },
      });
      for (const [index, card] of who.cards.entries()) {
        const response = await grade(
          who,
          sessionId,
          { cardId: card.cardId, grade: 'good' },
          key(`u${index}`),
        ).expect(409);
        expect(response.body.error.code).toBe('REVIEW_CARD_UNAVAILABLE');
      }
      expect(await prisma.reviewEvent.count({ where: { sessionId } })).toBe(0);
    });

    it('hides the session of another learner behind 404', async () => {
      const owner = await learner('owner', 1);
      const intruder = await learner('intruder', 1);
      const sessionId = await startSession(owner);
      const graded = await grade(
        intruder,
        sessionId,
        { cardId: owner.cards[0].cardId, grade: 'good' },
        key('i'),
      ).expect(404);
      expect(graded.body.error.code).toBe('REVIEW_SESSION_NOT_FOUND');
      const completed = await complete(intruder, sessionId).expect(404);
      expect(completed.body.error.code).toBe('REVIEW_SESSION_NOT_FOUND');
      await grade(
        owner,
        2_147_483_000,
        { cardId: owner.cards[0].cardId, grade: 'good' },
        key('m'),
      ).expect(404);
      expect(await status(sessionId)).toBe('in_progress');
    });

    it('abandons an expired session with 409 REVIEW_SESSION_EXPIRED, then answers NOT_ACTIVE', async () => {
      const who = await learner('grade-expired', 1);
      const sessionId = await startSession(who);
      await backdate(sessionId, DAY);
      const cardId = who.cards[0].cardId;
      const expired = await grade(
        who,
        sessionId,
        { cardId, grade: 'good' },
        key('x1'),
      ).expect(409);
      expect(expired.body.error.code).toBe('REVIEW_SESSION_EXPIRED');
      expect(await status(sessionId)).toBe('abandoned');
      const closed = await grade(
        who,
        sessionId,
        { cardId, grade: 'good' },
        key('x2'),
      ).expect(409);
      expect(closed.body.error.code).toBe('REVIEW_SESSION_NOT_ACTIVE');
      expect(await prisma.reviewEvent.count({ where: { sessionId } })).toBe(0);
    });
  });

  describe('POST /review/sessions/:sessionId/complete', () => {
    it('completes with the summary, returns the same summary again and closes grading', async () => {
      const who = await learner('complete', 4);
      const sessionId = await startSession(who);
      const grades = ['again', 'good', 'easy'] as const;
      for (const [index, g] of grades.entries()) {
        await grade(
          who,
          sessionId,
          {
            cardId: who.cards[index].cardId,
            grade: g,
            durationMs: 1000 * (index + 1),
          },
          key(`cp${index}`),
        ).expect(201);
      }
      const first = await complete(who, sessionId).expect(200);
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.body.data.session).toMatchObject({
        sessionId,
        status: 'completed',
        reviewedCount: 3,
        plannedCount: 4,
        expiresAt: null,
      });
      expect(first.body.data.summary).toEqual({
        again: 1,
        hard: 0,
        good: 1,
        easy: 1,
        remembered: 2,
        forgot: 1,
        retentionPercent: 67,
        totalDurationMs: 6000,
      });
      const second = await complete(who, sessionId).expect(200);
      expect(second.body.data.summary).toEqual(first.body.data.summary);

      const stored = await prisma.reviewSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect((stored.summary as { cardIds: number[] }).cardIds).toEqual(
        who.cards.map((c) => c.cardId),
      );
      expect(stored.completedAt).not.toBeNull();

      const late = await grade(
        who,
        sessionId,
        { cardId: who.cards[3].cardId, grade: 'good' },
        key('late'),
      ).expect(409);
      expect(late.body.error.code).toBe('REVIEW_SESSION_NOT_ACTIVE');
    });

    it('completes an empty session with a null retention', async () => {
      const who = await learner('complete-empty', 1);
      const sessionId = await startSession(who);
      const response = await complete(who, sessionId).expect(200);
      expect(response.body.data.summary).toMatchObject({
        retentionPercent: null,
        remembered: 0,
        forgot: 0,
      });
    });

    it('completes an in-progress session past its idle window', async () => {
      const who = await learner('complete-expired', 1);
      const sessionId = await startSession(who);
      await backdate(sessionId, 2 * DAY);
      await complete(who, sessionId).expect(200);
      expect(await status(sessionId)).toBe('completed');
    });

    it('answers 409 REVIEW_SESSION_NOT_ACTIVE for an abandoned session', async () => {
      const who = await learner('complete-abandoned', 1);
      const sessionId = await startSession(who);
      await backdate(sessionId, DAY);
      await create(who, key('ab')).expect(201);
      expect(await status(sessionId)).toBe('abandoned');
      const response = await complete(who, sessionId).expect(409);
      expect(response.body.error.code).toBe('REVIEW_SESSION_NOT_ACTIVE');
    });
  });
});
