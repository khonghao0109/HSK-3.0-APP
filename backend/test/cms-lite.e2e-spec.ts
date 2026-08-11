/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type CmsMutationBody = {
  success: true;
  data: {
    idempotent: boolean;
    lesson?: { id: number; title: string; status: string };
    topic?: { id: number; title: string; status: string };
    revision: { id: number; revision: number };
  };
};

describe('CMS Lite Publish Workflow & Lesson Content Readiness V1 E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let levelId: number;
  let normalToken: string;
  let adminToken: string;
  let adminId: number;
  let lessonId: number;
  let lessonRevision1Id: number;
  let topicId: number;
  let topicRevision1Id: number;
  let activePlanId: number;
  let latestLessonRevisionId: number;

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const password = 'StrongPassword123!';
  const normalEmail = `cms-user-${suffix}@example.com`;
  const adminEmail = `cms-admin-${suffix}@example.com`;
  const mainSlug = `cms-main-${suffix}`;

  const lessonPayload = (overrides: Record<string, unknown> = {}) => ({
    title: 'CMS Public V1',
    description: 'Stable published content',
    orderIndex: 1,
    slug: mainSlug,
    ...overrides,
  });

  const topicPayload = (overrides: Record<string, unknown> = {}) => ({
    title: 'CMS public topic',
    subtitle: 'Instructional block',
    type: 'vocabulary',
    content: [{ type: 'text', value: 'Ready to learn.' }],
    orderIndex: 1,
    isPremium: false,
    isLocked: false,
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
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const level = await prisma.level.create({
      data: {
        code: 'HSK5',
        name: 'HSK 5',
        orderIndex: 5,
        minBand: 5,
        maxBand: 5,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    levelId = level.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. authorizes from current database role and rejects a normal user', async () => {
    const normalRegistration = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: normalEmail, password, name: 'CMS Normal User' })
      .expect(201);
    normalToken = normalRegistration.body.accessToken as string;

    const adminRegistration = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password, name: 'CMS Admin' })
      .expect(201);
    adminId = adminRegistration.body.user.id as number;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password })
      .expect(201);
    adminToken = adminLogin.body.accessToken as string;

    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/lessons')
      .set('Authorization', `Bearer ${normalToken}`)
      .expect(403);
  });

  it('2. creates an immutable Lesson draft hidden from public and onboarding', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/cms/lessons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ levelId, ...lessonPayload() })
      .expect(201);
    const body = response.body as CmsMutationBody;
    lessonId = body.data.lesson!.id;
    lessonRevision1Id = body.data.revision.id;
    latestLessonRevisionId = lessonRevision1Id;

    expect(body.data).toMatchObject({
      idempotent: false,
      lesson: { status: 'draft', title: 'CMS Public V1' },
      revision: { revision: 1 },
    });

    const publicLessons = await request(app.getHttpServer())
      .get('/api/v1/learning/lessons')
      .query({ levelId })
      .expect(200);
    expect(publicLessons.body.data).toEqual([]);

    await request(app.getHttpServer())
      .post('/api/v1/onboarding/goals')
      .set('Authorization', `Bearer ${normalToken}`)
      .send({
        targetLevelId: levelId,
        targetBand: 5,
        dailyMinutes: 20,
        reminderEnabled: false,
        reminderTime: null,
        startDate: '2026-08-11',
      })
      .expect(201);
    const noPlan = await request(app.getHttpServer())
      .post('/api/v1/learning-plans')
      .set('Authorization', `Bearer ${normalToken}`)
      .expect(409);
    expect(noPlan.body.message).toMatch(/No published lessons/i);
  });

  it('3. publishes a Topic under a draft Lesson without exposing it publicly', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/cms/topics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lessonId, ...topicPayload() })
      .expect(201);
    const createdBody = created.body as CmsMutationBody;
    topicId = createdBody.data.topic!.id;
    topicRevision1Id = createdBody.data.revision.id;

    await review('topic', topicId, topicRevision1Id, 'approved');
    const published = await publish('topic', topicId, topicRevision1Id);
    expect(published.data.topic).toMatchObject({ status: 'published' });

    const topics = await request(app.getHttpServer())
      .get('/api/v1/learning/topics')
      .query({ lessonId })
      .expect(200);
    expect(topics.body.data).toEqual([]);
  });

  it('4. rejects publishing a Lesson with no public instructional block', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/cms/lessons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        levelId,
        ...lessonPayload({
          title: 'Empty lesson',
          slug: `cms-empty-${suffix}`,
          orderIndex: 2,
        }),
      })
      .expect(201);
    const body = created.body as CmsMutationBody;
    const emptyLessonId = body.data.lesson!.id;
    const emptyRevisionId = body.data.revision.id;
    await review('lesson', emptyLessonId, emptyRevisionId, 'approved');

    const response = await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/lessons/${emptyLessonId}/revisions/${emptyRevisionId}/publish`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(response.body.message).toMatch(/published Topic or Story/i);
  });

  it('5. publishes only the latest approved ready Lesson revision', async () => {
    await review('lesson', lessonId, lessonRevision1Id, 'approved');
    const reviewRetry = await review(
      'lesson',
      lessonId,
      lessonRevision1Id,
      'approved',
    );
    expect(reviewRetry.body.data.idempotent).toBe(true);
    await expect(
      prisma.contentReview.count({
        where: { revisionId: lessonRevision1Id },
      }),
    ).resolves.toBe(1);
    const published = await publish('lesson', lessonId, lessonRevision1Id);
    expect(published.data).toMatchObject({
      idempotent: false,
      lesson: { title: 'CMS Public V1', status: 'published' },
    });

    const publicLessons = await request(app.getHttpServer())
      .get('/api/v1/learning/lessons')
      .query({ levelId })
      .expect(200);
    expect(publicLessons.body.data).toEqual([
      expect.objectContaining({ id: lessonId, title: 'CMS Public V1' }),
    ]);
  });

  it('6. generates a plan containing only ready Lessons', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/learning-plans')
      .set('Authorization', `Bearer ${normalToken}`)
      .expect(201);
    activePlanId = response.body.data.id as number;
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].lesson).toMatchObject({ id: lessonId });
  });

  it('7. keeps live content stable while a new draft revision exists', async () => {
    const payload = lessonPayload({
      title: 'CMS Public V2',
      description: 'Not visible until publish',
    });
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/lessons/${lessonId}/revisions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
      .expect(201);
    const body = response.body as CmsMutationBody;
    latestLessonRevisionId = body.data.revision.id;
    expect(body.data).toMatchObject({
      idempotent: false,
      lesson: { title: 'CMS Public V1', status: 'published' },
      revision: { revision: 2 },
    });

    const retry = await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/lessons/${lessonId}/revisions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
      .expect(201);
    expect(retry.body.data).toMatchObject({
      idempotent: true,
      revision: { id: latestLessonRevisionId, revision: 2 },
    });

    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(200);
    expect(publicDetail.body.data.title).toBe('CMS Public V1');
  });

  it('8. atomically exposes the approved V2 and makes publish retry idempotent', async () => {
    await review('lesson', lessonId, latestLessonRevisionId, 'approved');
    const published = await publish('lesson', lessonId, latestLessonRevisionId);
    expect(published.data).toMatchObject({
      idempotent: false,
      lesson: { title: 'CMS Public V2', status: 'published' },
    });

    const auditCountBeforeRetry = await prisma.auditLog.count({
      where: { action: 'lesson.published', targetId: String(lessonId) },
    });
    const retry = await publish('lesson', lessonId, latestLessonRevisionId);
    expect(retry.data.idempotent).toBe(true);
    await expect(
      prisma.auditLog.count({
        where: { action: 'lesson.published', targetId: String(lessonId) },
      }),
    ).resolves.toBe(auditCountBeforeRetry);

    const publicDetail = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(200);
    expect(publicDetail.body.data.title).toBe('CMS Public V2');
  });

  it('9. returns 409 when an approved revision becomes stale', async () => {
    const revision3 = await createLessonRevision('CMS Draft V3', 3);
    await review('lesson', lessonId, revision3.id, 'approved');
    const revision4 = await createLessonRevision('CMS Draft V4', 4);
    latestLessonRevisionId = revision4.id;

    const response = await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/lessons/${lessonId}/revisions/${revision3.id}/publish`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(response.body.message).toMatch(/latest content revision/i);
  });

  it('10. serializes concurrent revision creation without lost updates', async () => {
    const [left, right] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/admin/cms/lessons/${lessonId}/revisions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(lessonPayload({ title: 'CMS concurrent A' }))
        .expect(201),
      request(app.getHttpServer())
        .post(`/api/v1/admin/cms/lessons/${lessonId}/revisions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(lessonPayload({ title: 'CMS concurrent B' }))
        .expect(201),
    ]);
    const revisions = [
      left.body.data.revision.revision as number,
      right.body.data.revision.revision as number,
    ].sort((a, b) => a - b);
    expect(revisions[1] - revisions[0]).toBe(1);
    expect(new Set(revisions).size).toBe(2);

    const stored = await prisma.contentRevision.findMany({
      where: { entityType: 'lesson', entityId: lessonId },
      orderBy: { revision: 'asc' },
      select: { id: true, revision: true },
    });
    expect(stored.map((revision) => revision.revision)).toEqual(
      Array.from({ length: stored.length }, (_, index) => index + 1),
    );
    latestLessonRevisionId = stored[stored.length - 1].id;
  });

  it('11. rejects publish after rejected or changes_requested latest review', async () => {
    await review('lesson', lessonId, latestLessonRevisionId, 'rejected');
    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/lessons/${lessonId}/revisions/${latestLessonRevisionId}/publish`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    await review(
      'lesson',
      lessonId,
      latestLessonRevisionId,
      'changes_requested',
    );
    const response = await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/lessons/${lessonId}/revisions/${latestLessonRevisionId}/publish`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(response.body.message).toMatch(/must approve/i);
  });

  it('12. filters draft/deleted child content and never returns exercise answer', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/topics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        lessonId,
        ...topicPayload({ title: 'Hidden draft topic', orderIndex: 2 }),
      })
      .expect(201);
    const archivedTopic = await request(app.getHttpServer())
      .post('/api/v1/admin/cms/topics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        lessonId,
        ...topicPayload({ title: 'Archived topic', orderIndex: 3 }),
      })
      .expect(201);
    const archivedTopicId = archivedTopic.body.data.topic.id as number;
    await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/topics/${archivedTopicId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const words = await Promise.all(
      [
        { label: 'public', status: 'published' as const, deletedAt: null },
        { label: 'draft', status: 'draft' as const, deletedAt: null },
        {
          label: 'deleted',
          status: 'published' as const,
          deletedAt: new Date(),
        },
      ].map((fixture, index) =>
        prisma.word.create({
          data: {
            hanzi: `词${suffix}-${index}`,
            pinyin: `ci ${suffix} ${index}`,
            pinyinNormalized: `ci ${suffix} ${index}`,
            status: fixture.status,
            deletedAt: fixture.deletedAt,
          },
          select: { id: true, hanzi: true },
        }),
      ),
    );
    await prisma.lessonWord.createMany({
      data: words.map((word, index) => ({
        lessonId,
        wordId: word.id,
        orderIndex: index + 1,
      })),
    });
    await prisma.lessonExercise.create({
      data: {
        lessonId,
        topicId,
        type: 'mcq',
        prompt: 'Choose the public answer',
        content: { choices: ['A', 'B'] },
        answer: { correct: 'A', secret: true },
        explanation: 'Internal explanation',
        version: 1,
        orderIndex: 1,
        status: 'published',
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(200);
    expect(response.body.data.topics).toHaveLength(1);
    expect(response.body.data.topics[0].id).toBe(topicId);
    expect(response.body.data.words).toEqual([
      expect.objectContaining({ id: words[0].id }),
    ]);
    expect(response.body.data.exercises).toHaveLength(1);
    expect(response.body.data.exercises[0]).not.toHaveProperty('answer');
    expect(response.body.data.exercises[0]).not.toHaveProperty('explanation');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('13. persists safe audit summaries and database-enforced immutable facts', async () => {
    const revisions = await prisma.contentRevision.findMany({
      where: { entityType: 'lesson', entityId: lessonId },
      orderBy: { revision: 'asc' },
    });
    expect(revisions.length).toBeGreaterThanOrEqual(6);
    expect(
      revisions.every((revision) => revision.contentHash?.length === 64),
    ).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'lesson.published', targetId: String(lessonId) },
      orderBy: { id: 'desc' },
    });
    expect(Object.keys(audit.afterSummary as object).sort()).toEqual([
      'contentHash',
      'entityId',
      'entityType',
      'revision',
      'status',
    ]);
    expect(JSON.stringify(audit.afterSummary)).not.toContain(
      'Stable published',
    );

    await expect(
      prisma.contentRevision.update({
        where: { id: revisions[0].id },
        data: { contentHash: 'tampered' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.auditLog.update({
        where: { id: audit.id },
        data: { action: 'tampered' },
      }),
    ).rejects.toThrow();
  });

  it('14. returns admin list filters and complete revision/review state', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/cms/lessons')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({
        levelId,
        status: 'published',
        search: 'cms-main',
        page: 1,
        limit: 10,
      })
      .expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id: lessonId,
        status: 'published',
        latestRevision: expect.objectContaining({ id: latestLessonRevisionId }),
      }),
    ]);
    expect(list.body.meta).toMatchObject({ page: 1, limit: 10, total: 1 });

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/cms/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.data.revisions[0].id).toBe(latestLessonRevisionId);
    expect(detail.body.data.revisions[0].reviews[0]).toMatchObject({
      decision: 'changes_requested',
    });
    expect(detail.body.data.revisions[0].reviews).toContainEqual(
      expect.objectContaining({ decision: 'rejected' }),
    );
  });

  it('15. archives the Lesson and preserves the active plan on no-ready-content 409', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/lessons/${lessonId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const publicLessons = await request(app.getHttpServer())
      .get('/api/v1/learning/lessons')
      .query({ levelId })
      .expect(200);
    expect(publicLessons.body.data).toEqual([]);
    await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}`)
      .expect(404);

    await request(app.getHttpServer())
      .post('/api/v1/learning-plans')
      .set('Authorization', `Bearer ${normalToken}`)
      .expect(409);
    const activePlans = await prisma.learningPlan.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    expect(activePlans).toContainEqual({ id: activePlanId });

    const currentPlan = await request(app.getHttpServer())
      .get('/api/v1/learning-plans/current')
      .set('Authorization', `Bearer ${normalToken}`)
      .expect(200);
    expect(currentPlan.body.data.id).toBe(activePlanId);
    expect(currentPlan.body.data.items).toEqual([]);

    const status = await request(app.getHttpServer())
      .get('/api/v1/onboarding/status')
      .set('Authorization', `Bearer ${normalToken}`)
      .expect(200);
    expect(status.body.data).toMatchObject({
      hasActiveLearningPlan: true,
      hasUsableLearningPlan: false,
      nextStep: 'content_unavailable',
    });
  });

  it('16. rejects stale admin JWT after suspension and anonymization', async () => {
    await prisma.user.update({
      where: { id: adminId },
      data: { status: 'suspended' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/lessons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        levelId,
        ...lessonPayload({
          title: 'Unauthorized suspended write',
          slug: `cms-suspended-${suffix}`,
          orderIndex: 10,
        }),
      })
      .expect(401);

    await prisma.user.update({
      where: { id: adminId },
      data: { status: 'anonymized' },
    });
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/lessons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        levelId,
        ...lessonPayload({
          title: 'Unauthorized anonymized write',
          slug: `cms-anonymized-${suffix}`,
          orderIndex: 11,
        }),
      })
      .expect(401);
  });

  async function createLessonRevision(title: string, marker: number) {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/lessons/${lessonId}/revisions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(
        lessonPayload({
          title,
          description: `Draft marker ${marker}`,
        }),
      )
      .expect(201);
    return response.body.data.revision as { id: number; revision: number };
  }

  async function review(
    entityType: 'lesson' | 'topic',
    entityId: number,
    revisionId: number,
    decision: 'approved' | 'changes_requested' | 'rejected',
  ) {
    return request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/${entityType}s/${entityId}/revisions/${revisionId}/reviews`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision })
      .expect(201);
  }

  async function publish(
    entityType: 'lesson' | 'topic',
    entityId: number,
    revisionId: number,
  ): Promise<CmsMutationBody> {
    const response = await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/${entityType}s/${entityId}/revisions/${revisionId}/publish`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    return response.body as CmsMutationBody;
  }
});
