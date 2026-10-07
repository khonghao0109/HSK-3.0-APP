/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';
import { completePreviousReadyLesson } from './utils/lesson-path-fixtures';

type LevelState = {
  status: 'draft' | 'published' | 'archived';
  publishedAt: Date | null;
  deletedAt: Date | null;
};

/**
 * HSK2 and HSK3 carry no lessons from other suites (learning.e2e only flips
 * their status), so positions here do not depend on suite order. Their prior
 * state is restored and this suite's lessons are withdrawn in `afterAll`.
 */
describe('Learning path and sequential lesson lock (Q18) E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pathLevelId: number;
  let emptyLevelId: number;
  let lesson1Id: number;
  let lesson2Id: number;
  let lesson3Id: number;
  let draftLessonId: number;
  let archivedLessonId: number;
  let archivedTopicLessonId: number;
  let lesson2TopicId: number;
  let lesson2ExerciseId: number;
  let lockedAtThree: { token: string; userId: number } | undefined;
  const priorLevels = new Map<number, LevelState | null>();
  const createdLessonIds: number[] = [];

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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

    pathLevelId = await publishLevel('HSK2', 2);
    emptyLevelId = await publishLevel('HSK3', 3);

    lesson1Id = await createLesson(10, 'one', 'story');
    draftLessonId = await createLesson(15, 'draft', 'story', 'draft');
    const lesson2 = await prisma.lesson.create({
      data: {
        levelId: pathLevelId,
        title: 'Path lesson two',
        orderIndex: 20,
        slug: `path-two-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
        topics: {
          create: {
            title: 'Path topic',
            content: [{ type: 'text', value: 'Second lesson.' }],
            orderIndex: 1,
            status: 'published',
            publishedAt: new Date(),
          },
        },
      },
      select: { id: true, topics: { select: { id: true } } },
    });
    lesson2Id = lesson2.id;
    createdLessonIds.push(lesson2Id);
    lesson2TopicId = lesson2.topics[0].id;
    lesson2ExerciseId = (
      await prisma.lessonExercise.create({
        data: {
          lessonId: lesson2Id,
          topicId: lesson2TopicId,
          type: 'mcq',
          prompt: 'Choose the greeting',
          content: {
            options: [
              { id: 'hello', text: '你好' },
              { id: 'bye', text: '再见' },
            ],
          },
          answer: { optionId: 'hello' },
          orderIndex: 1,
          status: 'published',
          publishedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;
    archivedLessonId = await createLesson(25, 'archived', 'story', 'archived');
    archivedTopicLessonId = await createLesson(26, 'old-topic', 'archived');
    lesson3Id = await createLesson(30, 'three', 'story');
  });

  afterAll(async () => {
    await prisma.lesson.updateMany({
      where: { id: { in: createdLessonIds } },
      data: { status: 'archived', deletedAt: new Date() },
    });
    for (const [id, state] of priorLevels) {
      await prisma.level.update({
        where: { id },
        data: state ?? { status: 'draft', publishedAt: null, deletedAt: null },
      });
    }
    await app.close();
  });

  it('[S1] returns 404 for a lesson that is not ready, even when it would be locked', async () => {
    const learner = await register('s1');
    for (const id of [draftLessonId, archivedLessonId, archivedTopicLessonId]) {
      const response = await start(learner.token, id, `s1-start-${id}`).expect(
        404,
      );
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
    await expect(
      prisma.progress.count({ where: { userId: learner.userId } }),
    ).resolves.toBe(0);
  });

  it('[S2] starts the first ready lesson of a level without progress', async () => {
    const learner = await register('s2');
    const response = await start(
      learner.token,
      lesson1Id,
      's2-start-l1',
    ).expect(201);
    expect(response.body.data).toMatchObject({
      lessonId: lesson1Id,
      status: 'learning',
    });
  });

  it('[S3] rejects a lesson whose previous lesson is not done without side effects', async () => {
    const learner = await register('s3');
    const plan = await prisma.learningPlan.create({
      data: {
        userId: learner.userId,
        targetLevelId: pathLevelId,
        targetBand: 2,
        status: 'active',
        startDate: new Date('2026-10-07T00:00:00Z'),
        items: { create: { lessonId: lesson2Id, orderIndex: 1 } },
      },
      select: { items: { select: { id: true } } },
    });

    const response = await start(
      learner.token,
      lesson2Id,
      's3-start-l2',
    ).expect(409);
    expect(response.body.error).toEqual({
      code: 'lesson_locked',
      message: 'Complete the previous lesson first.',
    });
    await expect(
      prisma.progress.count({ where: { userId: learner.userId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.learningEvent.count({ where: { userId: learner.userId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.learningPlanItem.findUniqueOrThrow({
        where: { id: plan.items[0].id },
        select: { status: true, startedAt: true },
      }),
    ).resolves.toEqual({ status: 'planned', startedAt: null });
  });

  it('[S4] starts the next lesson once the previous lesson is done', async () => {
    const learner = await register('s4');
    await start(learner.token, lesson1Id, 's4-start-l1').expect(201);
    await complete(learner.token, lesson1Id, 's4-done-l1').expect(201);
    await start(learner.token, lesson2Id, 's4-start-l2').expect(201);
  });

  it('[S5] keeps the already-started conflict for a started locked lesson', async () => {
    const learner = await register('s5');
    const now = new Date();
    await prisma.progress.create({
      data: {
        userId: learner.userId,
        lessonId: lesson2Id,
        status: 'learning',
        startedAt: now,
        lastActivityAt: now,
      },
    });
    const response = await start(learner.token, lesson2Id, 's5-new-key').expect(
      409,
    );
    expect(response.body.error).toEqual({
      code: 'CONFLICT',
      message: 'Lesson was already started with a different Idempotency-Key.',
    });
  });

  it('[S6] starts a locked lesson that has a not_started progress row', async () => {
    const learner = await register('s6');
    await prisma.progress.create({
      data: { userId: learner.userId, lessonId: lesson2Id },
    });
    await start(learner.token, lesson2Id, 's6-start-l2').expect(201);
    await expect(
      prisma.progress.findUniqueOrThrow({
        where: {
          userId_lessonId: { userId: learner.userId, lessonId: lesson2Id },
        },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'learning' });
  });

  it('[S7] replays the key of a successful start with the same event', async () => {
    const learner = await register('s7');
    const first = await start(learner.token, lesson1Id, 's7-start-l1').expect(
      201,
    );
    const replay = await start(learner.token, lesson1Id, 's7-start-l1').expect(
      201,
    );
    expect(replay.body.data.eventId).toBe(first.body.data.eventId);
    expect(replay.body.data).toEqual(first.body.data);
  });

  it('[S8] does not consume a key rejected as lesson_locked', async () => {
    const learner = await register('s8');
    const locked = await start(learner.token, lesson2Id, 's8-start-l2').expect(
      409,
    );
    expect(locked.body.error.code).toBe('lesson_locked');
    await start(learner.token, lesson1Id, 's8-start-l1').expect(201);
    await complete(learner.token, lesson1Id, 's8-done-l1').expect(201);
    const retried = await start(learner.token, lesson2Id, 's8-start-l2').expect(
      201,
    );
    expect(retried.body.data).toMatchObject({
      lessonId: lesson2Id,
      status: 'learning',
    });
  });

  it('[S9] rejects a key already used for another lesson', async () => {
    const learner = await register('s9');
    await start(learner.token, lesson1Id, 's9-shared-key').expect(201);
    const response = await start(
      learner.token,
      lesson2Id,
      's9-shared-key',
    ).expect(409);
    expect(response.body.error).toEqual({
      code: 'CONFLICT',
      message: 'Idempotency-Key was already used for a different request.',
    });
  });

  it('[S10] starts the first lesson of a level other than the goal level', async () => {
    const learner = await register('s10');
    await prisma.userGoal.create({
      data: {
        userId: learner.userId,
        targetLevelId: emptyLevelId,
        targetBand: 3,
        dailyMinutes: 15,
        startDate: new Date('2026-10-07T00:00:00Z'),
      },
    });
    await start(learner.token, lesson1Id, 's10-start-l1').expect(201);
  });

  it('[S11] keeps topic, attempt and complete writes closed on a locked lesson', async () => {
    const learner = await register('s11');
    const writes = [
      post(
        learner.token,
        `/learning/topics/${lesson2TopicId}/start`,
        's11-topic-start',
      ),
      post(
        learner.token,
        `/learning/exercises/${lesson2ExerciseId}/attempts`,
        's11-attempt',
        { answer: { optionId: 'hello' } },
      ),
      post(
        learner.token,
        `/learning/lessons/${lesson2Id}/complete`,
        's11-complete',
      ),
    ];
    for (const write of writes) {
      const response = await write.expect(409);
      expect(response.body.error).toEqual({
        code: 'CONFLICT',
        message: 'Lesson must be started first.',
      });
    }
    await expect(
      prisma.learningEvent.count({ where: { userId: learner.userId } }),
    ).resolves.toBe(0);
  });

  it('[S12] keeps the database consistent when completing L1 races starting L2', async () => {
    const learner = await register('s12');
    await start(learner.token, lesson1Id, 's12-start-l1').expect(201);
    const [completed, started] = await Promise.all([
      complete(learner.token, lesson1Id, 's12-done-l1'),
      start(learner.token, lesson2Id, 's12-start-l2'),
    ]);
    expect(completed.status).toBe(201);
    expect([201, 409]).toContain(started.status);

    const l2Progress = await prisma.progress.findUnique({
      where: {
        userId_lessonId: { userId: learner.userId, lessonId: lesson2Id },
      },
      select: { status: true },
    });
    const l2Events = await prisma.learningEvent.count({
      where: { userId: learner.userId, lessonId: lesson2Id },
    });
    await expect(
      prisma.progress.findUniqueOrThrow({
        where: {
          userId_lessonId: { userId: learner.userId, lessonId: lesson1Id },
        },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'done' });
    if (started.status === 201) {
      expect(l2Progress).toEqual({ status: 'learning' });
      expect(l2Events).toBe(1);
    } else {
      // The start ran first under the user lock: L1 was still learning.
      expect(started.body.error.code).toBe('lesson_locked');
      expect(l2Progress).toBeNull();
      expect(l2Events).toBe(0);
      await start(learner.token, lesson2Id, 's12-start-l2').expect(201);
    }
  });

  it('[S13] locks position 3 while the previous ready lesson is not done', async () => {
    const learner = await register('s13');
    lockedAtThree = learner;
    await completePreviousReadyLesson(prisma, learner.userId, lesson2Id);
    const response = await start(
      learner.token,
      lesson3Id,
      's13-start-l3',
    ).expect(409);
    expect(response.body.error.code).toBe('lesson_locked');
    await expect(
      prisma.progress.count({
        where: { userId: learner.userId, lessonId: lesson3Id },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.learningEvent.count({ where: { userId: learner.userId } }),
    ).resolves.toBe(0);
  });

  it('[S14] unlocks position 3 once L2 is done, skipping withdrawn lessons 25 and 26', async () => {
    const learner = lockedAtThree;
    if (!learner) throw new Error('[S13] must run first');
    await completePreviousReadyLesson(prisma, learner.userId, lesson3Id);
    await start(learner.token, lesson3Id, 's14-start-l3').expect(201);
  });

  it('checks an expired key before the lesson lock', async () => {
    const learner = await register('expired');
    const expiredAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await prisma.learningEvent.create({
      data: {
        userId: learner.userId,
        type: 'lesson_started',
        lessonId: lesson2Id,
        idempotencyKey: 'expired-start-l2',
        occurredAt: expiredAt,
        createdAt: expiredAt,
      },
    });
    const response = await start(
      learner.token,
      lesson2Id,
      'expired-start-l2',
    ).expect(400);
    expect(response.body.error.message).toBe(
      'Idempotency-Key has expired. Please use a fresh key.',
    );
  });

  it('[P1] rejects the path without a JWT', async () => {
    await request(app.getHttpServer()).get('/api/v1/learning/path').expect(401);
  });

  it('[P2] returns levels and set_goal for a learner without a goal', async () => {
    const learner = await register('p2');
    const response = await getPath(learner.token).expect(200);
    expect(response.body.data).toMatchObject({
      nextStep: 'set_goal',
      goal: null,
      nextLesson: null,
    });
    expect(pathLevel(response.body.data)).toEqual({
      id: pathLevelId,
      code: 'HSK2',
      name: 'HSK2',
      orderIndex: 2,
      lessonCount: 3,
      completedCount: 0,
      lessons: [
        lessonView(lesson1Id, 'Path lesson one', 'one', 1, 'current'),
        lessonView(lesson2Id, 'Path lesson two', 'two', 2, 'locked'),
        lessonView(lesson3Id, 'Path lesson three', 'three', 3, 'locked'),
      ],
    });
  });

  it('[P3] hides draft or archived levels and lessons without ready content', async () => {
    const learner = await register('p3');
    const hidden = new Set([
      draftLessonId,
      archivedLessonId,
      archivedTopicLessonId,
    ]);
    const ids = (body: PathBody) =>
      body.levels.flatMap((level) => level.lessons.map((lesson) => lesson.id));

    const published = (await getPath(learner.token).expect(200)).body
      .data as PathBody;
    expect(ids(published).filter((id) => hidden.has(id))).toEqual([]);

    for (const status of ['draft', 'archived'] as const) {
      await prisma.level.update({
        where: { id: pathLevelId },
        data: { status },
      });
      const body = (await getPath(learner.token).expect(200)).body
        .data as PathBody;
      expect(body.levels.map((level) => level.id)).not.toContain(pathLevelId);
      expect(ids(body)).not.toContain(lesson1Id);
    }
    await prisma.level.update({
      where: { id: pathLevelId },
      data: { status: 'published' },
    });
  });

  it('[P4] lists a published level without ready lessons and is not cached', async () => {
    const learner = await register('p4');
    const response = await getPath(learner.token).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const level = (response.body.data as PathBody).levels.find(
      (item) => item.id === emptyLevelId,
    );
    expect(level).toEqual({
      id: emptyLevelId,
      code: 'HSK3',
      name: 'HSK3',
      orderIndex: 3,
      lessonCount: 0,
      completedCount: 0,
      lessons: [],
    });
  });

  it('[P5] reports goal, progress and nextLesson without writing', async () => {
    const learner = await register('p5');
    await request(app.getHttpServer())
      .post('/api/v1/onboarding/goals')
      .set('Authorization', `Bearer ${learner.token}`)
      .send({
        targetLevelId: pathLevelId,
        dailyMinutes: 15,
        reminderEnabled: false,
        reminderTime: null,
        startDate: '2026-10-07',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/learning-plans')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(201);
    await completePreviousReadyLesson(prisma, learner.userId, lesson2Id);
    // No lesson is `learning` yet, so nextLesson comes from the goal level.
    const fromGoal = await getPath(learner.token).expect(200);
    expect(fromGoal.body.data.nextLesson).toMatchObject({
      lessonId: lesson2Id,
      levelCode: 'HSK2',
      position: 2,
    });
    await start(learner.token, lesson2Id, 'p5-start-l2').expect(201);

    const counts = () =>
      Promise.all([
        prisma.progress.count({ where: { userId: learner.userId } }),
        prisma.learningEvent.count({ where: { userId: learner.userId } }),
      ]);
    const before = await counts();
    const response = await getPath(learner.token).expect(200);
    const after = await counts();
    expect(after).toEqual(before);

    const data = response.body.data;
    expect(data.goal.targetLevelCode).toBe('HSK2');
    expect(data.nextStep).toBe('ready');
    const level = pathLevel(data);
    expect(level?.completedCount).toBe(1);
    expect(
      level?.lessons.map((lesson) => [
        lesson.id,
        lesson.state,
        lesson.completionPercent,
      ]),
    ).toEqual([
      [lesson1Id, 'done', 100],
      [lesson2Id, 'current', 0],
      [lesson3Id, 'locked', 0],
    ]);
    expect(data.nextLesson.lessonId).toBe(lesson2Id);
  });

  type PathBody = {
    levels: Array<{
      id: number;
      completedCount: number;
      lessons: Array<{ id: number; state: string; completionPercent: number }>;
    }>;
  };

  function pathLevel(body: PathBody) {
    return body.levels.find((level) => level.id === pathLevelId);
  }

  function lessonView(
    id: number,
    title: string,
    slug: string,
    position: number,
    state: string,
  ) {
    return {
      id,
      title,
      slug: `path-${slug}-${suffix}`,
      position,
      state,
      completionPercent: 0,
    };
  }

  async function publishLevel(code: 'HSK2' | 'HSK3', band: number) {
    const prior = await prisma.level.findUnique({
      where: { code },
      select: { id: true, status: true, publishedAt: true, deletedAt: true },
    });
    const level = await prisma.level.upsert({
      where: { code },
      update: { status: 'published', publishedAt: new Date(), deletedAt: null },
      create: {
        code,
        name: code,
        orderIndex: band,
        minBand: band,
        maxBand: band,
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true, name: true },
    });
    priorLevels.set(
      level.id,
      prior
        ? {
            status: prior.status,
            publishedAt: prior.publishedAt,
            deletedAt: prior.deletedAt,
          }
        : null,
    );
    return level.id;
  }

  async function createLesson(
    orderIndex: number,
    slug: string,
    content: 'story' | 'archived',
    status: 'published' | 'draft' | 'archived' = 'published',
  ) {
    const title = `Path lesson ${slug}`;
    const lesson = await prisma.lesson.create({
      data: {
        levelId: pathLevelId,
        title,
        orderIndex,
        slug: `path-${slug}-${suffix}`,
        status,
        publishedAt: new Date(),
        ...(content === 'story'
          ? {
              stories: {
                create: {
                  levelId: pathLevelId,
                  title: `${title} story`,
                  slug: `path-${slug}-story-${suffix}`,
                  content: {},
                  status: 'published',
                },
              },
            }
          : {
              topics: {
                create: {
                  title: `${title} topic`,
                  content: [{ type: 'text', value: 'Withdrawn.' }],
                  orderIndex: 1,
                  status: 'archived',
                },
              },
            }),
      },
      select: { id: true },
    });
    createdLessonIds.push(lesson.id);
    return lesson.id;
  }

  function post(token: string, path: string, key: string, body: object = {}) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);
  }

  function start(token: string, lessonId: number, key: string) {
    return post(token, `/learning/lessons/${lessonId}/start`, key);
  }

  function complete(token: string, lessonId: number, key: string) {
    return post(token, `/learning/lessons/${lessonId}/complete`, key);
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
        email: `path-${label}-${suffix}@example.com`,
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
