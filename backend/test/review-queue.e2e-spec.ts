/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { ReviewCardState } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { normalizePinyin } from '../src/common/utils/normalize-pinyin';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

const MIN = 60_000;
const DAY = 86_400_000;

/** M3.2 Pha A (Q252, R4): the learner's due review queue with grade previews. */
describe('Review queue E2E (M3.2)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = `m32q${Date.now()}`;

  interface Learner {
    id: number;
    token: string;
  }
  let learner: Learner;
  let other: Learner;

  function api() {
    return request(app.getHttpServer());
  }
  const queue = (who: Learner, query = '') =>
    api()
      .get(`/api/v1/review/queue${query}`)
      .set('Authorization', `Bearer ${who.token}`);

  async function register(name: string): Promise<Learner> {
    const email = `${tag}-${name}@example.com`;
    const registered = await api()
      .post('/api/v1/auth/register')
      .send({ email, password: 'StrongPassword123!', name })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    return { id: user.id, token: registered.body.data.accessToken as string };
  }

  async function createWord(name: string): Promise<number> {
    const pinyin = `${tag}${name}`;
    const word = await prisma.word.create({
      data: {
        hanzi: '复习',
        pinyin,
        pinyinNormalized: normalizePinyin(pinyin),
        status: 'published',
        meanings: { create: [{ meaningOrder: 1, meaningEn: `${name} en` }] },
      },
      select: { id: true },
    });
    return word.id;
  }

  /** A saved word with its card; `saved: false` leaves only the card. */
  async function card(
    who: Learner,
    name: string,
    data: {
      dueAt: Date;
      state?: ReviewCardState;
      intervalDays?: number;
      repetitions?: number;
      lapses?: number;
      lastReviewedAt?: Date | null;
      saved?: boolean;
    },
  ): Promise<{ cardId: number; wordId: number }> {
    const wordId = await createWord(name);
    if (data.saved !== false) {
      await prisma.userWord.create({ data: { userId: who.id, wordId } });
    }
    const created = await prisma.reviewCard.create({
      data: {
        userId: who.id,
        wordId,
        dueAt: data.dueAt,
        state: data.state ?? 'new',
        intervalDays: data.intervalDays ?? 0,
        repetitions: data.repetitions ?? 0,
        lapses: data.lapses ?? 0,
        lastReviewedAt: data.lastReviewedAt ?? null,
        schedulerVersion: 'sm2-v1',
      },
      select: { id: true },
    });
    return { cardId: created.id, wordId };
  }

  const ago = (ms: number) => new Date(Date.now() - ms);
  let due: { cardId: number; wordId: number }[];
  let reviewCard: { cardId: number; wordId: number };
  let hidden: Record<string, number>;

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

    learner = await register('learner');
    other = await register('other');

    // Due cards, created out of order: the queue sorts by dueAt, then id.
    const second = await card(learner, 'second', { dueAt: ago(2 * DAY) });
    const first = await card(learner, 'first', { dueAt: ago(3 * DAY) });
    reviewCard = await card(learner, 'review', {
      dueAt: ago(MIN),
      state: 'review',
      intervalDays: 10,
      repetitions: 3,
      lapses: 1,
      lastReviewedAt: ago(10 * DAY + MIN),
    });
    due = [first, second, reviewCard];

    hidden = {
      future: (
        await card(learner, 'future', { dueAt: new Date(Date.now() + DAY) })
      ).cardId,
      suspended: (
        await card(learner, 'suspended', {
          dueAt: ago(DAY),
          state: 'suspended',
        })
      ).cardId,
      unsaved: (
        await card(learner, 'unsaved', { dueAt: ago(DAY), saved: false })
      ).cardId,
      otherUser: (await card(other, 'theirs', { dueAt: ago(DAY) })).cardId,
    };
    const unpublished = await card(learner, 'unpublished', { dueAt: ago(DAY) });
    await prisma.word.update({
      where: { id: unpublished.wordId },
      data: { status: 'draft' },
    });
    hidden.unpublished = unpublished.cardId;
    const deleted = await card(learner, 'deleted', { dueAt: ago(DAY) });
    await prisma.word.update({
      where: { id: deleted.wordId },
      data: { deletedAt: new Date() },
    });
    hidden.deleted = deleted.cardId;
    // Q255: the queue uses PUBLIC_WORD_WHERE, like save and word detail.
    const impure = await card(learner, 'impure', { dueAt: ago(DAY) });
    await prisma.word.update({
      where: { id: impure.wordId },
      data: { isPure: false },
    });
    hidden.impure = impure.cardId;
    const meaningless = await card(learner, 'meaningless', { dueAt: ago(DAY) });
    await prisma.wordMeaning.deleteMany({
      where: { wordId: meaningless.wordId },
    });
    hidden.meaningless = meaningless.cardId;
  });

  afterAll(async () => {
    await prisma?.rateLimitCounter.deleteMany();
    if (app) await app.close();
  });

  it('needs a token', async () => {
    await api().get('/api/v1/review/queue').expect(401);
  });

  it('returns only due, unsuspended cards of saved public words of the caller, oldest due first', async () => {
    const response = await queue(learner).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');

    const { dueCount, items } = response.body.data as {
      dueCount: number;
      items: { cardId: number; state: string; word: { id: number } }[];
    };
    expect(items.map((item) => item.cardId)).toEqual(due.map((d) => d.cardId));
    expect(items.map((item) => item.word.id)).toEqual(due.map((d) => d.wordId));
    expect(dueCount).toBe(3);
    for (const id of Object.values(hidden)) {
      expect(items.map((item) => item.cardId)).not.toContain(id);
    }

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('"userId"');
    expect(serialized).not.toContain('"status"');
  });

  it('leaves out cards of impure words and of words without a meaning (Q255)', async () => {
    const response = await queue(learner, '?limit=50').expect(200);
    const ids = response.body.data.items.map(
      (item: { cardId: number }) => item.cardId,
    );
    expect(ids).not.toContain(hidden.impure);
    expect(ids).not.toContain(hidden.meaningless);
    expect(response.body.data.dueCount).toBe(3);
  });

  it('returns the public word fields of the dictionary', async () => {
    const response = await queue(learner, '?limit=1').expect(200);
    expect(response.body.data.items[0].word).toEqual({
      id: due[0].wordId,
      hanzi: '复习',
      traditional: null,
      pinyin: `${tag}first`,
      pinyinTone: null,
      example: null,
      meanings: [
        {
          order: 1,
          en: 'first en',
          vi: null,
          partOfSpeech: null,
          usage: null,
          note: null,
        },
      ],
      levels: [],
      sources: [],
    });
  });

  it('cuts items by limit but keeps the full dueCount', async () => {
    const response = await queue(learner, '?limit=2').expect(200);
    expect(response.body.data.dueCount).toBe(3);
    expect(
      response.body.data.items.map((item: { cardId: number }) => item.cardId),
    ).toEqual(due.slice(0, 2).map((d) => d.cardId));
  });

  it.each(['0', '51', 'abc', '1.5'])(
    'rejects limit=%s with 400',
    async (limit) => {
      await queue(learner, `?limit=${limit}`).expect(400);
    },
  );

  it('accepts the limit bounds 1 and 50', async () => {
    await queue(learner, '?limit=1').expect(200);
    await queue(learner, '?limit=50').expect(200);
  });

  it('previews every grade with the sm2-v1 schedule', async () => {
    const before = Date.now();
    const response = await queue(learner).expect(200);
    const after = Date.now();
    type GradePreview = { state: string; dueAt: string; intervalDays: number };
    const items = response.body.data.items as {
      cardId: number;
      state: string;
      dueAt: string;
      preview: Record<'again' | 'hard' | 'good' | 'easy', GradePreview>;
    }[];

    const fresh = items[0];
    expect(fresh.state).toBe('new');
    const at = (p: GradePreview) => new Date(p.dueAt).getTime();
    expect(fresh.preview.again).toMatchObject({
      state: 'learning',
      intervalDays: 0,
    });
    expect(at(fresh.preview.again)).toBeGreaterThanOrEqual(before + MIN);
    expect(at(fresh.preview.again)).toBeLessThanOrEqual(after + MIN);
    // One request uses one `now`, so the four previews differ by exact offsets.
    expect(at(fresh.preview.hard) - at(fresh.preview.again)).toBe(30_000);
    expect(at(fresh.preview.good) - at(fresh.preview.again)).toBe(9 * MIN);
    expect(fresh.preview.easy).toMatchObject({
      state: 'review',
      intervalDays: 4,
    });
    expect(at(fresh.preview.easy) - at(fresh.preview.again)).toBe(
      4 * DAY - MIN,
    );

    const review = items.find((item) => item.cardId === reviewCard.cardId);
    expect(review?.state).toBe('review');
    expect(review?.preview.again).toMatchObject({
      state: 'relearning',
      intervalDays: 0,
    });
    expect(review?.preview.hard).toMatchObject({
      state: 'review',
      intervalDays: 12,
    });
    expect(review?.preview.good).toMatchObject({
      state: 'review',
      intervalDays: 25,
    });
    expect(review?.preview.easy).toMatchObject({
      state: 'review',
      intervalDays: 33,
    });
    // Every request item shares the same `now`.
    expect(at(fresh.preview.again)).toBe(at(review!.preview.again) - 9 * MIN);
  });

  it('shows the other learner only their own card', async () => {
    const response = await queue(other).expect(200);
    expect(response.body.data).toMatchObject({ dueCount: 1 });
    expect(
      response.body.data.items.map((i: { cardId: number }) => i.cardId),
    ).toEqual([hidden.otherUser]);
  });

  it('does not write anything', async () => {
    const before = await prisma.reviewCard.findMany({
      where: { userId: learner.id },
      orderBy: { id: 'asc' },
    });
    await queue(learner).expect(200);
    expect(
      await prisma.reviewCard.findMany({
        where: { userId: learner.id },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(before);
  });
});
