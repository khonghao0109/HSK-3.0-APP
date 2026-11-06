/// <reference types="jest" />

import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { normalizePinyin } from '../src/common/utils/normalize-pinyin';
import { DictionaryService } from '../src/modules/dictionary/dictionary.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/** M2.6a: dictionary word detail and save/unsave (Q62). */
describe('Dictionary words E2E (M2.6a)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: number;
  let hsk1Id: number;
  let hsk1Name: string;
  let draftLevel: {
    id: number;
    status: 'draft' | 'published' | 'archived';
    created: boolean;
  };
  let lessonId: number;
  const words: Record<string, number> = {};

  // Pinyin search accepts letters only, so the run tag is spelled with a-j.
  const runNumber = Number(String(Date.now()).slice(-8));
  const tag = String(runNumber).replace(/\d/g, (digit) =>
    String.fromCharCode(97 + Number(digit)),
  );
  const pinyinPrefix = `zq${tag}`;

  async function createWord(
    name: string,
    options: {
      status?: 'draft' | 'published';
      deletedAt?: Date;
      isPure?: boolean;
      meanings?: boolean;
    } = {},
  ): Promise<number> {
    const pinyin = `${pinyinPrefix}${name}`;
    const word = await prisma.word.create({
      data: {
        hanzi: '学习',
        pinyin,
        pinyinNormalized: normalizePinyin(pinyin),
        status: options.status ?? 'published',
        deletedAt: options.deletedAt,
        isPure: options.isPure ?? true,
        ...(options.meanings === false
          ? {}
          : {
              meanings: {
                create: [{ meaningOrder: 1, meaningEn: `${name} meaning` }],
              },
            }),
      },
      select: { id: true },
    });
    return word.id;
  }

  function api() {
    return request(app.getHttpServer());
  }
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const save = (id: number | string, key: string = randomUUID()) =>
    api()
      .post(`/api/v1/dictionary/words/${id}/save`)
      .set(auth())
      .set('Idempotency-Key', key);
  const savedState = (id: number) =>
    api().get(`/api/v1/dictionary/words/${id}/save`).set(auth());
  const unsave = (id: number | string) =>
    api().delete(`/api/v1/dictionary/words/${id}/save`).set(auth());
  const countSaves = async (wordId: number) => ({
    userWords: await prisma.userWord.count({ where: { userId, wordId } }),
    events: await prisma.learningEvent.count({
      where: { userId, type: 'word_saved', resourceId: wordId },
    }),
  });

  function expectNoPrivateKeys(body: unknown) {
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('"userId"');
    expect(serialized).not.toContain('"idempotencyKey"');
    expect(serialized).not.toContain('accessToken');
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

    const hsk1 = await prisma.level.upsert({
      where: { code: 'HSK1' },
      update: { status: 'published', deletedAt: null },
      create: {
        code: 'HSK1',
        name: 'HSK 1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true, name: true },
    });
    hsk1Id = hsk1.id;
    hsk1Name = hsk1.name;
    // Level codes are fixed by Level_code_band_check, so HSK5 serves as the
    // draft Level: an existing row is flipped and restored afterwards, a row
    // created here is removed again (other suites create HSK5 themselves).
    const existingHsk5 = await prisma.level.findUnique({
      where: { code: 'HSK5' },
      select: { id: true, status: true },
    });
    if (existingHsk5) {
      draftLevel = { ...existingHsk5, created: false };
      await prisma.level.update({
        where: { id: existingHsk5.id },
        data: { status: 'draft' },
      });
    } else {
      const createdHsk5 = await prisma.level.create({
        data: {
          code: 'HSK5',
          name: `M2.6a HSK 5 ${tag}`,
          orderIndex: 5,
          minBand: 5,
          maxBand: 5,
          status: 'draft',
        },
        select: { id: true, status: true },
      });
      draftLevel = { ...createdHsk5, created: true };
    }

    const primary = await prisma.dataSource.create({
      data: {
        code: `m26a-primary-${tag}`,
        name: `M2.6a primary ${tag}`,
        version: '2.0.0',
        referenceUrl: 'https://example.invalid/not-public',
        license: 'CC-BY-SA-4.0',
        attribution: 'M2.6a attribution',
      },
    });
    const secondary = await prisma.dataSource.create({
      data: {
        code: `m26a-secondary-${tag}`,
        name: `M2.6a secondary ${tag}`,
        version: '1.0.0',
      },
    });

    words.detail = await prisma.word
      .create({
        data: {
          hanzi: '学习',
          traditional: '學習',
          pinyin: `${pinyinPrefix}detail`,
          pinyinNormalized: normalizePinyin(`${pinyinPrefix}detail`),
          pinyinTone: 'xue2 xi2',
          example: '我每天都学习中文。',
          status: 'published',
          // Created out of order: the response must follow meaningOrder.
          meanings: {
            create: [
              { meaningOrder: 2, meaningEn: 'to learn' },
              {
                meaningOrder: 1,
                meaningEn: 'to study',
                meaningVi: 'học tập',
                partOfSpeech: 'verb',
              },
            ],
          },
          wordLevels: {
            create: [{ levelId: draftLevel.id }, { levelId: hsk1Id }],
          },
          // The primary source is created after the secondary one.
          sources: {
            create: [
              { dataSourceId: secondary.id, isPrimary: false },
              { dataSourceId: primary.id, isPrimary: true },
            ],
          },
        },
        select: { id: true },
      })
      .then((word) => word.id);
    words.draft = await createWord('draft', { status: 'draft' });
    words.deleted = await createWord('deleted', { deletedAt: new Date() });
    words.impure = await createWord('impure', { isPure: false });
    words.noMeaning = await createWord('nomeaning', { meanings: false });
    words.saveMe = await createWord('saveme');
    words.parallel = await createWord('parallel');
    words.unpublish = await createWord('unpublish');
    words.serviceRace = await createWord('servicerace');

    lessonId = (
      await prisma.lesson.create({
        data: {
          levelId: hsk1Id,
          title: 'M2.6a lesson',
          slug: `m26a-lesson-${tag}`,
          // (levelId, orderIndex) is unique, so each run takes its own slot.
          orderIndex: 100_000 + runNumber,
        },
        select: { id: true },
      })
    ).id;

    const registered = await api()
      .post('/api/v1/auth/register')
      .send({
        email: `m26a-learner-${tag}@example.com`,
        password: 'StrongPassword123!',
        name: 'M2.6a learner',
      })
      .expect(201);
    token = registered.body.data.accessToken as string;
    userId = (
      await prisma.user.findUniqueOrThrow({
        where: { email: `m26a-learner-${tag}@example.com` },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (prisma && draftLevel?.created) {
      // WordLevel rows of this suite cascade with the Level.
      await prisma.level.delete({ where: { id: draftLevel.id } });
    } else if (prisma && draftLevel) {
      await prisma.level.update({
        where: { id: draftLevel.id },
        data: { status: draftLevel.status },
      });
    }
    await prisma?.rateLimitCounter.deleteMany();
    if (app) await app.close();
  });

  it('GET /dictionary returns the id of each public word', async () => {
    const response = await api()
      .get('/api/v1/dictionary')
      .query({ query: pinyinPrefix })
      .expect(200);

    const results = response.body.data as Array<{ id: number; pinyin: string }>;
    const ids = results.map((word) => word.id);
    expect(ids).toEqual(expect.arrayContaining([words.detail, words.saveMe]));
    for (const hidden of ['draft', 'deleted', 'impure', 'noMeaning']) {
      expect(ids).not.toContain(words[hidden]);
    }
    expect(results.find((word) => word.id === words.detail)).toEqual({
      id: words.detail,
      hanzi: '学习',
      pinyin: `${pinyinPrefix}detail`,
      pinyinTone: 'xue2 xi2',
      meanings: [
        { en: 'to study', vi: 'học tập' },
        { en: 'to learn', vi: null },
      ],
      level: hsk1Name,
    });
  });

  it('GET /dictionary/words/:id returns the public detail without a token', async () => {
    const response = await api()
      .get(`/api/v1/dictionary/words/${words.detail}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      id: words.detail,
      hanzi: '学习',
      traditional: '學習',
      pinyin: `${pinyinPrefix}detail`,
      pinyinTone: 'xue2 xi2',
      example: '我每天都学习中文。',
      meanings: [
        {
          order: 1,
          en: 'to study',
          vi: 'học tập',
          partOfSpeech: 'verb',
          usage: null,
          note: null,
        },
        {
          order: 2,
          en: 'to learn',
          vi: null,
          partOfSpeech: null,
          usage: null,
          note: null,
        },
      ],
      levels: [{ code: 'HSK1', name: hsk1Name }],
      sources: [
        {
          name: `M2.6a primary ${tag}`,
          version: '2.0.0',
          license: 'CC-BY-SA-4.0',
          attribution: 'M2.6a attribution',
        },
        {
          name: `M2.6a secondary ${tag}`,
          version: '1.0.0',
          license: null,
          attribution: null,
        },
      ],
    });
    expect(Object.keys(response.body.data)).toEqual([
      'id',
      'hanzi',
      'traditional',
      'pinyin',
      'pinyinTone',
      'example',
      'meanings',
      'levels',
      'sources',
    ]);
  });

  it.each(['draft', 'deleted', 'impure', 'noMeaning', 'missing'])(
    'GET /dictionary/words/:id is 404 for a %s word',
    async (name) => {
      const id = name === 'missing' ? 2_147_483_000 : words[name];
      const response = await api()
        .get(`/api/v1/dictionary/words/${id}`)
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: { code: 'WORD_NOT_FOUND', message: 'Word not found.' },
      });
    },
  );

  it.each(['0', '-1', 'abc', '9007199254740993'])(
    'GET /dictionary/words/%s is 400',
    async (id) => {
      const response = await api()
        .get(`/api/v1/dictionary/words/${id}`)
        .expect(400);
      expect(response.body.success).toBe(false);
    },
  );

  it('GET save state needs a token, is false before saving and 404 for a draft word', async () => {
    await api()
      .get(`/api/v1/dictionary/words/${words.saveMe}/save`)
      .expect(401);

    const before = await savedState(words.saveMe).expect(200);
    expect(before.body.data).toEqual({ wordId: words.saveMe, saved: false });

    const draft = await savedState(words.draft).expect(404);
    expect(draft.body.error.code).toBe('WORD_NOT_FOUND');
  });

  it('POST save needs a token and an Idempotency-Key', async () => {
    await api()
      .post(`/api/v1/dictionary/words/${words.saveMe}/save`)
      .set('Idempotency-Key', randomUUID())
      .expect(401);
    await api()
      .post(`/api/v1/dictionary/words/${words.saveMe}/save`)
      .set(auth())
      .expect(400);
    await save(words.saveMe, 'bad key!').expect(400);
    await save('abc').expect(400);

    expect(await countSaves(words.saveMe)).toEqual({ userWords: 0, events: 0 });
  });

  it('POST save stores one UserWord and one word_saved event, replays and ignores a second save', async () => {
    const key = randomUUID();
    const first = await save(words.saveMe, key).expect(201);
    expect(first.body.data).toEqual({
      wordId: words.saveMe,
      saved: true,
      eventId: expect.stringMatching(/^\d+$/),
      occurredAt: expect.any(String),
    });
    expectNoPrivateKeys(first.body);

    const event = await prisma.learningEvent.findFirstOrThrow({
      where: { userId, idempotencyKey: key },
    });
    expect(event).toMatchObject({
      type: 'word_saved',
      resourceType: 'word',
      resourceId: words.saveMe,
      lessonId: null,
      topicId: null,
      exerciseId: null,
      attemptId: null,
    });
    expect(event.id.toString()).toBe(first.body.data.eventId);
    expect(await countSaves(words.saveMe)).toEqual({ userWords: 1, events: 1 });

    const replay = await save(words.saveMe, key).expect(201);
    expect(replay.body.data).toEqual(first.body.data);

    const again = await save(words.saveMe).expect(201);
    expect(again.body.data).toEqual({
      wordId: words.saveMe,
      saved: true,
      eventId: null,
      occurredAt: null,
    });
    expect(await countSaves(words.saveMe)).toEqual({ userWords: 1, events: 1 });

    const state = await savedState(words.saveMe).expect(200);
    expect(state.body.data).toEqual({ wordId: words.saveMe, saved: true });
    expectNoPrivateKeys(state.body);
  });

  it('POST save refuses a key used by another request with 409', async () => {
    const lessonKey = randomUUID();
    await prisma.learningEvent.create({
      data: {
        userId,
        type: 'lesson_started',
        lessonId,
        idempotencyKey: lessonKey,
      },
    });
    await save(words.detail, lessonKey).expect(409);

    const wordKey = randomUUID();
    await save(words.detail, wordKey).expect(201);
    await save(words.parallel, wordKey).expect(409);
    expect(await countSaves(words.parallel)).toEqual({
      userWords: 0,
      events: 0,
    });
  });

  it('POST save is 404 for a word that is not public', async () => {
    const response = await save(words.draft).expect(404);
    expect(response.body.error.code).toBe('WORD_NOT_FOUND');
    expect(await countSaves(words.draft)).toEqual({ userWords: 0, events: 0 });
  });

  // Contract check (no 500, one UserWord, one event); the lock is proven by the service-level test below.
  it('concurrent saves with different keys store one UserWord and one event', async () => {
    // Eight requests make the race show up without the per-user lock.
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => save(words.parallel)),
    );

    expect(responses.map((response) => response.status)).toEqual(
      Array(8).fill(201),
    );
    const eventIds = responses.map((response) => response.body.data.eventId);
    expect(eventIds.filter((id) => id !== null)).toHaveLength(1);
    expect(await countSaves(words.parallel)).toEqual({
      userWords: 1,
      events: 1,
    });
  });

  // Lock evidence: without HTTP overhead the transactions overlap, and only the per-user lock keeps one UserWord.
  it('concurrent service saves without HTTP still store one UserWord and one event', async () => {
    const service = app.get(DictionaryService);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.saveWord(userId, words.serviceRace, randomUUID()),
      ),
    );

    expect(results.map((result) => result.status)).toEqual(
      Array(8).fill('fulfilled'),
    );
    expect(await countSaves(words.serviceRace)).toEqual({
      userWords: 1,
      events: 1,
    });
  });

  it('a saved word that stops being public stays saved until it is unsaved', async () => {
    await save(words.unpublish).expect(201);
    await prisma.word.update({
      where: { id: words.unpublish },
      data: { status: 'draft' },
    });

    const state = await savedState(words.unpublish).expect(200);
    expect(state.body.data).toEqual({ wordId: words.unpublish, saved: true });

    const removed = await unsave(words.unpublish).expect(200);
    expect(removed.body.data).toEqual({
      wordId: words.unpublish,
      saved: false,
    });
    await savedState(words.unpublish).expect(404);
    // Unsaving writes no event; the earlier word_saved fact stays.
    expect(await countSaves(words.unpublish)).toEqual({
      userWords: 0,
      events: 1,
    });
  });

  it('DELETE save is idempotent, needs a token and validates the id', async () => {
    await api()
      .delete(`/api/v1/dictionary/words/${words.saveMe}/save`)
      .expect(401);

    for (let round = 0; round < 2; round += 1) {
      const response = await unsave(words.saveMe).expect(200);
      expect(response.body.data).toEqual({
        wordId: words.saveMe,
        saved: false,
      });
      expectNoPrivateKeys(response.body);
    }
    const state = await savedState(words.saveMe).expect(200);
    expect(state.body.data.saved).toBe(false);

    const missing = await unsave(2_147_483_000).expect(200);
    expect(missing.body.data).toEqual({ wordId: 2_147_483_000, saved: false });
    await unsave('abc').expect(400);
    expect(await countSaves(words.saveMe)).toEqual({ userWords: 0, events: 1 });
  });
});
