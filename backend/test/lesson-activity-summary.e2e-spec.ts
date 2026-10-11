/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { ContentStatus, ExerciseType, TopicType } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';
import { completePreviousReadyLesson } from './utils/lesson-path-fixtures';

type LevelState = {
  status: ContentStatus;
  publishedAt: Date | null;
  deletedAt: Date | null;
};

type PathBody = {
  levels: Array<{
    id: number;
    code: string;
    lessons: Array<{ id: number; position: number; state: string }>;
  }>;
};

/**
 * Q43 summary fields of the lesson activity. The suite's lessons use
 * negative `orderIndex` values, so they are the first ready lessons of
 * HSK7_9 whatever other suites leave there, and positions 1..5 are absolute.
 */
describe('Lesson activity summary (Q43) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let levelId: number;
  let priorLevel: LevelState | null = null;
  const lessonIds: Record<'l1' | 'l2' | 'l3' | 'l4' | 'l5', number> = {
    l1: 0,
    l2: 0,
    l3: 0,
    l4: 0,
    l5: 0,
  };
  let draftLessonId: number;
  const topicIds: Record<string, number> = {};
  const exerciseIds: Record<string, number> = {};
  const createdLessonIds: number[] = [];
  let learner: { token: string; userId: number };

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const base = -(1_000_000 + Math.floor(Math.random() * 1_000_000)) * 100;
  const password = 'StrongPassword123!';

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
    await app.init();
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);

    const prior = await prisma.level.findUnique({
      where: { code: 'HSK7_9' },
      select: { status: true, publishedAt: true, deletedAt: true },
    });
    priorLevel = prior;
    levelId = (
      await prisma.level.upsert({
        where: { code: 'HSK7_9' },
        update: {
          status: 'published',
          publishedAt: new Date(),
          deletedAt: null,
        },
        create: {
          code: 'HSK7_9',
          name: 'HSK 7-9',
          orderIndex: 7,
          minBand: 7,
          maxBand: 9,
          status: 'published',
          publishedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;

    // A run killed before afterAll leaves its published `summary-` lessons in
    // HSK7_9 with negative orderIndex; retire them so positions stay absolute.
    await prisma.lesson.updateMany({
      where: {
        levelId,
        slug: { startsWith: 'summary-' },
        deletedAt: null,
      },
      data: { status: 'archived', deletedAt: new Date() },
    });

    lessonIds.l1 = await createLesson(0, 'one');
    lessonIds.l2 = await createLesson(10, 'two');
    draftLessonId = await createLesson(15, 'draft', 'draft');
    lessonIds.l3 = await createLesson(20, 'three');
    lessonIds.l4 = await createLesson(30, 'four');
    lessonIds.l5 = await createLesson(40, 'five');
    await seedSectionContent(lessonIds.l2);

    // L1 done, L2 started (most recent learning), L3 opened long ago while
    // L2 is not done, L4 and L5 without a row: done/current/available/locked.
    learner = await register('cross');
    await completePreviousReadyLesson(prisma, learner.userId, lessonIds.l2);
    await post(learner.token, `/learning/lessons/${lessonIds.l2}/start`, 'x-l2')
      .send({})
      .expect(201);
    await prisma.progress.create({
      data: {
        userId: learner.userId,
        lessonId: lessonIds.l3,
        status: 'learning',
        startedAt: new Date('2026-01-01T00:00:00Z'),
        lastActivityAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await seedSectionProgress(learner);
  });

  afterAll(async () => {
    await prisma.lesson.updateMany({
      where: { id: { in: createdLessonIds } },
      data: { status: 'archived', deletedAt: new Date() },
    });
    if (priorLevel) {
      await prisma.level.update({ where: { id: levelId }, data: priorLevel });
    }
    await app.close();
  });

  it('[A1] rejects the activity without a JWT', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonIds.l1}/activity`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/learning/lessons/abc/activity')
      .expect(401);
  });

  it.each(['abc', '0', '2147483648'])(
    '[A2] rejects lesson id %j with 400',
    async (id) => {
      const response = await getActivity(learner.token, id).expect(400);
      expect(response.body.error.code).toBe('BAD_REQUEST');
    },
  );

  it('[A3] returns 404 for a lesson that is not ready or does not exist', async () => {
    for (const id of [draftLessonId, 2_147_483_647]) {
      const response = await getActivity(learner.token, id).expect(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('[A4] reads a locked lesson with state locked while start stays 409', async () => {
    const activity = await getActivity(learner.token, lessonIds.l4).expect(200);
    expect(activity.body.data).toMatchObject({
      position: 4,
      state: 'locked',
      level: { id: levelId, code: 'HSK7_9' },
      nextAction: 'start_lesson',
    });
    const start = await post(
      learner.token,
      `/learning/lessons/${lessonIds.l4}/start`,
      'x-l4',
    )
      .send({})
      .expect(409);
    expect(start.body.error.code).toBe('lesson_locked');
  });

  it('[A5] reports level, position and state of each Q18 case', async () => {
    const expected = [
      [lessonIds.l1, 1, 'done'],
      [lessonIds.l2, 2, 'current'],
      [lessonIds.l3, 3, 'available'],
      [lessonIds.l4, 4, 'locked'],
      [lessonIds.l5, 5, 'locked'],
    ] as const;
    const level = await prisma.level.findUniqueOrThrow({
      where: { id: levelId },
      select: { id: true, code: true, name: true },
    });
    for (const [id, position, state] of expected) {
      const response = await getActivity(learner.token, id).expect(200);
      expect([
        response.body.data.level,
        response.body.data.position,
        response.body.data.state,
      ]).toEqual([level, position, state]);
    }
  });

  it('[A6] matches position and state of every path lesson, for two learners', async () => {
    const fresh = await register('cross-fresh');
    for (const user of [learner, fresh]) {
      const path = (await getPath(user.token).expect(200)).body
        .data as PathBody;
      const fromPath: Array<[number, string, number, string]> = [];
      const fromActivity: Array<[number, string, number, string]> = [];
      for (const level of path.levels) {
        for (const lesson of level.lessons) {
          fromPath.push([lesson.id, level.code, lesson.position, lesson.state]);
          const activity = await getActivity(user.token, lesson.id).expect(200);
          const data = activity.body.data;
          fromActivity.push([
            lesson.id,
            data.level.code,
            data.position,
            data.state,
          ]);
        }
      }
      expect(fromActivity).toEqual(fromPath);

      // Absolute expectations keep the comparison honest if the shared
      // path builder itself regresses.
      const ours = fromPath.filter(([id]) =>
        Object.values(lessonIds).includes(id),
      );
      expect(ours).toEqual(
        user === learner
          ? [
              [lessonIds.l1, 'HSK7_9', 1, 'done'],
              [lessonIds.l2, 'HSK7_9', 2, 'current'],
              [lessonIds.l3, 'HSK7_9', 3, 'available'],
              [lessonIds.l4, 'HSK7_9', 4, 'locked'],
              [lessonIds.l5, 'HSK7_9', 5, 'locked'],
            ]
          : [
              [lessonIds.l1, 'HSK7_9', 1, 'current'],
              [lessonIds.l2, 'HSK7_9', 2, 'locked'],
              [lessonIds.l3, 'HSK7_9', 3, 'locked'],
              [lessonIds.l4, 'HSK7_9', 4, 'locked'],
              [lessonIds.l5, 'HSK7_9', 5, 'locked'],
            ],
      );
    }
  });

  it('[A7] counts public words, vocabulary/grammar topics and exercises only', async () => {
    await post(
      learner.token,
      `/learning/exercises/${exerciseIds.mcq}/attempts`,
      'x-mcq-again',
    )
      .send({ answer: { optionId: 'hello' } })
      .expect(201);

    const activity = await getActivity(learner.token, lessonIds.l2).expect(200);
    expect(activity.body.data.sections).toEqual({
      vocabulary: { wordCount: 2, topicCount: 2, topicsDone: 1 },
      grammar: { topicCount: 1, topicsDone: 1 },
      practice: { exerciseCount: 2, attempted: 1 },
    });
    expect(activity.body.data).not.toHaveProperty('story');
    expect(activity.body.data).not.toHaveProperty('stories');

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/lessons/${lessonIds.l2}`)
      .expect(200);
    expect(detail.body.data.words).toHaveLength(
      activity.body.data.sections.vocabulary.wordCount,
    );
    expect(detail.body.data.exercises).toHaveLength(
      activity.body.data.sections.practice.exerciseCount,
    );
  });

  it('[A8] keeps the existing activity fields', async () => {
    const activity = await getActivity(learner.token, lessonIds.l2).expect(200);
    expect(Object.keys(activity.body.data).sort()).toEqual(
      [
        'currentExercise',
        'currentTopic',
        'lesson',
        'level',
        'nextAction',
        'position',
        'progress',
        'sections',
        'standaloneExercises',
        'state',
        'topics',
      ].sort(),
    );
    expect(activity.body.data.lesson).toMatchObject({
      id: lessonIds.l2,
      levelId,
    });
    expect(activity.body.data.progress.status).toBe('learning');
  });

  async function createLesson(
    offset: number,
    slug: string,
    status: ContentStatus = 'published',
  ) {
    const lesson = await prisma.lesson.create({
      data: {
        levelId,
        title: `Summary lesson ${slug}`,
        orderIndex: base + offset,
        slug: `summary-${slug}-${suffix}`,
        status,
        publishedAt: new Date(),
        topics: {
          create: {
            title: `Summary ${slug} intro`,
            type: 'key_text',
            content: [{ type: 'text', value: 'Intro.' }],
            orderIndex: 1,
            status: 'published',
            publishedAt: new Date(),
          },
        },
      },
      select: { id: true },
    });
    createdLessonIds.push(lesson.id);
    return lesson.id;
  }

  async function createTopic(
    lessonId: number,
    key: string,
    type: TopicType,
    orderIndex: number,
    status: ContentStatus = 'published',
    deleted = false,
  ) {
    topicIds[key] = (
      await prisma.topic.create({
        data: {
          lessonId,
          title: `Summary topic ${key}`,
          type,
          content: [{ type: 'text', value: key }],
          orderIndex,
          status,
          publishedAt: new Date(),
          deletedAt: deleted ? new Date() : null,
        },
        select: { id: true },
      })
    ).id;
  }

  async function createExercise(
    lessonId: number,
    key: string,
    type: ExerciseType,
    orderIndex: number,
    options: {
      topicId?: number | null;
      status?: ContentStatus;
      deleted?: boolean;
    } = {},
  ) {
    exerciseIds[key] = (
      await prisma.lessonExercise.create({
        data: {
          lessonId,
          topicId: options.topicId ?? null,
          type,
          prompt: `Summary exercise ${key}`,
          content: {
            options: [
              { id: 'hello', text: '你好' },
              { id: 'bye', text: '再见' },
            ],
          },
          answer: { optionId: 'hello' },
          orderIndex,
          status: options.status ?? 'published',
          publishedAt: new Date(),
          deletedAt: options.deleted ? new Date() : null,
        },
        select: { id: true },
      })
    ).id;
  }

  async function createLessonWord(
    lessonId: number,
    key: string,
    orderIndex: number,
    status: ContentStatus = 'published',
    deleted = false,
  ) {
    const word = await prisma.word.create({
      data: {
        hanzi: `词${key}-${suffix}`,
        pinyin: `ci-${key}-${suffix}`,
        pinyinNormalized: `ci${key}${suffix}`,
        status,
        publishedAt: new Date(),
        deletedAt: deleted ? new Date() : null,
      },
      select: { id: true },
    });
    await prisma.lessonWord.create({
      data: { lessonId, wordId: word.id, orderIndex },
    });
  }

  /**
   * L2 content: two public vocabulary topics, one public grammar topic, and
   * one hidden copy of each kind (draft, soft-deleted, archived) that must
   * not be counted; key_text and quiz topics never count.
   */
  async function seedSectionContent(lessonId: number) {
    await createTopic(lessonId, 'vocab1', 'vocabulary', 2);
    await createTopic(lessonId, 'vocab2', 'vocabulary', 3);
    await createTopic(lessonId, 'vocabDraft', 'vocabulary', 4, 'draft');
    await createTopic(
      lessonId,
      'vocabDeleted',
      'vocabulary',
      5,
      'published',
      true,
    );
    await createTopic(lessonId, 'grammar1', 'grammar', 6);
    await createTopic(lessonId, 'grammarArchived', 'grammar', 7, 'archived');
    await createTopic(lessonId, 'quiz', 'quiz', 8);

    await createExercise(lessonId, 'mcq', 'mcq', 1, {
      topicId: topicIds.vocab1,
    });
    await createExercise(lessonId, 'fill', 'fill_blank', 2);
    // The publish-readiness trigger rejects a published speaking_repeat, so
    // it can only exist as draft; the type filter itself is unit-tested.
    await createExercise(lessonId, 'speaking', 'speaking_repeat', 3, {
      status: 'draft',
    });
    await createExercise(lessonId, 'draft', 'mcq', 4, { status: 'draft' });
    // LessonExercise_archive_state_check: soft-deleted means archived.
    await createExercise(lessonId, 'deleted', 'mcq', 5, {
      status: 'archived',
      deleted: true,
    });
    await createExercise(lessonId, 'draftTopic', 'mcq', 6, {
      topicId: topicIds.vocabDraft,
    });

    await createLessonWord(lessonId, 'a', 1);
    await createLessonWord(lessonId, 'b', 2);
    await createLessonWord(lessonId, 'draft', 3, 'draft');
    await createLessonWord(lessonId, 'deleted', 4, 'published', true);
  }

  /** Done rows on hidden or non-section topics and attempts on hidden exercises must not count. */
  async function seedSectionProgress(user: { token: string; userId: number }) {
    for (const key of [
      'vocab1',
      'vocabDraft',
      'vocabDeleted',
      'grammar1',
      'grammarArchived',
      'quiz',
    ]) {
      await prisma.userTopicProgress.create({
        data: {
          userId: user.userId,
          topicId: topicIds[key],
          status: 'done',
          completionPercent: 100,
          startedAt: new Date(),
          completedAt: new Date(),
          lastActivityAt: new Date(),
        },
      });
    }
    await post(
      user.token,
      `/learning/exercises/${exerciseIds.mcq}/attempts`,
      'x-mcq',
    )
      .send({ answer: { optionId: 'hello' } })
      .expect(201);
    for (const key of ['speaking', 'draft', 'deleted', 'draftTopic']) {
      await prisma.lessonExerciseAttempt.create({
        data: {
          userId: user.userId,
          exerciseId: exerciseIds[key],
          attemptNumber: 1,
          answer: { optionId: 'hello' },
          contentSnapshot: {},
          submittedAt: new Date(),
        },
      });
    }
  }

  function post(token: string, path: string, key: string) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `${key}-${suffix}`.slice(0, 120));
  }

  function getActivity(token: string, lessonId: number | string) {
    return request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}/activity`)
      .set('Authorization', `Bearer ${token}`);
  }

  function getPath(token: string) {
    return request(app.getHttpServer())
      .get('/api/v1/learning/path')
      .set('Authorization', `Bearer ${token}`);
  }

  async function register(label: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `summary-${label}-${suffix}@example.com`,
        password,
        name: label,
      })
      .expect(201);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as number,
    };
  }
});
