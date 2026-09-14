/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { upsertSeedLearningTopic } from '../scripts/learning/seed-learning-topic';
import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { CreateExerciseDto } from '../src/modules/cms/dto/create-exercise.dto';
import { ExerciseAuthoringService } from '../src/modules/cms/exercise-authoring.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type ExerciseMutationBody = {
  success: true;
  data: {
    idempotent: boolean;
    exercise: {
      id: number;
      lessonId: number;
      topicId: number | null;
      type: string;
      prompt: string;
      version: number;
      status: string;
    };
    revision: { id: number; revision: number };
  };
};

describe('Exercise Authoring & Media Lifecycle V1 E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let levelId: number;
  let lessonId: number;
  let topicId: number;
  let adminToken: string;
  let normalToken: string;
  let learnerToken: string;
  let exerciseId: number;
  let revision1Id: number;
  let revision2Id: number;
  let listeningExerciseId: number;
  let listeningRevisionId: number;
  let speakingExerciseId: number;
  let speakingRevisionId: number;
  let readyAudioId: number;

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const password = 'StrongPassword123!';

  const choicePayload = (overrides: Record<string, unknown> = {}) => ({
    type: 'mcq',
    prompt: 'Choose the canonical greeting',
    content: {
      options: [
        { id: 'hello', text: '你好' },
        { id: 'bye', text: '再见' },
      ],
    },
    answer: { optionId: 'hello' },
    explanation: '你好 is the greeting.',
    orderIndex: 1,
    ...overrides,
  });

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
    prisma = app.get(PrismaService);

    const level = await prisma.level.upsert({
      where: { code: 'HSK1' },
      update: {},
      create: {
        code: 'HSK1',
        name: 'HSK1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
      },
    });
    levelId = level.id;
    const lesson = await prisma.lesson.create({
      data: {
        levelId,
        title: 'Exercise authoring lesson',
        slug: `exercise-authoring-${suffix}`,
        orderIndex: 700_000 + Math.floor(Math.random() * 100_000),
        status: 'published',
        publishedAt: new Date(),
      },
    });
    lessonId = lesson.id;
    topicId = (
      await prisma.topic.create({
        data: {
          lessonId,
          title: 'Exercise authoring topic',
          content: [{ type: 'text', value: 'Authoring fixture.' }],
          orderIndex: 1,
          status: 'published',
          publishedAt: new Date(),
        },
      })
    ).id;

    const normal = await register('normal');
    normalToken = normal.token;
    const admin = await register('admin');
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: 'admin' },
    });
    adminToken = await login(`exercise-admin-${suffix}@example.com`);
    const learner = await register('learner');
    learnerToken = learner.token;

    readyAudioId = (
      await prisma.media.create({
        data: {
          url: `https://cdn.example.test/exercise/${suffix}/ready.mp3`,
          type: 'audio',
          mimeType: 'audio/mpeg',
          duration: 12,
          storageProvider: 'private-test-provider',
          storageKey: `private/${suffix}/ready.mp3`,
          originalFilename: 'internal-source-name.mp3',
          checksum: `internal-checksum-${suffix}`,
          metadata: { internalTranscodeJob: `job-${suffix}` },
          processingStatus: 'ready',
        },
      })
    ).id;
  });

  afterAll(async () => {
    if (lessonId) {
      const now = new Date();
      await prisma.lessonExercise.updateMany({
        where: { lessonId },
        data: { status: 'archived', deletedAt: now },
      });
      await prisma.topic.updateMany({
        where: { lessonId },
        data: { status: 'archived', deletedAt: now },
      });
      await prisma.lesson.update({
        where: { id: lessonId },
        data: { status: 'archived', deletedAt: now },
      });
    }
    await app.close();
  });

  it('1. enforces authentication, admin RBAC and active-account state', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/exercises')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/exercises')
      .set('Authorization', `Bearer ${normalToken}`)
      .expect(403);

    const staleAdmin = await register('stale-admin');
    await prisma.user.update({
      where: { id: staleAdmin.userId },
      data: { role: 'admin' },
    });
    const staleToken = await login(
      `exercise-stale-admin-${suffix}@example.com`,
    );
    await prisma.user.update({
      where: { id: staleAdmin.userId },
      data: { status: 'suspended' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/exercises')
      .set('Authorization', `Bearer ${staleToken}`)
      .expect(401);
    await prisma.user.update({
      where: { id: staleAdmin.userId },
      data: { status: 'anonymized', deletedAt: new Date() },
    });
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/exercises')
      .set('Authorization', `Bearer ${staleToken}`)
      .expect(401);

    const secretKey = 'AUTHORITATIVEANSWERSECRET';
    const invalid = await adminPost('/admin/cms/exercises')
      .send({ lessonId, topicId, ...choicePayload(), [secretKey]: true })
      .expect(400);
    expect(invalid.body).toMatchObject({
      error: {
        code: 'REQUEST_VALIDATION_FAILED',
        details: {
          errors: expect.arrayContaining([
            expect.objectContaining({ path: '$.$unknown' }),
          ]),
        },
      },
    });
    expect(JSON.stringify(invalid.body)).not.toContain(secretKey);

    const downgraded = await register('downgraded-admin');
    await prisma.user.update({
      where: { id: downgraded.userId },
      data: { role: 'admin' },
    });
    const staleActor = { id: downgraded.userId, role: 'admin' };
    await prisma.user.update({
      where: { id: downgraded.userId },
      data: { role: 'user' },
    });
    const authoringService = app.get(ExerciseAuthoringService);
    const exerciseCount = await prisma.lessonExercise.count({
      where: { lessonId },
    });
    await expect(
      authoringService.createExercise(
        staleActor,
        {
          lessonId,
          topicId,
          ...choicePayload({ prompt: 'Must not survive role downgrade' }),
        } as CreateExerciseDto,
        { correlationId: `role-downgrade-${suffix}` },
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      prisma.lessonExercise.count({ where: { lessonId } }),
    ).resolves.toBe(exerciseCount);
  });

  it('2. creates a canonical draft and keeps it out of public learning', async () => {
    const response = await adminPost('/admin/cms/exercises')
      .send({ lessonId, topicId, ...choicePayload() })
      .expect(201);
    const body = response.body as ExerciseMutationBody;
    exerciseId = body.data.exercise.id;
    revision1Id = body.data.revision.id;
    expect(body.data).toMatchObject({
      idempotent: false,
      exercise: {
        lessonId,
        topicId,
        type: 'mcq',
        status: 'draft',
        version: 1,
      },
      revision: { revision: 1 },
    });

    const reseededTopic = await upsertSeedLearningTopic(prisma, {
      lessonId,
      title: 'Exercise authoring topic',
      orderIndex: 1,
      content: [{ type: 'text', value: 'Idempotent reseed.' }],
    });
    expect(reseededTopic.id).toBe(topicId);
    await expect(
      prisma.lessonExercise.findUniqueOrThrow({
        where: { id: exerciseId },
        select: { topicId: true },
      }),
    ).resolves.toEqual({ topicId });

    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(200);
    expect(publicDetail.body.data.exercises).toEqual([]);
  });

  it('3. lists and filters Exercise drafts and returns revision history', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/cms/exercises')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({
        lessonId,
        topicId,
        type: 'mcq',
        status: 'draft',
        page: 1,
        limit: 10,
      })
      .expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id: exerciseId,
        lessonId,
        topicId,
        type: 'mcq',
        status: 'draft',
        lesson: {
          id: lessonId,
          title: 'Exercise authoring lesson',
          slug: expect.stringMatching(/^exercise-authoring-/),
        },
        topic: {
          id: topicId,
          title: 'Exercise authoring topic',
        },
        dataSource: null,
        latestRevision: expect.objectContaining({ id: revision1Id }),
      }),
    ]);
    expect(list.body.meta.pagination).toMatchObject({
      page: 1,
      limit: 10,
      total: 1,
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/cms/exercises/${exerciseId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      id: exerciseId,
      answer: { optionId: 'hello' },
      lesson: { id: lessonId, title: 'Exercise authoring lesson' },
      topic: { id: topicId, title: 'Exercise authoring topic' },
      dataSource: null,
      revisions: [expect.objectContaining({ id: revision1Id, revision: 1 })],
    });
  });

  it('4. publishes only an approved latest revision and exposes no answer', async () => {
    await adminPost(
      `/admin/cms/exercises/${exerciseId}/revisions/${revision1Id}/publish`,
    ).expect(409);
    await review(exerciseId, revision1Id, 'approved');
    const published = await publish(exerciseId, revision1Id);
    expect(published.data).toMatchObject({
      idempotent: false,
      exercise: { id: exerciseId, status: 'published', version: 1 },
    });
    const retry = await publish(exerciseId, revision1Id);
    expect(retry.data.idempotent).toBe(true);

    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(200);
    const publicExercise = publicDetail.body.data.exercises.find(
      (exercise: { id: number }) => exercise.id === exerciseId,
    );
    expect(publicExercise).toMatchObject({
      id: exerciseId,
      type: 'mcq',
      version: 1,
    });
    expect(hasForbiddenPublicKey(publicExercise)).toBe(false);
  });

  it('5. creates and publishes V2 without changing an already submitted V1 attempt', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/learning/lessons/${lessonId}/start`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .set('Idempotency-Key', 'authoring-start-lesson-01')
      .send({})
      .expect(201);
    const attemptV1 = await request(app.getHttpServer())
      .post(`/api/v1/learning/exercises/${exerciseId}/attempts`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .set('Idempotency-Key', 'authoring-v1-attempt-01')
      .send({ answer: { optionId: 'hello' }, durationSeconds: 3 })
      .expect(201);
    expect(attemptV1.body.data).toMatchObject({
      exerciseVersion: 1,
      score: 100,
      explanation: '你好 is the greeting.',
    });

    const revision = await adminPost(
      `/admin/cms/exercises/${exerciseId}/revisions`,
    )
      .send(
        choicePayload({
          prompt: 'Choose the farewell',
          answer: { optionId: 'bye' },
          explanation: '再见 is the farewell.',
        }),
      )
      .expect(201);
    revision2Id = revision.body.data.revision.id as number;
    expect(revision.body.data.revision.revision).toBe(2);
    await review(exerciseId, revision2Id, 'approved');
    const publishedV2 = await publish(exerciseId, revision2Id);
    expect(publishedV2.data.exercise).toMatchObject({ version: 2 });

    const oldRetry = await request(app.getHttpServer())
      .post(`/api/v1/learning/exercises/${exerciseId}/attempts`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .set('Idempotency-Key', 'authoring-v1-attempt-01')
      .send({ answer: { optionId: 'hello' }, durationSeconds: 3 })
      .expect(201);
    expect(oldRetry.body.data).toEqual(attemptV1.body.data);

    const v2Attempt = await request(app.getHttpServer())
      .post(`/api/v1/learning/exercises/${exerciseId}/attempts`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .set('Idempotency-Key', 'authoring-v2-attempt-01')
      .send({ answer: { optionId: 'bye' }, durationSeconds: 4 })
      .expect(201);
    expect(v2Attempt.body.data).toMatchObject({
      exerciseVersion: 2,
      score: 100,
      explanation: '再见 is the farewell.',
    });
  });

  it('6. stores speaking_repeat as draft but rejects publish with a safe 422', async () => {
    const created = await adminPost('/admin/cms/exercises')
      .send({
        lessonId,
        topicId,
        type: 'speaking_repeat',
        prompt: 'Repeat 你好',
        content: { referenceText: '你好' },
        answer: {},
        explanation: null,
        orderIndex: 20,
      })
      .expect(201);
    speakingExerciseId = created.body.data.exercise.id as number;
    speakingRevisionId = created.body.data.revision.id as number;
    expect(created.body.data.exercise.status).toBe('draft');
    await review(speakingExerciseId, speakingRevisionId, 'approved');
    const rejected = await adminPost(
      `/admin/cms/exercises/${speakingExerciseId}/revisions/${speakingRevisionId}/publish`,
    ).expect(422);
    expect(rejected.body.error.message).toMatch(
      /speaking_repeat.*unsupported/i,
    );
    expect(JSON.stringify(rejected.body)).not.toContain('referenceText');
  });

  it('7. rejects non-ready listening media and publishes ready audio', async () => {
    const missingMedia = await adminPost('/admin/cms/exercises')
      .send({
        lessonId,
        topicId,
        type: 'listening_choice',
        prompt: 'Missing relational audio',
        content: {
          options: [
            { id: 'tone-a', text: 'mā' },
            { id: 'tone-b', text: 'má' },
          ],
        },
        answer: { optionId: 'tone-a' },
        explanation: null,
        mediaId: 2_147_483_647,
        orderIndex: 29,
      })
      .expect(409);
    expect(missingMedia.body.error.message).toBe(
      'LessonExercise violates a database integrity constraint.',
    );
    expect(JSON.stringify(missingMedia.body)).not.toContain('foreign key');

    const unusableMedia = await Promise.all([
      prisma.media.create({
        data: {
          url: `https://cdn.example.test/exercise/${suffix}/image.png`,
          type: 'image',
          processingStatus: 'ready',
        },
      }),
      prisma.media.create({
        data: {
          url: `https://cdn.example.test/exercise/${suffix}/pending.mp3`,
          type: 'audio',
          processingStatus: 'pending',
        },
      }),
      prisma.media.create({
        data: {
          url: `https://cdn.example.test/exercise/${suffix}/quarantine.mp3`,
          type: 'audio',
          processingStatus: 'quarantined',
        },
      }),
      prisma.media.create({
        data: {
          url: `https://cdn.example.test/exercise/${suffix}/deleted.mp3`,
          type: 'audio',
          processingStatus: 'ready',
          deletedAt: new Date(),
        },
      }),
    ]);

    for (const [index, media] of unusableMedia.entries()) {
      const created = await createListeningExercise(media.id, 30 + index);
      await review(
        created.data.exercise.id,
        created.data.revision.id,
        'approved',
      );
      const rejected = await adminPost(
        `/admin/cms/exercises/${created.data.exercise.id}/revisions/${created.data.revision.id}/publish`,
      ).expect(422);
      expect(rejected.body.error.message).toMatch(/audio media.*ready/i);
      expect(JSON.stringify(rejected.body)).not.toContain(media.url);
    }

    const ready = await createListeningExercise(readyAudioId, 40);
    listeningExerciseId = ready.data.exercise.id;
    listeningRevisionId = ready.data.revision.id;
    await review(listeningExerciseId, listeningRevisionId, 'approved');
    await publish(listeningExerciseId, listeningRevisionId);

    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(200);
    const listening = publicDetail.body.data.exercises.find(
      (exercise: { id: number }) => exercise.id === listeningExerciseId,
    );
    expect(listening).toMatchObject({
      id: listeningExerciseId,
      type: 'listening_choice',
      media: {
        id: readyAudioId,
        url: `https://cdn.example.test/exercise/${suffix}/ready.mp3`,
        mimeType: 'audio/mpeg',
        duration: 12,
      },
    });
    expect(hasForbiddenPublicKey(listening)).toBe(false);
  });

  it('8. snapshots safe media and retains attempts after media/exercise archive', async () => {
    const attempt = await request(app.getHttpServer())
      .post(`/api/v1/learning/exercises/${listeningExerciseId}/attempts`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .set('Idempotency-Key', 'authoring-listening-attempt-01')
      .send({ answer: { optionId: 'tone-a' }, durationSeconds: 7 })
      .expect(201);
    expect(attempt.body.data).toMatchObject({
      exerciseVersion: 1,
      score: 100,
      media: {
        id: readyAudioId,
        url: `https://cdn.example.test/exercise/${suffix}/ready.mp3`,
        mimeType: 'audio/mpeg',
        duration: 12,
      },
    });
    expect(hasForbiddenPublicKey(attempt.body.data)).toBe(false);

    await prisma.media.update({
      where: { id: readyAudioId },
      data: { deletedAt: new Date() },
    });
    const hiddenAfterSafetyInvalidation = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(200);
    expect(
      hiddenAfterSafetyInvalidation.body.data.exercises.some(
        (exercise: { id: number }) => exercise.id === listeningExerciseId,
      ),
    ).toBe(false);
    await adminPost(
      `/admin/cms/exercises/${listeningExerciseId}/revisions/${listeningRevisionId}/publish`,
    ).expect(422);
    await adminPost(
      `/admin/cms/exercises/${listeningExerciseId}/archive`,
    ).expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/learning/exercises/${listeningExerciseId}/attempts`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .set('Idempotency-Key', 'authoring-listening-after-archive')
      .send({ answer: { optionId: 'tone-a' } })
      .expect(404);
    const history = await request(app.getHttpServer())
      .get(`/api/v1/learning/exercises/${listeningExerciseId}/attempts`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(200);
    expect(history.body.data).toEqual([
      expect.objectContaining({
        exerciseVersion: 1,
        media: expect.objectContaining({
          id: readyAudioId,
          url: `https://cdn.example.test/exercise/${suffix}/ready.mp3`,
        }),
      }),
    ]);
    expect(hasForbiddenPublicKey(history.body)).toBe(false);
  });

  it('9. archives without deleting attempt history and audits safe summaries', async () => {
    await adminPost(`/admin/cms/exercises/${exerciseId}/archive`).expect(201);
    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(200);
    expect(
      publicDetail.body.data.exercises.map(
        (exercise: { id: number }) => exercise.id,
      ),
    ).not.toContain(exerciseId);

    const history = await request(app.getHttpServer())
      .get(`/api/v1/learning/exercises/${exerciseId}/attempts`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(200);
    expect(history.body.data).toEqual([
      expect.objectContaining({ exerciseVersion: 1, score: 100 }),
      expect.objectContaining({ exerciseVersion: 2, score: 100 }),
    ]);

    const audits = await prisma.auditLog.findMany({
      where: { targetType: 'lesson_exercise', targetId: String(exerciseId) },
      select: { action: true, afterSummary: true },
    });
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining([
        'lesson_exercise.created',
        'lesson_exercise.revision_created',
        'lesson_exercise.published',
        'lesson_exercise.archived',
      ]),
    );
    expect(JSON.stringify(audits)).not.toContain('optionId');
    expect(JSON.stringify(audits)).not.toContain('authoritative');
  });

  async function createListeningExercise(
    mediaId: number,
    orderIndex: number,
  ): Promise<ExerciseMutationBody> {
    const response = await adminPost('/admin/cms/exercises')
      .send({
        lessonId,
        topicId,
        type: 'listening_choice',
        prompt: 'Choose the syllable you hear',
        content: {
          options: [
            { id: 'tone-a', text: 'mā' },
            { id: 'tone-b', text: 'má' },
          ],
        },
        answer: { optionId: 'tone-a' },
        explanation: 'The audio uses the first tone.',
        mediaId,
        orderIndex,
      })
      .expect(201);
    return response.body as ExerciseMutationBody;
  }

  async function review(
    targetExerciseId: number,
    revisionId: number,
    decision: 'approved' | 'changes_requested' | 'rejected',
  ) {
    return adminPost(
      `/admin/cms/exercises/${targetExerciseId}/revisions/${revisionId}/reviews`,
    )
      .send({ decision })
      .expect(201);
  }

  async function publish(
    targetExerciseId: number,
    revisionId: number,
  ): Promise<ExerciseMutationBody> {
    const response = await adminPost(
      `/admin/cms/exercises/${targetExerciseId}/revisions/${revisionId}/publish`,
    ).expect(201);
    return response.body as ExerciseMutationBody;
  }

  function adminPost(path: string) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`);
  }

  async function register(label: string) {
    const email = `exercise-${label}-${suffix}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: `Exercise ${label}` })
      .expect(201);
    return {
      userId: response.body.data.user.id as number,
      token: response.body.data.accessToken as string,
    };
  }

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.data.accessToken as string;
  }
});

const FORBIDDEN_PUBLIC_KEYS = new Set([
  'answer',
  'authoritativeAnswer',
  'checksum',
  'metadata',
  'originalFilename',
  'storageKey',
  'storageProvider',
  'uploadedById',
  'updatedById',
]);

function hasForbiddenPublicKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenPublicKey);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      FORBIDDEN_PUBLIC_KEYS.has(key) || hasForbiddenPublicKey(nested),
  );
}
