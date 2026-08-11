/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

describe('Lesson Activity Attempt & Progress V1 E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let levelId: number;
  let lessonId: number;
  let topicId: number;
  let emptyTopicId: number;
  let mcqId: number;
  let fillId: number;
  let arrangeId: number;
  let draftExerciseId: number;
  let deletedExerciseId: number;
  let draftLessonId: number;
  let deletedLessonId: number;
  let draftTopicExerciseId: number;
  let contentOnlyLessonId: number;
  let speakingLessonId: number;
  let speakingId: number;
  let archiveLessonId: number;
  let archivedPointerExerciseId: number;
  let nextPointerExerciseId: number;
  let deletedTopicExerciseId: number;
  let userId: number;
  let userToken: string;
  let secondUserId: number;
  let secondUserToken: string;
  let planItemId: number;
  let firstAttemptId: number;

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
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const level = await prisma.level.upsert({
      where: { code: 'HSK7_9' },
      update: {
        name: 'HSK 7-9',
        orderIndex: 7,
        minBand: 7,
        maxBand: 9,
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
    });
    levelId = level.id;

    const lesson = await prisma.lesson.create({
      data: {
        levelId,
        title: 'Activity main lesson',
        orderIndex: 101,
        slug: `activity-main-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
      },
    });
    lessonId = lesson.id;
    const topic = await prisma.topic.create({
      data: {
        lessonId,
        title: 'Activity topic',
        content: [{ type: 'text', value: 'Learn safely.' }],
        orderIndex: 1,
        status: 'published',
        publishedAt: new Date(),
      },
    });
    topicId = topic.id;
    emptyTopicId = (
      await prisma.topic.create({
        data: {
          lessonId,
          title: 'Explicit empty topic',
          content: [{ type: 'text', value: 'Read this block.' }],
          orderIndex: 2,
          status: 'published',
          publishedAt: new Date(),
        },
      })
    ).id;
    mcqId = (
      await prisma.lessonExercise.create({
        data: {
          lessonId,
          topicId,
          type: 'mcq',
          prompt: 'Choose the greeting',
          content: {
            options: [
              { id: 'hello', text: '你好' },
              { id: 'bye', text: '再见' },
            ],
          },
          answer: { optionId: 'hello' },
          explanation: '你好 is a greeting.',
          orderIndex: 1,
          status: 'published',
        },
      })
    ).id;
    fillId = (
      await prisma.lessonExercise.create({
        data: {
          lessonId,
          topicId,
          type: 'fill_blank',
          prompt: 'Type ABC 你好',
          content: {},
          answer: { acceptedTexts: ['ＡBC  你好'] },
          orderIndex: 2,
          status: 'published',
        },
      })
    ).id;
    arrangeId = (
      await prisma.lessonExercise.create({
        data: {
          lessonId,
          type: 'arrange_sentence',
          prompt: 'Arrange the sentence',
          content: {
            tokens: [
              { id: 't1', text: '我' },
              { id: 't2', text: '学习' },
              { id: 't3', text: '中文' },
            ],
          },
          answer: { tokenIds: ['t1', 't2', 't3'] },
          orderIndex: 3,
          status: 'published',
        },
      })
    ).id;
    draftExerciseId = (
      await prisma.lessonExercise.create({
        data: {
          lessonId,
          type: 'mcq',
          prompt: 'Hidden draft',
          content: {
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
          },
          answer: { optionId: 'a' },
          orderIndex: 99,
          status: 'draft',
        },
      })
    ).id;
    deletedExerciseId = (
      await prisma.lessonExercise.create({
        data: {
          lessonId,
          type: 'mcq',
          prompt: 'Hidden soft-deleted exercise',
          content: {
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
          },
          answer: { optionId: 'a' },
          orderIndex: 100,
          status: 'published',
          deletedAt: new Date(),
        },
      })
    ).id;

    draftLessonId = (
      await prisma.lesson.create({
        data: {
          levelId,
          title: 'Draft activity lesson',
          orderIndex: 102,
          slug: `activity-draft-${suffix}`,
          status: 'draft',
          topics: {
            create: {
              title: 'Draft parent topic',
              content: {},
              orderIndex: 1,
              status: 'published',
            },
          },
        },
      })
    ).id;

    deletedLessonId = (
      await prisma.lesson.create({
        data: {
          levelId,
          title: 'Deleted activity lesson',
          orderIndex: 106,
          slug: `activity-deleted-lesson-${suffix}`,
          status: 'published',
          publishedAt: new Date(),
          deletedAt: new Date(),
          topics: {
            create: {
              title: 'Public child of deleted lesson',
              content: {},
              orderIndex: 1,
              status: 'published',
            },
          },
        },
      })
    ).id;

    const draftTopicLesson = await prisma.lesson.create({
      data: {
        levelId,
        title: 'Draft topic parent lesson',
        orderIndex: 107,
        slug: `activity-draft-topic-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
        stories: {
          create: {
            levelId,
            title: 'Draft topic lesson remains ready',
            slug: `activity-draft-topic-story-${suffix}`,
            content: {},
            status: 'published',
          },
        },
      },
    });
    const draftTopic = await prisma.topic.create({
      data: {
        lessonId: draftTopicLesson.id,
        title: 'Draft topic',
        content: {},
        orderIndex: 1,
        status: 'draft',
      },
    });
    draftTopicExerciseId = (
      await prisma.lessonExercise.create({
        data: {
          lessonId: draftTopicLesson.id,
          topicId: draftTopic.id,
          type: 'mcq',
          prompt: 'Hidden by draft topic',
          content: {
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
          },
          answer: { optionId: 'a' },
          orderIndex: 1,
          status: 'published',
        },
      })
    ).id;

    contentOnlyLessonId = (
      await prisma.lesson.create({
        data: {
          levelId,
          title: 'Content-only lesson',
          orderIndex: 108,
          slug: `activity-content-only-${suffix}`,
          status: 'published',
          publishedAt: new Date(),
          stories: {
            create: {
              levelId,
              title: 'Content-only story',
              slug: `activity-content-only-story-${suffix}`,
              content: {},
              status: 'published',
            },
          },
        },
      })
    ).id;

    const speakingLesson = await prisma.lesson.create({
      data: {
        levelId,
        title: 'Speaking unsupported lesson',
        orderIndex: 103,
        slug: `activity-speaking-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
        stories: {
          create: {
            levelId,
            title: 'Speaking instructions',
            slug: `activity-speaking-story-${suffix}`,
            content: {},
            status: 'published',
          },
        },
      },
    });
    speakingLessonId = speakingLesson.id;
    speakingId = (
      await prisma.lessonExercise.create({
        data: {
          lessonId: speakingLessonId,
          type: 'speaking_repeat',
          prompt: 'Repeat 你好',
          content: {},
          answer: {},
          orderIndex: 1,
          status: 'published',
        },
      })
    ).id;

    const archiveLesson = await prisma.lesson.create({
      data: {
        levelId,
        title: 'Archive pointer lesson',
        orderIndex: 104,
        slug: `activity-archive-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
        stories: {
          create: {
            levelId,
            title: 'Archive instructions',
            slug: `activity-archive-story-${suffix}`,
            content: {},
            status: 'published',
          },
        },
      },
    });
    archiveLessonId = archiveLesson.id;
    const archiveExercises = await Promise.all(
      [1, 2].map((orderIndex) =>
        prisma.lessonExercise.create({
          data: {
            lessonId: archiveLessonId,
            type: 'mcq',
            prompt: `Archive exercise ${orderIndex}`,
            content: {
              options: [
                { id: 'a', text: 'A' },
                { id: 'b', text: 'B' },
              ],
            },
            answer: { optionId: 'a' },
            orderIndex,
            status: 'published',
          },
        }),
      ),
    );
    archivedPointerExerciseId = archiveExercises[0].id;
    nextPointerExerciseId = archiveExercises[1].id;

    const deletedTopicLesson = await prisma.lesson.create({
      data: {
        levelId,
        title: 'Deleted topic lesson',
        orderIndex: 105,
        slug: `activity-deleted-topic-${suffix}`,
        status: 'published',
        publishedAt: new Date(),
        stories: {
          create: {
            levelId,
            title: 'Still ready',
            slug: `activity-deleted-topic-story-${suffix}`,
            content: {},
            status: 'published',
          },
        },
      },
    });
    const deletedTopic = await prisma.topic.create({
      data: {
        lessonId: deletedTopicLesson.id,
        title: 'Deleted topic',
        content: {},
        orderIndex: 1,
        status: 'published',
        deletedAt: new Date(),
      },
    });
    deletedTopicExerciseId = (
      await prisma.lessonExercise.create({
        data: {
          lessonId: deletedTopicLesson.id,
          topicId: deletedTopic.id,
          type: 'mcq',
          prompt: 'Hidden by parent topic',
          content: {
            options: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
          },
          answer: { optionId: 'a' },
          orderIndex: 1,
          status: 'published',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. rejects unauthenticated access and unsafe path ids', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}/activity`)
      .expect(401);
    const registration = await register('activity-user-a');
    userId = registration.userId;
    userToken = registration.token;
    await request(app.getHttpServer())
      .get('/api/v1/progress/lessons/0')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(400);
  });

  it('2. rejects stale JWTs for suspended and anonymized accounts', async () => {
    const suspended = await register('activity-suspended');
    await prisma.user.update({
      where: { id: suspended.userId },
      data: { status: 'suspended' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/progress/lessons')
      .set('Authorization', `Bearer ${suspended.token}`)
      .expect(401);

    const anonymized = await register('activity-anonymized');
    await prisma.user.update({
      where: { id: anonymized.userId },
      data: { status: 'anonymized', deletedAt: new Date() },
    });
    await request(app.getHttpServer())
      .get('/api/v1/progress/lessons')
      .set('Authorization', `Bearer ${anonymized.token}`)
      .expect(401);
  });

  it('3. enforces ready/public parents and requires a safe idempotency key', async () => {
    await post(`/learning/lessons/${draftLessonId}/start`, 'draft-lesson-01')
      .send({})
      .expect(404);
    await post(
      `/learning/lessons/${deletedLessonId}/start`,
      'deleted-lesson-01',
    )
      .send({})
      .expect(404);
    await post(`/learning/lessons/${lessonId}/start`, 'bad key')
      .send({})
      .expect(400);
    await post(`/learning/lessons/${lessonId}/start`).send({}).expect(400);
  });

  it('4. starts a lesson idempotently and creates one immutable event', async () => {
    const first = await post(
      `/learning/lessons/${lessonId}/start`,
      'lesson-start-001',
    )
      .send({})
      .expect(201);
    const retry = await post(
      `/learning/lessons/${lessonId}/start`,
      'lesson-start-001',
    )
      .send({})
      .expect(201);
    expect(retry.body).toEqual(first.body);
    await expect(
      prisma.learningEvent.count({
        where: { userId, type: 'lesson_started', lessonId },
      }),
    ).resolves.toBe(1);
    await post(`/learning/lessons/${lessonId}/start`, 'lesson-start-002')
      .send({})
      .expect(409);
  });

  it('5. starts a topic idempotently and rejects server-controlled fields', async () => {
    const first = await post(
      `/learning/topics/${topicId}/start`,
      'topic-start-001',
    )
      .send({})
      .expect(201);
    const retry = await post(
      `/learning/topics/${topicId}/start`,
      'topic-start-001',
    )
      .send({})
      .expect(201);
    expect(retry.body).toEqual(first.body);
    await post(`/learning/topics/${topicId}/start`, 'topic-start-spoof')
      .send({ userId, completionPercent: 100 })
      .expect(400);
    await post(`/learning/exercises/${mcqId}/attempts`, 'attempt-spoof-001')
      .send({ answer: { optionId: 'hello' }, userId, score: 100 })
      .expect(400);
  });

  it('6. rejects premature completion and hidden exercises without side effects', async () => {
    await post(`/learning/topics/${topicId}/complete`, 'topic-complete-early')
      .send({})
      .expect(409);
    await post(
      `/learning/exercises/${draftExerciseId}/attempts`,
      'draft-exercise-01',
    )
      .send({ answer: { optionId: 'a' } })
      .expect(404);
    await post(
      `/learning/exercises/${deletedExerciseId}/attempts`,
      'deleted-exercise-01',
    )
      .send({ answer: { optionId: 'a' } })
      .expect(404);
    await post(
      `/learning/exercises/${draftTopicExerciseId}/attempts`,
      'draft-topic-exercise-01',
    )
      .send({ answer: { optionId: 'a' } })
      .expect(404);
    await post(
      `/learning/exercises/${deletedTopicExerciseId}/attempts`,
      'deleted-topic-exercise-01',
    )
      .send({ answer: { optionId: 'a' } })
      .expect(404);
  });

  it('7. server-scores, snapshots and retries the same MCQ attempt exactly once', async () => {
    const first = await post(
      `/learning/exercises/${mcqId}/attempts`,
      'shared-attempt-key-01',
    )
      .send({ answer: { optionId: 'hello' }, durationSeconds: 10 })
      .expect(201);
    const retry = await post(
      `/learning/exercises/${mcqId}/attempts`,
      'shared-attempt-key-01',
    )
      .send({ durationSeconds: 10, answer: { optionId: 'hello' } })
      .expect(201);
    expect(retry.body).toEqual(first.body);
    expect(first.body.data).toMatchObject({
      attemptNumber: 1,
      isCorrect: true,
      score: 100,
      feedbackVersion: 'lesson-activity-v1',
    });
    expect(hasForbiddenResponseKey(first.body)).toBe(false);
    firstAttemptId = first.body.data.attemptId as number;
    await expect(
      prisma.lessonExerciseAttempt.count({
        where: { userId, exerciseId: mcqId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.learningEvent.count({
        where: { userId, type: 'exercise_submitted', exerciseId: mcqId },
      }),
    ).resolves.toBe(1);
    await post(`/learning/exercises/${mcqId}/attempts`, 'shared-attempt-key-01')
      .send({ answer: { optionId: 'bye' }, durationSeconds: 10 })
      .expect(409);
  });

  it('8. namespaces idempotency by user and isolates attempt history', async () => {
    const second = await register('activity-user-b');
    secondUserId = second.userId;
    secondUserToken = second.token;
    await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${lessonId}/start`)
      .set('Authorization', `Bearer ${secondUserToken}`)
      .set('Idempotency-Key', 'second-start-001')
      .send({})
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/learning/exercises/${mcqId}/attempts`)
      .set('Authorization', `Bearer ${secondUserToken}`)
      .set('Idempotency-Key', 'shared-attempt-key-01')
      .send({ answer: { optionId: 'bye' }, durationSeconds: 2 })
      .expect(201)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          attemptNumber: 1,
          score: 0,
        });
      });
    const ownerHistory = await get(
      `/learning/exercises/${mcqId}/attempts`,
    ).expect(200);
    expect(ownerHistory.body.data).toHaveLength(1);
    expect(ownerHistory.body.data[0].attemptId).toBe(firstAttemptId);
    const otherHistory = await request(app.getHttpServer())
      .get(`/api/v1/learning/exercises/${mcqId}/attempts`)
      .set('Authorization', `Bearer ${secondUserToken}`)
      .expect(200);
    expect(otherHistory.body.data).toHaveLength(1);
    expect(otherHistory.body.data[0].attemptId).not.toBe(firstAttemptId);
  });

  it('9. preserves old snapshot across authoring edits and scores the new version', async () => {
    await prisma.lessonExercise.update({
      where: { id: mcqId },
      data: {
        answer: { optionId: 'bye' },
        explanation: 'The authored answer changed in version 2.',
        version: { increment: 1 },
      },
    });
    const oldRetry = await post(
      `/learning/exercises/${mcqId}/attempts`,
      'shared-attempt-key-01',
    )
      .send({ answer: { optionId: 'hello' }, durationSeconds: 10 })
      .expect(201);
    expect(oldRetry.body.data).toMatchObject({
      attemptId: firstAttemptId,
      exerciseVersion: 1,
      score: 100,
      explanation: '你好 is a greeting.',
    });
    const next = await post(
      `/learning/exercises/${mcqId}/attempts`,
      'attempt-after-edit-01',
    )
      .send({ answer: { optionId: 'bye' }, durationSeconds: 4 })
      .expect(201);
    expect(next.body.data).toMatchObject({
      attemptNumber: 2,
      exerciseVersion: 2,
      score: 100,
    });
    const history = await get(`/learning/exercises/${mcqId}/attempts`).expect(
      200,
    );
    expect(history.body.data[0]).toMatchObject({
      exerciseVersion: 1,
      explanation: '你好 is a greeting.',
    });
  });

  it('10. normalizes fill blank, scores incorrect input and derives topic percent', async () => {
    const response = await post(
      `/learning/exercises/${fillId}/attempts`,
      'fill-attempt-0001',
    )
      .send({ answer: { text: 'wrong' }, durationSeconds: 5 })
      .expect(201);
    expect(response.body.data).toMatchObject({ isCorrect: false, score: 0 });
    const activity = await get(`/learning/lessons/${lessonId}/activity`).expect(
      200,
    );
    expect(activity.body.data.topics[0].progress).toMatchObject({
      status: 'learning',
      completionPercent: 100,
      timeSpentSeconds: 19,
    });
    expect(activity.body.data.nextAction).toBe('complete_topic');
    expect(hasForbiddenResponseKey(activity.body)).toBe(false);
  });

  it('11. completes topics by precondition, including an explicitly started empty topic', async () => {
    await post(`/learning/topics/${topicId}/complete`, 'topic-complete-001')
      .send({})
      .expect(201);
    await post(
      `/learning/topics/${emptyTopicId}/complete`,
      'empty-topic-too-early',
    )
      .send({})
      .expect(409);
    await post(`/learning/topics/${emptyTopicId}/start`, 'empty-topic-start-01')
      .send({})
      .expect(201);
    await post(
      `/learning/topics/${emptyTopicId}/complete`,
      'empty-topic-done-001',
    )
      .send({})
      .expect(201);
  });

  it('12. scores standalone arrangement and derives lesson percent/score/time', async () => {
    await post(
      `/learning/exercises/${arrangeId}/attempts`,
      'arrange-attempt-01',
    )
      .send({
        answer: { tokenIds: ['t1', 't2', 't3'] },
        durationSeconds: 6,
      })
      .expect(201);
    const progress = await get(`/progress/lessons/${lessonId}`).expect(200);
    expect(progress.body.data).toMatchObject({
      status: 'learning',
      completionPercent: 100,
      score: 67,
      timeSpentSeconds: 25,
    });
  });

  it('13. completes the lesson and its active LearningPlanItem idempotently', async () => {
    const plan = await prisma.learningPlan.create({
      data: {
        userId,
        targetLevelId: levelId,
        targetBand: 7,
        status: 'active',
        startDate: new Date('2026-08-11T00:00:00Z'),
        items: {
          create: { lessonId, orderIndex: 1, status: 'in_progress' },
        },
      },
      select: { items: { select: { id: true } } },
    });
    planItemId = plan.items[0].id;
    const first = await post(
      `/learning/lessons/${lessonId}/complete`,
      'lesson-complete-01',
    )
      .send({})
      .expect(201);
    const retry = await post(
      `/learning/lessons/${lessonId}/complete`,
      'lesson-complete-01',
    )
      .send({})
      .expect(201);
    expect(retry.body).toEqual(first.body);
    await expect(
      prisma.learningPlanItem.findUnique({ where: { id: planItemId } }),
    ).resolves.toMatchObject({ status: 'completed' });
    await expect(
      prisma.learningEvent.count({
        where: { userId, type: 'lesson_completed', lessonId },
      }),
    ).resolves.toBe(1);
  });

  it('14. lists only owner progress and keeps completed lessons non-regressing', async () => {
    await prisma.lessonExercise.create({
      data: {
        lessonId,
        type: 'mcq',
        prompt: 'New content after completion',
        content: {
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
        answer: { optionId: 'a' },
        orderIndex: 100,
        status: 'published',
      },
    });
    const activity = await get(`/learning/lessons/${lessonId}/activity`).expect(
      200,
    );
    expect(activity.body.data).toMatchObject({
      progress: { status: 'done', completionPercent: 100 },
      nextAction: 'completed',
    });
    const list = await get('/progress/lessons').expect(200);
    expect(list.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lessonId, status: 'done' }),
      ]),
    );
    const secondList = await request(app.getHttpServer())
      .get('/api/v1/progress/lessons')
      .set('Authorization', `Bearer ${secondUserToken}`)
      .expect(200);
    expect(secondList.body.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ lessonId, status: 'done' }),
      ]),
    );
  });

  it('15. skips an archived current exercise without rewriting stored progress', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${archiveLessonId}/start`)
      .set('Authorization', `Bearer ${secondUserToken}`)
      .set('Idempotency-Key', 'archive-start-001')
      .send({})
      .expect(201);
    await prisma.lessonExercise.update({
      where: { id: archivedPointerExerciseId },
      data: { status: 'archived' },
    });
    const before = await prisma.progress.findUnique({
      where: {
        userId_lessonId: { userId: secondUserId, lessonId: archiveLessonId },
      },
      select: { currentExerciseId: true },
    });
    expect(before?.currentExerciseId).toBe(archivedPointerExerciseId);
    const activity = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${archiveLessonId}/activity`)
      .set('Authorization', `Bearer ${secondUserToken}`)
      .expect(200);
    expect(activity.body.data.currentExercise.id).toBe(nextPointerExerciseId);
    expect(
      activity.body.data.standaloneExercises.map(
        (exercise: { id: number }) => exercise.id,
      ),
    ).not.toContain(archivedPointerExerciseId);
    const after = await prisma.progress.findUnique({
      where: {
        userId_lessonId: { userId: secondUserId, lessonId: archiveLessonId },
      },
      select: { currentExerciseId: true },
    });
    expect(after).toEqual(before);
  });

  it('16. rejects speaking_repeat without creating fake facts', async () => {
    await post(
      `/learning/lessons/${speakingLessonId}/start`,
      'speaking-start-01',
    )
      .send({})
      .expect(201);
    await post(
      `/learning/exercises/${speakingId}/attempts`,
      'speaking-attempt-1',
    )
      .send({ answer: { audioId: 'not-trusted' }, durationSeconds: 3 })
      .expect(422);
    await expect(
      prisma.lessonExerciseAttempt.count({
        where: { userId, exerciseId: speakingId },
      }),
    ).resolves.toBe(0);
  });

  it('17. explicitly completes a started content-only lesson', async () => {
    await post(
      `/learning/lessons/${contentOnlyLessonId}/complete`,
      'content-only-early',
    )
      .send({})
      .expect(409);
    await post(
      `/learning/lessons/${contentOnlyLessonId}/start`,
      'content-only-start',
    )
      .send({})
      .expect(201);
    await post(
      `/learning/lessons/${contentOnlyLessonId}/complete`,
      'content-only-done1',
    )
      .send({})
      .expect(201);
    await get(`/progress/lessons/${contentOnlyLessonId}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.data).toMatchObject({
          status: 'done',
          completionPercent: 100,
        });
      });
  });

  it('18. retains archived attempt history and enforces immutable facts', async () => {
    await prisma.lessonExercise.update({
      where: { id: mcqId },
      data: { status: 'archived' },
    });
    const history = await get(`/learning/exercises/${mcqId}/attempts`).expect(
      200,
    );
    expect(history.body.data).toHaveLength(2);
    await post(`/learning/exercises/${mcqId}/attempts`, 'archived-new-attempt')
      .send({ answer: { optionId: 'bye' } })
      .expect(404);
    await expect(
      prisma.lessonExerciseAttempt.update({
        where: { id: firstAttemptId },
        data: { score: 0 },
      }),
    ).rejects.toBeDefined();
    const event = await prisma.learningEvent.findFirstOrThrow({
      where: { userId, attemptId: firstAttemptId },
      select: { id: true, metadata: true },
    });
    expect(JSON.stringify(event.metadata)).not.toContain('optionId');
    await expect(
      prisma.learningEvent.update({
        where: { id: event.id },
        data: { metadata: { score: 0 } },
      }),
    ).rejects.toBeDefined();
  });

  function post(path: string, key?: string) {
    const builder = request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${userToken}`);
    return key ? builder.set('Idempotency-Key', key) : builder;
  }

  function get(path: string) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${userToken}`);
  }

  async function register(label: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `${label}-${suffix}@example.com`,
        password,
        name: label,
      })
      .expect(201);
    return {
      token: response.body.accessToken as string,
      userId: response.body.user.id as number,
    };
  }
});

function hasForbiddenResponseKey(value: unknown): boolean {
  const forbidden = new Set([
    'answer',
    'authoritativeAnswer',
    'contentSnapshot',
    'detailJson',
    'userId',
  ]);
  if (Array.isArray(value)) return value.some(hasForbiddenResponseKey);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) => forbidden.has(key) || hasForbiddenResponseKey(child),
  );
}
