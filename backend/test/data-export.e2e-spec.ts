/// <reference types="jest" />

import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import {
  JOB_NAMES,
  JobQueuePort,
} from '../src/infrastructure/jobs/job-queue.port';
import { InMemoryJobQueue } from '../src/infrastructure/jobs/in-memory-job-queue.adapter';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../src/infrastructure/storage/object-storage.port';
import { InMemoryObjectStorageAdapter } from '../src/infrastructure/storage/in-memory-object-storage.adapter';
import { DataExportJob } from '../src/modules/user/jobs/data-export.job';
import { PurgeExpiredExportsJob } from '../src/modules/user/jobs/purge-expired-exports.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type EnvelopeResponse<T> = {
  success: boolean;
  data: T;
  meta: {
    requestId: string;
    timestamp: string;
  };
};

type CreateExportResponse = {
  exportId: number;
  status: string;
};

type ExportListItem = {
  id: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  outputExpiresAt: string | null;
  downloadable: boolean;
  outputStorageKey?: string;
  errorMessage?: string;
};

describe('Data Export E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let inMemoryQueue: InMemoryJobQueue;
  let inMemoryStorage: InMemoryObjectStorageAdapter;
  let exportHandler: DataExportJob;
  let purgeHandler: PurgeExpiredExportsJob;

  let testLevelId: number;
  let testLessonId: number;
  let testWordId: number;
  let testExamId: number;

  const prefix = `e2e_exp_${Date.now()}`;
  const password = 'Password123!';
  const emailFor = (label: string) => `${prefix}_${label}@example.com`;
  const http = () => request(app.getHttpServer());

  const registerUser = async (
    label: string,
  ): Promise<{ token: string; userId: number; email: string }> => {
    const email = emailFor(label);
    const res = await http()
      .post('/api/v1/auth/register')
      .set('User-Agent', `TestAgent_${label}`)
      .send({ email, password, name: `User ${label}` })
      .expect(HttpStatus.CREATED);

    const envelope = res.body as EnvelopeResponse<{ accessToken: string }>;
    const token = envelope.data.accessToken;
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    return { token, userId: user.id, email };
  };

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

    const queuePort = app.get<JobQueuePort>(JobQueuePort);
    expect(queuePort).toBeInstanceOf(InMemoryJobQueue);
    inMemoryQueue = queuePort as InMemoryJobQueue;

    const storagePort = app.get<ObjectStoragePort>(OBJECT_STORAGE);
    expect(storagePort).toBeInstanceOf(InMemoryObjectStorageAdapter);
    inMemoryStorage = storagePort as InMemoryObjectStorageAdapter;

    exportHandler = new DataExportJob(null, prisma, inMemoryStorage);
    purgeHandler = new PurgeExpiredExportsJob(null, prisma, inMemoryStorage);

    // Setup base fixtures for child table tests
    const level = await prisma.level.upsert({
      where: { code: 'HSK1' },
      update: {},
      create: {
        name: 'HSK 1',
        code: 'HSK1',
        orderIndex: 1,
        minBand: 1,
        maxBand: 1,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
      },
    });
    testLevelId = level.id;

    const lesson = await prisma.lesson.create({
      data: {
        levelId: level.id,
        title: `Lesson ${prefix}`,
        slug: `lesson-${prefix}`,
        orderIndex: 98765,
        status: 'published',
      },
    });
    testLessonId = lesson.id;

    const word = await prisma.word.create({
      data: {
        hanzi: `学${prefix.slice(-4)}`,
        pinyin: 'xue',
        pinyinNormalized: 'xue',
        status: 'published',
      },
    });
    testWordId = word.id;

    const testExam = await prisma.test.create({
      data: {
        levelId: level.id,
        title: `Test ${prefix}`,
        slug: `test-${prefix}`,
        duration: 3600,
        status: 'published',
      },
    });
    testExamId = testExam.id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    inMemoryQueue.clear();
  });

  it('P1: POST /users/me/data-exports enqueues 1 job; subsequent POST within 24 hours returns 429; allows POST after failed job', async () => {
    const { token } = await registerUser('p1');

    // 1. Initial request -> 202
    const res1 = await http()
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.ACCEPTED);

    const envelope1 = res1.body as EnvelopeResponse<CreateExportResponse>;
    expect(envelope1.data.exportId).toBeGreaterThan(0);
    expect(envelope1.data.status).toBe('requested');

    const exportId = envelope1.data.exportId;

    // Verify 1 job enqueued in privacy.data-export
    const enqueuedJobs = inMemoryQueue.getJobsByName(JOB_NAMES.DATA_EXPORT);
    expect(enqueuedJobs.length).toBe(1);
    expect(enqueuedJobs[0].data).toEqual({ exportId });
    expect(enqueuedJobs[0].options?.singletonKey).toBe(`export:${exportId}`);

    // 2. Second request within 24 hours -> 429 EXPORT_RATE_LIMITED
    const res2 = await http()
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.TOO_MANY_REQUESTS);

    expect(res2.body.error.code).toBe('EXPORT_RATE_LIMITED');

    // 3. Mark the existing job as 'failed' in database
    await prisma.dataExportJob.update({
      where: { id: exportId },
      data: { status: 'failed', errorCode: 'TEST_FAILURE' },
    });

    // 4. After a failed job, requesting export should succeed (202)
    const res3 = await http()
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.ACCEPTED);

    const envelope3 = res3.body as EnvelopeResponse<CreateExportResponse>;
    expect(envelope3.data.exportId).toBeGreaterThan(exportId);
    expect(envelope3.data.status).toBe('requested');
  });

  it('P3, P4: completed export download returns 200 with 4 security headers, valid schemaVersion, user.email, session userAgent, and zero password/tokenHash', async () => {
    const { token, userId, email } = await registerUser('p3_p4');

    // Request export
    const reqRes = await http()
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.ACCEPTED);

    const exportId = (reqRes.body as EnvelopeResponse<CreateExportResponse>)
      .data.exportId;

    // Process job with real handler
    const processed = await exportHandler.process({ exportId });
    expect(processed).toBe(true);

    const jobRow = await prisma.dataExportJob.findUniqueOrThrow({
      where: { id: exportId },
    });
    expect(jobRow.status).toBe('completed');
    expect(jobRow.outputStorageKey).not.toBeNull();

    // Download export
    const dlRes = await http()
      .get(`/api/v1/users/me/data-exports/${exportId}/download`)
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    // P3: Assert all 4 security headers
    expect(dlRes.headers['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    expect(dlRes.headers['content-disposition']).toBe(
      `attachment; filename="hsk-data-export-${exportId}.json"`,
    );
    expect(dlRes.headers['cache-control']).toBe('no-store');
    expect(dlRes.headers['x-content-type-options']).toBe('nosniff');

    // P4: Parse JSON content
    const exportContent = JSON.parse(dlRes.text) as Record<string, unknown>;
    expect(exportContent.schemaVersion).toBe(1);
    expect(exportContent.generatedAt).toBeDefined();

    const userData = exportContent.user as Record<string, unknown>;
    expect(userData.email).toBe(email);
    expect(userData.id).toBe(userId);

    // Verify sessions contain userAgent
    const sessions = exportContent.sessions as Array<Record<string, unknown>>;
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].userAgent).toBeDefined();

    // Verify zero secrets: no "password" or "tokenHash" substring in JSON
    expect(dlRes.text).not.toContain('"password"');
    expect(dlRes.text).not.toContain('"tokenHash"');
  });

  it('P2: download only accessible by owner, before expiration, and with existing id; returns 404 otherwise', async () => {
    const userA = await registerUser('p2_a');
    const userB = await registerUser('p2_b');

    // Create export for User A
    const reqRes = await http()
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(HttpStatus.ACCEPTED);

    const exportId = (reqRes.body as EnvelopeResponse<CreateExportResponse>)
      .data.exportId;

    await exportHandler.process({ exportId });

    // 1. User B tries to download User A's export -> 404
    await http()
      .get(`/api/v1/users/me/data-exports/${exportId}/download`)
      .set('Authorization', `Bearer ${userB.token}`)
      .expect(HttpStatus.NOT_FOUND);

    // 2. Non-existent export ID -> 404
    await http()
      .get(`/api/v1/users/me/data-exports/999999/download`)
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(HttpStatus.NOT_FOUND);

    // 3. Shift outputExpiresAt into the past using raw SQL -> 404
    await prisma.$executeRawUnsafe(
      `UPDATE "DataExportJob" SET "outputExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id = $1`,
      exportId,
    );

    await http()
      .get(`/api/v1/users/me/data-exports/${exportId}/download`)
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(HttpStatus.NOT_FOUND);
  });

  it('P8: purge cron deletes objects completed older than 7 days and sets outputStorageKey to NULL', async () => {
    const { token } = await registerUser('p8_cron');

    const reqRes = await http()
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.ACCEPTED);

    const exportId = (reqRes.body as EnvelopeResponse<CreateExportResponse>)
      .data.exportId;

    await exportHandler.process({ exportId });

    const beforeJob = await prisma.dataExportJob.findUniqueOrThrow({
      where: { id: exportId },
    });
    const storageKey = beforeJob.outputStorageKey!;
    expect(await inMemoryStorage.privateObjectExists(storageKey)).toBe(true);

    // Shift completedAt back 8 days
    await prisma.$executeRawUnsafe(
      `UPDATE "DataExportJob" SET "completedAt" = CURRENT_TIMESTAMP - INTERVAL '8 days' WHERE id = $1`,
      exportId,
    );

    // Run purge cron
    const purgedCount = await purgeHandler.purge();
    expect(purgedCount).toBeGreaterThanOrEqual(1);

    // Verify object removed from storage and key set to NULL
    expect(await inMemoryStorage.privateObjectExists(storageKey)).toBe(false);

    const afterJob = await prisma.dataExportJob.findUniqueOrThrow({
      where: { id: exportId },
    });
    expect(afterJob.outputStorageKey).toBeNull();
  });

  it('GET /users/me/data-exports returns list without outputStorageKey or errorMessage', async () => {
    const { token } = await registerUser('list_user');

    const reqRes = await http()
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.ACCEPTED);

    const exportId = (reqRes.body as EnvelopeResponse<CreateExportResponse>)
      .data.exportId;

    await exportHandler.process({ exportId });

    const listRes = await http()
      .get('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK);

    const envelope = listRes.body as EnvelopeResponse<ExportListItem[]>;
    expect(Array.isArray(envelope.data)).toBe(true);
    expect(envelope.data.length).toBeGreaterThan(0);

    const item = envelope.data.find((e) => e.id === exportId);
    expect(item).toBeDefined();
    expect(item!.id).toBe(exportId);
    expect(item!.status).toBe('completed');
    expect(item!.downloadable).toBe(true);
    expect(item!.outputStorageKey).toBeUndefined();
    expect(item!.errorMessage).toBeUndefined();
    expect(JSON.stringify(listRes.body)).not.toContain('privacy-exports');
  });

  it('P6: user isolation - export of user A does not contain user B ID or email', async () => {
    const userA = await registerUser('iso_a');
    const userB = await registerUser('iso_b');

    // Create some distinct data for user B
    await prisma.userProfile.create({
      data: {
        userId: userB.userId,
        displayName: 'SecretProfileUserB',
        locale: 'vi-VN',
        timezone: 'Asia/Ho_Chi_Minh',
      },
    });

    // User A requests export
    const reqRes = await http()
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(HttpStatus.ACCEPTED);

    const exportId = (reqRes.body as EnvelopeResponse<CreateExportResponse>)
      .data.exportId;

    await exportHandler.process({ exportId });

    const dlRes = await http()
      .get(`/api/v1/users/me/data-exports/${exportId}/download`)
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(HttpStatus.OK);

    const exportText = dlRes.text;
    expect(exportText).toContain(userA.email);
    expect(exportText).toContain(String(userA.userId));

    // Must NOT contain user B email, user B user ID, or user B profile data
    expect(exportText).not.toContain(userB.email);
    expect(exportText).not.toContain(`"userId":${userB.userId}`);
    expect(exportText).not.toContain('SecretProfileUserB');
  });

  it('Q3: E2E export has child tables (ExamAnswer, ExamAttemptEvent, ReviewEvent, LearningPlanItem)', async () => {
    const userA = await registerUser('q3_child');

    const plan = await prisma.learningPlan.create({
      data: {
        userId: userA.userId,
        targetLevelId: testLevelId,
        startDate: new Date(),
        items: {
          create: {
            lessonId: testLessonId,
            orderIndex: 1,
          },
        },
      },
      include: { items: true },
    });

    const card = await prisma.reviewCard.create({
      data: {
        userId: userA.userId,
        wordId: testWordId,
        events: {
          create: {
            grade: 'good',
            previousState: 'new',
            nextState: 'learning',
            previousDueAt: new Date(),
            nextDueAt: new Date(),
            previousIntervalDays: 0,
            nextIntervalDays: 1,
            previousEaseFactor: 2.5,
            nextEaseFactor: 2.5,
            idempotencyKey: `rev_q3_${Date.now()}`,
          },
        },
      },
      include: { events: true },
    });

    const attempt = await prisma.examAttempt.create({
      data: {
        userId: userA.userId,
        testId: testExamId,
        expiresAt: new Date(Date.now() + 3600000),
        remainingSeconds: 3600,
        scoringVersion: 'v1',
        idempotencyKey: `att_q3_${Date.now()}`,
        answers: {
          create: {
            snapshotQuestionKey: 'q1',
            answer: { selected: 'A' },
          },
        },
        events: {
          create: {
            type: 'started',
            idempotencyKey: `att_evt_q3_${Date.now()}`,
          },
        },
      },
      include: { answers: true, events: true },
    });

    // Request export
    const reqRes = await http()
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(HttpStatus.ACCEPTED);

    const exportId = (reqRes.body as EnvelopeResponse<CreateExportResponse>)
      .data.exportId;

    await exportHandler.process({ exportId });

    const dlRes = await http()
      .get(`/api/v1/users/me/data-exports/${exportId}/download`)
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(HttpStatus.OK);

    type ExportPayload = {
      learningPlans: Array<{
        id: number;
        items: Array<{ id: number; learningPlanId: number }>;
      }>;
      reviewCards: Array<{
        id: number;
        events: Array<{ id: string; cardId: number }>;
      }>;
      examAttempts: Array<{
        id: number;
        answers: Array<{ id: number; attemptId: number }>;
        events: Array<{ id: string; attemptId: number }>;
      }>;
    };

    const exportContent = JSON.parse(dlRes.text) as ExportPayload;

    // 1. LearningPlanItem
    expect(exportContent.learningPlans.length).toBeGreaterThan(0);
    const planItems = exportContent.learningPlans[0].items;
    expect(planItems.length).toBeGreaterThan(0);
    expect(planItems[0].id).toBe(plan.items[0].id);

    // 2. ReviewEvent
    expect(exportContent.reviewCards.length).toBeGreaterThan(0);
    const reviewEvents = exportContent.reviewCards[0].events;
    expect(reviewEvents.length).toBeGreaterThan(0);
    expect(reviewEvents[0].id).toBe(card.events[0].id.toString());

    // 3. ExamAnswer
    expect(exportContent.examAttempts.length).toBeGreaterThan(0);
    const answers = exportContent.examAttempts[0].answers;
    expect(answers.length).toBeGreaterThan(0);
    expect(answers[0].id).toBe(attempt.answers[0].id);

    // 4. ExamAttemptEvent
    const attemptEvents = exportContent.examAttempts[0].events;
    expect(attemptEvents.length).toBeGreaterThan(0);
    expect(attemptEvents[0].id).toBe(attempt.events[0].id.toString());
  });

  it('Q4: E2E user isolation on child tables - export of user A does not contain user B child record IDs', async () => {
    const userA = await registerUser('q4_user_a');
    const userB = await registerUser('q4_user_b');

    // User A data
    const planA = await prisma.learningPlan.create({
      data: {
        userId: userA.userId,
        targetLevelId: testLevelId,
        startDate: new Date(),
        items: {
          create: {
            lessonId: testLessonId,
            orderIndex: 1,
          },
        },
      },
      include: { items: true },
    });

    const cardA = await prisma.reviewCard.create({
      data: {
        userId: userA.userId,
        wordId: testWordId,
        events: {
          create: {
            grade: 'good',
            previousState: 'new',
            nextState: 'learning',
            previousDueAt: new Date(),
            nextDueAt: new Date(),
            previousIntervalDays: 0,
            nextIntervalDays: 1,
            previousEaseFactor: 2.5,
            nextEaseFactor: 2.5,
            idempotencyKey: `rev_q4_a_${Date.now()}`,
          },
        },
      },
      include: { events: true },
    });

    const attemptA = await prisma.examAttempt.create({
      data: {
        userId: userA.userId,
        testId: testExamId,
        expiresAt: new Date(Date.now() + 3600000),
        remainingSeconds: 3600,
        scoringVersion: 'v1',
        idempotencyKey: `att_q4_a_${Date.now()}`,
        answers: {
          create: {
            snapshotQuestionKey: 'q1',
            answer: { selected: 'A' },
          },
        },
        events: {
          create: {
            type: 'started',
            idempotencyKey: `att_evt_q4_a_${Date.now()}`,
          },
        },
      },
      include: { answers: true, events: true },
    });

    // User B data (similar child records)
    const planB = await prisma.learningPlan.create({
      data: {
        userId: userB.userId,
        targetLevelId: testLevelId,
        startDate: new Date(),
        items: {
          create: {
            lessonId: testLessonId,
            orderIndex: 1,
          },
        },
      },
      include: { items: true },
    });

    const cardB = await prisma.reviewCard.create({
      data: {
        userId: userB.userId,
        wordId: testWordId,
        events: {
          create: {
            grade: 'hard',
            previousState: 'new',
            nextState: 'learning',
            previousDueAt: new Date(),
            nextDueAt: new Date(),
            previousIntervalDays: 0,
            nextIntervalDays: 1,
            previousEaseFactor: 2.3,
            nextEaseFactor: 2.3,
            idempotencyKey: `rev_q4_b_${Date.now()}`,
          },
        },
      },
      include: { events: true },
    });

    const attemptB = await prisma.examAttempt.create({
      data: {
        userId: userB.userId,
        testId: testExamId,
        expiresAt: new Date(Date.now() + 3600000),
        remainingSeconds: 3600,
        scoringVersion: 'v1',
        idempotencyKey: `att_q4_b_${Date.now()}`,
        answers: {
          create: {
            snapshotQuestionKey: 'q1',
            answer: { selected: 'B' },
          },
        },
        events: {
          create: {
            type: 'started',
            idempotencyKey: `att_evt_q4_b_${Date.now()}`,
          },
        },
      },
      include: { answers: true, events: true },
    });

    // User A requests export
    const reqRes = await http()
      .post('/api/v1/users/me/data-exports')
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(HttpStatus.ACCEPTED);

    const exportId = (reqRes.body as EnvelopeResponse<CreateExportResponse>)
      .data.exportId;

    await exportHandler.process({ exportId });

    const dlRes = await http()
      .get(`/api/v1/users/me/data-exports/${exportId}/download`)
      .set('Authorization', `Bearer ${userA.token}`)
      .expect(HttpStatus.OK);

    type ExportPayload = {
      learningPlans: Array<{
        id: number;
        items: Array<{ id: number; learningPlanId: number }>;
      }>;
      reviewCards: Array<{
        id: number;
        events: Array<{ id: string; cardId: number }>;
      }>;
      examAttempts: Array<{
        id: number;
        answers: Array<{ id: number; attemptId: number }>;
        events: Array<{ id: string; attemptId: number }>;
      }>;
    };

    const exportContent = JSON.parse(dlRes.text) as ExportPayload;

    // Verify User A records are present
    const planAItemIds = exportContent.learningPlans.flatMap((p) =>
      p.items.map((i) => i.id),
    );
    expect(planAItemIds).toContain(planA.items[0].id);

    const cardAEventIds = exportContent.reviewCards.flatMap((c) =>
      c.events.map((e) => e.id),
    );
    expect(cardAEventIds).toContain(cardA.events[0].id.toString());

    const attemptAAnswerIds = exportContent.examAttempts.flatMap((a) =>
      a.answers.map((ans) => ans.id),
    );
    expect(attemptAAnswerIds).toContain(attemptA.answers[0].id);

    const attemptAEventIds = exportContent.examAttempts.flatMap((a) =>
      a.events.map((e) => e.id),
    );
    expect(attemptAEventIds).toContain(attemptA.events[0].id.toString());

    // Verify User B child records are strictly NOT present
    expect(planAItemIds).not.toContain(planB.items[0].id);
    expect(cardAEventIds).not.toContain(cardB.events[0].id.toString());
    expect(attemptAAnswerIds).not.toContain(attemptB.answers[0].id);
    expect(attemptAEventIds).not.toContain(attemptB.events[0].id.toString());

    // Also verify User B parent records and IDs are not present anywhere in raw JSON
    const exportText = dlRes.text;
    expect(exportText).not.toContain(userB.email);
    expect(exportText).not.toContain(`"userId":${userB.userId}`);
  });
});
