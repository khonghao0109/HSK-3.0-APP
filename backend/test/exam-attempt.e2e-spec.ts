/// <reference types="jest" />

import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ContentStatus,
  MediaProcessingStatus,
  MediaType,
  Prisma,
  QuestionType,
  Skill,
} from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { sha256CanonicalJson } from '../src/common/utils/canonical-json';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { apiError } from './utils/api-envelope';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * M4.2a / TL-116: learner exam start and immutable snapshot on a disposable
 * database. Every behaviour below is asserted through the real HTTP surface;
 * the snapshot assertions read the stored JSONB row.
 */

type ExamQuestionBody = {
  key: string;
  orderIndex: number;
  type: string;
  skill: string;
  content: string;
  answers: Record<string, unknown>;
  audio: { mediaId: number } | null;
  image: { mediaId: number } | null;
};

type ExamGroupBody = {
  key: string;
  orderIndex: number;
  title: string | null;
  instruction: string | null;
  content: Prisma.JsonValue;
  audio: { mediaId: number } | null;
  image: { mediaId: number } | null;
  questions: ExamQuestionBody[];
};

type ExamSectionBody = {
  key: string;
  orderIndex: number;
  title: string;
  instruction: string | null;
  skill: string;
  groups: ExamGroupBody[];
};

type ExamAttemptBody = {
  id: number;
  testId: number;
  status: string;
  startedAt: string;
  expiresAt: string;
  serverNow: string;
  remainingSeconds: number;
  maxScore: number;
  questionCount: number;
  test: {
    title: string;
    instruction: string | null;
    levelCode: string;
    durationMinutes: number;
    passScore: number | null;
  };
  sections: ExamSectionBody[];
  answers: unknown[];
};

type ExamIntroBody = {
  id: number;
  title: string;
  questionCount: number;
  sectionCount: number;
  maxScore: number;
  passScore: number | null;
  durationMinutes: number;
  sections: Array<{
    orderIndex: number;
    title: string;
    skill: string;
    questionCount: number;
    maxScore: number;
  }>;
  activeAttempt: null | {
    id: number;
    startedAt: string;
    expiresAt: string;
    answeredCount: number;
    questionCount: number;
  };
};

