/// <reference types="jest" />

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ContentStatus, Prisma, QuestionType, Skill } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type AdminTestQuestionData = {
  questionId: number;
  orderIndex: number;
  type: string;
  skill: string;
  levelId: number;
  difficulty: number | null;
  status: string;
  content: string;
};

type AdminTestGroupData = {
  id: number;
  title: string | null;
  instruction: string | null;
  audioId: number | null;
  imageId: number | null;
  orderIndex: number;
  questions: AdminTestQuestionData[];
};

type AdminTestSectionData = {
  id: number;
  skill: string;
  title: string;
  instruction: string | null;
  orderIndex: number;
  questionCount: number;
  groups: AdminTestGroupData[];
};

type AdminTestData = {
  id: number;
  levelId: number;
  levelCode: string;
  title: string;
  instruction: string | null;
  duration: number;
  passScore: number | null;
  maxScore: number;
  status: string;
  version: number;
  sectionCount: number;
  questionCount: number;
  skills: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

type AdminTestDetailData = AdminTestData & {
  sections: AdminTestSectionData[];
};

type StructureGroupInput = {
  title?: string | null;
  instruction?: string | null;
  audioId?: number | null;
  imageId?: number | null;
  questionIds: number[];
};

type StructureSectionInput = {
  skill: Skill;
  title: string;
  instruction?: string | null;
  groups: StructureGroupInput[];
};

type CreateTestInput = {
  levelId?: number;
  title?: string;
  instruction?: string | null;
  duration?: number;
  passScore?: number | null;
};

const POSTGRESQL_INT4_MAX = 2_147_483_647;

// The documented admin Test shapes (TL-94). `AdminTestDetailDto` adds sections.
const ADMIN_TEST_KEYS = [
  'createdAt',
  'duration',
  'id',
  'instruction',
  'levelCode',
  'levelId',
  'maxScore',
  'passScore',
  'publishedAt',
  'questionCount',
  'sectionCount',
  'skills',
  'status',
  'title',
  'updatedAt',
  'version',
];
const ADMIN_TEST_DETAIL_KEYS = [...ADMIN_TEST_KEYS, 'sections'].sort();

describe('Test Builder V1 E2E (M4.1b / TL-102)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let suffix: string;
  let adminToken: string;
  let learnerToken: string;
  let adminId: number;
  let testLevelId: number;
  let otherLevelId: number;
  let readyAudioId: number;
  let readyImageId: number;
  let pendingAudioId: number;
  let pendingImageId: number;
  let deletedAudioId: number;
  let qReading1Id: number;
  let qReading2Id: number;
  let qListening1Id: number;
  let qOtherLevelId: number;
  let qDraftId: number;
  let publishedTestId: number;

  const createdTestIds: number[] = [];
  const createdQuestionIds: number[] = [];
  const createdMediaIds: number[] = [];
  const password = 'StrongPassword123!';

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

    // Q116 isolation: the M4.1a spec asserts counts over HSK1, so this spec
    // owns HSK2/HSK3 and archives everything it creates in afterAll.
    testLevelId = await upsertLevel('HSK2', 2);
    otherLevelId = await upsertLevel('HSK3', 3);

    const admin = await register('admin');
    adminId = admin.userId;
    await prisma.user.update({
      where: { id: adminId },
      data: { role: 'admin' },
    });
    adminToken = await login(`test-builder-admin-${suffix}@example.com`);
    learnerToken = (await register('learner')).token;

    readyAudioId = await seedMedia('ready.mp3', 'audio', 'ready');
    readyImageId = await seedMedia('ready.png', 'image', 'ready');
    pendingAudioId = await seedMedia('pending.mp3', 'audio', 'pending');
    pendingImageId = await seedMedia('pending.png', 'image', 'pending');
    deletedAudioId = await seedMedia('deleted.mp3', 'audio', 'ready', {
      deletedAt: new Date(),
    });

    qReading1Id = await createPublishedQuestion({
      content: 'Câu đọc hiểu thứ nhất của test builder',
    });
    qReading2Id = await createPublishedQuestion({
      content: 'Câu đọc hiểu thứ hai của test builder',
    });
    qListening1Id = await createPublishedQuestion({
      skill: Skill.listening,
      audioId: readyAudioId,
      explanation: 'Nghe đoạn hội thoại rồi chọn đáp án.',
      content: 'Câu nghe hiểu của test builder',
    });
    qOtherLevelId = await createPublishedQuestion({
      levelId: otherLevelId,
      content: 'Câu đọc hiểu cấp HSK3 dùng cho level mismatch',
    });
    qDraftId = (
      await createDraftQuestion({
        content: 'Câu nháp chưa publish của test builder',
      })
    ).questionId;
  });

  afterAll(async () => {
    // FK order is Restrict: placement -> TestQuestion -> group -> section -> test.
    const ids = [...new Set(createdTestIds)];
    if (ids.length > 0) {
      await prisma.testQuestionPlacement.deleteMany({
        where: { testId: { in: ids } },
      });
      await prisma.testQuestion.deleteMany({ where: { testId: { in: ids } } });
      await prisma.questionGroup.deleteMany({ where: { testId: { in: ids } } });
      await prisma.testSection.deleteMany({ where: { testId: { in: ids } } });
      await prisma.test.deleteMany({ where: { id: { in: ids } } });
    }
    // ContentReview rows are immutable by trigger, so questions are archived
    // (never deleted) to keep them out of live-count assertions.
    const questionIds = [...new Set(createdQuestionIds)];
    if (questionIds.length > 0) {
      await prisma.question.updateMany({
        where: { id: { in: questionIds } },
        data: { status: ContentStatus.archived, deletedAt: new Date() },
      });
    }
    const mediaIds = [...new Set(createdMediaIds)];
    if (mediaIds.length > 0) {
      await prisma.media.updateMany({
        where: { id: { in: mediaIds } },
        data: { deletedAt: new Date() },
      });
    }
    if (app) await app.close();
  });

  it('1. enforces admin RBAC and Cache-Control no-store on all eight test routes', async () => {
    const probe = await createTest({ title: testTitle('rbac probe') });
    const testId = probe.id;

    // 401 without a token and 403 with a learner token, on every endpoint.
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/tests')
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/cms/tests')
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/cms/tests/${String(testId)}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/cms/tests/${String(testId)}`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/tests')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/admin/cms/tests')
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/cms/tests/${String(testId)}`)
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/cms/tests/${String(testId)}`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/v1/admin/cms/tests/${String(testId)}/structure`)
      .expect(401);
    await request(app.getHttpServer())
      .put(`/api/v1/admin/cms/tests/${String(testId)}/structure`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/tests/${String(testId)}/publish`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/tests/${String(testId)}/publish`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/tests/${String(testId)}/archive`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/tests/${String(testId)}/archive`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/tests/${String(testId)}/duplicate`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/cms/tests/${String(testId)}/duplicate`)
      .set('Authorization', `Bearer ${learnerToken}`)
      .expect(403);

    // `Cache-Control: no-store` belongs to every successful-or-domain-error
    // admin response, so it is asserted against the authorized calls.
    const list = await adminGet('/admin/cms/tests', { limit: 1 }).expect(200);
    expectNoStore(list);
    const created = await adminPost('/admin/cms/tests')
      .send({
        levelId: testLevelId,
        title: testTitle('rbac created'),
        duration: 30,
      })
      .expect(201);
    createdTestIds.push(created.body.data.id as number);
    expectNoStore(created);
    const read = await adminGet(`/admin/cms/tests/${String(testId)}`).expect(
      200,
    );
    expectNoStore(read);
    const shadow = await createTest({ title: testTitle('rbac shadow') });
    expectNoStore(
      await adminPatch(`/admin/cms/tests/${String(shadow.id)}`)
        .send({
          expectedUpdatedAt: shadow.updatedAt,
          title: testTitle('rbac shadow patched'),
        })
        .expect(200),
    );
    const shadowPatched = await adminGet(
      `/admin/cms/tests/${String(shadow.id)}`,
    ).expect(200);
    const structure = await putStructure(
      shadow.id,
      shadowPatched.body.data.updatedAt as string,
      [],
    ).expect(200);
    expectNoStore(structure);
    const blockedPublish = await adminPost(
      `/admin/cms/tests/${String(shadow.id)}/publish`,
    )
      .send({ expectedUpdatedAt: structure.body.data.updatedAt })
      .expect(409);
    expect(blockedPublish.body.error.code).toBe('TEST_NOT_PUBLISHABLE');
    expectNoStore(blockedPublish);
    const archived = await adminPost(
      `/admin/cms/tests/${String(shadow.id)}/archive`,
    )
      .send({})
      .expect(201);
    expectNoStore(archived);
    const duplicated = await adminPost(
      `/admin/cms/tests/${String(shadow.id)}/duplicate`,
    )
      .send({})
      .expect(201);
    createdTestIds.push(duplicated.body.data.id as number);
    expect(duplicated.body.data.status).toBe('draft');
    expectNoStore(duplicated);

    // Missing tests answer 404 rather than 400/500.
    await adminGet('/admin/cms/tests/999999999').expect(404);
  });

  it('2. creates, reads and patches metadata under optimistic concurrency', async () => {
    const detail = await createTest({
      title: testTitle('meta'),
      instruction: 'Làm bài cẩn thận',
      duration: 90,
      passScore: 60,
    });
    expect(Object.keys(detail).sort()).toEqual(ADMIN_TEST_DETAIL_KEYS);
    expect(detail).toMatchObject({
      levelId: testLevelId,
      levelCode: 'HSK2',
      title: testTitle('meta'),
      instruction: 'Làm bài cẩn thận',
      duration: 90,
      passScore: 60,
      maxScore: 0,
      status: 'draft',
      version: 1,
      sectionCount: 0,
      questionCount: 0,
      skills: [],
      publishedAt: null,
    });
    expect(detail.sections).toEqual([]);
    expect(new Date(detail.updatedAt).getTime()).toBeGreaterThan(0);

    const read = await adminGet(`/admin/cms/tests/${String(detail.id)}`).expect(
      200,
    );
    expect(read.body.data).toEqual(detail);

    const originalUpdatedAt = detail.updatedAt;
    await sleep(20);
    const patched = await adminPatch(`/admin/cms/tests/${String(detail.id)}`)
      .send({
        expectedUpdatedAt: originalUpdatedAt,
        title: testTitle('meta patched'),
        duration: 120,
        passScore: 75,
      })
      .expect(200);
    expect(patched.body.data).toMatchObject({
      title: testTitle('meta patched'),
      duration: 120,
      passScore: 75,
      status: 'draft',
      version: 1,
    });
    // The mutation moved the concurrency token, so the old one is now stale.
    expect(patched.body.data.updatedAt).not.toBe(originalUpdatedAt);

    const stale = await adminPatch(`/admin/cms/tests/${String(detail.id)}`)
      .send({
        expectedUpdatedAt: originalUpdatedAt,
        title: testTitle('meta stale'),
      })
      .expect(409);
    expect(stale.body.error.code).toBe('TEST_CONCURRENT_UPDATE');

    const currentUpdatedAt = patched.body.data.updatedAt as string;
    await sleep(20);
    const cleared = await adminPatch(`/admin/cms/tests/${String(detail.id)}`)
      .send({
        expectedUpdatedAt: currentUpdatedAt,
        passScore: null,
        instruction: null,
      })
      .expect(200);
    expect(cleared.body.data.passScore).toBeNull();
    expect(cleared.body.data.instruction).toBeNull();

    const clearedUpdatedAt = cleared.body.data.updatedAt as string;
    const badLevel = await adminPatch(`/admin/cms/tests/${String(detail.id)}`)
      .send({
        expectedUpdatedAt: clearedUpdatedAt,
        levelId: POSTGRESQL_INT4_MAX,
      })
      .expect(422);
    expect(badLevel.body.error.code).toBe('level_not_found');
    expect(badLevel.body.error.details).toEqual({ path: 'levelId' });

    const badCreate = await adminPost('/admin/cms/tests')
      .send({
        levelId: POSTGRESQL_INT4_MAX,
        title: testTitle('bad level'),
        duration: 30,
      })
      .expect(422);
    expect(badCreate.body.error.details.path).toBe('levelId');

    for (const duration of [0, 301]) {
      const invalid = await adminPost('/admin/cms/tests')
        .send({
          levelId: testLevelId,
          title: testTitle(`duration ${String(duration)}`),
          duration,
        })
        .expect(400);
      expect(invalid.body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    }
    const invalidPatch = await adminPatch(
      `/admin/cms/tests/${String(detail.id)}`,
    )
      .send({ expectedUpdatedAt: clearedUpdatedAt, duration: 0 })
      .expect(400);
    expect(invalidPatch.body.error.code).toBe('REQUEST_VALIDATION_FAILED');

    const emptyTitle = await adminPost('/admin/cms/tests')
      .send({ levelId: testLevelId, title: '   ', duration: 30 })
      .expect(400);
    expect(emptyTitle.body.error.code).toBe('REQUEST_VALIDATION_FAILED');

    // H1: levelId/title/duration reject null while passScore/instruction clear.
    for (const field of ['levelId', 'title', 'duration'] as const) {
      const before = await adminGet(
        `/admin/cms/tests/${String(detail.id)}`,
      ).expect(200);
      const rejectedNull = await adminPatch(
        `/admin/cms/tests/${String(detail.id)}`,
      )
        .send({ expectedUpdatedAt: clearedUpdatedAt, [field]: null })
        .expect(400);
      expect(rejectedNull.body.error.code).toBe('REQUEST_VALIDATION_FAILED');
      const after = await adminGet(
        `/admin/cms/tests/${String(detail.id)}`,
      ).expect(200);
      expect(after.body.data).toEqual(before.body.data);
    }
  });

  it('3. replaces the structure tree, keeps global order and churns section/group ids', async () => {
    const test = await createTest({
      title: testTitle('structure'),
      duration: 45,
    });

    const firstPut = await putStructure(test.id, test.updatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc hiểu',
        instruction: 'Đọc đoạn văn rồi chọn đáp án.',
        groups: [
          { title: 'Nhóm đọc 1', questionIds: [qReading1Id] },
          {
            title: null,
            instruction: 'Nhóm không tiêu đề',
            questionIds: [qReading2Id],
          },
        ],
      },
      {
        skill: Skill.listening,
        title: 'Nghe hiểu',
        groups: [
          {
            title: 'Nhóm nghe',
            audioId: readyAudioId,
            questionIds: [qListening1Id],
          },
        ],
      },
    ]).expect(200);
    const first = firstPut.body.data as AdminTestDetailData;

    expect(Object.keys(first).sort()).toEqual(ADMIN_TEST_DETAIL_KEYS);
    expect(first).toMatchObject({
      id: test.id,
      title: testTitle('structure'),
      levelId: testLevelId,
      status: 'draft',
      sectionCount: 2,
      questionCount: 3,
      maxScore: 200,
      version: 1,
      skills: ['reading', 'listening'],
      publishedAt: null,
    });
    expect(first.sections.map((section) => section.orderIndex)).toEqual([1, 2]);
    expect(first.sections.map((section) => section.skill)).toEqual([
      'reading',
      'listening',
    ]);
    expect(first.sections[0]?.title).toBe('Đọc hiểu');
    expect(first.sections[0]?.instruction).toBe(
      'Đọc đoạn văn rồi chọn đáp án.',
    );
    expect(first.sections[0]?.questionCount).toBe(2);
    expect(first.sections[0]?.groups.map((group) => group.orderIndex)).toEqual([
      1, 2,
    ]);
    expect(first.sections[0]?.groups[0]?.instruction).toBeNull();
    expect(first.sections[0]?.groups[1]?.title).toBeNull();
    expect(first.sections[0]?.groups[1]?.instruction).toBe(
      'Nhóm không tiêu đề',
    );
    expect(first.sections[1]?.groups.map((group) => group.orderIndex)).toEqual([
      1,
    ]);
    expect(first.sections[1]?.groups[0]?.audioId).toBe(readyAudioId);
    expect(first.sections[1]?.groups[0]?.imageId).toBeNull();

    const firstQuestions = flattenQuestions(first);
    expect(firstQuestions.map((question) => question.questionId)).toEqual([
      qReading1Id,
      qReading2Id,
      qListening1Id,
    ]);
    expect(firstQuestions.map((question) => question.orderIndex)).toEqual([
      1, 2, 3,
    ]);
    expect(firstQuestions.map((question) => question.skill)).toEqual([
      'reading',
      'reading',
      'listening',
    ]);
    expect(
      firstQuestions.every((question) => question.status === 'published'),
    ).toBe(true);
    expect(firstQuestions[2]?.levelId).toBe(testLevelId);

    // TestQuestion.orderIndex === TestQuestionPlacement.orderIndex === 1..N.
    const firstDbQuestions = await prisma.testQuestion.findMany({
      where: { testId: test.id },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, questionId: true, orderIndex: true },
    });
    const firstPlacements = await prisma.testQuestionPlacement.findMany({
      where: { testId: test.id },
      orderBy: { orderIndex: 'asc' },
      select: {
        testQuestionId: true,
        sectionId: true,
        groupId: true,
        orderIndex: true,
      },
    });
    expect(firstDbQuestions.map((row) => row.orderIndex)).toEqual([1, 2, 3]);
    expect(firstPlacements.map((row) => row.orderIndex)).toEqual([1, 2, 3]);
    expect(firstDbQuestions.map((row) => row.questionId)).toEqual([
      qReading1Id,
      qReading2Id,
      qListening1Id,
    ]);
    const testQuestionById = new Map(
      firstDbQuestions.map((row) => [row.id, row]),
    );
    for (const placement of firstPlacements) {
      const testQuestion = testQuestionById.get(placement.testQuestionId);
      expect(testQuestion).toBeDefined();
      expect(placement.orderIndex).toBe(testQuestion?.orderIndex);
    }
    expect(firstPlacements[0]?.sectionId).toBe(first.sections[0]?.id);
    expect(firstPlacements[0]?.groupId).toBe(first.sections[0]?.groups[0]?.id);
    expect(firstPlacements[2]?.sectionId).toBe(first.sections[1]?.id);
    expect(firstPlacements[2]?.groupId).toBe(first.sections[1]?.groups[0]?.id);

    // A second PUT replaces every row: ids change, order is renumbered.
    const secondPut = await putStructure(test.id, first.updatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc hiểu',
        instruction: 'Đọc đoạn văn.',
        groups: [
          {
            title: 'Nhóm đọc gộp',
            questionIds: [qReading1Id, qReading2Id],
          },
        ],
      },
      {
        skill: Skill.listening,
        title: 'Nghe hiểu',
        groups: [
          {
            title: 'Nhóm nghe',
            audioId: readyAudioId,
            questionIds: [qListening1Id],
          },
        ],
      },
    ]).expect(200);
    const second = secondPut.body.data as AdminTestDetailData;
    // Section and group ids live in separate tables, so each namespace is
    // compared on its own: both must be fully replaced by the second PUT.
    const previousSectionIds = new Set(
      first.sections.map((section) => section.id),
    );
    const previousGroupIds = new Set(
      first.sections.flatMap((section) =>
        section.groups.map((group) => group.id),
      ),
    );
    expect(previousSectionIds.size).toBeGreaterThan(0);
    expect(previousGroupIds.size).toBeGreaterThan(0);
    for (const section of second.sections) {
      expect(previousSectionIds.has(section.id)).toBe(false);
      for (const group of section.groups) {
        expect(previousGroupIds.has(group.id)).toBe(false);
      }
    }
    expect(second.sections.map((section) => section.id)).not.toEqual(
      first.sections.map((section) => section.id),
    );
    expect(second.sections[0]?.groups).toHaveLength(1);
    expect(second.sections[0]?.questionCount).toBe(2);
    expect(second.sections[0]?.groups[0]?.orderIndex).toBe(1);
    expect(
      flattenQuestions(second).map((question) => question.orderIndex),
    ).toEqual([1, 2, 3]);
    expect(
      flattenQuestions(second).map((question) => question.questionId),
    ).toEqual([qReading1Id, qReading2Id, qListening1Id]);

    const secondDbQuestions = await prisma.testQuestion.findMany({
      where: { testId: test.id },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, questionId: true, orderIndex: true },
    });
    const secondPlacements = await prisma.testQuestionPlacement.findMany({
      where: { testId: test.id },
      orderBy: { orderIndex: 'asc' },
      select: { testQuestionId: true, orderIndex: true },
    });
    expect(secondDbQuestions.map((row) => row.orderIndex)).toEqual([1, 2, 3]);
    expect(secondPlacements.map((row) => row.orderIndex)).toEqual([1, 2, 3]);
    expect(secondPlacements.map((row) => row.testQuestionId)).toEqual(
      secondDbQuestions.map((row) => row.id),
    );

    // List shape: TestAdmin exactly, pagination meta, updatedAt DESC ordering.
    const list = await adminGet('/admin/cms/tests', {
      levelId: testLevelId,
      q: testTitle('structure'),
      page: 1,
      limit: 50,
    }).expect(200);
    expect(list.body.meta.pagination).toEqual({
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    });
    expect(list.body.data).toHaveLength(1);
    const listItem = list.body.data[0] as AdminTestData;
    expect(Object.keys(listItem).sort()).toEqual(ADMIN_TEST_KEYS);
    expect(listItem).toMatchObject({
      id: test.id,
      levelId: testLevelId,
      levelCode: 'HSK2',
      title: testTitle('structure'),
      duration: 45,
      passScore: null,
      maxScore: 200,
      status: 'draft',
      version: 1,
      sectionCount: 2,
      questionCount: 3,
      skills: ['reading', 'listening'],
      publishedAt: null,
    });

    const sortedList = await adminGet('/admin/cms/tests', {
      q: suffix,
      limit: 100,
    }).expect(200);
    const updatedAtTimes = (sortedList.body.data as AdminTestData[]).map(
      (row) => new Date(row.updatedAt).getTime(),
    );
    expect(updatedAtTimes).toEqual(
      [...updatedAtTimes].sort((left, right) => right - left),
    );
  });

  it('4. rejects duplicate questions, unusable questions/media, limits and stale tokens', async () => {
    const test = await createTest({ title: testTitle('structure invalid') });
    const expectedUpdatedAt = test.updatedAt;

    const duplicateInGroup = await putStructure(test.id, expectedUpdatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ questionIds: [qReading1Id, qReading1Id] }],
      },
    ]).expect(422);
    expect(duplicateInGroup.body.error.code).toBe('TEST_STRUCTURE_INVALID');
    expect(duplicateInGroup.body.error.details.path).toBe(
      'sections[0].groups[0].questionIds[1]',
    );

    const duplicateAcrossSections = await putStructure(
      test.id,
      expectedUpdatedAt,
      [
        {
          skill: Skill.reading,
          title: 'Đọc 1',
          groups: [{ questionIds: [qReading1Id] }],
        },
        {
          skill: Skill.reading,
          title: 'Đọc 2',
          groups: [{ questionIds: [qReading1Id] }],
        },
      ],
    ).expect(422);
    expect(duplicateAcrossSections.body.error.code).toBe(
      'TEST_STRUCTURE_INVALID',
    );
    expect(duplicateAcrossSections.body.error.details.path).toBe(
      'sections[1].groups[0].questionIds[0]',
    );

    const missingQuestion = await putStructure(test.id, expectedUpdatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ questionIds: [POSTGRESQL_INT4_MAX] }],
      },
    ]).expect(409);
    expect(missingQuestion.body.error).toMatchObject({
      code: 'TEST_QUESTION_NOT_USABLE',
      details: {
        field: 'sections[0].groups[0].questionIds[0]',
        reason: 'not_found',
      },
    });

    const archivedQuestion = await createDraftQuestion({
      content: 'Câu hỏi bị lưu trữ trước khi gắn vào test',
    });
    await adminPost(
      `/admin/cms/questions/${String(archivedQuestion.questionId)}/archive`,
    ).expect(201);
    const archivedQuestionPut = await putStructure(test.id, expectedUpdatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ questionIds: [archivedQuestion.questionId] }],
      },
    ]).expect(409);
    expect(archivedQuestionPut.body.error).toMatchObject({
      code: 'TEST_QUESTION_NOT_USABLE',
      details: {
        field: 'sections[0].groups[0].questionIds[0]',
        reason: 'archived',
      },
    });

    const wrongAudioType = await putStructure(test.id, expectedUpdatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ audioId: readyImageId, questionIds: [qReading1Id] }],
      },
    ]).expect(409);
    expect(wrongAudioType.body.error).toMatchObject({
      code: 'MEDIA_NOT_USABLE',
      details: {
        field: 'sections[0].groups[0].audioId',
        reason: 'wrong_type',
      },
    });

    const archivedMedia = await putStructure(test.id, expectedUpdatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ audioId: deletedAudioId, questionIds: [qReading1Id] }],
      },
    ]).expect(409);
    expect(archivedMedia.body.error).toMatchObject({
      code: 'MEDIA_NOT_USABLE',
      details: {
        field: 'sections[0].groups[0].audioId',
        reason: 'archived',
      },
    });

    const wrongImageType = await putStructure(test.id, expectedUpdatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ imageId: readyAudioId, questionIds: [qReading1Id] }],
      },
    ]).expect(409);
    expect(wrongImageType.body.error).toMatchObject({
      code: 'MEDIA_NOT_USABLE',
      details: {
        field: 'sections[0].groups[0].imageId',
        reason: 'wrong_type',
      },
    });

    const tooManyQuestions = Array.from(
      { length: 51 },
      (_unused, index) => index + 1,
    );
    const overQuestionLimit = await putStructure(test.id, expectedUpdatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ questionIds: tooManyQuestions }],
      },
    ]).expect(400);
    expect(overQuestionLimit.body.error.code).toBe('REQUEST_VALIDATION_FAILED');

    const tooManyGroups = Array.from({ length: 21 }, (_unused, index) => ({
      title: `Nhóm ${String(index)}`,
      questionIds: [qReading1Id],
    }));
    const overGroupLimit = await putStructure(test.id, expectedUpdatedAt, [
      { skill: Skill.reading, title: 'Đọc', groups: tooManyGroups },
    ]).expect(400);
    expect(overGroupLimit.body.error.code).toBe('REQUEST_VALIDATION_FAILED');

    // H5: 5 groups x 41 = 205 questions crosses the 200-question cap.
    const seededIds = await seedPublishedQuestions(205, 'limit');
    const fiveGroups = Array.from({ length: 5 }, (_unused, groupIndex) => ({
      title: `Nhóm giới hạn ${String(groupIndex)}`,
      questionIds: seededIds.slice(groupIndex * 41, (groupIndex + 1) * 41),
    }));
    const overTotal = await putStructure(test.id, expectedUpdatedAt, [
      { skill: Skill.reading, title: 'Đọc', groups: fiveGroups },
    ]).expect(422);
    expect(overTotal.body.error.code).toBe('TEST_STRUCTURE_INVALID');
    expect(overTotal.body.error.details.path).toBe('sections');

    // H5: 11 sections is rejected by the nested DTO (ArrayMaxSize 10).
    const elevenSections = Array.from({ length: 11 }, (_unused, index) => ({
      skill: Skill.reading,
      title: `Phần ${String(index)}`,
      groups: [{ questionIds: [qReading1Id] }],
    }));
    const overSectionLimit = await putStructure(
      test.id,
      expectedUpdatedAt,
      elevenSections,
    ).expect(400);
    expect(overSectionLimit.body.error.code).toBe('REQUEST_VALIDATION_FAILED');

    const stale = await putStructure(test.id, '2000-01-01T00:00:00.000Z', [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ questionIds: [qReading1Id] }],
      },
    ]).expect(409);
    expect(stale.body.error.code).toBe('TEST_CONCURRENT_UPDATE');

    // Nothing above committed a structure, and 0 sections is a valid draft.
    await expect(
      prisma.testSection.count({ where: { testId: test.id } }),
    ).resolves.toBe(0);
    const emptied = await putStructure(test.id, expectedUpdatedAt, []).expect(
      200,
    );
    expect(emptied.body.data).toMatchObject({
      sectionCount: 0,
      questionCount: 0,
      maxScore: 0,
      sections: [],
    });
    await expect(
      prisma.testSection.count({ where: { testId: test.id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.testQuestion.count({ where: { testId: test.id } }),
    ).resolves.toBe(0);
  });

  it('5. reports every publish blocker at once and rejects seeded empty structures', async () => {
    const test = await createTest({
      title: testTitle('publish blockers'),
      duration: 30,
    });
    const structured = await putStructure(test.id, test.updatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [
          {
            title: 'Nhóm lỗi',
            audioId: pendingAudioId,
            imageId: pendingImageId,
            questionIds: [qDraftId],
          },
          {
            title: 'Nhóm sai cấp',
            questionIds: [qOtherLevelId],
          },
        ],
      },
      {
        skill: Skill.listening,
        title: 'Nghe',
        groups: [{ title: 'Nhóm sai kỹ năng', questionIds: [qReading1Id] }],
      },
    ]).expect(200);

    const blocked = await adminPost(
      `/admin/cms/tests/${String(test.id)}/publish`,
    )
      .send({ expectedUpdatedAt: structured.body.data.updatedAt })
      .expect(409);
    expect(blocked.body.error.code).toBe('TEST_NOT_PUBLISHABLE');
    const reasons = blocked.body.error.details.reasons as Array<{
      code: string;
      field: string;
    }>;
    expect(reasons.length).toBeGreaterThanOrEqual(6);
    expect(reasons).toEqual(
      expect.arrayContaining([
        {
          code: 'question_not_published',
          field: 'sections[0].groups[0].questionIds[0]',
        },
        { code: 'audio_not_ready', field: 'sections[0].groups[0].audioId' },
        { code: 'image_not_ready', field: 'sections[0].groups[0].imageId' },
        {
          code: 'question_level_mismatch',
          field: 'sections[0].groups[1].questionIds[0]',
        },
        {
          code: 'question_skill_mismatch',
          field: 'sections[1].groups[0].questionIds[0]',
        },
        { code: 'pass_score_required', field: 'passScore' },
      ]),
    );
    const reasonCodes = reasons.map((reason) => reason.code);
    for (const code of [
      'question_not_published',
      'audio_not_ready',
      'image_not_ready',
      'question_level_mismatch',
      'question_skill_mismatch',
      'pass_score_required',
    ]) {
      expect(reasonCodes).toContain(code);
    }
    expect(new Set(reasonCodes).size).toBe(reasonCodes.length);

    // A draft with no sections and a set pass score only misses sections.
    const emptyTest = await createTest({
      title: testTitle('publish sections required'),
      duration: 30,
      passScore: 0,
    });
    const sectionsRequired = await adminPost(
      `/admin/cms/tests/${String(emptyTest.id)}/publish`,
    )
      .send({ expectedUpdatedAt: emptyTest.updatedAt })
      .expect(409);
    expect(sectionsRequired.body.error.code).toBe('TEST_NOT_PUBLISHABLE');
    expect(sectionsRequired.body.error.details.reasons).toEqual([
      { code: 'sections_required', field: 'sections' },
    ]);

    // section_empty / group_empty can only be produced by seeding the tree.
    const seededTest = await createTest({
      title: testTitle('publish seeded'),
      duration: 30,
      passScore: 0,
    });
    await prisma.testSection.create({
      data: {
        testId: seededTest.id,
        skill: Skill.reading,
        title: 'Phần rỗng',
        orderIndex: 1,
      },
    });
    const populatedSection = await prisma.testSection.create({
      data: {
        testId: seededTest.id,
        skill: Skill.listening,
        title: 'Phần có nhóm rỗng',
        orderIndex: 2,
      },
    });
    await prisma.questionGroup.create({
      data: {
        testId: seededTest.id,
        sectionId: populatedSection.id,
        title: 'Nhóm rỗng',
        orderIndex: 1,
      },
    });
    const seededPublish = await adminPost(
      `/admin/cms/tests/${String(seededTest.id)}/publish`,
    )
      .send({ expectedUpdatedAt: seededTest.updatedAt })
      .expect(409);
    expect(seededPublish.body.error.code).toBe('TEST_NOT_PUBLISHABLE');
    expect(seededPublish.body.error.details.reasons).toEqual([
      { code: 'section_empty', field: 'sections[0]' },
      { code: 'group_empty', field: 'sections[1].groups[0]' },
    ]);

    // pass_score_out_of_range is checked against 100 × sectionCount.
    const outOfRangeTest = await createTest({
      title: testTitle('publish out of range'),
      duration: 30,
      passScore: 150,
    });
    const outOfRangeStructure = await putStructure(
      outOfRangeTest.id,
      outOfRangeTest.updatedAt,
      [
        {
          skill: Skill.reading,
          title: 'Đọc',
          groups: [{ title: 'Nhóm', questionIds: [qReading1Id] }],
        },
      ],
    ).expect(200);
    const outOfRange = await adminPost(
      `/admin/cms/tests/${String(outOfRangeTest.id)}/publish`,
    )
      .send({ expectedUpdatedAt: outOfRangeStructure.body.data.updatedAt })
      .expect(409);
    expect(outOfRange.body.error.details.reasons).toEqual([
      { code: 'pass_score_out_of_range', field: 'passScore' },
    ]);

    // H2: a question that is draft, of another level AND another skill reports
    // every applicable code against the same field.
    const tripleMismatchId = (
      await createDraftQuestion({
        levelId: otherLevelId,
        skill: Skill.listening,
      })
    ).questionId;
    const tripleTest = await createTest({
      title: testTitle('publish triple mismatch'),
      duration: 30,
      passScore: 0,
    });
    const tripleStructure = await putStructure(
      tripleTest.id,
      tripleTest.updatedAt,
      [
        {
          skill: Skill.reading,
          title: 'Đọc',
          groups: [{ title: 'Nhóm', questionIds: [tripleMismatchId] }],
        },
      ],
    ).expect(200);
    const tripleBlocked = await adminPost(
      `/admin/cms/tests/${String(tripleTest.id)}/publish`,
    )
      .send({ expectedUpdatedAt: tripleStructure.body.data.updatedAt })
      .expect(409);
    expect(tripleBlocked.body.error.code).toBe('TEST_NOT_PUBLISHABLE');
    expect(tripleBlocked.body.error.details.reasons).toEqual([
      {
        code: 'question_not_published',
        field: 'sections[0].groups[0].questionIds[0]',
      },
      {
        code: 'question_level_mismatch',
        field: 'sections[0].groups[0].questionIds[0]',
      },
      {
        code: 'question_skill_mismatch',
        field: 'sections[0].groups[0].questionIds[0]',
      },
    ]);
  });

  it('6. publishes a valid test and then refuses every draft-only mutation', async () => {
    const test = await createTest({
      title: testTitle('publish success'),
      duration: 40,
      passScore: 50,
    });
    const structured = await putStructure(test.id, test.updatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [
          { title: 'Nhóm đọc', questionIds: [qReading1Id, qReading2Id] },
        ],
      },
      {
        skill: Skill.listening,
        title: 'Nghe',
        groups: [
          {
            title: 'Nhóm nghe',
            audioId: readyAudioId,
            imageId: readyImageId,
            questionIds: [qListening1Id],
          },
        ],
      },
    ]).expect(200);
    const published = await adminPost(
      `/admin/cms/tests/${String(test.id)}/publish`,
    )
      .send({ expectedUpdatedAt: structured.body.data.updatedAt })
      .expect(201);
    const publishedDetail = published.body.data as AdminTestDetailData;
    publishedTestId = publishedDetail.id;
    expect(publishedDetail.status).toBe('published');
    expect(publishedDetail.publishedAt).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u,
    );
    expect(
      new Date(publishedDetail.publishedAt as string).getTime(),
    ).toBeGreaterThan(0);
    expect(publishedDetail).toMatchObject({
      sectionCount: 2,
      questionCount: 3,
      maxScore: 200,
      passScore: 50,
    });
    const stored = await prisma.test.findUnique({
      where: { id: test.id },
      select: { status: true, publishedAt: true },
    });
    expect(stored?.status).toBe(ContentStatus.published);
    expect(stored?.publishedAt?.toISOString()).toBe(
      publishedDetail.publishedAt,
    );

    const publishedUpdatedAt = publishedDetail.updatedAt;
    const patchAfterPublish = await adminPatch(
      `/admin/cms/tests/${String(publishedTestId)}`,
    )
      .send({
        expectedUpdatedAt: publishedUpdatedAt,
        title: testTitle('publish success patched'),
      })
      .expect(409);
    expect(patchAfterPublish.body.error.code).toBe('TEST_NOT_EDITABLE');

    const putAfterPublish = await putStructure(
      publishedTestId,
      publishedUpdatedAt,
      [],
    ).expect(409);
    expect(putAfterPublish.body.error.code).toBe('TEST_NOT_EDITABLE');

    const publishAgain = await adminPost(
      `/admin/cms/tests/${String(publishedTestId)}/publish`,
    )
      .send({ expectedUpdatedAt: publishedUpdatedAt })
      .expect(409);
    expect(publishAgain.body.error.code).toBe('TEST_NOT_EDITABLE');
  });

  it('7. blocks archiving a question used by a test published through this API', async () => {
    const questionId = await createPublishedQuestion({
      content: 'Câu hỏi thuộc test được publish qua API',
    });
    const test = await createTest({
      title: testTitle('question archive'),
      duration: 30,
      passScore: 10,
    });
    const structured = await putStructure(test.id, test.updatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ title: 'Nhóm', questionIds: [questionId] }],
      },
    ]).expect(200);
    const published = await adminPost(
      `/admin/cms/tests/${String(test.id)}/publish`,
    )
      .send({ expectedUpdatedAt: structured.body.data.updatedAt })
      .expect(201);
    expect(published.body.data.status).toBe('published');

    const blocked = await adminPost(
      `/admin/cms/questions/${String(questionId)}/archive`,
    ).expect(409);
    expect(blocked.body.error.code).toBe('QUESTION_IN_PUBLISHED_TEST');
    expect(typeof blocked.body.error.message).toBe('string');

    const stored = await prisma.question.findUnique({
      where: { id: questionId },
      select: { status: true, deletedAt: true },
    });
    expect(stored).toEqual({
      status: ContentStatus.published,
      deletedAt: null,
    });
  });

  it('8. archives a test and separates it from the default list', async () => {
    const test = await createTest({
      title: testTitle('archive'),
      duration: 20,
    });
    const archived = await adminPost(
      `/admin/cms/tests/${String(test.id)}/archive`,
    )
      .send({})
      .expect(201);
    expect(archived.body.data).toMatchObject({
      id: test.id,
      status: 'archived',
    });

    const defaultList = await adminGet('/admin/cms/tests', {
      q: testTitle('archive'),
      limit: 100,
    }).expect(200);
    expect(
      (defaultList.body.data as AdminTestData[]).map((row) => row.id),
    ).not.toContain(test.id);

    const archivedList = await adminGet('/admin/cms/tests', {
      q: testTitle('archive'),
      status: 'archived',
      limit: 100,
    }).expect(200);
    const archivedIds = (archivedList.body.data as AdminTestData[]).map(
      (row) => row.id,
    );
    expect(archivedIds).toContain(test.id);
    expect(archivedList.body.meta.pagination.total).toBeGreaterThanOrEqual(1);

    const allDefault = await adminGet('/admin/cms/tests', {
      limit: 100,
    }).expect(200);
    expect(
      (allDefault.body.data as AdminTestData[]).map((row) => row.id),
    ).not.toContain(test.id);

    const archivedAgain = await adminPost(
      `/admin/cms/tests/${String(test.id)}/archive`,
    )
      .send({})
      .expect(409);
    expect(archivedAgain.body.error.code).toBe('TEST_ARCHIVED');

    const patchArchived = await adminPatch(
      `/admin/cms/tests/${String(test.id)}`,
    )
      .send({
        expectedUpdatedAt: archived.body.data.updatedAt,
        title: testTitle('archive patched'),
      })
      .expect(409);
    expect(patchArchived.body.error.code).toBe('TEST_ARCHIVED');

    // A published test can be archived too (the contract allows both statuses).
    const publishedArchive = await adminPost(
      `/admin/cms/tests/${String(publishedTestId)}/archive`,
    )
      .send({})
      .expect(201);
    expect(publishedArchive.body.data).toMatchObject({
      id: publishedTestId,
      status: 'archived',
    });
    const publishedDefault = await adminGet('/admin/cms/tests', {
      q: testTitle('publish success'),
      limit: 100,
    }).expect(200);
    expect(
      (publishedDefault.body.data as AdminTestData[]).map((row) => row.id),
    ).not.toContain(publishedTestId);
  });

  it('9. duplicates a test into a new draft with identical structure', async () => {
    const source = await createTest({
      title: testTitle('duplicate source'),
      instruction: 'Bản gốc',
      duration: 55,
      passScore: 40,
    });
    const structured = await putStructure(source.id, source.updatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        instruction: 'Đọc đi',
        groups: [
          { title: 'Nhóm A', questionIds: [qReading1Id] },
          { title: 'Nhóm B', questionIds: [qReading2Id] },
        ],
      },
      {
        skill: Skill.listening,
        title: 'Nghe',
        groups: [
          {
            title: 'Nhóm C',
            audioId: readyAudioId,
            imageId: readyImageId,
            questionIds: [qListening1Id],
          },
        ],
      },
    ]).expect(200);
    const sourceDetail = structured.body.data as AdminTestDetailData;

    const duplicated = await adminPost(
      `/admin/cms/tests/${String(source.id)}/duplicate`,
    )
      .send({})
      .expect(201);
    const copy = duplicated.body.data as AdminTestDetailData;
    createdTestIds.push(copy.id);
    expect(copy.id).not.toBe(source.id);
    expect(copy.status).toBe('draft');
    expect(copy.title).toBe(`${testTitle('duplicate source')} (bản sao)`);
    expect(copy.title.endsWith(' (bản sao)')).toBe(true);
    expect(copy.title.length).toBeLessThanOrEqual(200);
    expect(copy).toMatchObject({
      levelId: testLevelId,
      levelCode: 'HSK2',
      instruction: 'Bản gốc',
      duration: 55,
      passScore: 40,
      maxScore: 200,
      sectionCount: 2,
      questionCount: 3,
      skills: ['reading', 'listening'],
      publishedAt: null,
      version: 1,
    });
    expect(structureFingerprint(copy)).toEqual(
      structureFingerprint(sourceDetail),
    );
    const sourceSectionIds = new Set(
      sourceDetail.sections.map((section) => section.id),
    );
    const sourceGroupIds = new Set(
      sourceDetail.sections.flatMap((section) =>
        section.groups.map((group) => group.id),
      ),
    );
    for (const section of copy.sections) {
      expect(sourceSectionIds.has(section.id)).toBe(false);
      for (const group of section.groups) {
        expect(sourceGroupIds.has(group.id)).toBe(false);
      }
    }

    // Duplicating a published test also yields a fresh draft.
    const publishedSource = await createTest({
      title: testTitle('duplicate published'),
      duration: 25,
      passScore: 10,
    });
    const publishedStructure = await putStructure(
      publishedSource.id,
      publishedSource.updatedAt,
      [
        {
          skill: Skill.reading,
          title: 'Đọc',
          groups: [{ title: 'Nhóm', questionIds: [qReading1Id] }],
        },
      ],
    ).expect(200);
    await adminPost(`/admin/cms/tests/${String(publishedSource.id)}/publish`)
      .send({ expectedUpdatedAt: publishedStructure.body.data.updatedAt })
      .expect(201);
    const publishedCopy = await adminPost(
      `/admin/cms/tests/${String(publishedSource.id)}/duplicate`,
    )
      .send({})
      .expect(201);
    createdTestIds.push(publishedCopy.body.data.id as number);
    expect(publishedCopy.body.data).toMatchObject({
      status: 'draft',
      sectionCount: 1,
      questionCount: 1,
      publishedAt: null,
    });

    // A 200-char title is truncated so the "(bản sao)" suffix still fits.
    const longTitle = `Test builder long ${suffix} ${'x'.repeat(200)}`.slice(
      0,
      200,
    );
    expect(longTitle.length).toBe(200);
    const longSource = await createTest({ title: longTitle });
    const longCopy = await adminPost(
      `/admin/cms/tests/${String(longSource.id)}/duplicate`,
    )
      .send({})
      .expect(201);
    createdTestIds.push(longCopy.body.data.id as number);
    const longCopyTitle = longCopy.body.data.title as string;
    expect(longCopyTitle.length).toBe(200);
    expect(longCopyTitle.endsWith(' (bản sao)')).toBe(true);
    expect(longCopyTitle).toBe(`${longTitle.slice(0, 190)} (bản sao)`);

    // H6: duplicating a title whose 190th character is an emoji must not split
    // the surrogate pair (no U+FFFD, still <= 200 characters).
    const emojiTitle = `${'a'.repeat(189)}🎯`;
    expect(Array.from(emojiTitle)).toHaveLength(190);
    const emojiSource = await createTest({ title: emojiTitle });
    const emojiCopy = await adminPost(
      `/admin/cms/tests/${String(emojiSource.id)}/duplicate`,
    )
      .send({})
      .expect(201);
    createdTestIds.push(emojiCopy.body.data.id as number);
    const emojiCopyTitle = emojiCopy.body.data.title as string;
    expect(emojiCopyTitle).not.toContain('\uFFFD');
    expect(Array.from(emojiCopyTitle).length).toBeLessThanOrEqual(200);
    expect(emojiCopyTitle.endsWith(' (bản sao)')).toBe(true);
    expect(Array.from(emojiCopyTitle).slice(0, 190).join('')).toBe(emojiTitle);
  });

  it('10. audits every test mutation with a safe afterSummary', async () => {
    const created = await createTest({
      title: testTitle('audit'),
      duration: 30,
      passScore: 10,
    });
    const structured = await putStructure(created.id, created.updatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ title: 'Nhóm', questionIds: [qReading1Id] }],
      },
    ]).expect(200);
    await sleep(20);
    const patched = await adminPatch(`/admin/cms/tests/${String(created.id)}`)
      .send({
        expectedUpdatedAt: structured.body.data.updatedAt,
        title: testTitle('audit patched'),
      })
      .expect(200);
    const published = await adminPost(
      `/admin/cms/tests/${String(created.id)}/publish`,
    )
      .send({ expectedUpdatedAt: patched.body.data.updatedAt })
      .expect(201);
    expect(published.body.data.status).toBe('published');
    await adminPost(`/admin/cms/tests/${String(created.id)}/archive`)
      .send({})
      .expect(201);
    const duplicated = await adminPost(
      `/admin/cms/tests/${String(created.id)}/duplicate`,
    )
      .send({})
      .expect(201);
    const duplicatedId = duplicated.body.data.id as number;
    createdTestIds.push(duplicatedId);

    const audits = await prisma.auditLog.findMany({
      where: { targetType: 'test', targetId: String(created.id) },
      orderBy: { id: 'asc' },
      select: { action: true, afterSummary: true, actorId: true },
    });
    expect(audits.map((audit) => audit.action)).toEqual([
      'test.created',
      'test.structure_updated',
      'test.updated',
      'test.published',
      'test.archived',
    ]);
    expect(audits.every((audit) => audit.actorId === adminId)).toBe(true);
    for (const audit of audits) {
      const summary = audit.afterSummary as Record<string, unknown>;
      expect(Object.keys(summary).sort()).toEqual([
        'entityId',
        'entityType',
        'questionCount',
        'sectionCount',
        'status',
      ]);
      expect(summary).toMatchObject({
        entityType: 'test',
        entityId: created.id,
      });
    }
    const summaries = new Map(
      audits.map((audit) => [
        audit.action,
        audit.afterSummary as Record<string, unknown>,
      ]),
    );
    expect(summaries.get('test.created')).toMatchObject({
      status: 'draft',
      sectionCount: 0,
      questionCount: 0,
    });
    expect(summaries.get('test.structure_updated')).toMatchObject({
      status: 'draft',
      sectionCount: 1,
      questionCount: 1,
    });
    expect(summaries.get('test.published')).toMatchObject({
      status: 'published',
      sectionCount: 1,
      questionCount: 1,
    });
    expect(summaries.get('test.archived')).toMatchObject({
      status: 'archived',
      sectionCount: 1,
      questionCount: 1,
    });

    const duplicateAudits = await prisma.auditLog.findMany({
      where: { targetType: 'test', targetId: String(duplicatedId) },
      orderBy: { id: 'asc' },
      select: { action: true, afterSummary: true },
    });
    expect(duplicateAudits.map((audit) => audit.action)).toEqual([
      'test.duplicated',
    ]);
    const duplicateSummary = duplicateAudits[0]?.afterSummary as Record<
      string,
      unknown
    >;
    expect(Object.keys(duplicateSummary).sort()).toEqual([
      'entityId',
      'entityType',
      'questionCount',
      'sectionCount',
      'sourceTestId',
      'status',
    ]);
    expect(duplicateSummary).toMatchObject({
      entityType: 'test',
      entityId: duplicatedId,
      status: 'draft',
      sectionCount: 1,
      questionCount: 1,
      sourceTestId: created.id,
    });

    const actions = [
      ...audits.map((audit) => audit.action),
      ...duplicateAudits.map((audit) => audit.action),
    ];
    for (const action of [
      'test.created',
      'test.updated',
      'test.structure_updated',
      'test.published',
      'test.archived',
      'test.duplicated',
    ]) {
      expect(actions).toContain(action);
    }
    // Audit summaries must never carry question content.
    expect(JSON.stringify(audits)).not.toContain('Câu đọc hiểu');
  });

  it('11. blocks identity changes for a question used by a published test (Q116)', async () => {
    const questionId = await createPublishedQuestion({
      content: 'Câu hỏi Q116 dùng cho test đã publish',
      explanation: 'Giải thích cho câu hỏi Q116.',
    });

    // A test published through this API now holds the question.
    const test = await createTest({
      title: testTitle('q116 published test'),
      duration: 30,
      passScore: 50,
    });
    const structured = await putStructure(test.id, test.updatedAt, [
      {
        skill: Skill.reading,
        title: 'Đọc',
        groups: [{ title: 'Nhóm Q116', questionIds: [questionId] }],
      },
    ]).expect(200);
    const published = await adminPost(
      `/admin/cms/tests/${String(test.id)}/publish`,
    )
      .send({ expectedUpdatedAt: structured.body.data.updatedAt })
      .expect(201);
    expect(published.body.data.status).toBe('published');

    // Identity change (skill) is frozen while a published test uses it.
    const skillRevision = await adminPost(
      `/admin/cms/questions/${String(questionId)}/revisions`,
    )
      .send(
        questionPayload({
          skill: Skill.listening,
          audioId: readyAudioId,
          explanation: 'Nghe và chọn đáp án đúng.',
        }),
      )
      .expect(201);
    const skillRevisionId = skillRevision.body.data.revision.id as number;
    await reviewQuestionRevision(questionId, skillRevisionId).expect(201);
    const blocked = await adminPost(
      `/admin/cms/questions/${String(questionId)}/revisions/${String(skillRevisionId)}/publish`,
    ).expect(409);
    expect(blocked.body.error.code).toBe('QUESTION_IN_PUBLISHED_TEST');
    expect(blocked.body.error.details.field).toBe('skill');

    // The rejected publish left the live question untouched.
    const unchanged = await adminGet(
      `/admin/cms/questions/${String(questionId)}`,
    ).expect(200);
    expect(unchanged.body.data).toMatchObject({
      status: 'published',
      skill: 'reading',
      type: 'mcq',
      levelId: testLevelId,
    });

    // Content-only revision keeps level/skill/type and publishes over it.
    const contentRevision = await adminPost(
      `/admin/cms/questions/${String(questionId)}/revisions`,
    )
      .send(questionPayload({ content: 'Nội dung mới cho câu hỏi' }))
      .expect(201);
    const contentRevisionId = contentRevision.body.data.revision.id as number;
    expect(contentRevision.body.data.question.status).toBe('published');
    await reviewQuestionRevision(questionId, contentRevisionId).expect(201);
    const republished = await adminPost(
      `/admin/cms/questions/${String(questionId)}/revisions/${String(contentRevisionId)}/publish`,
    ).expect(201);
    expect(republished.body.data).toMatchObject({
      idempotent: false,
      question: {
        status: 'published',
        content: 'Nội dung mới cho câu hỏi',
      },
    });
    const updated = await adminGet(
      `/admin/cms/questions/${String(questionId)}`,
    ).expect(200);
    expect(updated.body.data).toMatchObject({
      status: 'published',
      skill: 'reading',
      type: 'mcq',
      levelId: testLevelId,
      version: 3,
      content: 'Nội dung mới cho câu hỏi',
    });
  });

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function testTitle(label: string): string {
    return `Test builder ${label} ${suffix}`;
  }

  function expectNoStore(response: { headers: Record<string, unknown> }): void {
    expect(String(response.headers['cache-control'])).toContain('no-store');
  }

  async function upsertLevel(
    code: string,
    orderIndex: number,
  ): Promise<number> {
    const level = await prisma.level.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name: code,
        orderIndex,
        minBand: orderIndex,
        maxBand: orderIndex,
        curriculumVersion: 'HSK_3_0',
        status: ContentStatus.published,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    return level.id;
  }

  async function seedPublishedQuestions(
    count: number,
    label: string,
  ): Promise<number[]> {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      INSERT INTO "Question" (
        "content", "type", "skill", "levelId", "answers", "correctAnswer",
        "explanation", "status", "version", "createdAt", "updatedAt"
      )
      SELECT
        ${`Câu giới hạn ${label} `} || g,
        'mcq'::"QuestionType",
        'reading'::"Skill",
        ${testLevelId},
        '{"options":[{"id":"a","text":"Đáp án đúng"},{"id":"b","text":"Đáp án sai"}]}'::jsonb,
        '{"optionId":"a"}'::jsonb,
        'Giải thích cho câu giới hạn.',
        'published'::"ContentStatus",
        1,
        now(),
        now()
      FROM generate_series(1, ${count}) AS g
      RETURNING "id"
    `);
    const ids = rows.map((row) => row.id);
    createdQuestionIds.push(...ids);
    return ids;
  }

  async function seedMedia(
    filename: string,
    type: 'audio' | 'image',
    processingStatus: 'ready' | 'pending',
    overrides: { deletedAt?: Date } = {},
  ): Promise<number> {
    const media = await prisma.media.create({
      data: {
        url: `https://cdn.example.test/test-builder/${suffix}/${filename}`,
        type,
        mimeType: type === 'audio' ? 'audio/mpeg' : 'image/png',
        processingStatus,
        ...overrides,
      },
      select: { id: true },
    });
    createdMediaIds.push(media.id);
    return media.id;
  }

  function questionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: QuestionType.mcq,
      skill: Skill.reading,
      levelId: testLevelId,
      content: 'Câu hỏi của test builder',
      answers: {
        options: [
          { id: 'a', text: 'Đáp án đúng' },
          { id: 'b', text: 'Đáp án sai' },
        ],
      },
      correctAnswer: { optionId: 'a' },
      explanation: 'Giải thích cho test builder.',
      difficulty: 2,
      ...overrides,
    };
  }

  async function createDraftQuestion(
    overrides: Record<string, unknown> = {},
  ): Promise<{ questionId: number; revisionId: number }> {
    const response = await adminPost('/admin/cms/questions')
      .send(questionPayload(overrides))
      .expect(201);
    const questionId = response.body.data.question.id as number;
    const revisionId = response.body.data.revision.id as number;
    createdQuestionIds.push(questionId);
    return { questionId, revisionId };
  }

  async function createPublishedQuestion(
    overrides: Record<string, unknown> = {},
  ): Promise<number> {
    const { questionId, revisionId } = await createDraftQuestion(overrides);
    await reviewQuestionRevision(questionId, revisionId).expect(201);
    await adminPost(
      `/admin/cms/questions/${String(questionId)}/revisions/${String(revisionId)}/publish`,
    ).expect(201);
    return questionId;
  }

  function reviewQuestionRevision(questionId: number, revisionId: number) {
    return adminPost(
      `/admin/cms/questions/${String(questionId)}/revisions/${String(revisionId)}/reviews`,
    ).send({ decision: 'approved' });
  }

  async function createTest(
    input: CreateTestInput = {},
  ): Promise<AdminTestDetailData> {
    const response = await adminPost('/admin/cms/tests')
      .send({
        levelId: testLevelId,
        title: testTitle('draft'),
        duration: 60,
        ...input,
      })
      .expect(201);
    const data = response.body.data as AdminTestDetailData;
    createdTestIds.push(data.id);
    return data;
  }

  function putStructure(
    testId: number,
    expectedUpdatedAt: string,
    sections: StructureSectionInput[],
  ) {
    return adminPut(`/admin/cms/tests/${String(testId)}/structure`).send({
      expectedUpdatedAt,
      sections,
    });
  }

  function flattenQuestions(
    detail: AdminTestDetailData,
  ): AdminTestQuestionData[] {
    return detail.sections.flatMap((section) =>
      section.groups.flatMap((group) => group.questions),
    );
  }

  function structureFingerprint(detail: AdminTestDetailData) {
    return detail.sections.map((section) => ({
      skill: section.skill,
      title: section.title,
      instruction: section.instruction,
      orderIndex: section.orderIndex,
      groups: section.groups.map((group) => ({
        title: group.title,
        instruction: group.instruction,
        audioId: group.audioId,
        imageId: group.imageId,
        orderIndex: group.orderIndex,
        questions: group.questions.map((question) => ({
          questionId: question.questionId,
          orderIndex: question.orderIndex,
        })),
      })),
    }));
  }

  function adminGet(
    path: string,
    query: Record<string, unknown> = {},
    token = adminToken,
  ) {
    return request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`)
      .query(query);
  }

  function adminPost(path: string, token = adminToken) {
    return request(app.getHttpServer())
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function adminPatch(path: string, token = adminToken) {
    return request(app.getHttpServer())
      .patch(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function adminPut(path: string, token = adminToken) {
    return request(app.getHttpServer())
      .put(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function register(label: string) {
    const email = `test-builder-${label}-${suffix}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password, name: `Test Builder ${label}` })
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
