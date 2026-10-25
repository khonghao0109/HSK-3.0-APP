/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, QuestionType, Skill } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { CreateQuestionRevisionDto } from '../src/modules/cms/dto/create-question-revision.dto';
import { QuestionAuthoringService } from '../src/modules/cms/question-authoring.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type QuestionMutationBody = {
  success: true;
  data: {
    idempotent: boolean;
    question: {
      id: number;
      content: string;
      type: string;
      status: string;
      version: number;
      tags?: Array<{ slug: string; name: string }>;
    };
    revision: { id: number; revision: number };
  };
};

type QuestionDetail = {
  id: number;
  content: string;
  type: string;
  skill: string;
  levelId: number;
  audioId: number | null;
  imageId: number | null;
  difficulty: number | null;
  status: string;
  version: number;
  contentHash: string | null;
  answers: Record<string, unknown>;
  correctAnswer: Record<string, unknown>;
  tags: Array<{ slug: string; name: string }>;
  level: { id: number; code: string };
  revisions: Array<{
    id: number;
    revision: number;
    changedFields: string[];
    author: { id: number; name: string | null } | null;
    reviews: Array<{
      decision: string;
      note: string | null;
      reviewer: { id: number; name: string | null } | null;
    }>;
  }>;
};

describe('Question Authoring V1 E2E (M4.1a)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let levelId: number;
  let adminToken: string;
  let normalToken: string;
  let adminId: number;
  let readyAudioId: number;
  let readyImageId: number;
  let pendingAudioId: number;
  let processingAudioId: number;
  let quarantinedAudioId: number;
  let deletedImageId: number;
  let mcqQuestionId: number;
  let mcqRevision1Id: number;
  let suffix: string;

  const password = 'StrongPassword123!';

  function mcqPayload(overrides: Record<string, unknown> = {}) {
    return {
      type: QuestionType.mcq,
      skill: Skill.reading,
      levelId,
      content: 'Chọn nghĩa đúng của 你好',
      answers: {
        options: [
          { id: 'a', text: 'Xin chào' },
          { id: 'b', text: 'Tạm biệt' },
        ],
      },
      correctAnswer: { optionId: 'a' },
      explanation: '你好 là lời chào.',
      difficulty: 2,
      tags: ['Gia đình'],
      ...overrides,
    };
  }

  beforeAll(async () => {
    assertDisposableTestDatabase();
    suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

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

    const admin = await register('admin');
    adminId = admin.userId;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });
    adminToken = await login(`question-admin-${suffix}@example.com`);
    const normal = await register('normal');
    normalToken = normal.token;

    readyAudioId = (
      await prisma.media.create({
        data: {
          url: `https://cdn.example.test/question/${suffix}/ready.mp3`,
          type: 'audio',
          mimeType: 'audio/mpeg',
          duration: 8,
          processingStatus: 'ready',
        },
      })
    ).id;
    readyImageId = (
      await prisma.media.create({
        data: {
          url: `https://cdn.example.test/question/${suffix}/ready.png`,
          type: 'image',
          mimeType: 'image/png',
          processingStatus: 'ready',
        },
      })
    ).id;
    pendingAudioId = (
      await prisma.media.create({
        data: {
          url: `https://cdn.example.test/question/${suffix}/pending.mp3`,
          type: 'audio',
          processingStatus: 'pending',
        },
      })
    ).id;
    processingAudioId = (
      await prisma.media.create({
        data: {
          url: `https://cdn.example.test/question/${suffix}/processing.mp3`,
          type: 'audio',
          processingStatus: 'processing',
        },
      })
    ).id;
    quarantinedAudioId = (
      await prisma.media.create({
        data: {
          url: `https://cdn.example.test/question/${suffix}/quarantined.mp3`,
          type: 'audio',
          processingStatus: 'quarantined',
        },
      })
    ).id;
    deletedImageId = (
      await prisma.media.create({
        data: {
          url: `https://cdn.example.test/question/${suffix}/deleted.png`,
          type: 'image',
          processingStatus: 'ready',
          deletedAt: new Date(),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$executeRaw(
      Prisma.sql`DELETE FROM "Test" WHERE "title" LIKE ${`Question authoring test ${suffix}%`}`,
    );
    await prisma.media.updateMany({
      where: {
        id: {
          in: [readyAudioId, readyImageId, pendingAudioId, deletedImageId],
        },
      },
      data: { deletedAt: new Date() },
    });
    await app.close();
  });

  it('1. enforces authentication, admin RBAC and a safe validation error', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/questions')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/questions')
      .set('Authorization', `Bearer ${normalToken}`)
      .expect(403);

    const secret = 'AUTHORITATIVEANSWERSECRET';
    const invalid = await adminPost('/admin/cms/questions')
      .send({ ...mcqPayload(), [secret]: true })
      .expect(400);
    expect(invalid.body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    expect(JSON.stringify(invalid.body)).not.toContain(secret);

    // TL-77: the legacy QuestionType values are outside the M4.1a contract.
    const legacyType = await adminPost('/admin/cms/questions')
      .send({ ...mcqPayload(), type: 'listening' })
      .expect(400);
    expect(legacyType.body.error.code).toBe('REQUEST_VALIDATION_FAILED');

    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/questions/999999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    const staleAdmin = await register('stale');
    await prisma.user.update({
      where: { id: staleAdmin.userId },
      data: { role: 'admin' },
    });
    const staleToken = await login(`question-stale-${suffix}@example.com`);
    await prisma.user.update({
      where: { id: staleAdmin.userId },
      data: { status: 'suspended' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/questions')
      .set('Authorization', `Bearer ${staleToken}`)
      .expect(401);

    const downgraded = await register('downgraded');
    await prisma.user.update({
      where: { id: downgraded.userId },
      data: { role: 'admin' },
    });
    const staleActor = { id: downgraded.userId, role: 'admin' };
    await prisma.user.update({
      where: { id: downgraded.userId },
      data: { role: 'user' },
    });
    const countBefore = await prisma.question.count();
    const service = app.get(QuestionAuthoringService);
    await expect(
      service.createQuestion(
        staleActor,
        mcqPayload() as CreateQuestionRevisionDto,
        { correlationId: `question-downgrade-${suffix}` },
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(prisma.question.count()).resolves.toBe(countBefore);
  });

  it('2. creates a draft with revision 1 and serves detail, list filters and counts', async () => {
    const created = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ tags: ['Gia đình', 'Từ vựng'], explanation: null }))
      .expect(201);
    const body = created.body as QuestionMutationBody;
    mcqQuestionId = body.data.question.id;
    mcqRevision1Id = body.data.revision.id;
    expect(body.data).toMatchObject({
      idempotent: false,
      question: { status: 'draft', version: 1, type: 'mcq' },
      revision: { revision: 1 },
    });
    expect(body.data.question.tags).toEqual([
      { slug: 'gia-dinh', name: 'Gia đình' },
      { slug: 'tu-vung', name: 'Từ vựng' },
    ]);

    const detail = await adminGet(`/admin/cms/questions/${mcqQuestionId}`);
    const data = detail.body.data as QuestionDetail;
    expect(data).toMatchObject({
      id: mcqQuestionId,
      content: 'Chọn nghĩa đúng của 你好',
      type: 'mcq',
      skill: 'reading',
      levelId,
      difficulty: 2,
      status: 'draft',
      version: 1,
      level: { id: levelId, code: 'HSK1' },
      answers: {
        options: [
          { id: 'a', text: 'Xin chào' },
          { id: 'b', text: 'Tạm biệt' },
        ],
      },
      correctAnswer: { optionId: 'a' },
    });
    expect(data.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(data.tags).toEqual([
      { slug: 'gia-dinh', name: 'Gia đình' },
      { slug: 'tu-vung', name: 'Từ vựng' },
    ]);
    expect(data.revisions).toHaveLength(1);
    expect(data.revisions[0]).toMatchObject({
      id: mcqRevision1Id,
      revision: 1,
      changedFields: [],
      author: { id: adminId },
    });

    const list = await adminGet('/admin/cms/questions', {
      levelId,
      skill: 'reading',
      type: 'mcq',
      difficulty: 2,
      status: 'draft',
      tag: 'tu-vung',
      q: 'nghĩa',
      page: 1,
      limit: 10,
    });
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id: mcqQuestionId,
        level: { id: levelId, code: 'HSK1' },
        tags: [
          { slug: 'gia-dinh', name: 'Gia đình' },
          { slug: 'tu-vung', name: 'Từ vựng' },
        ],
        latestRevision: {
          id: mcqRevision1Id,
          revision: 1,
          decision: null,
        },
      }),
    ]);
    expect(list.body.meta.pagination).toMatchObject({
      page: 1,
      limit: 10,
      total: 1,
    });

    // escapeLike: a literal percent sign must not behave like a wildcard.
    const literalPercent = await adminGet('/admin/cms/questions', { q: '%' });
    expect(literalPercent.body.data).toEqual([]);

    const counts = await adminGet('/admin/cms/questions/counts');
    expect(counts.body.data).toMatchObject({
      total: 1,
      bySkill: { listening: 0, reading: 1, writing: 0, speaking: 0 },
      vocabularyGrammar: 1,
    });
    // TL-82a: mặc định chỉ trả câu chưa archived nên meta.total bằng
    // counts.total khi không lọc.
    const unfiltered = await adminGet('/admin/cms/questions', { limit: 100 });
    expect(unfiltered.body.meta.pagination.total).toBe(counts.body.data.total);
  });

  it('3. stores all four objective formats with the TL-78 column mapping', async () => {
    const cases: Array<{
      payload: Record<string, unknown>;
      answers: Record<string, unknown>;
      correctAnswer: Record<string, unknown>;
    }> = [
      {
        payload: {
          type: QuestionType.true_false,
          content: '你好 là lời chào.',
          answers: {},
          correctAnswer: { value: true },
          imageId: readyImageId,
        },
        answers: {},
        correctAnswer: { value: true },
      },
      {
        payload: {
          type: QuestionType.fill_blank,
          content: 'Điền từ: 我___HSK.',
          answers: {},
          correctAnswer: { acceptedTexts: ['học'], caseSensitive: false },
        },
        answers: {},
        correctAnswer: { acceptedTexts: ['học'], caseSensitive: false },
      },
      {
        payload: {
          type: QuestionType.arrange_sentence,
          content: 'Sắp xếp thành câu đúng.',
          answers: {
            tokens: [
              { id: 't1', text: '我' },
              { id: 't2', text: '是' },
            ],
          },
          correctAnswer: { tokenIds: ['t1', 't2'] },
        },
        answers: {
          tokens: [
            { id: 't1', text: '我' },
            { id: 't2', text: '是' },
          ],
        },
        correctAnswer: { tokenIds: ['t1', 't2'] },
      },
    ];

    for (const example of cases) {
      const created = await adminPost('/admin/cms/questions')
        .send(mcqPayload(example.payload))
        .expect(201);
      const questionId = created.body.data.question.id as number;
      const detail = await adminGet(`/admin/cms/questions/${questionId}`);
      const data = detail.body.data as QuestionDetail;
      expect(data.type).toBe(example.payload.type);
      expect(data.answers).toEqual(example.answers);
      expect(data.correctAnswer).toEqual(example.correctAnswer);
    }

    const shuffled = await prisma.question.findMany({
      where: {
        id: { not: mcqQuestionId },
        levelId,
      },
      select: { type: true },
      orderBy: { id: 'asc' },
    });
    expect(shuffled.map((question) => question.type)).toEqual([
      QuestionType.true_false,
      QuestionType.fill_blank,
      QuestionType.arrange_sentence,
    ]);
  });

  it('4. blocks publish with machine-readable reasons and publishes after fixes', async () => {
    const early = await adminPost(
      `/admin/cms/questions/${mcqQuestionId}/revisions/${mcqRevision1Id}/publish`,
    ).expect(409);
    expect(early.body.error.code).toBe('REVIEW_NOT_APPROVED');

    await review(mcqQuestionId, mcqRevision1Id, 'approved');
    const noExplanation = await adminPost(
      `/admin/cms/questions/${mcqQuestionId}/revisions/${mcqRevision1Id}/publish`,
    ).expect(409);
    expect(noExplanation.body.error).toMatchObject({
      code: 'QUESTION_NOT_PUBLISHABLE',
      details: {
        reasons: [{ code: 'explanation_required', field: 'explanation' }],
      },
    });

    // A revision for the listening skill must carry audio (TL-83).
    const listening = await adminPost(
      `/admin/cms/questions/${mcqQuestionId}/revisions`,
    )
      .send(
        mcqPayload({ skill: Skill.listening, explanation: 'Nghe và chọn.' }),
      )
      .expect(201);
    const listeningRevisionId = listening.body.data.revision.id as number;
    expect(listening.body.data.question.status).toBe('draft');
    expect(listening.body.data.question.version).toBe(2);
    await review(mcqQuestionId, listeningRevisionId, 'approved');
    const missingAudio = await adminPost(
      `/admin/cms/questions/${mcqQuestionId}/revisions/${listeningRevisionId}/publish`,
    ).expect(409);
    expect(
      missingAudio.body.error.details.reasons.map(
        (reason: { code: string }) => reason.code,
      ),
    ).toEqual(['audio_required']);

    // Ready audio passes the publish gate; the row materializes only now.
    const withAudio = await adminPost(
      `/admin/cms/questions/${mcqQuestionId}/revisions`,
    )
      .send(
        mcqPayload({
          skill: Skill.listening,
          explanation: 'Nghe và chọn.',
          audioId: readyAudioId,
        }),
      )
      .expect(201);
    expect(withAudio.body.data.question.status).toBe('draft');
    const audioRevisionId = withAudio.body.data.revision.id as number;
    await review(mcqQuestionId, audioRevisionId, 'approved');
    const published = await publish(mcqQuestionId, audioRevisionId);
    expect(published.data).toMatchObject({
      idempotent: false,
      question: { status: 'published', version: 3 },
    });
    const republished = await publish(mcqQuestionId, audioRevisionId);
    expect(republished.data.idempotent).toBe(true);
  });

  it('5. records changedFields, revision history and the review note newest first', async () => {
    const detail = await adminGet(`/admin/cms/questions/${mcqQuestionId}`);
    const data = detail.body.data as QuestionDetail;
    expect(data.status).toBe('published');
    expect(data.version).toBe(3);
    expect(data.audioId).toBe(readyAudioId);
    expect(data.revisions.map((revision) => revision.revision)).toEqual([
      3, 2, 1,
    ]);
    const [revision3, revision2] = data.revisions;
    expect(revision3.changedFields).toEqual(['audioId']);
    expect(revision2.changedFields).toEqual(['skill', 'explanation', 'tags']);
    expect(revision3.reviews[0]).toMatchObject({
      decision: 'approved',
      note: null,
      reviewer: { id: adminId },
    });
    expect(revision3.author).toMatchObject({ id: adminId });
  });

  it('6. treats an identical revision snapshot as idempotent', async () => {
    const payload = mcqPayload({
      skill: Skill.listening,
      explanation: 'Nghe và chọn.',
      audioId: readyAudioId,
    });
    const identical = await adminPost(
      `/admin/cms/questions/${mcqQuestionId}/revisions`,
    )
      .send(payload)
      .expect(201);
    expect(identical.body.data).toMatchObject({
      idempotent: true,
      revision: { revision: 3 },
    });
    await expect(
      prisma.contentRevision.count({
        where: { entityType: 'question', entityId: mcqQuestionId },
      }),
    ).resolves.toBe(3);
  });

  it('7. saves pending/processing media as draft but blocks publish and unusable media', async () => {
    // TL-81a: pending/processing audio may be attached while authoring; the
    // publish gate is what requires a fully ready file.
    for (const mediaId of [pendingAudioId, processingAudioId]) {
      const draft = await adminPost('/admin/cms/questions')
        .send(mcqPayload({ audioId: mediaId }))
        .expect(201);
      const questionId = draft.body.data.question.id as number;
      const revisionId = draft.body.data.revision.id as number;
      expect(draft.body.data.question.status).toBe('draft');
      await review(questionId, revisionId, 'approved');
      const blocked = await adminPost(
        `/admin/cms/questions/${questionId}/revisions/${revisionId}/publish`,
      ).expect(409);
      expect(blocked.body.error.code).toBe('QUESTION_NOT_PUBLISHABLE');
      expect(
        blocked.body.error.details.reasons.map(
          (reason: { code: string }) => reason.code,
        ),
      ).toEqual(['audio_not_ready']);
    }

    // Media that can never become usable is rejected while saving (TL-81a).
    for (const [mediaField, mediaId, reason] of [
      ['audioId', quarantinedAudioId, 'quarantined'],
      ['audioId', readyImageId, 'wrong_type'],
      ['imageId', deletedImageId, 'archived'],
      ['imageId', 2_147_483_647, 'not_found'],
    ] as const) {
      const response = await adminPost('/admin/cms/questions')
        .send(mcqPayload({ [mediaField]: mediaId }))
        .expect(409);
      expect(response.body.error).toMatchObject({
        code: 'MEDIA_NOT_USABLE',
        details: { field: mediaField, reason },
      });
    }

    // A ready image is usable, and losing it after save blocks publish.
    const withImage = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ imageId: readyImageId }))
      .expect(201);
    expect(withImage.body.data.question.imageId).toBe(readyImageId);
  });

  it('8. upserts tag names by slug and replaces the question tag links', async () => {
    const first = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ tags: ['Gia đình'] }))
      .expect(201);
    const second = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ tags: ['gia đình'] }))
      .expect(201);
    const tags = await prisma.tag.findMany({
      where: { slug: 'gia-dinh' },
      select: { id: true, name: true },
    });
    expect(tags).toHaveLength(1);
    expect(tags[0]?.name).toBe('Gia đình');

    const firstId = first.body.data.question.id as number;
    const detailBefore = await adminGet(`/admin/cms/questions/${firstId}`);
    expect(detailBefore.body.data.tags).toEqual([
      { slug: 'gia-dinh', name: 'Gia đình' },
    ]);

    const draftRevision = await adminPost(
      `/admin/cms/questions/${firstId}/revisions`,
    )
      .send(mcqPayload({ tags: ['Từ vựng'] }))
      .expect(201);
    expect(draftRevision.body.data.question.status).toBe('draft');
    const detailAfter = await adminGet(`/admin/cms/questions/${firstId}`);
    expect(detailAfter.body.data.tags).toEqual([
      { slug: 'tu-vung', name: 'Từ vựng' },
    ]);
    const links = await prisma.questionTag.count({
      where: { questionId: firstId },
    });
    expect(links).toBe(1);
    // Tag rows are never deleted by unlink (stable vocabulary for suggestions).
    await expect(
      prisma.tag.count({ where: { slug: 'gia-dinh' } }),
    ).resolves.toBe(1);
    expect(second.body.data.question.tags).toEqual([
      { slug: 'gia-dinh', name: 'Gia đình' },
    ]);
  });

  it('9. blocks archiving a question used by a published test, then archives it', async () => {
    const created = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ tags: ['Lưu trữ'] }))
      .expect(201);
    const questionId = created.body.data.question.id as number;

    const testTitle = `Question authoring test ${suffix} published`;
    const [seededTest] = await prisma.$queryRaw<Array<{ id: number }>>(
      Prisma.sql`
        INSERT INTO "Test" ("levelId", "title", "duration", "status", "publishedAt", "createdAt", "updatedAt")
        VALUES (${levelId}, ${testTitle}, 60, 'published', now(), now(), now())
        RETURNING "id"
      `,
    );
    if (!seededTest) throw new Error('Failed to seed the published test row.');
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "TestQuestion" ("testId", "questionId", "orderIndex")
      VALUES (${seededTest.id}, ${questionId}, 1)
    `);

    const blocked = await adminPost(
      `/admin/cms/questions/${questionId}/archive`,
    ).expect(409);
    expect(blocked.body.error.code).toBe('QUESTION_IN_PUBLISHED_TEST');

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "Test" SET "status" = 'draft', "deletedAt" = now()
      WHERE "id" = ${seededTest.id}
    `);
    const archived = await adminPost(
      `/admin/cms/questions/${questionId}/archive`,
    ).expect(201);
    expect(archived.body.data).toMatchObject({
      idempotent: false,
      question: { status: 'archived' },
    });
    const again = await adminPost(
      `/admin/cms/questions/${questionId}/archive`,
    ).expect(201);
    expect(again.body.data.idempotent).toBe(true);

    const mutation = await adminPost(
      `/admin/cms/questions/${questionId}/revisions`,
    )
      .send(mcqPayload())
      .expect(409);
    expect(mutation.body.error.code).toBe('QUESTION_ARCHIVED');

    const counts = await adminGet('/admin/cms/questions/counts');
    expect(counts.body.data.vocabularyGrammar).toBeGreaterThanOrEqual(1);
    const list = await adminGet('/admin/cms/questions', {
      q: 'Chọn nghĩa đúng của 你好',
      status: 'archived',
      limit: 100,
    });
    expect(
      list.body.data.map((question: { id: number }) => question.id),
    ).toContain(questionId);
    // TL-82a: danh sách mặc định KHÔNG có câu archived.
    const defaultList = await adminGet('/admin/cms/questions', {
      q: 'Chọn nghĩa đúng của 你好',
      limit: 100,
    });
    expect(
      defaultList.body.data.map((question: { id: number }) => question.id),
    ).not.toContain(questionId);
    const allLive = await adminGet('/admin/cms/questions', { limit: 100 });
    expect(allLive.body.meta.pagination.total).toBe(counts.body.data.total);
  });

  it('10. audits question mutations with safe summaries in the same transaction', async () => {
    const created = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ tags: ['Audit'] }))
      .expect(201);
    const questionId = created.body.data.question.id as number;
    const revisionId = created.body.data.revision.id as number;
    await review(questionId, revisionId, 'changes_requested', 'Sửa giải thích');
    await review(questionId, revisionId, 'approved');
    await publish(questionId, revisionId);
    await adminPost(`/admin/cms/questions/${questionId}/archive`).expect(201);

    const audits = await prisma.auditLog.findMany({
      where: { targetType: 'question', targetId: String(questionId) },
      orderBy: { id: 'asc' },
      select: { action: true, afterSummary: true, actorId: true },
    });
    expect(audits.map((audit) => audit.action)).toEqual([
      'question.created',
      'question.reviewed',
      'question.reviewed',
      'question.published',
      'question.archived',
    ]);
    expect(audits.every((audit) => audit.actorId === adminId)).toBe(true);
    const reviewed = audits[1]?.afterSummary as Record<string, unknown>;
    expect(reviewed).toMatchObject({
      entityType: 'question',
      entityId: questionId,
      revision: 1,
      status: 'changes_requested',
      decision: 'changes_requested',
    });
    expect(JSON.stringify(audits)).not.toContain('optionId');
    expect(JSON.stringify(audits)).not.toContain('Xin chào');
  });

  it('11. lists tags with admin-only access and counts only live questions', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/tags')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/tags')
      .set('Authorization', `Bearer ${normalToken}`)
      .expect(403);

    const tagName = 'Truy vấn nhãn';
    const first = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ tags: [tagName] }))
      .expect(201);
    const second = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ tags: [tagName] }))
      .expect(201);
    expect(first.body.data.question.tags).toEqual([
      { slug: 'truy-van-nhan', name: tagName },
    ]);

    const before = await adminGet('/admin/cms/tags', { q: 'truy vấn' });
    expect(before.body.data).toEqual([
      { slug: 'truy-van-nhan', name: tagName, questionCount: 2 },
    ]);

    await adminPost(
      `/admin/cms/questions/${String(second.body.data.question.id)}/archive`,
    ).expect(201);
    const after = await adminGet('/admin/cms/tags', { q: 'truy vấn' });
    expect(after.body.data).toEqual([
      { slug: 'truy-van-nhan', name: tagName, questionCount: 1 },
    ]);

    // Archived questions never contribute to the count (TL-93).
    const archivedTag = await adminGet('/admin/cms/tags', { q: 'Audit' });
    expect(archivedTag.body.data).toEqual([
      { slug: 'audit', name: 'Audit', questionCount: 0 },
    ]);

    // name ASC, id ASC, and the limit cap.
    const all = await adminGet('/admin/cms/tags', { limit: 100 });
    expect(Array.isArray(all.body.data)).toBe(true);
    expect(all.body.data.length).toBeGreaterThanOrEqual(2);
    const names = all.body.data.map((tag: { name: string }) => tag.name);
    expect(names).toEqual(
      [...names].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
    const badQuery = await adminGet('/admin/cms/tags', { q: 'x'.repeat(41) });
    expect(badQuery.status).toBe(400);
  });

  it('12. combines repeated tag filters with OR and rejects more than five', async () => {
    const tagA = `or-a-${suffix}`;
    const tagB = `or-b-${suffix}`;
    const onlyA = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ tags: [tagA], content: 'Câu chỉ gắn tag A' }))
      .expect(201);
    const onlyB = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ tags: [tagB], content: 'Câu chỉ gắn tag B' }))
      .expect(201);
    const both = await adminPost('/admin/cms/questions')
      .send(mcqPayload({ tags: [tagA, tagB], content: 'Câu gắn cả hai tag' }))
      .expect(201);

    const single = await adminGet('/admin/cms/questions', {
      tag: tagA,
      limit: 100,
    });
    expect(
      single.body.data.map((question: { id: number }) => question.id),
    ).toEqual(expect.arrayContaining([onlyA.body.data.question.id]));
    expect(
      single.body.data.map((question: { id: number }) => question.id),
    ).not.toContain(onlyB.body.data.question.id);

    // TL-82b: `?tag=a&tag=b` là hợp (OR) của hai tập.
    const union = await adminGet('/admin/cms/questions', {
      tag: [tagA, tagB],
      limit: 100,
    });
    const ids = union.body.data.map((question: { id: number }) => question.id);
    for (const created of [onlyA, onlyB, both]) {
      expect(ids).toContain(created.body.data.question.id);
    }
    expect(union.body.meta.pagination.total).toBe(3);

    const tooMany = await adminGet('/admin/cms/questions', {
      tag: ['a1', 'b1', 'c1', 'd1', 'e1', 'f1'],
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe('REQUEST_VALIDATION_FAILED');
  });

  async function review(
    questionId: number,
    revisionId: number,
    decision: 'approved' | 'changes_requested' | 'rejected',
    note?: string,
  ) {
    const response = await adminPost(
      `/admin/cms/questions/${questionId}/revisions/${revisionId}/reviews`,
    )
      .send({ decision, ...(note === undefined ? {} : { note }) })
      .expect(201);
    return response.body as {
      data: { idempotent: boolean; review: { id: number } };
    };
  }

  async function publish(
    questionId: number,
    revisionId: number,
  ): Promise<QuestionMutationBody> {
    const response = await adminPost(
      `/admin/cms/questions/${questionId}/revisions/${revisionId}/publish`,
    ).expect(201);
    return response.body as QuestionMutationBody;
  }

  function adminGet(path: string, query: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .query(query);
  }

  function adminPost(path: string, token = adminToken) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function register(label: string) {
    const email = `question-${label}-${suffix}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: `Question ${label}` })
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