const FORBIDDEN_KEYS = [
  'correctAnswer',
  'explanation',
  'acceptedTexts',
  'caseSensitive',
  'tokenIds',
  'optionId',
  'isCorrect',
  'contentHash',
  'questionId',
  'questionVersion',
];

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.push(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

function expectNoForbiddenKeys(body: unknown): void {
  const keys = collectKeys(body);
  for (const forbidden of FORBIDDEN_KEYS) {
    expect(keys.filter((key) => key === forbidden)).toEqual([]);
  }
}

function newKey(): string {
  return randomUUID();
}

describe('Exam attempt E2E (M4.2a / TL-116)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let suffix: string;
  const password = 'StrongPassword123!';

  const createdTestIds: number[] = [];
  const createdQuestionIds: number[] = [];
  const createdMediaIds: number[] = [];

  let levelId: number;
  let readyImageId: number;
  let readyAudioId: number;
  let revokedMediaId: number;

  let publishedTestId: number;
  let secondPublishedTestId: number;
  let draftTestId: number;
  let archivedTestId: number;
  let windowTestId: number;
  let revokedMediaTestId: number;
  let archivedQuestionTestId: number;

  let q1Id: number;
  let originalQ1Content: string;

  let learnerToken: string;
  let learnerId: number;
  let expiredToken: string;
  let expiredUserId: number;
  let otherToken: string;
  let unavailableToken: string;

  let attemptId: number;
  let startKey: string;

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

    // Own HSK4 so the other e2e specs (HSK1–HSK3) keep their scoped counts.
    levelId = await upsertLevel('HSK4', 4);

    readyImageId = await seedMedia('exam-intro.png', MediaType.image);
    readyAudioId = await seedMedia('exam-listening.mp3', MediaType.audio);

    q1Id = await seedQuestion({
      type: QuestionType.mcq,
      skill: Skill.reading,
      content: 'Câu đọc hiểu số một của đề thi thử',
      answers: {
        options: [
          { id: 'a', text: 'Đáp án đúng' },
          { id: 'b', text: 'Đáp án sai' },
        ],
      },
      correctAnswer: { optionId: 'a' },
      explanation: 'Vì đáp án A khớp đoạn văn.',
    });
    originalQ1Content = 'Câu đọc hiểu số một của đề thi thử';
    const q2Id = await seedQuestion({
      type: QuestionType.true_false,
      skill: Skill.reading,
      content: 'Câu đúng sai của đề thi thử',
      answers: {},
      correctAnswer: true,
      explanation: 'Đoạn văn khẳng định điều này.',
    });
    const q3Id = await seedQuestion({
      type: QuestionType.fill_blank,
      skill: Skill.reading,
      content: 'Câu điền từ của đề thi thử',
      answers: {},
      correctAnswer: { acceptedTexts: ['你好'], caseSensitive: false },
      explanation: 'Từ cần điền là 你好.',
    });
    const q4Id = await seedQuestion({
      type: QuestionType.arrange_sentence,
      skill: Skill.reading,
      content: 'Câu sắp xếp của đề thi thử',
      answers: {
        tokens: [
          { id: 't2', text: '二' },
          { id: 't1', text: '一' },
        ],
      },
      correctAnswer: { tokenIds: ['t1', 't2'] },
      explanation: null,
    });
    const q5Id = await seedQuestion({
      type: QuestionType.mcq,
      skill: Skill.listening,
      audioId: readyAudioId,
      content: 'Câu nghe hiểu của đề thi thử',
      answers: {
        options: [
          { id: 'a', text: 'Đáp án đúng' },
          { id: 'b', text: 'Đáp án sai' },
        ],
      },
      correctAnswer: { optionId: 'b' },
      explanation: 'Nghe kỹ câu thứ hai.',
    });

    publishedTestId = await seedTest({
      title: `Đề thi thử M4.2a ${suffix}`,
      status: ContentStatus.published,
      passScore: 120,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [
            {
              title: 'Đoạn 1',
              instruction: 'Chọn đáp án đúng.',
              content: { passages: [{ id: 'p1', text: '文本' }] },
              imageId: readyImageId,
              questionIds: [q1Id, q2Id, q3Id, q4Id],
            },
          ],
        },
        {
          skill: Skill.listening,
          title: 'Nghe hiểu',
          groups: [
            {
              title: null,
              instruction: null,
              audioId: readyAudioId,
              questionIds: [q5Id],
            },
          ],
        },
      ],
    });

    secondPublishedTestId = await seedTest({
      title: `Đề thi thử thứ hai M4.2a ${suffix}`,
      status: ContentStatus.published,
      passScore: 100,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [{ title: null, questionIds: [q1Id] }],
        },
      ],
    });

    draftTestId = await seedTest({
      title: `Đề nháp M4.2a ${suffix}`,
      status: ContentStatus.draft,
      passScore: 100,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [{ title: null, questionIds: [q1Id] }],
        },
      ],
    });
    archivedTestId = await seedTest({
      title: `Đề lưu trữ M4.2a ${suffix}`,
      status: ContentStatus.archived,
      deletedAt: new Date(),
      passScore: 100,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [{ title: null, questionIds: [q1Id] }],
        },
      ],
    });
    windowTestId = await seedTest({
      title: `Đề ngoài cửa sổ M4.2a ${suffix}`,
      status: ContentStatus.published,
      availableFrom: new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000),
      availableTo: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000),
      passScore: 100,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [{ title: null, questionIds: [q1Id] }],
        },
      ],
    });

    revokedMediaId = await seedMedia('revoked.png', MediaType.image);
    revokedMediaTestId = await seedTest({
      title: `Đề thu hồi media M4.2a ${suffix}`,
      status: ContentStatus.published,
      passScore: 100,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [
            { title: null, imageId: revokedMediaId, questionIds: [q1Id] },
          ],
        },
      ],
    });
    const archivedQuestionId = await seedQuestion({
      type: QuestionType.mcq,
      skill: Skill.reading,
      content: `Câu bị lưu trữ M4.2a ${suffix}`,
      answers: { options: [{ id: 'a', text: 'A' }] },
      correctAnswer: { optionId: 'a' },
      explanation: 'Giải thích.',
      status: ContentStatus.archived,
    });
    archivedQuestionTestId = await seedTest({
      title: `Đề câu lưu trữ M4.2a ${suffix}`,
      status: ContentStatus.published,
      passScore: 100,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [{ title: null, questionIds: [archivedQuestionId] }],
        },
      ],
    });

    const learner = await register('learner');
    learnerId = learner.userId;
    learnerToken = learner.token;
    const expired = await register('expired');
    expiredUserId = expired.userId;
    expiredToken = expired.token;
    otherToken = (await register('other')).token;
    unavailableToken = (await register('unavailable')).token;
  });

  afterAll(async () => {
    // ExamAttemptSnapshot/ExamAttemptEvent are immutable by trigger and the
    // attempt keeps the Test alive, so the tree is archived rather than
    // deleted; the database itself is disposable.
    const ids = [...new Set(createdTestIds)];
    if (ids.length > 0) {
      await prisma.test.updateMany({
        where: { id: { in: ids } },
        data: { status: ContentStatus.archived, deletedAt: new Date() },
      });
    }
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

  function get(path: string, token?: string) {
    const call = request(app.getHttpServer()).get(`/api/v1${path}`);
    return token === undefined
      ? call
      : call.set('Authorization', `Bearer ${token}`);
  }

  function post(path: string, token?: string) {
    const call = request(app.getHttpServer()).post(`/api/v1${path}`);
    return token === undefined
      ? call
      : call.set('Authorization', `Bearer ${token}`);
  }

  it('1. rejects every route without a bearer token', async () => {
    await get(`/exam/tests/${String(publishedTestId)}`).expect(401);
    await post(`/exam/tests/${String(publishedTestId)}/attempts`)
      .send({ idempotencyKey: newKey() })
      .expect(401);
    await get('/exam/attempts/1').expect(401);
  });

  it('2. hides draft, archived, out-of-window and unknown tests behind 404', async () => {
    for (const testId of [
      draftTestId,
      archivedTestId,
      windowTestId,
      2_147_483_647,
    ]) {
      const intro = await get(
        `/exam/tests/${String(testId)}`,
        learnerToken,
      ).expect(404);
      expect(intro.body).toEqual(
        apiError({
          code: 'EXAM_TEST_NOT_FOUND',
          message: 'Exam test was not found.',
        }),
      );

      const start = await post(
        `/exam/tests/${String(testId)}/attempts`,
        learnerToken,
      )
        .send({ idempotencyKey: newKey() })
        .expect(404);
      expect(start.body).toEqual(
        apiError({
          code: 'EXAM_TEST_NOT_FOUND',
          message: 'Exam test was not found.',
        }),
      );
    }
  });

  it('3. returns the intro counts, maxScore, passScore and no active attempt', async () => {
    const response = await get(
      `/exam/tests/${String(publishedTestId)}`,
      learnerToken,
    ).expect(200);

    expectNoStore(response);
    const intro = response.body.data as ExamIntroBody;
    expect(intro).toMatchObject({
      id: publishedTestId,
      questionCount: 5,
      sectionCount: 2,
      maxScore: 200,
      passScore: 120,
      durationMinutes: 90,
      activeAttempt: null,
    });
    expect(intro.sections).toEqual([
      {
        orderIndex: 1,
        title: 'Đọc hiểu',
        skill: 'reading',
        questionCount: 4,
        maxScore: 100,
      },
      {
        orderIndex: 2,
        title: 'Nghe hiểu',
        skill: 'listening',
        questionCount: 1,
        maxScore: 100,
      },
    ]);
    expectNoForbiddenKeys(response.body);
  });

  it('4. creates one attempt with a complete immutable snapshot', async () => {
    startKey = newKey();
    const response = await post(
      `/exam/tests/${String(publishedTestId)}/attempts`,
      learnerToken,
    )
      .send({ idempotencyKey: startKey })
      .expect(201);

    expectNoStore(response);
    const body = response.body.data as ExamAttemptBody;
    attemptId = body.id;
    expect(body).toMatchObject({
      testId: publishedTestId,
      status: 'in_progress',
      maxScore: 200,
      questionCount: 5,
      answers: [],
    });
    expect(body.test).toEqual({
      title: `Đề thi thử M4.2a ${suffix}`,
      instruction: null,
      levelCode: 'HSK4',
      durationMinutes: 90,
      passScore: 120,
    });
    expect(body.sections.map((section) => section.key)).toEqual(['s1', 's2']);
    expect(body.sections[0]?.groups[0]?.key).toBe('s1-g1');
    expect(
      body.sections[0]?.groups[0]?.questions.map((question) => question.key),
    ).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(body.sections[1]?.groups[0]?.questions[0]?.key).toBe('q5');
    expect(body.sections[0]?.groups[0]?.image).toEqual({
      mediaId: readyImageId,
      kind: 'image',
      mimeType: 'image/png',
      durationMs: null,
    });
    expect(body.sections[1]?.groups[0]?.audio).toEqual({
      mediaId: readyAudioId,
      kind: 'audio',
      mimeType: 'audio/mpeg',
      durationMs: null,
    });
    expectNoForbiddenKeys(response.body);

    // The frozen row keeps the internal scoring fields.
    const snapshot = await prisma.examAttemptSnapshot.findUniqueOrThrow({
      where: { attemptId },
      select: {
        payload: true,
        contentHash: true,
        testVersion: true,
        snapshotVersion: true,
      },
    });
    const payload = snapshot.payload as Prisma.JsonObject;
    const sections = payload.sections as Prisma.JsonArray;
    const firstSection = sections[0] as Prisma.JsonObject;
    const groups = firstSection.groups as Prisma.JsonArray;
    const firstGroup = groups[0] as Prisma.JsonObject;
    const questions = firstGroup.questions as Prisma.JsonArray;
    const firstQuestion = questions[0] as Prisma.JsonObject;

    expect(firstQuestion.correctAnswer).toEqual({ optionId: 'a' });
    expect(firstQuestion.explanation).toBe('Vì đáp án A khớp đoạn văn.');
    expect(firstQuestion.answers).toEqual({
      options: [
        { id: 'a', text: 'Đáp án đúng' },
        { id: 'b', text: 'Đáp án sai' },
      ],
    });
    expect(firstQuestion.questionId).toBe(q1Id);
    // arrange_sentence keeps the stored token order (shortcut).
    const arrangeQuestion = questions[3] as Prisma.JsonObject;
    expect(arrangeQuestion.answers).toEqual({
      tokens: [
        { id: 't2', text: '二' },
        { id: 't1', text: '一' },
      ],
    });
    expect(snapshot.contentHash).toBe(sha256CanonicalJson(snapshot.payload));
    expect(snapshot.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.testVersion).toBe(1);
    expect(snapshot.snapshotVersion).toBe(1);

    const attempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      select: {
        startedAt: true,
        expiresAt: true,
        remainingSeconds: true,
        maxScore: true,
        scoringVersion: true,
        snapshotVersion: true,
        idempotencyKey: true,
      },
    });
    expect(attempt.remainingSeconds).toBe(5_400);
    expect(attempt.maxScore).toBe(200);
    expect(attempt.scoringVersion).toBe('hsk-p0-v1');
    expect(attempt.snapshotVersion).toBe(1);
    expect(attempt.idempotencyKey).toBe(startKey);
    expect(attempt.expiresAt.getTime() - attempt.startedAt.getTime()).toBe(
      90 * 60 * 1_000,
    );

    const events = await prisma.examAttemptEvent.findMany({
      where: { attemptId },
      select: { type: true, idempotencyKey: true },
    });
    expect(events).toEqual([{ type: 'started', idempotencyKey: startKey }]);
  });

  it('5. replays the same key and returns the live attempt for a new key', async () => {
    const sameKey = await post(
      `/exam/tests/${String(publishedTestId)}/attempts`,
      learnerToken,
    )
      .send({ idempotencyKey: startKey })
      .expect(200);
    expect((sameKey.body.data as ExamAttemptBody).id).toBe(attemptId);
    expectNoStore(sameKey);

    const newKeyResponse = await post(
      `/exam/tests/${String(publishedTestId)}/attempts`,
      learnerToken,
    )
      .send({ idempotencyKey: newKey() })
      .expect(200);
    expect((newKeyResponse.body.data as ExamAttemptBody).id).toBe(attemptId);

    expect(
      await prisma.examAttempt.count({
        where: { userId: learnerId, testId: publishedTestId },
      }),
    ).toBe(1);
    expect(
      await prisma.examAttemptSnapshot.count({ where: { attemptId } }),
    ).toBe(1);

    // TL-111: the same key belongs to one test only.
    const reused = await post(
      `/exam/tests/${String(secondPublishedTestId)}/attempts`,
      learnerToken,
    )
      .send({ idempotencyKey: startKey })
      .expect(409);
    expect(reused.body).toEqual(
      apiError({
        code: 'EXAM_IDEMPOTENCY_KEY_REUSED',
        message: 'Idempotency key was already used for another exam test.',
      }),
    );
  });

  it('6. reports the active attempt on the intro', async () => {
    const response = await get(
      `/exam/tests/${String(publishedTestId)}`,
      learnerToken,
    ).expect(200);
    const intro = response.body.data as ExamIntroBody;

    expect(intro.activeAttempt).toMatchObject({
      id: attemptId,
      answeredCount: 0,
      questionCount: 5,
    });
    expect(intro.activeAttempt?.startedAt).toEqual(expect.any(String));
    expect(intro.activeAttempt?.expiresAt).toEqual(expect.any(String));
  });

  it('7. returns the in-progress attempt without leaking answers', async () => {
    const response = await get(
      `/exam/attempts/${String(attemptId)}`,
      learnerToken,
    ).expect(200);
    expectNoStore(response);
    const body = response.body.data as ExamAttemptBody;

    expect(body).toMatchObject({
      id: attemptId,
      testId: publishedTestId,
      status: 'in_progress',
      questionCount: 5,
      answers: [],
    });
    expect(body.serverNow).toEqual(expect.any(String));
    expect(body.remainingSeconds).toBeGreaterThan(0);
    expect(body.remainingSeconds).toBeLessThanOrEqual(5_400);
    expectNoForbiddenKeys(response.body);

    // TL-111: another learner cannot read the attempt.
    await get(`/exam/attempts/${String(attemptId)}`, otherToken).expect(404);
    await get('/exam/attempts/2147483647', learnerToken).expect(404);
  });

  it('8. keeps the frozen content after the live question changes (Q116)', async () => {
    const before = await prisma.examAttemptSnapshot.findUniqueOrThrow({
      where: { attemptId },
      select: { contentHash: true },
    });

    await prisma.question.update({
      where: { id: q1Id },
      data: {
        content: 'Nội dung câu hỏi đã bị admin sửa',
        explanation: 'Giải thích đã bị sửa',
      },
    });

    const response = await get(
      `/exam/attempts/${String(attemptId)}`,
      learnerToken,
    ).expect(200);
    const body = response.body.data as ExamAttemptBody;
    expect(body.sections[0]?.groups[0]?.questions[0]?.content).toBe(
      originalQ1Content,
    );
    expectNoForbiddenKeys(response.body);

    const after = await prisma.examAttemptSnapshot.findUniqueOrThrow({
      where: { attemptId },
      select: { contentHash: true, payload: true },
    });
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.contentHash).toBe(sha256CanonicalJson(after.payload));
    const payload = after.payload as Prisma.JsonObject;
    const firstQuestion = (
      ((payload.sections as Prisma.JsonArray)[0] as Prisma.JsonObject)
        .groups as Prisma.JsonArray
    )[0] as Prisma.JsonObject;
    expect((firstQuestion.questions as Prisma.JsonArray)[0]).toMatchObject({
      content: originalQ1Content,
      explanation: 'Vì đáp án A khớp đoạn văn.',
    });
  });

  it('9. times out an expired attempt and starts a new one (Q120)', async () => {
    const first = await post(
      `/exam/tests/${String(publishedTestId)}/attempts`,
      expiredToken,
    )
      .send({ idempotencyKey: newKey() })
      .expect(201);
    const expiredAttemptId = (first.body.data as ExamAttemptBody).id;

    // ExamAttempt_time_check requires expiresAt > startedAt, so both move.
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: expiredAttemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 60_000),
      },
    });

    // TL-112: GET intro treats the expired attempt as inactive and writes nothing.
    const introBefore = await get(
      `/exam/tests/${String(publishedTestId)}`,
      expiredToken,
    ).expect(200);
    expect((introBefore.body.data as ExamIntroBody).activeAttempt).toBeNull();
    expect(
      await prisma.examAttempt.findUniqueOrThrow({
        where: { id: expiredAttemptId },
        select: { status: true },
      }),
    ).toEqual({ status: 'in_progress' });

    const second = await post(
      `/exam/tests/${String(publishedTestId)}/attempts`,
      expiredToken,
    )
      .send({ idempotencyKey: newKey() })
      .expect(201);
    const newAttemptId = (second.body.data as ExamAttemptBody).id;
    expect(newAttemptId).not.toBe(expiredAttemptId);

    const expired = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: expiredAttemptId },
      select: {
        status: true,
        submittedAt: true,
        remainingSeconds: true,
        expiresAt: true,
      },
    });
    expect(expired.status).toBe('timed_out');
    expect(expired.remainingSeconds).toBe(0);
    expect(expired.submittedAt?.getTime()).toBe(expired.expiresAt.getTime());

    const events = await prisma.examAttemptEvent.findMany({
      where: { attemptId: expiredAttemptId },
      select: { type: true, metadata: true },
    });
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type).sort()).toEqual([
      'started',
      'timed_out',
    ]);
    const timedOut = events.find((event) => event.type === 'timed_out');
    expect(timedOut?.metadata).toEqual({ reason: 'expired_on_start' });

    expect(
      await prisma.examAttempt.count({
        where: { userId: expiredUserId, testId: publishedTestId },
      }),
    ).toBe(2);
  });

  it('10. blocks a start when the published content is no longer usable', async () => {
    await prisma.media.update({
      where: { id: revokedMediaId },
      data: {
        processingStatus: MediaProcessingStatus.quarantined,
        deletedAt: new Date(),
      },
    });

    const mediaResponse = await post(
      `/exam/tests/${String(revokedMediaTestId)}/attempts`,
      unavailableToken,
    )
      .send({ idempotencyKey: newKey() })
      .expect(409);
    expect(mediaResponse.body.error).toMatchObject({
      code: 'EXAM_TEST_UNAVAILABLE',
      message: 'Exam test content is not available.',
    });
    expect(mediaResponse.body.error.details.reasons).toEqual([
      { code: 'image_not_ready', field: 'sections[0].groups[0].imageId' },
    ]);

    const questionResponse = await post(
      `/exam/tests/${String(archivedQuestionTestId)}/attempts`,
      unavailableToken,
    )
      .send({ idempotencyKey: newKey() })
      .expect(409);
    expect(questionResponse.body.error).toMatchObject({
      code: 'EXAM_TEST_UNAVAILABLE',
    });
    expect(questionResponse.body.error.details.reasons).toEqual([
      {
        code: 'question_not_published',
        field: 'sections[0].groups[0].questionIds[0]',
      },
    ]);

    // Nothing was written for a rejected start.
    expect(
      await prisma.examAttempt.count({
        where: { testId: { in: [revokedMediaTestId, archivedQuestionTestId] } },
      }),
    ).toBe(0);
  });

  it('11. rejects a malformed body with 400', async () => {
    const path = `/exam/tests/${String(publishedTestId)}/attempts`;
    for (const body of [
      {},
      { idempotencyKey: 'not-a-uuid' },
      { idempotencyKey: newKey(), extra: true },
    ]) {
      const response = await post(path, learnerToken).send(body).expect(400);
      expect(response.body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    }
  });

  it('12. carries no forbidden key on any of the three responses (R11)', async () => {
    const responses = [
      await get(`/exam/tests/${String(publishedTestId)}`, learnerToken).expect(
        200,
      ),
      await post(
        `/exam/tests/${String(publishedTestId)}/attempts`,
        learnerToken,
      )
        .send({ idempotencyKey: newKey() })
        .expect(200),
      await get(`/exam/attempts/${String(attemptId)}`, learnerToken).expect(
        200,
      ),
    ];
    for (const response of responses) {
      expectNoForbiddenKeys(response.body);
    }
    // The frozen scoring data is still in the database, so the scan above is
    // meaningful: the serializer removed it, not the fixture.
    const snapshot = await prisma.examAttemptSnapshot.findUniqueOrThrow({
      where: { attemptId },
      select: { payload: true },
    });
    const keys = collectKeys(snapshot.payload);
    expect(keys).toContain('correctAnswer');
    expect(keys).toContain('explanation');
  });

  it('13. returns the live attempt even when its content is no longer publishable (Q120/Q121)', async () => {
    // Fresh fixtures so archiving this question/media cannot disturb the cases
    // above; the learner is new for the same reason.
    const durableQuestionContent = `Câu hỏi còn hạn M4.2a ${suffix}`;
    const durableMediaId = await seedMedia('durable.png', MediaType.image);
    const durableQuestionId = await seedQuestion({
      type: QuestionType.mcq,
      skill: Skill.reading,
      content: durableQuestionContent,
      answers: {
        options: [
          { id: 'a', text: 'Đáp án đúng' },
          { id: 'b', text: 'Đáp án sai' },
        ],
      },
      correctAnswer: { optionId: 'a' },
      explanation: 'Giải thích của câu hỏi còn hạn.',
    });
    const durableTestId = await seedTest({
      title: `Đề còn hạn M4.2a ${suffix}`,
      status: ContentStatus.published,
      passScore: 50,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [
            {
              title: null,
              imageId: durableMediaId,
              questionIds: [durableQuestionId],
            },
          ],
        },
      ],
    });
    const durable = await register('durable');

    const started = await post(
      `/exam/tests/${String(durableTestId)}/attempts`,
      durable.token,
    )
      .send({ idempotencyKey: newKey() })
      .expect(201);
    const liveAttempt = started.body.data as ExamAttemptBody;
    const frozenBefore = await prisma.examAttemptSnapshot.findUniqueOrThrow({
      where: { attemptId: liveAttempt.id },
      select: { contentHash: true },
    });

    // The live content changes after the attempt started: the question is
    // archived and the group image is revoked (Q116 allows this).
    await prisma.question.update({
      where: { id: durableQuestionId },
      data: { status: ContentStatus.archived },
    });
    await prisma.media.update({
      where: { id: durableMediaId },
      data: {
        processingStatus: MediaProcessingStatus.quarantined,
        deletedAt: new Date(),
      },
    });

    // Q120/Q121: a live attempt is returned as-is; the publish gate runs only
    // when a new attempt has to be created.
    const resumed = await post(
      `/exam/tests/${String(durableTestId)}/attempts`,
      durable.token,
    )
      .send({ idempotencyKey: newKey() })
      .expect(200);
    expectNoStore(resumed);
    const resumedBody = resumed.body.data as ExamAttemptBody;
    expect(resumedBody.id).toBe(liveAttempt.id);
    expect(resumedBody.sections[0]?.groups[0]?.questions[0]?.content).toBe(
      durableQuestionContent,
    );
    expectNoForbiddenKeys(resumed.body);

    const frozenAfter = await prisma.examAttemptSnapshot.findUniqueOrThrow({
      where: { attemptId: liveAttempt.id },
      select: { contentHash: true },
    });
    expect(frozenAfter.contentHash).toBe(frozenBefore.contentHash);

    const intro = await get(
      `/exam/tests/${String(durableTestId)}`,
      durable.token,
    ).expect(200);
    expect((intro.body.data as ExamIntroBody).activeAttempt?.id).toBe(
      liveAttempt.id,
    );

    // Once the attempt has expired the start needs new content, so the publish
    // gate rejects it; the rollback must leave the old attempt untouched.
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: liveAttempt.id },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 60_000),
      },
    });
    const blocked = await post(
      `/exam/tests/${String(durableTestId)}/attempts`,
      durable.token,
    )
      .send({ idempotencyKey: newKey() })
      .expect(409);
    expect(blocked.body.error).toMatchObject({
      code: 'EXAM_TEST_UNAVAILABLE',
      message: 'Exam test content is not available.',
    });
    expect(blocked.body.error.details.reasons).toEqual([
      {
        code: 'question_not_published',
        field: 'sections[0].groups[0].questionIds[0]',
      },
      { code: 'image_not_ready', field: 'sections[0].groups[0].imageId' },
    ]);
    expectNoForbiddenKeys(blocked.body);

    const stillLive = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: liveAttempt.id },
      select: { status: true },
    });
    expect(stillLive.status).toBe('in_progress');
    expect(
      await prisma.examAttempt.count({
        where: { userId: durable.userId, testId: durableTestId },
      }),
    ).toBe(1);
  });

  function expectNoStore(response: { headers: Record<string, string> }): void {
    expect(response.headers['cache-control']).toBe('no-store');
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

  async function seedMedia(filename: string, type: MediaType): Promise<number> {
    const media = await prisma.media.create({
      data: {
        url: `https://cdn.example.test/exam-e2e/${suffix}/${filename}`,
        type,
        mimeType: type === MediaType.audio ? 'audio/mpeg' : 'image/png',
        processingStatus: MediaProcessingStatus.ready,
      },
      select: { id: true },
    });
    createdMediaIds.push(media.id);
    return media.id;
  }

  async function seedQuestion(input: {
    type: QuestionType;
    skill: Skill;
    content: string;
    answers: Prisma.InputJsonValue;
    correctAnswer: Prisma.InputJsonValue;
    explanation?: string | null;
    audioId?: number;
    status?: ContentStatus;
  }): Promise<number> {
    const question = await prisma.question.create({
      data: {
        content: input.content,
        type: input.type,
        skill: input.skill,
        levelId,
        answers: input.answers,
        correctAnswer: input.correctAnswer,
        explanation: input.explanation ?? null,
        audioId: input.audioId ?? null,
        status: input.status ?? ContentStatus.published,
        publishedAt: new Date(),
        version: 1,
      },
      select: { id: true },
    });
    createdQuestionIds.push(question.id);
    return question.id;
  }

  async function seedTest(input: {
    title: string;
    status: ContentStatus;
    passScore: number;
    deletedAt?: Date;
    availableFrom?: Date;
    availableTo?: Date;
    sections: Array<{
      skill: Skill;
      title: string;
      groups: Array<{
        title: string | null;
        instruction?: string | null;
        content?: Prisma.InputJsonValue;
        audioId?: number;
        imageId?: number;
        questionIds: number[];
      }>;
    }>;
  }): Promise<number> {
    const test = await prisma.test.create({
      data: {
        levelId,
        title: input.title,
        instruction: null,
        duration: 90,
        passScore: input.passScore,
        scoringVersion: 'hsk-p0-v1',
        status: input.status,
        publishedAt:
          input.status === ContentStatus.published ? new Date() : null,
        deletedAt: input.deletedAt ?? null,
        availableFrom: input.availableFrom ?? null,
        availableTo: input.availableTo ?? null,
      },
      select: { id: true },
    });
    createdTestIds.push(test.id);

    let questionOrder = 0;
    for (let i = 0; i < input.sections.length; i += 1) {
      const section = input.sections[i];
      if (!section) continue;
      const createdSection = await prisma.testSection.create({
        data: {
          testId: test.id,
          skill: section.skill,
          title: section.title,
          instruction: null,
          orderIndex: i + 1,
        },
        select: { id: true },
      });
      for (let j = 0; j < section.groups.length; j += 1) {
        const group = section.groups[j];
        if (!group) continue;
        const createdGroup = await prisma.questionGroup.create({
          data: {
            testId: test.id,
            sectionId: createdSection.id,
            title: group.title,
            instruction: group.instruction ?? null,
            content: group.content,
            audioId: group.audioId ?? null,
            imageId: group.imageId ?? null,
            orderIndex: j + 1,
          },
          select: { id: true },
        });
        for (const questionId of group.questionIds) {
          questionOrder += 1;
          const testQuestion = await prisma.testQuestion.create({
            data: { testId: test.id, questionId, orderIndex: questionOrder },
            select: { id: true },
          });
          await prisma.testQuestionPlacement.create({
            data: {
              testQuestionId: testQuestion.id,
              testId: test.id,
              sectionId: createdSection.id,
              groupId: createdGroup.id,
              orderIndex: questionOrder,
            },
          });
        }
      }
    }
    return test.id;
  }

  async function register(
    label: string,
  ): Promise<{ userId: number; token: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `exam-e2e-${label}-${suffix}@example.com`,
        password,
        name: `Exam E2E ${label}`,
      })
      .expect(201);
    return {
      userId: response.body.data.user.id as number,
      token: response.body.data.accessToken as string,
    };
  }
});
