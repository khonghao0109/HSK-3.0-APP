/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
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
        exceptionFactory: createSafeValidationException,
      }),
    );
    await app.init();
    await app.listen(0, '127.0.0.1');
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
    normalToken = normalRegistration.body.data.accessToken as string;

    const adminRegistration = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password, name: 'CMS Admin' })
      .expect(201);
    adminId = adminRegistration.body.data.user.id as number;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password })
      .expect(201);
    adminToken = adminLogin.body.data.accessToken as string;

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

    // No x-request-id was sent: the generated id is echoed and audited.
    const requestId = response.headers['x-request-id'];
    expect(response.body.meta.requestId).toBe(requestId);
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: { targetType: 'lesson', targetId: String(lessonId) },
        orderBy: { id: 'asc' },
        select: { correlationId: true },
      }),
    ).resolves.toEqual({ correlationId: requestId });

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
    expect(noPlan.body.error.message).toMatch(/No published lessons/i);
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
    expect(response.body.error.message).toMatch(/published Topic or Story/i);
    expect(response.body.error.code).toBe('LESSON_NO_PUBLISHED_CHILD');
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
    expect(response.body.error.message).toMatch(/latest content revision/i);
    expect(response.body.error.code).toBe('REVISION_NOT_LATEST');
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
    expect(response.body.error.message).toMatch(/must approve/i);
    expect(response.body.error.code).toBe('REVIEW_NOT_APPROVED');
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
        content: {
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        },
        answer: { optionId: 'a' },
        explanation: 'Internal explanation',
        version: 1,
        orderIndex: 1,
        status: 'published',
        publishedAt: new Date(),
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
    expect(list.body.meta.pagination).toMatchObject({
      page: 1,
      limit: 10,
      total: 1,
    });

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

  it('16. returns lesson detail topics ordered, without content, with summary latestRevision (B1)', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/cms/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const topics = detail.body.data.topics as Array<Record<string, unknown>>;

    // Mọi Topic của bài (kể cả archived), orderIndex asc rồi id asc:
    // topic published (1), hidden draft (2), archived (3).
    expect(topics.map((topic) => topic.orderIndex)).toEqual([1, 2, 3]);
    expect(topics.map((topic) => topic.status)).toEqual([
      'published',
      'draft',
      'archived',
    ]);
    for (const topic of topics) {
      expect(topic).not.toHaveProperty('content');
    }

    // latestRevision tóm tắt: không snapshot/contentHash; reviews tối đa 1
    // bản mới nhất chỉ gồm decision/reviewerId/createdAt.
    const summary = topics[0].latestRevision as Record<string, unknown>;
    expect(summary).toMatchObject({ revision: 1 });
    expect(Object.keys(summary).sort()).toEqual([
      'authorId',
      'createdAt',
      'id',
      'reviews',
      'revision',
    ]);
    const reviews = summary.reviews as Array<Record<string, unknown>>;
    expect(reviews).toHaveLength(1);
    expect(Object.keys(reviews[0]).sort()).toEqual([
      'createdAt',
      'decision',
      'reviewerId',
    ]);
    expect(reviews[0].decision).toBe('approved');

    // Chủ đề draft chưa có đánh giá → reviews rỗng; không có bản sửa → null
    // (bài này mọi chủ đề đều có revision 1 nên kiểm nhánh rỗng).
    const draftSummary = topics[1].latestRevision as { reviews: unknown[] };
    expect(draftSummary.reviews).toEqual([]);
  });

  it('17. returns machine codes for lesson 409 conflicts and audits reviews (B2+B3)', async () => {
    // CONTENT_UNIQUE_CONFLICT: slug trùng (Lesson.slug @unique).
    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/admin/cms/lessons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        levelId,
        ...lessonPayload({ title: 'Duplicate slug lesson', orderIndex: 20 }),
      })
      .expect(409);
    expect(duplicate.body.error.code).toBe('CONTENT_UNIQUE_CONFLICT');
    expect(duplicate.body.error.message).toBe(
      'Content conflicts with an existing slug or order.',
    );

    // LESSON_LEVEL_NOT_PUBLISHED: level tạm chuyển draft (không tạo Level mới
    // vì code/band bị check constraint chặt và các suite e2e khác upsert chung
    // DB), khôi phục published ở finally. Publish-readiness đọc trạng thái
    // level tại thời điểm publish, không phải lúc tạo lesson.
    await prisma.level.update({
      where: { id: levelId },
      data: { status: 'draft' },
    });
    try {
      const draftLesson = await request(app.getHttpServer())
        .post('/api/v1/admin/cms/lessons')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          levelId,
          ...lessonPayload({
            title: 'Draft level lesson',
            slug: `cms-draft-level-${suffix}`,
            orderIndex: 21,
          }),
        })
        .expect(201);
      const draftLessonId = draftLesson.body.data.lesson.id as number;
      const draftRevisionId = draftLesson.body.data.revision.id as number;
      await review('lesson', draftLessonId, draftRevisionId, 'approved');

      // Q89/B3: review ghi audit đủ actor, correlation và tóm tắt sau thao tác.
      const reviewAudit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'lesson.reviewed', targetId: String(draftLessonId) },
        orderBy: { id: 'desc' },
      });
      expect(reviewAudit.actorId).toBe(adminId);
      expect(reviewAudit.correlationId).toBeTruthy();
      expect(reviewAudit.afterSummary).toMatchObject({
        entityType: 'lesson',
        entityId: draftLessonId,
        revision: 1,
        status: 'approved',
      });

      const levelNotPublished = await request(app.getHttpServer())
        .post(
          `/api/v1/admin/cms/lessons/${draftLessonId}/revisions/${draftRevisionId}/publish`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
      expect(levelNotPublished.body.error.code).toBe(
        'LESSON_LEVEL_NOT_PUBLISHED',
      );
      expect(levelNotPublished.body.error.message).toBe(
        'Lesson requires a published, non-deleted parent level.',
      );
    } finally {
      await prisma.level.update({
        where: { id: levelId },
        data: { status: 'published' },
      });
    }
  });

  it('18. returns machine codes for topic 409 conflicts (B2)', async () => {
    const parent = await request(app.getHttpServer())
      .post('/api/v1/admin/cms/lessons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        levelId,
        ...lessonPayload({
          title: 'Topic codes parent',
          slug: `cms-topic-codes-${suffix}`,
          orderIndex: 22,
        }),
      })
      .expect(201);
    const parentId = parent.body.data.lesson.id as number;

    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/cms/topics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ lessonId: parentId, ...topicPayload({ title: 'Codes topic' }) })
      .expect(201);
    const codesTopicId = created.body.data.topic.id as number;
    const codesRevision1Id = created.body.data.revision.id as number;

    // REVIEW_NOT_APPROVED: publish bản mới nhất chưa được duyệt.
    const notApproved = await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/topics/${codesTopicId}/revisions/${codesRevision1Id}/publish`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(notApproved.body.error.code).toBe('REVIEW_NOT_APPROVED');
    expect(notApproved.body.error.message).toBe(
      'The latest review decision must approve this revision.',
    );

    // REVISION_NOT_LATEST: publish bản sửa cũ sau khi có bản sửa mới hơn.
    const revision2 = await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/topics/${codesTopicId}/revisions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(topicPayload({ title: 'Codes topic v2' }))
      .expect(201);
    const codesRevision2Id = revision2.body.data.revision.id as number;
    const stale = await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/topics/${codesTopicId}/revisions/${codesRevision1Id}/publish`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(stale.body.error.code).toBe('REVISION_NOT_LATEST');
    expect(stale.body.error.message).toBe(
      'Only the latest content revision can be used for this action.',
    );

    // CONTENT_ARCHIVED (assertMutableEntity): tạo bản sửa cho topic đã lưu trữ.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/topics/${codesTopicId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const archivedEdit = await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/topics/${codesTopicId}/revisions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(topicPayload({ title: 'Codes topic v3' }))
      .expect(409);
    expect(archivedEdit.body.error.code).toBe('CONTENT_ARCHIVED');
    expect(archivedEdit.body.error.message).toBe(
      'Archived Topic cannot be changed.',
    );

    // CONTENT_ARCHIVED (assertEntityExists): review topic đã lưu trữ.
    const archivedReview = await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/topics/${codesTopicId}/revisions/${codesRevision2Id}/reviews`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'approved' })
      .expect(409);
    expect(archivedReview.body.error.code).toBe('CONTENT_ARCHIVED');
    expect(archivedReview.body.error.message).toBe(
      'Archived content cannot be changed.',
    );
  });

  it('18b. handles a topic without revisions, audits topic reviews and rejects an invalid snapshot (R15)', async () => {
    const parent = await request(app.getHttpServer())
      .post('/api/v1/admin/cms/lessons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        levelId,
        ...lessonPayload({
          title: 'Null revision parent',
          slug: `cms-null-revision-${suffix}`,
          orderIndex: 23,
        }),
      })
      .expect(201);
    const parentId = parent.body.data.lesson.id as number;

    // Nhánh latestRevision null: topic tạo thẳng bằng prisma, không có bản sửa.
    const bare = await prisma.topic.create({
      data: {
        lessonId: parentId,
        title: 'Bare topic',
        type: 'vocabulary',
        content: [{ type: 'text', value: 'No revision.' }],
        orderIndex: 1,
      },
      select: { id: true },
    });
    const lessonDetail = await request(app.getHttpServer())
      .get(`/api/v1/admin/cms/lessons/${parentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const bareItem = (
      lessonDetail.body.data.topics as Array<Record<string, unknown>>
    ).find((topic) => topic.id === bare.id);
    expect(bareItem).toMatchObject({ id: bare.id, latestRevision: null });
    const topicDetail = await request(app.getHttpServer())
      .get(`/api/v1/admin/cms/topics/${bare.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(topicDetail.body.data.revisions).toEqual([]);

    // CONTENT_REVISION_INVALID: bản sửa có snapshot không hợp lệ (chèn thẳng
    // bằng prisma vì API luôn tạo snapshot hợp lệ), được duyệt rồi publish.
    const invalid = await prisma.contentRevision.create({
      data: {
        entityType: 'topic',
        entityId: bare.id,
        revision: 1,
        snapshot: { title: 42 },
        contentHash: 'invalid-snapshot-hash',
        authorId: adminId,
      },
      select: { id: true },
    });
    await review('topic', bare.id, invalid.id, 'approved');

    // Audit topic.reviewed đủ actor, correlation và tóm tắt.
    const reviewAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'topic.reviewed', targetId: String(bare.id) },
      orderBy: { id: 'desc' },
    });
    expect(reviewAudit.actorId).toBe(adminId);
    expect(reviewAudit.correlationId).toBeTruthy();
    expect(reviewAudit.afterSummary).toMatchObject({
      entityType: 'topic',
      entityId: bare.id,
      revision: 1,
      status: 'approved',
    });

    const rejected = await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/topics/${bare.id}/revisions/${invalid.id}/publish`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(rejected.body.error.code).toBe('CONTENT_REVISION_INVALID');
  });

  it('19. rejects stale admin JWT after suspension and anonymization', async () => {
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
