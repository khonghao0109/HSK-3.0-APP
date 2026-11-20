/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * Block `grammar_point`/`dialogue` của `Topic.content`: CMS kiểm khi tạo,
 * tạo bản sửa và publish (422 `topic_content_invalid` + path); nội dung hợp lệ
 * tới học viên nguyên văn qua `/learning/lessons/:id/activity`.
 */
describe('CMS topic content blocks E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let levelId: number;
  let adminId: number;
  let adminToken: string;
  let learnerToken: string;
  const lessonIds: number[] = [];

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const password = 'StrongPassword123!';

  const grammarPoints = [
    {
      type: 'grammar_point',
      title: 'Câu khẳng định với 是',
      formula: [
        { role: 'subj', zh: '我', vi: 'tôi' },
        { role: 'key', zh: '是', vi: 'là' },
        { role: 'other', zh: '学生', vi: 'học sinh' },
      ],
      explanation: 'Chủ ngữ + 是 + danh từ.',
      examples: [
        {
          hanzi: '我是学生。',
          pinyin: 'Wǒ shì xuésheng.',
          vi: 'Tôi là học sinh.',
          highlight: '是',
        },
      ],
    },
    {
      type: 'grammar_point',
      title: 'Câu hỏi với 吗',
      formula: [
        { role: 'other', zh: 'câu trần thuật', vi: 'mệnh đề' },
        { role: 'key', zh: '吗', vi: 'không?' },
      ],
      explanation: 'Thêm 吗 vào cuối câu trần thuật để hỏi.',
      examples: [
        {
          hanzi: '你是老师吗？',
          pinyin: 'Nǐ shì lǎoshī ma?',
          vi: 'Bạn là giáo viên à?',
          highlight: null,
        },
        { hanzi: '你好吗？', pinyin: 'Nǐ hǎo ma?', vi: 'Bạn khỏe không?' },
      ],
    },
  ];
  const invalidGrammarPoint = {
    ...grammarPoints[0],
    examples: [{ ...grammarPoints[0].examples[0], highlight: '很' }],
  };

  const topicPayload = (overrides: Record<string, unknown> = {}) => ({
    title: 'Ngữ pháp bài 1',
    subtitle: null,
    type: 'grammar',
    content: grammarPoints,
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

    // Level codes are fixed by Level_code_band_check: the lessons go to
    // HSK 7–9, upserted published as dictionary-search.e2e-spec does.
    const level = await prisma.level.upsert({
      where: { code: 'HSK7_9' },
      update: { status: 'published', deletedAt: null },
      create: {
        code: 'HSK7_9',
        name: `HSK 7-9 ${suffix}`,
        orderIndex: 7,
        minBand: 7,
        maxBand: 9,
        curriculumVersion: 'HSK_3_0',
        status: 'published',
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    levelId = level.id;

    const adminEmail = `topic-content-admin-${suffix}@example.com`;
    const admin = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: adminEmail, password, name: 'Topic Content Admin' })
      .expect(201);
    adminId = admin.body.data.user.id as number;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password })
      .expect(201);
    adminToken = login.body.data.accessToken as string;

    const learner = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `topic-content-learner-${suffix}@example.com`,
        password,
        name: 'Topic Content Learner',
      })
      .expect(201);
    learnerToken = learner.body.data.accessToken as string;
  });

  afterAll(async () => {
    // Ẩn bài đã publish để không lọt vào kiểm tra nội dung public của spec khác.
    for (const lessonId of lessonIds) {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/cms/lessons/${lessonId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`);
    }
    await app.close();
  });

  it('1. publishes a grammar topic with grammar_point blocks and serves them verbatim', async () => {
    const lessonId = await createLesson(1);
    const created = await createTopic({ lessonId, ...topicPayload() }).expect(
      201,
    );
    const topicId = created.body.data.topic.id as number;
    await reviewAndPublish(
      'topic',
      topicId,
      created.body.data.revision.id as number,
    );
    await publishLesson(lessonId);

    const activity = await request(app.getHttpServer())
      .get(`/api/v1/learning/lessons/${lessonId}/activity`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(200);
    const topic = (
      activity.body.data.topics as Array<{ id: number; content: unknown }>
    ).find((candidate) => candidate.id === topicId);
    expect(topic?.content).toEqual(grammarPoints);
  });

  it('2. rejects an invalid grammar_point on create with 422 and a path', async () => {
    const lessonId = await createLesson(2);
    const response = await createTopic({
      lessonId,
      ...topicPayload({ content: [grammarPoints[0], invalidGrammarPoint] }),
    }).expect(422);
    expect(response.body.error.code).toBe('topic_content_invalid');
    expect(response.body.error.details.path).toBe(
      'content[1].examples[0].highlight',
    );

    const mismatch = await createTopic({
      lessonId,
      ...topicPayload({ type: 'vocabulary' }),
    }).expect(422);
    expect(mismatch.body.error.code).toBe('topic_content_invalid');
    expect(mismatch.body.error.details.path).toBe('content[0].type');
    await expect(prisma.topic.count({ where: { lessonId } })).resolves.toBe(0);
  });

  it('3. rejects publishing a stored revision whose snapshot has an invalid block', async () => {
    const lessonId = await createLesson(3);
    const created = await createTopic({ lessonId, ...topicPayload() }).expect(
      201,
    );
    const topicId = created.body.data.topic.id as number;
    // API luôn chặn block sai, nên chèn thẳng bản sửa như dữ liệu lưu trước luật.
    const stored = await prisma.contentRevision.create({
      data: {
        entityType: 'topic',
        entityId: topicId,
        revision: 2,
        snapshot: topicPayload({ content: [invalidGrammarPoint] }),
        contentHash: `invalid-topic-block-${suffix}`,
        authorId: adminId,
      },
      select: { id: true },
    });
    await review('topic', topicId, stored.id);

    const rejected = await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/topics/${topicId}/revisions/${stored.id}/publish`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(422);
    expect(rejected.body.error.code).toBe('topic_content_invalid');
    expect(rejected.body.error.details.path).toBe(
      'content[0].examples[0].highlight',
    );
    const topic = await prisma.topic.findUniqueOrThrow({
      where: { id: topicId },
      select: { status: true },
    });
    expect(topic.status).toBe('draft');
  });

  it('4. still creates and publishes a topic with only text blocks', async () => {
    const lessonId = await createLesson(4);
    const textOnly = [{ type: 'text', value: 'Ready to learn.' }];
    const created = await createTopic({
      lessonId,
      ...topicPayload({ type: 'vocabulary', content: textOnly }),
    }).expect(201);
    const published = await reviewAndPublish(
      'topic',
      created.body.data.topic.id as number,
      created.body.data.revision.id as number,
    );
    expect(published.body.data.topic).toMatchObject({
      status: 'published',
      content: textOnly,
    });
  });

  // A shared level: lesson order far from other suites' lessons.
  const orderBase = 100_000 + Math.floor(Math.random() * 800_000);

  async function createLesson(index: number): Promise<number> {
    const orderIndex = orderBase + index;
    const response = await request(app.getHttpServer())
      .post('/api/v1/admin/cms/lessons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        levelId,
        title: `Topic content ${orderIndex}`,
        description: 'Grammar blocks',
        orderIndex,
        slug: `topic-content-${orderIndex}-${suffix}`,
      })
      .expect(201);
    const lessonId = response.body.data.lesson.id as number;
    lessonIds.push(lessonId);
    return lessonId;
  }

  function createTopic(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/v1/admin/cms/topics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);
  }

  async function publishLesson(lessonId: number) {
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/cms/lessons/${lessonId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const revisionId = detail.body.data.revisions[0].id as number;
    await reviewAndPublish('lesson', lessonId, revisionId);
  }

  async function review(
    entityType: 'lesson' | 'topic',
    entityId: number,
    revisionId: number,
  ) {
    await request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/${entityType}s/${entityId}/revisions/${revisionId}/reviews`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'approved' })
      .expect(201);
  }

  async function reviewAndPublish(
    entityType: 'lesson' | 'topic',
    entityId: number,
    revisionId: number,
  ) {
    await review(entityType, entityId, revisionId);
    return request(app.getHttpServer())
      .post(
        `/api/v1/admin/cms/${entityType}s/${entityId}/revisions/${revisionId}/publish`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
  }
});
