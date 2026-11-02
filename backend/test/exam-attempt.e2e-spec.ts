/// <reference types="jest" />

import { createHash, randomUUID } from 'node:crypto';

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
import { InMemoryObjectStorageAdapter } from '../src/infrastructure/storage/in-memory-object-storage.adapter';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage.port';
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

type ExamSubmitBody = {
  id: number;
  status: string;
  submittedAt: string;
  serverNow: string;
  answeredCount: number;
  unansweredCount: number;
  flaggedCount: number;
  replayed: boolean;
};

/** A3/TL-165: the 200 body of GET /exam/attempts/:attemptId/result. */
type ExamResultBody = {
  attemptId: number;
  testId: number;
  status: string;
  testTitle: string;
  startedAt: string;
  submittedAt: string;
  score: number;
  maxScore: number;
  passScore: number | null;
  passed: boolean | null;
  scoringVersion: string;
  gradedAt: string;
  counts: {
    answeredCount: number;
    correctCount: number;
    incorrectCount: number;
    unansweredCount: number;
  };
  sections: Array<{
    key: string;
    title: string;
    skill: string;
    questionCount: number;
    correctCount: number;
    score: number;
    maxScore: number;
  }>;
  skills: Array<{ skill: string; score: number; maxScore: number }>;
  weakAreas: Array<{
    slug: string;
    name: string;
    answered: number;
    correct: number;
    accuracy: number;
    level: string;
  }>;
};

/** A3/TL-166: the 200 body of GET /exam/attempts/:attemptId/review. */
type ExamReviewBody = {
  attemptId: number;
  status: string;
  testTitle: string;
  startedAt: string;
  submittedAt: string;
  questions: Array<{
    key: string;
    orderIndex: number;
    type: string;
    skill: string;
    content: string;
    answers: Record<string, unknown>;
    learnerAnswer: unknown;
    correctAnswer: unknown;
    explanation: string | null;
    isCorrect: boolean;
    isFlagged: boolean;
    sectionKey: string;
    groupKey: string;
    groupMedia: { audio: unknown; image: unknown };
    audio: unknown;
    image: unknown;
  }>;
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
  let storage: InMemoryObjectStorageAdapter;
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
    storage = app.get<InMemoryObjectStorageAdapter>(OBJECT_STORAGE);

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
      correctAnswer: { value: true },
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
    // TL-133: arrange_sentence tokens are shuffled and renumbered per attempt.
    // Two distinct tokens must be inverted, so the answer order is never shown.
    const arrangeQuestion = questions[3] as Prisma.JsonObject;
    expect(arrangeQuestion.answers).toEqual({
      tokens: [
        { id: 't1', text: '二' },
        { id: 't2', text: '一' },
      ],
    });
    expect(arrangeQuestion.correctAnswer).toEqual({ tokenIds: ['t2', 't1'] });
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

  it('14. saves a new mcq answer as version 1 and returns it on the attempt read (TL-121/TL-127)', async () => {
    const fixture = await fourTypeAttempt('save-mcq');
    const body = {
      answer: { choice: 'a' },
      isFlagged: true,
      expectedVersion: null,
      idempotencyKey: newKey(),
      clientElapsedMs: 12_345,
    };

    const saved = await saveAnswer(
      fixture.token,
      fixture.attemptId,
      'q1',
      body,
    ).expect(200);
    expectNoStore(saved);
    const savedBody = saved.body.data as {
      questionKey: string;
      answer: unknown;
      isFlagged: boolean;
      version: number;
      answeredAt: string;
      lastSavedAt: string;
      serverNow: string;
      remainingSeconds: number;
    };
    expect(savedBody).toMatchObject({
      questionKey: 'q1',
      answer: { choice: 'a' },
      isFlagged: true,
      version: 1,
    });
    expect(savedBody.answeredAt).toEqual(expect.any(String));
    expect(savedBody.lastSavedAt).toEqual(expect.any(String));
    expect(savedBody.serverNow).toEqual(expect.any(String));
    expect(savedBody.remainingSeconds).toBeGreaterThan(0);
    expectNoForbiddenKeys(saved.body);

    const row = await prisma.examAnswer.findUniqueOrThrow({
      where: {
        attemptId_snapshotQuestionKey: {
          attemptId: fixture.attemptId,
          snapshotQuestionKey: 'q1',
        },
      },
      select: {
        version: true,
        answeredAt: true,
        saveIdempotencyKey: true,
        questionId: true,
      },
    });
    expect(row.version).toBe(1);
    expect(row.answeredAt).toEqual(expect.any(Date));
    expect(row.saveIdempotencyKey).toBe(body.idempotencyKey);
    expect(row.questionId).not.toBeNull();

    const events = await prisma.examAttemptEvent.findMany({
      where: { attemptId: fixture.attemptId, type: 'autosaved' },
      select: { idempotencyKey: true, metadata: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.idempotencyKey).toBe(body.idempotencyKey);
    expect(events[0]?.metadata).toEqual({
      questionKey: 'q1',
      version: 1,
      clientElapsedMs: 12_345,
      bodySha256: expect.stringMatching(/^[0-9a-f]{64}$/u) as unknown,
    });
    // The event is metadata-only: no answer content (TL-123).
    expect(JSON.stringify(events[0]?.metadata)).not.toContain('choice');

    const read = await get(
      `/exam/attempts/${String(fixture.attemptId)}`,
      fixture.token,
    ).expect(200);
    expect((read.body.data as ExamAttemptBody).answers).toEqual([
      {
        questionKey: 'q1',
        answer: { choice: 'a' },
        isFlagged: true,
        version: 1,
        answeredAt: expect.any(String) as unknown,
        lastSavedAt: expect.any(String) as unknown,
      },
    ]);
    expectNoForbiddenKeys(read.body);
  });

  it('15. replays the same key and body without bumping the version or the event count (TL-123)', async () => {
    const fixture = await fourTypeAttempt('save-replay');
    const body = {
      answer: { value: true },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    };

    const first = await saveAnswer(
      fixture.token,
      fixture.attemptId,
      'q2',
      body,
    ).expect(200);
    const second = await saveAnswer(
      fixture.token,
      fixture.attemptId,
      'q2',
      body,
    ).expect(200);

    expect((first.body.data as { version: number }).version).toBe(1);
    expect((second.body.data as { version: number }).version).toBe(1);
    expect((second.body.data as { answer: unknown }).answer).toEqual({
      value: true,
    });
    for (const response of [first, second]) {
      expectNoForbiddenKeys(response.body);
    }

    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(1);
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'autosaved' },
      }),
    ).toBe(1);
  });

  it('16. rejects a reused key with a different body or a different question (TL-123)', async () => {
    const fixture = await fourTypeAttempt('save-key-reused');
    const key = newKey();
    await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: key,
    }).expect(200);

    const differentBody = await saveAnswer(
      fixture.token,
      fixture.attemptId,
      'q1',
      {
        answer: { choice: 'b' },
        isFlagged: false,
        expectedVersion: null,
        idempotencyKey: key,
      },
    ).expect(409);
    expect(differentBody.body).toEqual(
      apiError({
        code: 'EXAM_IDEMPOTENCY_KEY_REUSED',
        message: 'Idempotency key was already used for another exam test.',
      }),
    );

    const differentQuestion = await saveAnswer(
      fixture.token,
      fixture.attemptId,
      'q2',
      {
        answer: { value: true },
        isFlagged: false,
        expectedVersion: null,
        idempotencyKey: key,
      },
    ).expect(409);
    expect(differentQuestion.body.error.code).toBe(
      'EXAM_IDEMPOTENCY_KEY_REUSED',
    );
    expectNoForbiddenKeys(differentBody.body);
    expectNoForbiddenKeys(differentQuestion.body);
    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(1);
  });

  it('17. enforces expectedVersion and returns details.current on a conflict (TL-123)', async () => {
    const fixture = await fourTypeAttempt('save-version');
    const first = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(200);
    expect((first.body.data as { version: number }).version).toBe(1);

    const stale = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'b' },
      isFlagged: false,
      expectedVersion: 7,
      idempotencyKey: newKey(),
    }).expect(409);
    expect(stale.body.error).toMatchObject({
      code: 'EXAM_ANSWER_VERSION_CONFLICT',
      details: {
        current: {
          questionKey: 'q1',
          answer: { choice: 'a' },
          isFlagged: false,
          version: 1,
        },
      },
    });

    const alreadyExists = await saveAnswer(
      fixture.token,
      fixture.attemptId,
      'q1',
      {
        answer: { choice: 'b' },
        isFlagged: false,
        expectedVersion: null,
        idempotencyKey: newKey(),
      },
    ).expect(409);
    expect(alreadyExists.body.error).toMatchObject({
      code: 'EXAM_ANSWER_VERSION_CONFLICT',
      details: { current: { version: 1 } },
    });

    const noRowWithVersion = await saveAnswer(
      fixture.token,
      fixture.attemptId,
      'q2',
      {
        answer: { value: true },
        isFlagged: false,
        expectedVersion: 3,
        idempotencyKey: newKey(),
      },
    ).expect(409);
    expect(noRowWithVersion.body.error).toMatchObject({
      code: 'EXAM_ANSWER_VERSION_CONFLICT',
      details: { current: null },
    });

    const updated = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'b' },
      isFlagged: true,
      expectedVersion: 1,
      idempotencyKey: newKey(),
    }).expect(200);
    expect(updated.body.data).toMatchObject({
      questionKey: 'q1',
      answer: { choice: 'b' },
      isFlagged: true,
      version: 2,
    });
  });

  it('17b. rejects a missing answer or an out-of-range version field (TL-121)', async () => {
    const fixture = await fourTypeAttempt('save-body');
    const base = {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    };
    // `isFlagged` is not in this list: the global pipe enables implicit
    // conversion, so a JSON string is coerced to boolean before validation
    // (same behaviour as every other boolean body field in this codebase).
    const missingAnswer = await saveAnswer(
      fixture.token,
      fixture.attemptId,
      'q1',
      { ...base, answer: undefined },
    ).expect(400);
    expect(missingAnswer.body.error).toMatchObject({
      code: 'EXAM_ANSWER_INVALID',
      details: { field: 'answer' },
    });

    const bodies = [
      { ...base, expectedVersion: 0 },
      { ...base, expectedVersion: undefined },
      { ...base, clientElapsedMs: 86_400_001 },
      { ...base, clientElapsedMs: -1 },
      { ...base, clientElapsedMs: null },
    ];
    for (const body of bodies) {
      const response = await saveAnswer(
        fixture.token,
        fixture.attemptId,
        'q1',
        body,
      ).expect(400);
      expect(response.body.error.code).toBe('REQUEST_VALIDATION_FAILED');
    }
    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(0);
  });

  it('18. validates the four answer shapes against the snapshot (TL-122)', async () => {
    const fixture = await fourTypeAttempt('save-shapes');
    const invalid = [
      ['q1', { choice: 'z' }, 'answer.choice'],
      // Non-object shapes also reach the validator (TL-122): the DTO accepts
      // any JSON value so the service can report the documented field.
      ['q1', 'a', 'answer.choice'],
      ['q1', [1, 2], 'answer.choice'],
      ['q2', { value: 'yes' }, 'answer.value'],
      ['q2', true, 'answer.value'],
      ['q3', { text: '   ' }, 'answer.text'],
      ['q3', 42, 'answer.text'],
      ['q4', { order: ['t1'] }, 'answer.order'],
      ['q4', 't1,t2', 'answer.order'],
    ] as const;
    for (const [questionKey, answer, field] of invalid) {
      const response = await saveAnswer(
        fixture.token,
        fixture.attemptId,
        questionKey,
        {
          answer,
          isFlagged: false,
          expectedVersion: null,
          idempotencyKey: newKey(),
        },
      ).expect(400);
      expect(response.body.error).toMatchObject({
        code: 'EXAM_ANSWER_INVALID',
        details: { field },
      });
      expectNoForbiddenKeys(response.body);
    }
    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(0);

    const valid = [
      ['q1', { choice: 'a' }],
      ['q2', { value: false }],
      ['q3', { text: '  e\u0301  ' }],
      ['q4', { order: ['t1', 't2'] }],
    ] as const;
    for (const [questionKey, answer] of valid) {
      const response = await saveAnswer(
        fixture.token,
        fixture.attemptId,
        questionKey,
        {
          answer,
          isFlagged: false,
          expectedVersion: null,
          idempotencyKey: newKey(),
        },
      ).expect(200);
      expectNoForbiddenKeys(response.body);
    }
    const rows = await prisma.examAnswer.findMany({
      where: { attemptId: fixture.attemptId },
      orderBy: { snapshotQuestionKey: 'asc' },
      select: { snapshotQuestionKey: true, answer: true },
    });
    expect(rows).toEqual([
      { snapshotQuestionKey: 'q1', answer: { choice: 'a' } },
      { snapshotQuestionKey: 'q2', answer: { value: false } },
      // NFC + trim: the decomposed e + combining acute is stored composed.
      { snapshotQuestionKey: 'q3', answer: { text: '\u00e9' } },
      { snapshotQuestionKey: 'q4', answer: { order: ['t1', 't2'] } },
    ]);
  });

  it('19. maps an unknown or malformed question key to 404 EXAM_QUESTION_NOT_FOUND (TL-121)', async () => {
    const fixture = await fourTypeAttempt('save-unknown-key');
    for (const questionKey of ['q999', 'q01', 'not-a-key']) {
      const response = await saveAnswer(
        fixture.token,
        fixture.attemptId,
        questionKey,
        {
          answer: { choice: 'a' },
          isFlagged: false,
          expectedVersion: null,
          idempotencyKey: newKey(),
        },
      ).expect(404);
      expect(response.body.error.code).toBe('EXAM_QUESTION_NOT_FOUND');
      expectNoForbiddenKeys(response.body);
    }
  });

  it("20. hides another learner's attempt behind 404 (TL-121)", async () => {
    const fixture = await fourTypeAttempt('save-other-user');
    const response = await saveAnswer(otherToken, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(404);
    expect(response.body.error.code).toBe('EXAM_ATTEMPT_NOT_FOUND');
    expectNoForbiddenKeys(response.body);
    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(0);
  });

  it('21. rejects a save on an attempt that is no longer in progress (TL-126)', async () => {
    for (const status of ['submitted', 'timed_out'] as const) {
      const fixture = await fourTypeAttempt(`save-closed-${status}`);
      await prisma.examAttempt.update({
        where: { id: fixture.attemptId },
        data: { status, submittedAt: new Date() },
      });
      const response = await saveAnswer(
        fixture.token,
        fixture.attemptId,
        'q1',
        {
          answer: { choice: 'a' },
          isFlagged: false,
          expectedVersion: null,
          idempotencyKey: newKey(),
        },
      ).expect(409);
      expect(response.body.error).toMatchObject({
        code: 'EXAM_ATTEMPT_CLOSED',
        details: { status },
      });
      expectNoForbiddenKeys(response.body);
    }
  });

  it('22. lazily times out a save past the 5 second grace window (TL-126)', async () => {
    const fixture = await fourTypeAttempt('save-expired');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const response = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(409);
    expect(response.body.error).toMatchObject({ code: 'EXAM_ATTEMPT_EXPIRED' });
    expectNoForbiddenKeys(response.body);

    const attempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
      select: {
        status: true,
        submittedAt: true,
        expiresAt: true,
        remainingSeconds: true,
      },
    });
    expect(attempt.status).toBe('timed_out');
    expect(attempt.remainingSeconds).toBe(0);
    expect(attempt.submittedAt?.getTime()).toBe(attempt.expiresAt.getTime());

    const events = await prisma.examAttemptEvent.findMany({
      where: { attemptId: fixture.attemptId, type: 'timed_out' },
      select: { metadata: true },
    });
    expect(events).toEqual([{ metadata: { reason: 'expired_on_save' } }]);
    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(0);

    // The terminal state is not rewritten by a later save.
    const second = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(409);
    expect(second.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      details: { status: 'timed_out' },
    });
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'timed_out' },
      }),
    ).toBe(1);
  });

  it('23. accepts a save inside the 5 second grace window (TL-126)', async () => {
    const fixture = await fourTypeAttempt('save-grace');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 2_000),
      },
    });

    const response = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(200);
    expectNoForbiddenKeys(response.body);
    expect(
      (response.body.data as { version: number; remainingSeconds: number })
        .version,
    ).toBe(1);
    expect(
      (response.body.data as { remainingSeconds: number }).remainingSeconds,
    ).toBe(0);
    expect(
      (
        await prisma.examAttempt.findUniqueOrThrow({
          where: { id: fixture.attemptId },
          select: { status: true },
        })
      ).status,
    ).toBe('in_progress');
  });

  it('24. GET applies the lazy timeout once with reason expired_on_read (TL-127)', async () => {
    const fixture = await fourTypeAttempt('read-expired');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const first = await get(
      `/exam/attempts/${String(fixture.attemptId)}`,
      fixture.token,
    ).expect(200);
    const body = first.body.data as ExamAttemptBody;
    expect(body.status).toBe('timed_out');
    expect(body.remainingSeconds).toBe(0);
    expect(body.answers).toEqual([]);
    expectNoStore(first);
    expectNoForbiddenKeys(first.body);

    const second = await get(
      `/exam/attempts/${String(fixture.attemptId)}`,
      fixture.token,
    ).expect(200);
    expect((second.body.data as ExamAttemptBody).status).toBe('timed_out');

    const events = await prisma.examAttemptEvent.findMany({
      where: { attemptId: fixture.attemptId, type: 'timed_out' },
      select: { metadata: true },
    });
    expect(events).toEqual([{ metadata: { reason: 'expired_on_read' } }]);
  });

  it('25. saves a mixed batch per item and validates the batch envelope (TL-124)', async () => {
    const fixture = await fourTypeAttempt('save-batch');
    await saveAnswer(fixture.token, fixture.attemptId, 'q2', {
      answer: { value: true },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(200);

    const batch = await put(
      `/exam/attempts/${String(fixture.attemptId)}/answers`,
      fixture.token,
    )
      .send({
        items: [
          {
            questionKey: 'q1',
            answer: { choice: 'a' },
            isFlagged: true,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
          {
            questionKey: 'q2',
            answer: { value: false },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
          {
            questionKey: 'q3',
            answer: { text: '   ' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
          {
            questionKey: 'q999',
            answer: { text: 'x' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
        ],
      })
      .expect(200);

    const data = batch.body.data as {
      results: Array<{ questionKey: string; status: string }>;
      serverNow: string;
      remainingSeconds: number;
    };
    expect(
      data.results.map((result) => [result.questionKey, result.status]),
    ).toEqual([
      ['q1', 'saved'],
      ['q2', 'conflict'],
      ['q3', 'invalid'],
      ['q999', 'not_found'],
    ]);
    expect(data.serverNow).toEqual(expect.any(String));
    expect(data.remainingSeconds).toBeGreaterThan(0);
    expectNoForbiddenKeys(batch.body);

    // A good item commits even when a sibling item is invalid/conflicting.
    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(2);

    const tooMany = await put(
      `/exam/attempts/${String(fixture.attemptId)}/answers`,
      fixture.token,
    )
      .send({
        items: Array.from({ length: 21 }, (_unused, index) => ({
          questionKey: `q${String(index + 1)}`,
          answer: { choice: 'a' },
          isFlagged: false,
          expectedVersion: null,
          idempotencyKey: newKey(),
        })),
      })
      .expect(400);
    expect(tooMany.body.error.code).toBe('REQUEST_VALIDATION_FAILED');

    const duplicated = await put(
      `/exam/attempts/${String(fixture.attemptId)}/answers`,
      fixture.token,
    )
      .send({
        items: [
          {
            questionKey: 'q1',
            answer: { choice: 'a' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
          {
            questionKey: 'q1',
            answer: { choice: 'b' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
        ],
      })
      .expect(400);
    expect(duplicated.body.error.code).toBe('REQUEST_VALIDATION_FAILED');

    // A closed attempt fails the whole batch, not one item (TL-124/TL-126).
    const closedFixture = await fourTypeAttempt('save-batch-closed');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: closedFixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });
    const expiredBatch = await put(
      `/exam/attempts/${String(closedFixture.attemptId)}/answers`,
      closedFixture.token,
    )
      .send({
        items: [
          {
            questionKey: 'q1',
            answer: { choice: 'a' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
        ],
      })
      .expect(409);
    expect(expiredBatch.body.error.code).toBe('EXAM_ATTEMPT_EXPIRED');
    expect(
      await prisma.examAnswer.count({
        where: { attemptId: closedFixture.attemptId },
      }),
    ).toBe(0);
  });

  it('26. grants signed media for the attempt snapshot only (TL-128)', async () => {
    const imageId = await seedPrivateMediaObject(
      'grant-image',
      MediaType.image,
    );
    const audioId = await seedPrivateMediaObject(
      'grant-audio',
      MediaType.audio,
    );
    const questionImageId = await seedPrivateMediaObject(
      'grant-question-image',
      MediaType.image,
    );
    const notInSnapshotId = await seedPrivateMediaObject(
      'grant-unused',
      MediaType.image,
    );
    const questionId = await seedQuestion({
      type: QuestionType.mcq,
      skill: Skill.reading,
      content: `Câu có ảnh riêng M4.2b ${suffix}`,
      answers: { options: [{ id: 'a', text: 'A' }] },
      correctAnswer: { optionId: 'a' },
      imageId: questionImageId,
    });
    const testId = await seedTest({
      title: `Đề media grant M4.2b ${suffix}`,
      status: ContentStatus.published,
      passScore: 0,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [
            {
              title: null,
              imageId,
              audioId,
              questionIds: [questionId],
            },
          ],
        },
      ],
    });
    const learner = await register('grant');
    const attempt = await startAttempt(learner.token, testId);

    const otherLearner = await register('grant-other');
    const otherRead = await get(
      `/exam/attempts/${String(attempt)}/media-grants`,
      otherLearner.token,
    ).expect(404);
    expect(otherRead.body.error.code).toBe('EXAM_ATTEMPT_NOT_FOUND');
    expectNoForbiddenKeys(otherRead.body);

    const response = await get(
      `/exam/attempts/${String(attempt)}/media-grants`,
      learner.token,
    ).expect(200);
    expectNoStore(response);
    expectNoForbiddenKeys(response.body);
    const data = response.body.data as {
      grants: Array<{
        mediaId: number;
        kind: string;
        url: string;
        expiresAt: string;
      }>;
      unavailable: number[];
    };
    expect(data.grants.map((grant) => grant.mediaId)).toEqual([
      imageId,
      audioId,
      questionImageId,
    ]);
    expect(data.unavailable).toEqual([]);
    expect(data.grants.map((grant) => grant.kind)).toEqual([
      'image',
      'audio',
      'image',
    ]);
    for (const grant of data.grants) {
      expect(grant.url).toMatch(
        new RegExp(
          `^/api/v1/media/${String(grant.mediaId)}/content\\?expires=\\d+&signature=[0-9a-f]{64}$`,
          'u',
        ),
      );
      const ttl =
        Math.floor(Date.parse(grant.expiresAt) / 1_000) -
        Math.floor(Date.now() / 1_000);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
      // The signed URL is the one the existing content route verifies.
      await request(app.getHttpServer()).get(grant.url).expect(200);
    }
    expect(data.grants.map((grant) => grant.mediaId)).not.toContain(
      notInSnapshotId,
    );

    // A media row that is no longer usable is skipped and only its id leaks.
    await prisma.media.update({
      where: { id: audioId },
      data: {
        processingStatus: MediaProcessingStatus.quarantined,
        deletedAt: new Date(),
      },
    });
    const partial = await get(
      `/exam/attempts/${String(attempt)}/media-grants`,
      learner.token,
    ).expect(200);
    const partialData = partial.body.data as {
      grants: Array<{ mediaId: number }>;
      unavailable: number[];
    };
    expect(partialData.grants.map((grant) => grant.mediaId)).toEqual([
      imageId,
      questionImageId,
    ]);
    expect(partialData.unavailable).toEqual([audioId]);

    // Snapshot without media: an empty list, not an error.
    const bareQuestionId = await seedQuestion({
      type: QuestionType.mcq,
      skill: Skill.reading,
      content: `Câu không media M4.2b ${suffix}`,
      answers: { options: [{ id: 'a', text: 'A' }] },
      correctAnswer: { optionId: 'a' },
    });
    const bareTestId = await seedTest({
      title: `Đề không media M4.2b ${suffix}`,
      status: ContentStatus.published,
      passScore: 0,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [{ title: null, questionIds: [bareQuestionId] }],
        },
      ],
    });
    const bareAttempt = await startAttempt(learner.token, bareTestId);
    const bare = await get(
      `/exam/attempts/${String(bareAttempt)}/media-grants`,
      learner.token,
    ).expect(200);
    expect(bare.body.data).toEqual({ grants: [], unavailable: [] });

    // Q218: a finished attempt now gets review grants (fixed TTL) instead of
    // the old 409; an attempt that can no longer be used stays closed.
    await prisma.examAttempt.update({
      where: { id: bareAttempt },
      data: { status: 'submitted', submittedAt: new Date() },
    });
    const finished = await get(
      `/exam/attempts/${String(bareAttempt)}/media-grants`,
      learner.token,
    ).expect(200);
    expect(finished.body.data).toEqual({ grants: [], unavailable: [] });

    const closedFixture = await fourTypeAttempt('grant-closed');
    await prisma.examAttempt.update({
      where: { id: closedFixture.attemptId },
      data: { status: 'invalidated', invalidatedReason: 'e2e review grant' },
    });
    const closed = await get(
      `/exam/attempts/${String(closedFixture.attemptId)}/media-grants`,
      closedFixture.token,
    ).expect(409);
    expect(closed.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      details: { status: 'invalidated' },
    });

    const expiredFixture = await fourTypeAttempt('grant-expired');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: expiredFixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });
    const expired = await get(
      `/exam/attempts/${String(expiredFixture.attemptId)}/media-grants`,
      expiredFixture.token,
    ).expect(409);
    expect(expired.body.error.code).toBe('EXAM_ATTEMPT_EXPIRED');
    // This read is read-only: the attempt stays in_progress for GET to close.
    expect(
      (
        await prisma.examAttempt.findUniqueOrThrow({
          where: { id: expiredFixture.attemptId },
          select: { status: true },
        })
      ).status,
    ).toBe('in_progress');
  });

  it('27. blocks a start when a question media is no longer ready (TL-129)', async () => {
    const pendingAudioId = await seedMediaWithStatus(
      'question-audio-pending',
      MediaType.audio,
      MediaProcessingStatus.pending,
    );
    const archivedImageId = await seedMedia(
      'question-image-archived.png',
      MediaType.image,
    );
    await prisma.media.update({
      where: { id: archivedImageId },
      data: {
        processingStatus: MediaProcessingStatus.quarantined,
        deletedAt: new Date(),
      },
    });
    const questionId = await seedQuestion({
      type: QuestionType.listening,
      skill: Skill.listening,
      content: `Câu nghe media hỏng M4.2b ${suffix}`,
      answers: { options: [{ id: 'a', text: 'A' }] },
      correctAnswer: { optionId: 'a' },
      audioId: pendingAudioId,
      imageId: archivedImageId,
    });
    const testId = await seedTest({
      title: `Đề media câu hỏng M4.2b ${suffix}`,
      status: ContentStatus.published,
      passScore: 0,
      sections: [
        {
          skill: Skill.listening,
          title: 'Nghe hiểu',
          groups: [{ title: null, questionIds: [questionId] }],
        },
      ],
    });

    const response = await post(
      `/exam/tests/${String(testId)}/attempts`,
      learnerToken,
    )
      .send({ idempotencyKey: newKey() })
      .expect(409);
    expect(response.body.error).toMatchObject({
      code: 'EXAM_TEST_UNAVAILABLE',
    });
    expect(response.body.error.details.reasons).toEqual([
      {
        code: 'question_audio_not_ready',
        field: 'sections[0].groups[0].questionIds[0]',
      },
      {
        code: 'question_image_not_ready',
        field: 'sections[0].groups[0].questionIds[0]',
      },
    ]);
    expect(
      await prisma.examAttempt.count({
        where: { testId, userId: learnerId },
      }),
    ).toBe(0);
  });

  it('29. clears an answer with null but keeps the flag (TL-121)', async () => {
    const fixture = await fourTypeAttempt('save-clear');
    const created = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(200);
    expect((created.body.data as { version: number }).version).toBe(1);

    const clearKey = newKey();
    const clearBody = {
      answer: null,
      isFlagged: true,
      expectedVersion: 1,
      idempotencyKey: clearKey,
    };
    const cleared = await saveAnswer(
      fixture.token,
      fixture.attemptId,
      'q1',
      clearBody,
    ).expect(200);
    expect(cleared.body.data).toMatchObject({
      questionKey: 'q1',
      answer: null,
      isFlagged: true,
      version: 2,
    });
    expectNoForbiddenKeys(cleared.body);

    const read = await get(
      `/exam/attempts/${String(fixture.attemptId)}`,
      fixture.token,
    ).expect(200);
    expect((read.body.data as ExamAttemptBody).answers).toEqual([
      {
        questionKey: 'q1',
        answer: null,
        isFlagged: true,
        version: 2,
        answeredAt: expect.any(String) as unknown,
        lastSavedAt: expect.any(String) as unknown,
      },
    ]);
    // The row still exists: clearing stores JSON null, it does not delete.
    const row = await prisma.examAnswer.findUniqueOrThrow({
      where: {
        attemptId_snapshotQuestionKey: {
          attemptId: fixture.attemptId,
          snapshotQuestionKey: 'q1',
        },
      },
      select: { answer: true, answeredAt: true, isFlagged: true },
    });
    expect(row.answer).toBeNull();
    expect(row.isFlagged).toBe(true);
    expect(row.answeredAt).toEqual(expect.any(Date));

    // Repeating the exact clear request replays it without a new version.
    const replayed = await saveAnswer(
      fixture.token,
      fixture.attemptId,
      'q1',
      clearBody,
    ).expect(200);
    expect((replayed.body.data as { version: number }).version).toBe(2);
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'autosaved' },
      }),
    ).toBe(2);

    // A stale version with a new key is a conflict, not a replay.
    const stale = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'b' },
      isFlagged: true,
      expectedVersion: 1,
      idempotencyKey: newKey(),
    }).expect(409);
    expect(stale.body.error.code).toBe('EXAM_ANSWER_VERSION_CONFLICT');
  });

  it('28. carries no forbidden key on any M4.2b body (R11)', async () => {
    const fixture = await fourTypeAttempt('save-r11');
    const single = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: true,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(200);
    const batch = await put(
      `/exam/attempts/${String(fixture.attemptId)}/answers`,
      fixture.token,
    )
      .send({
        items: [
          {
            questionKey: 'q2',
            answer: { value: true },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
        ],
      })
      .expect(200);
    const attempted = await get(
      `/exam/attempts/${String(fixture.attemptId)}`,
      fixture.token,
    ).expect(200);
    const grants = await get(
      `/exam/attempts/${String(fixture.attemptId)}/media-grants`,
      fixture.token,
    ).expect(200);
    for (const response of [single, batch, attempted, grants]) {
      expectNoForbiddenKeys(response.body);
    }
    // The frozen snapshot still holds correctAnswer/explanation, so the walker
    // above is meaningful rather than vacuous.
    const snapshot = await prisma.examAttemptSnapshot.findUniqueOrThrow({
      where: { attemptId: fixture.attemptId },
      select: { payload: true },
    });
    const keys = collectKeys(snapshot.payload);
    expect(keys).toContain('correctAnswer');
    expect(keys).toContain('explanation');
  });

  it('30. rejects a deeply nested answer without a server fault (F2)', async () => {
    const fixture = await fourTypeAttempt('deep-answer');
    let deep: unknown = 'leaf';
    for (let depth = 0; depth < 17; depth += 1) deep = { a: deep };

    const response = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: deep,
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(400);
    expect(response.body.error).toMatchObject({
      code: 'EXAM_ANSWER_INVALID',
      details: { field: 'answer' },
    });
    expectNoForbiddenKeys(response.body);
    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(0);
  });

  it('31. rejects an answer with an own __proto__ key (F2)', async () => {
    const fixture = await fourTypeAttempt('proto-answer');
    const answer = JSON.parse(
      '{"choice":"a","__proto__":{"polluted":true}}',
    ) as object;

    const response = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer,
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(400);
    expect(response.body.error.code).toBe('EXAM_ANSWER_INVALID');
    expect(response.body.error.details).toEqual({ field: 'answer' });
    expectNoForbiddenKeys(response.body);

    // The raw-body guard is body-wide: a batch carrying one such item is a 400
    // for the whole request (a merely deep answer is per-item instead).
    const protoItem = JSON.parse(
      `{"questionKey":"q2","answer":{"value":true,"__proto__":{"polluted":true}},"isFlagged":false,"expectedVersion":null,"idempotencyKey":"${newKey()}"}`,
    ) as object;
    const batch = await put(
      `/exam/attempts/${String(fixture.attemptId)}/answers`,
      fixture.token,
    )
      .send({
        items: [
          {
            questionKey: 'q1',
            answer: { choice: 'a' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
          protoItem,
        ],
      })
      .expect(400);
    expect(batch.body.error).toMatchObject({
      code: 'EXAM_ANSWER_INVALID',
      details: { field: 'answer' },
    });
    expectNoForbiddenKeys(batch.body);

    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(0);
    // No prototype pollution reached any object in this process.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('32. keeps a batch alive when one item is deeply nested (F2)', async () => {
    const fixture = await fourTypeAttempt('batch-deep');
    let deep: unknown = 'leaf';
    for (let depth = 0; depth < 17; depth += 1) deep = { a: deep };

    const response = await put(
      `/exam/attempts/${String(fixture.attemptId)}/answers`,
      fixture.token,
    )
      .send({
        items: [
          {
            questionKey: 'q1',
            answer: { choice: 'a' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
          {
            questionKey: 'q2',
            answer: deep,
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
          {
            questionKey: 'q3',
            answer: { text: '你好' },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
        ],
      })
      .expect(200);

    const data = response.body.data as {
      results: Array<{ questionKey: string; status: string; code?: string }>;
    };
    expect(data.results.map((item) => [item.questionKey, item.status])).toEqual(
      [
        ['q1', 'saved'],
        ['q2', 'invalid'],
        ['q3', 'saved'],
      ],
    );
    expect(data.results[1]?.code).toBe('EXAM_ANSWER_INVALID');
    expectNoForbiddenKeys(response.body);
    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(2);
  });

  it('33. counts only answers with a non-null payload in the intro (F3)', async () => {
    const fixture = await fourTypeAttempt('answered-count');
    const intro = async (): Promise<number> => {
      const response = await get(
        `/exam/tests/${String(fixture.testId)}`,
        fixture.token,
      ).expect(200);
      return (response.body.data as ExamIntroBody).activeAttempt
        ?.answeredCount as number;
    };
    expect(await intro()).toBe(0);

    // Flagged, not answered: the row exists but its answer is JSON null.
    for (const questionKey of ['q1', 'q2']) {
      await saveAnswer(fixture.token, fixture.attemptId, questionKey, {
        answer: null,
        isFlagged: true,
        expectedVersion: null,
        idempotencyKey: newKey(),
      }).expect(200);
    }
    expect(await intro()).toBe(0);

    await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: true,
      expectedVersion: 1,
      idempotencyKey: newKey(),
    }).expect(200);
    expect(await intro()).toBe(1);

    await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: null,
      isFlagged: true,
      expectedVersion: 2,
      idempotencyKey: newKey(),
    }).expect(200);
    expect(await intro()).toBe(0);

    await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'b' },
      isFlagged: false,
      expectedVersion: 3,
      idempotencyKey: newKey(),
    }).expect(200);
    expect(await intro()).toBe(1);
  });

  it('34. shuffles and masks arrange_sentence tokens per attempt (TL-133)', async () => {
    const authored = [
      { id: 'orig-1', text: '我' },
      { id: 'orig-2', text: '爱' },
      { id: 'orig-3', text: '学习' },
      { id: 'orig-4', text: '中文' },
    ];
    const questionId = await seedQuestion({
      type: QuestionType.arrange_sentence,
      skill: Skill.reading,
      content: `Câu sắp xếp F9 ${suffix}`,
      answers: { tokens: authored },
      correctAnswer: { tokenIds: authored.map((token) => token.id) },
    });
    const testId = await seedTest({
      title: `Đề sắp xếp F9 ${suffix}`,
      status: ContentStatus.published,
      passScore: 0,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [{ title: null, questionIds: [questionId] }],
        },
      ],
    });
    const learner = await register('f9-arrange');
    const attemptId = await startAttempt(learner.token, testId);

    const read = await get(
      `/exam/attempts/${String(attemptId)}`,
      learner.token,
    ).expect(200);
    expectNoForbiddenKeys(read.body);
    const body = read.body.data as ExamAttemptBody;
    const question = body.sections[0]?.groups[0]?.questions[0];
    if (question === undefined) throw new Error('F9 question missing');
    const tokens = (
      question.answers as { tokens: Array<{ id: string; text: string }> }
    ).tokens;

    // (a) ids are renumbered per display position and none is the original id.
    expect(tokens.map((token) => token.id)).toEqual(['t1', 't2', 't3', 't4']);
    const originalIds = authored.map((token) => token.id);
    expect(tokens.some((token) => originalIds.includes(token.id))).toBe(false);
    // (b) the display order is not the authored (correct) sentence.
    expect(tokens.map((token) => token.text)).not.toEqual(
      authored.map((token) => token.text),
    );

    // (c) the frozen payload still rebuilds the correct sentence.
    const snapshot = await prisma.examAttemptSnapshot.findUniqueOrThrow({
      where: { attemptId },
      select: { payload: true },
    });
    const storedQuestion = snapshotQuestionByKey(
      snapshot.payload,
      question.key,
    );
    const storedTokens = (
      storedQuestion.answers as {
        tokens: Array<{ id: string; text: string }>;
      }
    ).tokens;
    const textByNewId = new Map(
      storedTokens.map((token) => [token.id, token.text]),
    );
    const storedAnswer = storedQuestion.correctAnswer as { tokenIds: string[] };
    expect(storedAnswer.tokenIds.map((id) => textByNewId.get(id))).toEqual(
      authored.map((token) => token.text),
    );

    // (d) only the per-attempt ids are accepted by the answer validator.
    const withOriginalIds = await saveAnswer(
      learner.token,
      attemptId,
      question.key,
      {
        answer: { order: originalIds },
        isFlagged: false,
        expectedVersion: null,
        idempotencyKey: newKey(),
      },
    ).expect(400);
    expect(withOriginalIds.body.error).toMatchObject({
      code: 'EXAM_ANSWER_INVALID',
      details: { field: 'answer.order' },
    });
    expectNoForbiddenKeys(withOriginalIds.body);

    const saved = await saveAnswer(learner.token, attemptId, question.key, {
      answer: { order: tokens.map((token) => token.id) },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(200);
    expectNoForbiddenKeys(saved.body);
  });

  function submit(
    attemptId: number,
    token: string,
    idempotencyKey: string = newKey(),
  ) {
    return post(`/exam/attempts/${String(attemptId)}/submit`, token).send({
      idempotencyKey,
    });
  }

  it('35. submits an in-progress attempt once and reports the aggregate counts (TL-150/TL-151)', async () => {
    const fixture = await fourTypeAttempt('submit-basic');
    await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(200);

    const response = await submit(
      fixture.attemptId,
      fixture.token,
      newKey(),
    ).expect(200);
    const data = response.body.data as ExamSubmitBody;
    expect(data).toMatchObject({
      id: fixture.attemptId,
      status: 'submitted',
      answeredCount: 1,
      unansweredCount: 3,
      flaggedCount: 0,
      replayed: false,
    });
    expect(Number.isFinite(Date.parse(data.submittedAt))).toBe(true);
    expect(Number.isFinite(Date.parse(data.serverNow))).toBe(true);
    expectNoStore(response);
    expectNoForbiddenKeys(response.body);

    const attempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
      select: {
        status: true,
        submittedAt: true,
        remainingSeconds: true,
      },
    });
    expect(attempt.status).toBe('submitted');
    expect(attempt.submittedAt).not.toBeNull();
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'submitted' },
      }),
    ).toBe(1);
    expect(
      await prisma.examAttemptEvent.count({
        where: {
          attemptId: fixture.attemptId,
          type: { in: ['submitted', 'timed_out'] },
        },
      }),
    ).toBe(1);
    // A2: submit itself grades the attempt into a Result (case 51), but it still
    // writes no answer row of its own and no extra autosave event.
    expect(
      await prisma.examAnswer.count({
        where: { attemptId: fixture.attemptId },
      }),
    ).toBe(1);
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'autosaved' },
      }),
    ).toBe(1);
  });

  it('36. replays the same submit key without a second transition or event (TL-151 step 2)', async () => {
    const fixture = await fourTypeAttempt('submit-replay');
    await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: true,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(200);

    const key = newKey();
    const first = await submit(fixture.attemptId, fixture.token, key).expect(
      200,
    );
    const firstData = first.body.data as ExamSubmitBody;
    const submittedAt = (
      await prisma.examAttempt.findUniqueOrThrow({
        where: { id: fixture.attemptId },
        select: { submittedAt: true },
      })
    ).submittedAt;

    const second = await submit(fixture.attemptId, fixture.token, key).expect(
      200,
    );
    const secondData = second.body.data as ExamSubmitBody;
    expect(secondData).toMatchObject({
      replayed: true,
      submittedAt: firstData.submittedAt,
      answeredCount: firstData.answeredCount,
      unansweredCount: firstData.unansweredCount,
      flaggedCount: firstData.flaggedCount,
    });
    expectNoForbiddenKeys(second.body);
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'submitted' },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.examAttempt.findUniqueOrThrow({
          where: { id: fixture.attemptId },
          select: { submittedAt: true },
        })
      ).submittedAt,
    ).toEqual(submittedAt);
  });

  it('37. maps a timed-out attempt to CLOSED and a second submit to ALREADY_SUBMITTED', async () => {
    const timedOut = await fourTypeAttempt('submit-timed-out');
    await prisma.examAttempt.update({
      where: { id: timedOut.attemptId },
      data: { status: 'timed_out', submittedAt: new Date() },
    });
    const closed = await submit(
      timedOut.attemptId,
      timedOut.token,
      newKey(),
    ).expect(409);
    expect(closed.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      details: { status: 'timed_out' },
    });

    const submitted = await fourTypeAttempt('submit-second-key');
    await submit(submitted.attemptId, submitted.token, newKey()).expect(200);
    const again = await submit(
      submitted.attemptId,
      submitted.token,
      newKey(),
    ).expect(409);
    expect(again.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_ALREADY_SUBMITTED',
      details: { status: 'submitted' },
    });
    expectNoForbiddenKeys(again.body);
  });

  it('38. two concurrent submits with different keys write exactly one terminal event', async () => {
    const fixture = await fourTypeAttempt('submit-race');
    const firstKey = newKey();
    const secondKey = newKey();
    const [first, second] = await Promise.all([
      submit(fixture.attemptId, fixture.token, firstKey),
      submit(fixture.attemptId, fixture.token, secondKey),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    const mismatch = [first, second].find(
      (response) => response.status === 409,
    );
    const code = (mismatch?.body.error as { code?: string } | undefined)?.code;
    expect(code).toBe('EXAM_ATTEMPT_ALREADY_SUBMITTED');
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'submitted' },
      }),
    ).toBe(1);
    expect(
      await prisma.examAttemptEvent.count({
        where: {
          attemptId: fixture.attemptId,
          type: { in: ['submitted', 'timed_out'] },
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.examAttempt.findUniqueOrThrow({
          where: { id: fixture.attemptId },
          select: { status: true },
        })
      ).status,
    ).toBe('submitted');
  });

  it('39. a submit racing the lazy timeout leaves exactly one terminal state', async () => {
    const fixture = await fourTypeAttempt('submit-vs-timeout');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const [submitted, read] = await Promise.all([
      submit(fixture.attemptId, fixture.token, newKey()),
      get(`/exam/attempts/${String(fixture.attemptId)}`, fixture.token),
    ]);
    expect(read.status).toBe(200);
    expect(submitted.status).toBe(409);
    const code = (submitted.body.error as { code?: string }).code;
    expect(['EXAM_ATTEMPT_EXPIRED', 'EXAM_ATTEMPT_CLOSED']).toContain(code);

    const attempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
      select: { status: true },
    });
    expect(attempt.status).toBe('timed_out');
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'timed_out' },
      }),
    ).toBe(1);
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'submitted' },
      }),
    ).toBe(0);
  });

  it('40. a submit past the grace window closes the attempt with expired_on_submit', async () => {
    const fixture = await fourTypeAttempt('submit-expired');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const response = await submit(
      fixture.attemptId,
      fixture.token,
      newKey(),
    ).expect(409);
    expect(response.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_EXPIRED',
    });
    const attempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
      select: {
        status: true,
        submittedAt: true,
        expiresAt: true,
        remainingSeconds: true,
        score: true,
      },
    });
    expect(attempt.status).toBe('timed_out');
    expect(attempt.remainingSeconds).toBe(0);
    expect(attempt.submittedAt?.getTime()).toBe(attempt.expiresAt.getTime());
    // A3a: a timeout on the submit path never grades, so no Result exists and
    // the attempt keeps a null score.
    expect(attempt.score).toBeNull();
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(0);
    expect(
      await prisma.examAttemptEvent.findMany({
        where: { attemptId: fixture.attemptId, type: 'timed_out' },
        select: { metadata: true },
      }),
    ).toEqual([{ metadata: { reason: 'expired_on_submit' } }]);
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'submitted' },
      }),
    ).toBe(0);
  });

  it('41. a submit inside the grace window is a normal submitted attempt (Q133)', async () => {
    const fixture = await fourTypeAttempt('submit-grace');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 2_000),
      },
    });

    const response = await submit(
      fixture.attemptId,
      fixture.token,
      newKey(),
    ).expect(200);
    expect((response.body.data as ExamSubmitBody).status).toBe('submitted');
    const attempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
      select: { status: true, remainingSeconds: true },
    });
    expect(attempt.status).toBe('submitted');
    expect(attempt.remainingSeconds).toBe(0);
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'timed_out' },
      }),
    ).toBe(0);
  });

  it("42. hides another learner's or an unknown attempt behind 404", async () => {
    const fixture = await fourTypeAttempt('submit-not-found');
    const foreign = await submit(
      fixture.attemptId,
      otherToken,
      newKey(),
    ).expect(404);
    expect(foreign.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_NOT_FOUND',
    });
    const unknown = await submit(2_147_000_000, fixture.token, newKey()).expect(
      404,
    );
    expect(unknown.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_NOT_FOUND',
    });
  });

  it('43. maps an invalidated attempt to EXAM_ATTEMPT_CLOSED', async () => {
    const fixture = await fourTypeAttempt('submit-invalidated');
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        status: 'invalidated',
        invalidatedReason: 'operator repair',
      },
    });
    const response = await submit(
      fixture.attemptId,
      fixture.token,
      newKey(),
    ).expect(409);
    expect(response.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      details: { status: 'invalidated' },
    });
  });

  it('44. carries no forbidden key and no score/result in the submit body (R11/TL-150)', async () => {
    const fixture = await fourTypeAttempt('submit-r11');
    const response = await submit(
      fixture.attemptId,
      fixture.token,
      newKey(),
    ).expect(200);
    expectNoForbiddenKeys(response.body);
    const data = response.body.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual([
      'answeredCount',
      'flaggedCount',
      'id',
      'replayed',
      'serverNow',
      'status',
      'submittedAt',
      'unansweredCount',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('score');
  });

  it('45. rejects a malformed or non-strict submit body with 400', async () => {
    const fixture = await fourTypeAttempt('submit-body');
    const missing = await post(
      `/exam/attempts/${String(fixture.attemptId)}/submit`,
      fixture.token,
    )
      .send({})
      .expect(400);
    expect(missing.body.error).toMatchObject({
      code: 'REQUEST_VALIDATION_FAILED',
    });

    const badUuid = await post(
      `/exam/attempts/${String(fixture.attemptId)}/submit`,
      fixture.token,
    )
      .send({ idempotencyKey: 'not-a-uuid' })
      .expect(400);
    expect(badUuid.body.error).toMatchObject({
      code: 'REQUEST_VALIDATION_FAILED',
    });

    for (const extra of [{ score: 100 }, { answers: [] }, { result: null }]) {
      const response = await post(
        `/exam/attempts/${String(fixture.attemptId)}/submit`,
        fixture.token,
      )
        .send({ idempotencyKey: newKey(), ...extra })
        .expect(400);
      expect(response.body.error).toMatchObject({
        code: 'REQUEST_VALIDATION_FAILED',
      });
    }
    // None of the rejected bodies may have closed the attempt.
    expect(
      (
        await prisma.examAttempt.findUniqueOrThrow({
          where: { id: fixture.attemptId },
          select: { status: true },
        })
      ).status,
    ).toBe('in_progress');
  });

  it('46. the database rejects a second Result and a Result for an open attempt', async () => {
    const fixture = await fourTypeAttempt('submit-result-integrity');
    await submit(fixture.attemptId, fixture.token, newKey()).expect(200);
    // A2: the submit transaction itself writes the Result, so the unique
    // `attemptId` is already claimed when the case starts.
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(1);

    const base = {
      userId: fixture.userId,
      testId: fixture.testId,
      attemptId: fixture.attemptId,
      score: 0,
      scoringVersion: 'hsk-p0-v1',
      detailJson: {},
    };
    const duplicate = await prisma.result.create({ data: base }).then(
      () => null,
      (error: unknown) => error as { code?: string },
    );
    expect(duplicate?.code).toBe('P2002');

    const open = await fourTypeAttempt('submit-result-open');
    const rejected = await prisma.result
      .create({
        data: {
          userId: open.userId,
          testId: open.testId,
          attemptId: open.attemptId,
          score: 0,
          scoringVersion: 'hsk-p0-v1',
          detailJson: {},
        },
      })
      .then(
        () => null,
        (error: unknown) => error as Error & { code?: string },
      );
    expect(String(rejected?.message)).toContain(
      'Result can only reference a submitted or timed-out ExamAttempt',
    );
  });

  it('47. keeps the attempt closed for single saves, batches and media grants after submit', async () => {
    const fixture = await fourTypeAttempt('submit-closed-ops');
    await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(200);
    const before = await prisma.examAttemptEvent.count({
      where: { attemptId: fixture.attemptId, type: 'autosaved' },
    });
    await submit(fixture.attemptId, fixture.token, newKey()).expect(200);

    const single = await saveAnswer(fixture.token, fixture.attemptId, 'q2', {
      answer: { value: true },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(409);
    expect(single.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      details: { status: 'submitted' },
    });

    const batch = await put(
      `/exam/attempts/${String(fixture.attemptId)}/answers`,
      fixture.token,
    )
      .send({
        items: [
          {
            questionKey: 'q2',
            answer: { value: true },
            isFlagged: false,
            expectedVersion: null,
            idempotencyKey: newKey(),
          },
        ],
      })
      .expect(409);
    expect(batch.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      details: { status: 'submitted' },
    });

    // Q158/Q218: a submitted attempt now gets review media grants instead of
    // the old 409; the grant TTL is the fixed 300 s review TTL.
    const grants = await get(
      `/exam/attempts/${String(fixture.attemptId)}/media-grants`,
      fixture.token,
    ).expect(200);
    // This fixture's snapshot has no media, so the terminal branch returns an
    // empty list instead of the old 409 (Q158/Q218).
    expect(grants.body.data).toEqual({ grants: [], unavailable: [] });

    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'autosaved' },
      }),
    ).toBe(before);
    const answer = await prisma.examAnswer.findUniqueOrThrow({
      where: {
        attemptId_snapshotQuestionKey: {
          attemptId: fixture.attemptId,
          snapshotQuestionKey: 'q1',
        },
      },
      select: { version: true },
    });
    expect(answer.version).toBe(1);
  });

  it('48. starts a fresh attempt after submit and reports no active attempt (Q120)', async () => {
    const fixture = await fourTypeAttempt('submit-restart');
    await submit(fixture.attemptId, fixture.token, newKey()).expect(200);

    const intro = await get(
      `/exam/tests/${String(fixture.testId)}`,
      fixture.token,
    ).expect(200);
    expect((intro.body.data as ExamIntroBody).activeAttempt).toBeNull();

    const nextAttemptId = await startAttempt(fixture.token, fixture.testId);
    expect(nextAttemptId).not.toBe(fixture.attemptId);
    expect(
      await prisma.examAttempt.count({
        where: { userId: fixture.userId, testId: fixture.testId },
      }),
    ).toBe(2);
  });

  it('49. replays a committed submit key even after the grace window (TL-151 step 2)', async () => {
    const fixture = await fourTypeAttempt('submit-replay-late');
    const key = newKey();
    await submit(fixture.attemptId, fixture.token, key).expect(200);
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const replayed = await submit(fixture.attemptId, fixture.token, key).expect(
      200,
    );
    expect((replayed.body.data as ExamSubmitBody).replayed).toBe(true);
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'timed_out' },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.examAttempt.findUniqueOrThrow({
          where: { id: fixture.attemptId },
          select: { status: true },
        })
      ).status,
    ).toBe('submitted');
  });

  it('50. a submitted attempt reports zero remaining before and after its deadline (TL-152)', async () => {
    const fixture = await fourTypeAttempt('submit-past-deadline');
    await submit(fixture.attemptId, fixture.token, newKey()).expect(200);

    // TL-152: the clock stops at submit, even with ~90 minutes left.
    const beforeDeadline = await get(
      `/exam/attempts/${String(fixture.attemptId)}`,
      fixture.token,
    ).expect(200);
    const beforeBody = beforeDeadline.body.data as ExamAttemptBody;
    expect(beforeBody.status).toBe('submitted');
    expect(beforeBody.remainingSeconds).toBe(0);

    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const read = await get(
      `/exam/attempts/${String(fixture.attemptId)}`,
      fixture.token,
    ).expect(200);
    const body = read.body.data as ExamAttemptBody;
    expect(body.status).toBe('submitted');
    expect(body.remainingSeconds).toBe(0);
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'timed_out' },
      }),
    ).toBe(0);
  });

  /**
   * A2 helpers: the graded `Result` row of one attempt (with its per-skill
   * breakdown), a convenience save for an already valid answer shape, and a
   * tag attached straight to a seeded question (`seedQuestion` has no tags).
   */
  async function attemptResult(attemptId: number) {
    return prisma.result.findUniqueOrThrow({
      where: { attemptId },
      select: {
        id: true,
        userId: true,
        testId: true,
        score: true,
        maxScore: true,
        passed: true,
        awardedBand: true,
        scoringVersion: true,
        publishedAt: true,
        detailJson: true,
        skillScores: { select: { skill: true, score: true, total: true } },
      },
    });
  }

  async function saveAnswerFor(
    token: string,
    attemptId: number,
    questionKey: string,
    answer: Prisma.InputJsonValue,
    isFlagged = false,
  ): Promise<void> {
    await saveAnswer(token, attemptId, questionKey, {
      answer,
      isFlagged,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(200);
  }

  async function seedMcqQuestion(label: string): Promise<number> {
    return seedQuestion({
      type: QuestionType.mcq,
      skill: Skill.reading,
      content: `Câu A2 ${label} ${suffix}`,
      answers: {
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
      correctAnswer: { optionId: 'a' },
    });
  }

  async function attachTag(
    questionId: number,
    slug: string,
    name: string,
  ): Promise<void> {
    const tag = await prisma.tag.upsert({
      where: { slug },
      update: {},
      create: { slug, name },
      select: { id: true },
    });
    await prisma.questionTag.create({
      data: { questionId, tagId: tag.id },
    });
  }

  it('51a. submit grades the attempt into exactly one Result with the frozen breakdown (A2)', async () => {
    const learner = await register('a2-result-shape');
    const gradedAttemptId = await startAttempt(learner.token, publishedTestId);

    // Reading: q1 (mcq), q2 (true_false), q3 (fill_blank) right, q4 (arrange)
    // left blank; listening: q5 right.
    await saveAnswerFor(learner.token, gradedAttemptId, 'q1', { choice: 'a' });
    await saveAnswerFor(learner.token, gradedAttemptId, 'q2', { value: true });
    await saveAnswerFor(learner.token, gradedAttemptId, 'q3', { text: '你好' });
    await saveAnswerFor(learner.token, gradedAttemptId, 'q5', { choice: 'b' });

    await submit(gradedAttemptId, learner.token, newKey()).expect(200);

    const [result, snapshot, attemptRow] = await Promise.all([
      attemptResult(gradedAttemptId),
      prisma.examAttemptSnapshot.findUniqueOrThrow({
        where: { attemptId: gradedAttemptId },
        select: { contentHash: true },
      }),
      prisma.examAttempt.findUniqueOrThrow({
        where: { id: gradedAttemptId },
        select: { scoringVersion: true },
      }),
    ]);

    expect(
      await prisma.result.count({ where: { attemptId: gradedAttemptId } }),
    ).toBe(1);
    // The frozen authoring/config version is recorded next to the grading one.
    expect(attemptRow.scoringVersion).toBe('hsk-p0-v1');
    // Q118/Q143: reading 3/4 => round(75), listening 1/1 => 100, so 175 of 200.
    expect(result).toMatchObject({
      userId: learner.userId,
      testId: publishedTestId,
      score: 175,
      maxScore: 200,
      passed: true,
      awardedBand: null,
      scoringVersion: 'exam-score-v1',
    });
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(result.detailJson).toEqual({
      schemaVersion: 1,
      attemptScoringVersion: attemptRow.scoringVersion,
      snapshotContentHash: snapshot.contentHash,
      counts: {
        answeredCount: 4,
        correctCount: 4,
        incorrectCount: 0,
        unansweredCount: 1,
      },
      sections: [
        {
          key: 's1',
          skill: Skill.reading,
          questionCount: 4,
          correctCount: 3,
          score: 75,
          maxScore: 100,
        },
        {
          key: 's2',
          skill: Skill.listening,
          questionCount: 1,
          correctCount: 1,
          score: 100,
          maxScore: 100,
        },
      ],
      weakAreas: [],
      questions: [
        { key: 'q1', isCorrect: true },
        { key: 'q2', isCorrect: true },
        { key: 'q3', isCorrect: true },
        { key: 'q4', isCorrect: false },
        { key: 'q5', isCorrect: true },
      ],
    });
    // Q155: the persisted breakdown never carries a key, an explanation or
    // question content.
    const serialized = JSON.stringify(result.detailJson);
    for (const leakedKey of [
      'optionId',
      'correctAnswer',
      'explanation',
      'acceptedTexts',
      'tokenIds',
    ]) {
      expect(serialized).not.toContain(leakedKey);
    }
    // Q153: a skill's score is the sum of its sections' rounded scores.
    expect(
      [...result.skillScores].sort((left, right) =>
        left.skill.localeCompare(right.skill),
      ),
    ).toEqual([
      { skill: Skill.listening, score: 100, total: 100 },
      { skill: Skill.reading, score: 75, total: 100 },
    ]);
  });

  it('51b. maps the frozen passScore to passed true, false and null', async () => {
    // publishedTestId freezes passScore 120 against maxScore 200.
    const passLearner = await register('a2-pass');
    const passAttemptId = await startAttempt(
      passLearner.token,
      publishedTestId,
    );
    await saveAnswerFor(passLearner.token, passAttemptId, 'q1', {
      choice: 'a',
    });
    await saveAnswerFor(passLearner.token, passAttemptId, 'q2', {
      value: true,
    });
    await saveAnswerFor(passLearner.token, passAttemptId, 'q3', {
      text: '你好',
    });
    await saveAnswerFor(passLearner.token, passAttemptId, 'q5', {
      choice: 'b',
    });
    await submit(passAttemptId, passLearner.token, newKey()).expect(200);
    const passedResult = await attemptResult(passAttemptId);
    expect(passedResult.score).toBe(175);
    expect(passedResult.passed).toBe(true);

    // 25 of 200: one right reading answer, listening blank.
    const failLearner = await register('a2-fail');
    const failAttemptId = await startAttempt(
      failLearner.token,
      publishedTestId,
    );
    await saveAnswerFor(failLearner.token, failAttemptId, 'q1', {
      choice: 'a',
    });
    await submit(failAttemptId, failLearner.token, newKey()).expect(200);
    const failedResult = await attemptResult(failAttemptId);
    expect(failedResult.score).toBe(25);
    expect(failedResult.passed).toBe(false);

    // Q145: a frozen passScore of null means "unknown", not "failed". The live
    // Test still has a pass line (A3a: 50), so this case proves the result reads
    // the FROZEN snapshot value, not the live `Test.passScore`. The frozen
    // payload below is the same shape an imported or legacy attempt carries;
    // save and submit still run over HTTP.
    const nullPassQuestionId = await seedMcqQuestion('pass-null');
    const nullPassTestId = await seedTest({
      title: `Đề không có điểm đỗ A2 ${suffix}`,
      status: ContentStatus.published,
      passScore: 50,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [{ title: null, questionIds: [nullPassQuestionId] }],
        },
      ],
    });
    const nullPassLearner = await register('a2-pass-null');
    const nullPassPayload: Prisma.InputJsonValue = {
      schemaVersion: 1,
      test: {
        id: nullPassTestId,
        title: `Đề không có điểm đỗ A2 ${suffix}`,
        instruction: null,
        levelCode: 'HSK4',
        durationMinutes: 90,
        passScore: null,
        maxScore: 100,
        scoringVersion: 'hsk-p0-v1',
      },
      sections: [
        {
          key: 's1',
          orderIndex: 1,
          skill: Skill.reading,
          title: 'Đọc hiểu',
          instruction: null,
          maxScore: 100,
          groups: [
            {
              key: 's1-g1',
              orderIndex: 1,
              title: null,
              instruction: null,
              content: null,
              audio: null,
              image: null,
              questions: [
                {
                  key: 'q1',
                  orderIndex: 1,
                  questionId: nullPassQuestionId,
                  questionVersion: 1,
                  type: QuestionType.mcq,
                  skill: Skill.reading,
                  content: `Câu A2 pass-null ${suffix}`,
                  answers: { options: [{ id: 'a', text: 'A' }] },
                  audio: null,
                  image: null,
                  correctAnswer: { optionId: 'a' },
                  explanation: null,
                },
              ],
            },
          ],
        },
      ],
    };
    const nullPassNow = new Date();
    const nullPassAttempt = await prisma.examAttempt.create({
      data: {
        userId: nullPassLearner.userId,
        testId: nullPassTestId,
        status: 'in_progress',
        startedAt: nullPassNow,
        expiresAt: new Date(nullPassNow.getTime() + 90 * 60_000),
        remainingSeconds: 5_400,
        maxScore: 100,
        scoringVersion: 'hsk-p0-v1',
        snapshotVersion: 1,
        idempotencyKey: newKey(),
      },
      select: { id: true },
    });
    await prisma.examAttemptSnapshot.create({
      data: {
        attemptId: nullPassAttempt.id,
        testVersion: 1,
        snapshotVersion: 1,
        contentHash: sha256CanonicalJson(nullPassPayload),
        payload: nullPassPayload,
      },
    });
    await saveAnswerFor(nullPassLearner.token, nullPassAttempt.id, 'q1', {
      choice: 'a',
    });
    await submit(nullPassAttempt.id, nullPassLearner.token, newKey()).expect(
      200,
    );
    const nullPassResult = await attemptResult(nullPassAttempt.id);
    expect(nullPassResult.score).toBe(100);
    expect(nullPassResult.passed).toBeNull();
  });

  it('51c. scores a blank answer as wrong without counting it as answered (Q143)', async () => {
    const questionIds = [
      await seedMcqQuestion('blank-1'),
      await seedMcqQuestion('blank-2'),
      await seedMcqQuestion('blank-3'),
    ];
    const testId = await seedTest({
      title: `Đề câu trống A2 ${suffix}`,
      status: ContentStatus.published,
      passScore: 0,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [{ title: null, questionIds }],
        },
      ],
    });
    const learner = await register('a2-blank');
    const blankAttemptId = await startAttempt(learner.token, testId);
    await saveAnswerFor(learner.token, blankAttemptId, 'q1', { choice: 'a' });
    await saveAnswerFor(learner.token, blankAttemptId, 'q2', { choice: 'a' });
    await submit(blankAttemptId, learner.token, newKey()).expect(200);

    const result = await attemptResult(blankAttemptId);
    // 2 correct of 3 in one section: round-half-up(100 × 2 / 3) = 67.
    expect(result.score).toBe(67);
    expect(result.detailJson).toMatchObject({
      counts: {
        answeredCount: 2,
        correctCount: 2,
        incorrectCount: 0,
        unansweredCount: 1,
      },
      sections: [
        {
          key: 's1',
          skill: Skill.reading,
          questionCount: 3,
          correctCount: 2,
          score: 67,
          maxScore: 100,
        },
      ],
      questions: [
        { key: 'q1', isCorrect: true },
        { key: 'q2', isCorrect: true },
        { key: 'q3', isCorrect: false },
      ],
    });
    const attemptRow = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: blankAttemptId },
      select: { score: true },
    });
    expect(attemptRow.score).toBe(67);
  });

  it('51d. grades arrange_sentence against the per-attempt masked token ids (TL-133)', async () => {
    const fixture = await fourTypeAttempt('a2-arrange');
    const read = await get(
      `/exam/attempts/${String(fixture.attemptId)}`,
      fixture.token,
    ).expect(200);
    const body = read.body.data as ExamAttemptBody;
    const arrangeQuestion = body.sections[0]?.groups[0]?.questions.find(
      (entry) => entry.type === 'arrange_sentence',
    );
    if (arrangeQuestion === undefined) {
      throw new Error('A2 arrange question missing');
    }
    const displayedTokens = (
      arrangeQuestion.answers as {
        tokens: Array<{ id: string; text: string }>;
      }
    ).tokens;

    // The correct sentence, as texts, comes from the frozen snapshot; the ids
    // the learner must submit are the masked display ids of those texts (TL-133).
    const snapshot = await prisma.examAttemptSnapshot.findUniqueOrThrow({
      where: { attemptId: fixture.attemptId },
      select: { payload: true },
    });
    const storedQuestion = snapshotQuestionByKey(
      snapshot.payload,
      arrangeQuestion.key,
    );
    const storedTokens = (
      storedQuestion.answers as { tokens: Array<{ id: string; text: string }> }
    ).tokens;
    const textByStoredId = new Map(
      storedTokens.map((token) => [token.id, token.text]),
    );
    const correctTexts = (
      storedQuestion.correctAnswer as { tokenIds: string[] }
    ).tokenIds.map((tokenId) => textByStoredId.get(tokenId) ?? '');
    const order = correctTexts.map((text) => {
      const match = displayedTokens.find((token) => token.text === text);
      if (match === undefined) {
        throw new Error(`A2 masked token "${text}" missing`);
      }
      return match.id;
    });
    expect(order).toHaveLength(correctTexts.length);

    await saveAnswerFor(fixture.token, fixture.attemptId, arrangeQuestion.key, {
      order,
    });
    await submit(fixture.attemptId, fixture.token, newKey()).expect(200);

    const result = await attemptResult(fixture.attemptId);
    const detail = result.detailJson as Prisma.JsonObject;
    expect(detail['questions']).toContainEqual({
      key: arrangeQuestion.key,
      isCorrect: true,
    });
    expect(result.score).toBe(25);
  });

  it('51e. builds weak areas from answered questions only, two answers minimum (Q154)', async () => {
    const weakSlug = `a2-weak-${suffix}`;
    const mediumSlug = `a2-medium-${suffix}`;
    const singleSlug = `a2-single-${suffix}`;
    const weakName = `A2 weak ${suffix}`;
    const mediumName = `A2 medium ${suffix}`;
    const singleName = `A2 single ${suffix}`;

    const weakQuestionIds = [
      await seedMcqQuestion('weak-1'),
      await seedMcqQuestion('weak-2'),
    ];
    const mediumQuestionIds = [
      await seedMcqQuestion('medium-1'),
      await seedMcqQuestion('medium-2'),
    ];
    // A3a: a third tagged question that stays unanswered must not change the
    // tag's answered/accuracy/level.
    const blankMediumQuestionId = await seedMcqQuestion('medium-3');
    const singleQuestionId = await seedMcqQuestion('single-1');
    for (const questionId of weakQuestionIds) {
      await attachTag(questionId, weakSlug, weakName);
    }
    for (const questionId of mediumQuestionIds) {
      await attachTag(questionId, mediumSlug, mediumName);
    }
    await attachTag(blankMediumQuestionId, mediumSlug, mediumName);
    await attachTag(singleQuestionId, singleSlug, singleName);

    const testId = await seedTest({
      title: `Đề weak area A2 ${suffix}`,
      status: ContentStatus.published,
      passScore: 0,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [
            {
              title: null,
              questionIds: [
                ...weakQuestionIds,
                ...mediumQuestionIds,
                singleQuestionId,
                // The blank medium question goes last so q1–q5 keep their
                // meaning for the assertions below.
                blankMediumQuestionId,
              ],
            },
          ],
        },
      ],
    });
    const learner = await register('a2-weak-areas');
    const weakAttemptId = await startAttempt(learner.token, testId);
    // q1/q2 are both wrong (weak), q3 right and q4 wrong (medium) while q6 of
    // that same tag stays blank, q5 is the only answered question of its tag
    // and must never be listed. Blank questions never count toward a tag.
    await saveAnswerFor(learner.token, weakAttemptId, 'q1', { choice: 'b' });
    await saveAnswerFor(learner.token, weakAttemptId, 'q2', { choice: 'b' });
    await saveAnswerFor(learner.token, weakAttemptId, 'q3', { choice: 'a' });
    await saveAnswerFor(learner.token, weakAttemptId, 'q4', { choice: 'b' });
    await saveAnswerFor(learner.token, weakAttemptId, 'q5', { choice: 'b' });
    await submit(weakAttemptId, learner.token, newKey()).expect(200);

    const detail = (await attemptResult(weakAttemptId))
      .detailJson as Prisma.JsonObject;
    // Accuracy 0 sorts before 0.5; the single-answer tag is excluded.
    expect(detail['weakAreas']).toEqual([
      {
        slug: weakSlug,
        name: weakName,
        answered: 2,
        correct: 0,
        accuracy: 0,
        level: 'weak',
      },
      {
        slug: mediumSlug,
        name: mediumName,
        answered: 2,
        correct: 1,
        accuracy: 0.5,
        level: 'medium',
      },
    ]);
  });

  it('51f. replays the submit key without writing a second Result', async () => {
    const fixture = await fourTypeAttempt('a2-replay');
    const key = newKey();
    await submit(fixture.attemptId, fixture.token, key).expect(200);
    const firstResult = await prisma.result.findUniqueOrThrow({
      where: { attemptId: fixture.attemptId },
    });
    const replayed = await submit(fixture.attemptId, fixture.token, key).expect(
      200,
    );
    expect((replayed.body.data as ExamSubmitBody).replayed).toBe(true);
    // A3a: the replay must not rewrite ANY column of the graded Result.
    expect(
      await prisma.result.findUniqueOrThrow({
        where: { attemptId: fixture.attemptId },
      }),
    ).toEqual(firstResult);
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(1);
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'submitted' },
      }),
    ).toBe(1);
  });

  it('51g. keeps ExamAttempt.score equal to Result.score', async () => {
    const fixture = await fourTypeAttempt('a2-attempt-score');
    await saveAnswerFor(fixture.token, fixture.attemptId, 'q1', {
      choice: 'a',
    });
    await submit(fixture.attemptId, fixture.token, newKey()).expect(200);

    const attemptRow = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
      select: { score: true },
    });
    const result = await attemptResult(fixture.attemptId);
    // 1 correct of 4 in the only section: round(25).
    expect(result.score).toBe(25);
    expect(attemptRow.score).toBe(result.score);
  });

  it('51h. keeps score out of the submitted event metadata', async () => {
    const fixture = await fourTypeAttempt('a2-event-metadata');
    await saveAnswerFor(
      fixture.token,
      fixture.attemptId,
      'q1',
      { choice: 'a' },
      true,
    );
    await submit(fixture.attemptId, fixture.token, newKey()).expect(200);

    // The Result proves grading ran, so the metadata check is not vacuous.
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(1);
    const events = await prisma.examAttemptEvent.findMany({
      where: { attemptId: fixture.attemptId, type: 'submitted' },
      select: { metadata: true },
    });
    expect(events).toEqual([
      {
        metadata: {
          reason: 'user_submit',
          answeredCount: 1,
          unansweredCount: 3,
          flaggedCount: 1,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('score');
  });

  it('51i. never grades a timed-out attempt', async () => {
    const fixture = await fourTypeAttempt('a2-timed-out');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const lateSave = await saveAnswer(fixture.token, fixture.attemptId, 'q1', {
      answer: { choice: 'a' },
      isFlagged: false,
      expectedVersion: null,
      idempotencyKey: newKey(),
    }).expect(409);
    expect(lateSave.body.error).toMatchObject({ code: 'EXAM_ATTEMPT_EXPIRED' });

    const read = await get(
      `/exam/attempts/${String(fixture.attemptId)}`,
      fixture.token,
    ).expect(200);
    expect((read.body.data as ExamAttemptBody).status).toBe('timed_out');

    const closed = await submit(
      fixture.attemptId,
      fixture.token,
      newKey(),
    ).expect(409);
    expect(closed.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      details: { status: 'timed_out' },
    });
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(0);
    const attemptRow = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
      select: { score: true },
    });
    expect(attemptRow.score).toBeNull();
  });

  it('51j. commits the submit but writes no Result when an answer has an unknown shape', async () => {
    const fixture = await fourTypeAttempt('a2-scoring-failed');
    // Bypass the answer validator on purpose: the stored row is readable JSON
    // but not the documented mcq shape, so grading fails closed.
    await prisma.examAnswer.create({
      data: {
        attemptId: fixture.attemptId,
        snapshotQuestionKey: 'q1',
        answer: { choice: 123 },
        isFlagged: false,
        answeredAt: new Date(),
      },
    });

    const response = await submit(
      fixture.attemptId,
      fixture.token,
      newKey(),
    ).expect(200);
    expect((response.body.data as ExamSubmitBody).status).toBe('submitted');
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(0);
    // The terminal transition and its event still committed; only grading was
    // skipped, so the attempt can be graded lazily later (A3).
    expect(
      await prisma.examAttemptEvent.count({
        where: { attemptId: fixture.attemptId, type: 'submitted' },
      }),
    ).toBe(1);
    const attemptRow = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
      select: { status: true, score: true },
    });
    expect(attemptRow).toEqual({ status: 'submitted', score: null });
  });

  /**
   * A3 helpers: the two read routes, and a manually frozen attempt for the
   * fixture the start gate rejects (a snapshot whose `passScore` is null while
   * the live Test still has a pass line).
   */
  function getResult(token: string, attemptId: number) {
    return get(`/exam/attempts/${String(attemptId)}/result`, token);
  }

  function getReview(token: string, attemptId: number) {
    return get(`/exam/attempts/${String(attemptId)}/review`, token);
  }

  async function createFrozenAttempt(input: {
    userId: number;
    testId: number;
    payload: Prisma.InputJsonValue;
    maxScore: number;
  }): Promise<number> {
    const now = new Date();
    const attempt = await prisma.examAttempt.create({
      data: {
        userId: input.userId,
        testId: input.testId,
        status: 'in_progress',
        startedAt: now,
        expiresAt: new Date(now.getTime() + 90 * 60_000),
        remainingSeconds: 90 * 60,
        maxScore: input.maxScore,
        scoringVersion: 'hsk-p0-v1',
        snapshotVersion: 1,
        idempotencyKey: newKey(),
      },
      select: { id: true },
    });
    await prisma.examAttemptSnapshot.create({
      data: {
        attemptId: attempt.id,
        testVersion: 1,
        snapshotVersion: 1,
        contentHash: sha256CanonicalJson(input.payload),
        payload: input.payload,
      },
    });
    return attempt.id;
  }

  it('52a. returns the stored result of a submitted attempt with no-store (A3/TL-165)', async () => {
    const learner = await register('a3-result-owner');
    const gradedAttemptId = await startAttempt(learner.token, publishedTestId);
    await saveAnswerFor(learner.token, gradedAttemptId, 'q1', { choice: 'a' });
    await saveAnswerFor(learner.token, gradedAttemptId, 'q2', { value: true });
    await saveAnswerFor(learner.token, gradedAttemptId, 'q3', { text: '你好' });
    await saveAnswerFor(learner.token, gradedAttemptId, 'q5', { choice: 'b' });
    await submit(gradedAttemptId, learner.token, newKey()).expect(200);

    const [resultRow, attemptRow, snapshot, response] = await Promise.all([
      attemptResult(gradedAttemptId),
      prisma.examAttempt.findUniqueOrThrow({
        where: { id: gradedAttemptId },
        select: { startedAt: true, submittedAt: true },
      }),
      prisma.examAttemptSnapshot.findUniqueOrThrow({
        where: { attemptId: gradedAttemptId },
        select: { payload: true },
      }),
      getResult(learner.token, gradedAttemptId).expect(200),
    ]);
    expectNoStore(response);

    const body = response.body.data as ExamResultBody;
    expect(Object.keys(body).sort()).toEqual([
      'attemptId',
      'counts',
      'gradedAt',
      'maxScore',
      'passScore',
      'passed',
      'score',
      'scoringVersion',
      'sections',
      'skills',
      'startedAt',
      'status',
      'submittedAt',
      'testId',
      'testTitle',
      'weakAreas',
    ]);
    expect(body).toMatchObject({
      attemptId: gradedAttemptId,
      testId: publishedTestId,
      status: 'submitted',
      testTitle: `Đề thi thử M4.2a ${suffix}`,
      startedAt: attemptRow.startedAt.toISOString(),
      submittedAt: attemptRow.submittedAt?.toISOString(),
      score: resultRow.score,
      maxScore: resultRow.maxScore,
      passScore: 120,
      passed: true,
      scoringVersion: 'exam-score-v1',
      gradedAt: resultRow.publishedAt?.toISOString(),
      counts: {
        answeredCount: 4,
        correctCount: 4,
        incorrectCount: 0,
        unansweredCount: 1,
      },
    });
    // Q118/Q143: reading 3/4 => 75, listening 1/1 => 100.
    expect(body.sections).toEqual([
      {
        key: 's1',
        title: 'Đọc hiểu',
        skill: Skill.reading,
        questionCount: 4,
        correctCount: 3,
        score: 75,
        maxScore: 100,
      },
      {
        key: 's2',
        title: 'Nghe hiểu',
        skill: Skill.listening,
        questionCount: 1,
        correctCount: 1,
        score: 100,
        maxScore: 100,
      },
    ]);
    // Q153: sorted by skill enum (listening before reading).
    expect(body.skills).toEqual([
      { skill: Skill.listening, score: 100, maxScore: 100 },
      { skill: Skill.reading, score: 75, maxScore: 100 },
    ]);
    expect(body.weakAreas).toEqual([]);
    // The title is the frozen snapshot title, not the live `Test.title`.
    const frozenTest = (snapshot.payload as Prisma.JsonObject)
      .test as Prisma.JsonObject;
    expect(frozenTest['title']).toBe(body.testTitle);
  });

  it("52b. hides another learner's or an unknown attempt behind 404", async () => {
    const learner = await register('a3-result-owner-404');
    const attemptId = await startAttempt(learner.token, publishedTestId);
    await submit(attemptId, learner.token, newKey()).expect(200);

    const foreign = await getResult(otherToken, attemptId).expect(404);
    expect(foreign.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_NOT_FOUND',
    });
    const unknown = await getResult(learner.token, 2_147_000_000).expect(404);
    expect(unknown.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_NOT_FOUND',
    });
  });

  it('52c. answers 409 EXAM_ATTEMPT_NOT_TERMINAL while the attempt is in progress', async () => {
    const fixture = await fourTypeAttempt('a3-result-open');
    const response = await getResult(fixture.token, fixture.attemptId).expect(
      409,
    );
    expect(response.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_NOT_TERMINAL',
    });
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(0);
  });

  it('52d. lazily times out an expired attempt and grades it on the first result read', async () => {
    const fixture = await fourTypeAttempt('a3-result-timeout');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const response = await getResult(fixture.token, fixture.attemptId).expect(
      200,
    );
    expectNoStore(response);
    const body = response.body.data as ExamResultBody;
    const attemptRow = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
      select: { status: true, submittedAt: true, expiresAt: true, score: true },
    });
    expect(attemptRow.status).toBe('timed_out');
    expect(body.status).toBe('timed_out');
    // Q146: a timed-out attempt is graded like a submitted one; the timeout sets
    // submittedAt to the attempt deadline.
    expect(body.submittedAt).toBe(attemptRow.expiresAt.toISOString());
    expect(
      await prisma.examAttemptEvent.findMany({
        where: { attemptId: fixture.attemptId, type: 'timed_out' },
        select: { metadata: true },
      }),
    ).toEqual([{ metadata: { reason: 'expired_on_read' } }]);
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(1);
    const [resultRow] = await prisma.result.findMany({
      where: { attemptId: fixture.attemptId },
      select: { score: true },
    });
    expect(resultRow?.score).toBe(body.score);
    // A3a/Q155: the attempt mirrors the score because it has a maxScore.
    expect(attemptRow.score).toBe(body.score);
  });

  it('52e. grades a timed_out attempt exactly once and repeats the same result', async () => {
    const fixture = await fourTypeAttempt('a3-result-once');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const first = await getResult(fixture.token, fixture.attemptId).expect(200);
    const stored = await prisma.result.findUniqueOrThrow({
      where: { attemptId: fixture.attemptId },
    });
    const second = await getResult(fixture.token, fixture.attemptId).expect(
      200,
    );

    expect(second.body.data).toEqual(first.body.data);
    expect(
      await prisma.result.findUniqueOrThrow({
        where: { attemptId: fixture.attemptId },
      }),
    ).toEqual(stored);
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(1);
  });

  it('52f. maps an invalidated attempt to EXAM_ATTEMPT_CLOSED without the answer key (Q157)', async () => {
    const fixture = await fourTypeAttempt('a3-result-invalidated');
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        status: 'invalidated',
        invalidatedReason: 'operator repair',
      },
    });

    const response = await getResult(fixture.token, fixture.attemptId).expect(
      409,
    );
    expect(response.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      details: { status: 'invalidated' },
    });
    const serialized = JSON.stringify(response.body);
    for (const leaked of ['correctAnswer', 'explanation', 'questions']) {
      expect(serialized).not.toContain(leaked);
    }
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(0);
  });

  it('52g. answers 409 EXAM_RESULT_UNAVAILABLE when grading fails (Q156)', async () => {
    const fixture = await fourTypeAttempt('a3-result-unavailable');
    // Bypass the validator on purpose: the stored row is readable JSON but not
    // the documented mcq shape, so grading fails closed.
    await prisma.examAnswer.create({
      data: {
        attemptId: fixture.attemptId,
        snapshotQuestionKey: 'q1',
        answer: { choice: 123 },
        isFlagged: false,
        answeredAt: new Date(),
      },
    });
    // A2: the submit still commits, without a Result.
    await submit(fixture.attemptId, fixture.token, newKey()).expect(200);

    const response = await getResult(fixture.token, fixture.attemptId).expect(
      409,
    );
    expect(response.body.error).toMatchObject({
      code: 'EXAM_RESULT_UNAVAILABLE',
    });
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(0);
    expect(
      (
        await prisma.examAttempt.findUniqueOrThrow({
          where: { id: fixture.attemptId },
          select: { status: true },
        })
      ).status,
    ).toBe('submitted');

    // Q156 applies to both read routes.
    const review = await getReview(fixture.token, fixture.attemptId).expect(
      409,
    );
    expect(review.body.error).toMatchObject({
      code: 'EXAM_RESULT_UNAVAILABLE',
    });
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(0);
  });

  it('52h. returns passed null when the frozen passScore is null (Q145)', async () => {
    const questionId = await seedMcqQuestion('a3-pass-null');
    const testId = await seedTest({
      title: `Đề A3 pass null ${suffix}`,
      status: ContentStatus.published,
      // A3a: the live test has a pass line; the frozen snapshot does not.
      passScore: 50,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [{ title: null, questionIds: [questionId] }],
        },
      ],
    });
    const learner = await register('a3-pass-null');
    const payload: Prisma.InputJsonValue = {
      schemaVersion: 1,
      test: {
        id: testId,
        title: `Đề A3 pass null ${suffix}`,
        instruction: null,
        levelCode: 'HSK4',
        durationMinutes: 90,
        passScore: null,
        maxScore: 100,
        scoringVersion: 'hsk-p0-v1',
      },
      sections: [
        {
          key: 's1',
          orderIndex: 1,
          skill: Skill.reading,
          title: 'Đọc hiểu',
          instruction: null,
          maxScore: 100,
          groups: [
            {
              key: 's1-g1',
              orderIndex: 1,
              title: null,
              instruction: null,
              content: null,
              audio: null,
              image: null,
              questions: [
                {
                  key: 'q1',
                  orderIndex: 1,
                  questionId,
                  questionVersion: 1,
                  type: QuestionType.mcq,
                  skill: Skill.reading,
                  content: `Câu A3 pass null ${suffix}`,
                  answers: { options: [{ id: 'a', text: 'A' }] },
                  audio: null,
                  image: null,
                  correctAnswer: { optionId: 'a' },
                  explanation: null,
                },
              ],
            },
          ],
        },
      ],
    };
    const attemptId = await createFrozenAttempt({
      userId: learner.userId,
      testId,
      payload,
      maxScore: 100,
    });
    await saveAnswerFor(learner.token, attemptId, 'q1', { choice: 'a' });
    await submit(attemptId, learner.token, newKey()).expect(200);

    const response = await getResult(learner.token, attemptId).expect(200);
    const body = response.body.data as ExamResultBody;
    expect(body.score).toBe(100);
    expect(body.passScore).toBeNull();
    expect(body.passed).toBeNull();
  });

  it('52i. carries no forbidden key on the result body (R11)', async () => {
    const fixture = await fourTypeAttempt('a3-result-r11');
    await saveAnswerFor(fixture.token, fixture.attemptId, 'q1', {
      choice: 'a',
    });
    await submit(fixture.attemptId, fixture.token, newKey()).expect(200);

    const response = await getResult(fixture.token, fixture.attemptId).expect(
      200,
    );
    expectNoForbiddenKeys(response.body);
  });

  it('52j. commits the lazy timeout even when the first read fails scoring (Q156)', async () => {
    // The scoring_failed branch must not throw inside the transaction: the
    // timeout transition has to commit, and only then the request answers 409.
    const resultFixture = await fourTypeAttempt('a3-q156-lazy-timeout');
    await prisma.examAnswer.create({
      data: {
        attemptId: resultFixture.attemptId,
        snapshotQuestionKey: 'q1',
        answer: { choice: 123 },
        isFlagged: false,
        answeredAt: new Date(),
      },
    });
    const resultNowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: resultFixture.attemptId },
      data: {
        startedAt: new Date(resultNowMs - 91 * 60_000),
        expiresAt: new Date(resultNowMs - 10_000),
      },
    });

    const response = await getResult(
      resultFixture.token,
      resultFixture.attemptId,
    ).expect(409);
    expect(response.body.error).toMatchObject({
      code: 'EXAM_RESULT_UNAVAILABLE',
    });
    const resultAttempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: resultFixture.attemptId },
      select: { status: true, submittedAt: true, expiresAt: true },
    });
    expect(resultAttempt.status).toBe('timed_out');
    expect(resultAttempt.submittedAt?.getTime()).toBe(
      resultAttempt.expiresAt.getTime(),
    );
    expect(
      await prisma.examAttemptEvent.findMany({
        where: { attemptId: resultFixture.attemptId, type: 'timed_out' },
        select: { metadata: true },
      }),
    ).toEqual([{ metadata: { reason: 'expired_on_read' } }]);
    expect(
      await prisma.result.count({
        where: { attemptId: resultFixture.attemptId },
      }),
    ).toBe(0);

    // The same contract on the review route, with a different attempt.
    const reviewFixture = await fourTypeAttempt('a3-q156-lazy-timeout-review');
    await prisma.examAnswer.create({
      data: {
        attemptId: reviewFixture.attemptId,
        snapshotQuestionKey: 'q1',
        answer: { choice: 123 },
        isFlagged: false,
        answeredAt: new Date(),
      },
    });
    const reviewNowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: reviewFixture.attemptId },
      data: {
        startedAt: new Date(reviewNowMs - 91 * 60_000),
        expiresAt: new Date(reviewNowMs - 10_000),
      },
    });

    const reviewResponse = await getReview(
      reviewFixture.token,
      reviewFixture.attemptId,
    ).expect(409);
    expect(reviewResponse.body.error).toMatchObject({
      code: 'EXAM_RESULT_UNAVAILABLE',
    });
    const reviewAttempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: reviewFixture.attemptId },
      select: { status: true, submittedAt: true, expiresAt: true },
    });
    expect(reviewAttempt.status).toBe('timed_out');
    expect(reviewAttempt.submittedAt?.getTime()).toBe(
      reviewAttempt.expiresAt.getTime(),
    );
    expect(
      await prisma.examAttemptEvent.findMany({
        where: { attemptId: reviewFixture.attemptId, type: 'timed_out' },
        select: { metadata: true },
      }),
    ).toEqual([{ metadata: { reason: 'expired_on_read' } }]);
    expect(
      await prisma.result.count({
        where: { attemptId: reviewFixture.attemptId },
      }),
    ).toBe(0);
  });

  it('53a. reviews every frozen question in order with the stored correctness (A3/TL-166)', async () => {
    const learner = await register('a3-review-owner');
    const reviewAttemptId = await startAttempt(learner.token, publishedTestId);
    await saveAnswerFor(learner.token, reviewAttemptId, 'q1', { choice: 'a' });
    await saveAnswerFor(learner.token, reviewAttemptId, 'q2', { value: false });
    await saveAnswerFor(learner.token, reviewAttemptId, 'q3', { text: '你好' });
    await saveAnswerFor(learner.token, reviewAttemptId, 'q5', { choice: 'b' });
    await submit(reviewAttemptId, learner.token, newKey()).expect(200);

    const [response, resultRow, snapshot] = await Promise.all([
      getReview(learner.token, reviewAttemptId).expect(200),
      attemptResult(reviewAttemptId),
      prisma.examAttemptSnapshot.findUniqueOrThrow({
        where: { attemptId: reviewAttemptId },
        select: { payload: true },
      }),
    ]);
    expectNoStore(response);
    const body = response.body.data as ExamReviewBody;
    expect(body).toMatchObject({
      attemptId: reviewAttemptId,
      status: 'submitted',
      testTitle: `Đề thi thử M4.2a ${suffix}`,
    });

    // Q148: every question of the frozen snapshot, section → group → question.
    expect(body.questions.map((question) => question.key)).toEqual([
      'q1',
      'q2',
      'q3',
      'q4',
      'q5',
    ]);
    expect(body.questions.map((question) => question.orderIndex)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(body.questions.map((question) => question.type)).toEqual([
      'mcq',
      'true_false',
      'fill_blank',
      'arrange_sentence',
      'mcq',
    ]);
    expect(body.questions.map((question) => question.skill)).toEqual([
      Skill.reading,
      Skill.reading,
      Skill.reading,
      Skill.reading,
      Skill.listening,
    ]);
    // Q148: isCorrect is read from Result.detailJson.questions by key.
    const detail = resultRow.detailJson as Prisma.JsonObject;
    const graded = new Map(
      (detail['questions'] as Prisma.JsonArray).map((entry) => {
        const record = entry as Prisma.JsonObject;
        return [record['key'] as string, record['isCorrect'] as boolean];
      }),
    );
    expect(body.questions.map((question) => question.isCorrect)).toEqual(
      body.questions.map((question) => graded.get(question.key)),
    );
    expect(body.questions.map((question) => question.isCorrect)).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
    // The blank question reads as null and wrong.
    expect(body.questions[3]).toMatchObject({
      key: 'q4',
      learnerAnswer: null,
      isCorrect: false,
    });
    // The answer key and explanation are the frozen snapshot copies. The live
    // row of q1 was edited by earlier cases, so the fixture here is the stored
    // snapshot itself (that is exactly the Q148 invariant).
    const snapshotQ1 = snapshotQuestionByKey(snapshot.payload, 'q1');
    const snapshotQ3 = snapshotQuestionByKey(snapshot.payload, 'q3');
    expect(snapshotQ1.correctAnswer).toEqual({ optionId: 'a' });
    expect(snapshotQ3.correctAnswer).toEqual({
      acceptedTexts: ['你好'],
      caseSensitive: false,
    });
    expect(body.questions[0]).toMatchObject({
      content: snapshotQ1.content,
      learnerAnswer: { choice: 'a' },
      correctAnswer: snapshotQ1.correctAnswer,
      explanation: snapshotQ1.explanation,
      isCorrect: true,
    });
    expect(body.questions[2]).toMatchObject({
      answers: {},
      learnerAnswer: { text: '你好' },
      correctAnswer: snapshotQ3.correctAnswer,
      explanation: snapshotQ3.explanation,
    });
    // Q158/Q217: the review now carries the frozen snapshot media refs (no
    // signed URL) so the client can match a media grant.
    expect(body.questions[0]?.groupMedia.image).not.toBeNull();
    expect(body.questions[4]?.audio).not.toBeNull();
    expect(JSON.stringify(body)).not.toContain('/media/');
  });

  it('53b. keeps arrange ids in the masked snapshot space in all three places (Q158/TL-133)', async () => {
    const arrangeQuestionId = await seedQuestion({
      type: QuestionType.arrange_sentence,
      skill: Skill.reading,
      content: `Câu arrange masked A3 ${suffix}`,
      answers: {
        tokens: [
          { id: 'authored-b', text: '二' },
          { id: 'authored-a', text: '一' },
        ],
      },
      correctAnswer: { tokenIds: ['authored-a', 'authored-b'] },
    });
    const testId = await seedTest({
      title: `Đề arrange masked A3 ${suffix}`,
      status: ContentStatus.published,
      passScore: 0,
      sections: [
        {
          skill: Skill.reading,
          title: 'Sắp xếp',
          groups: [{ title: null, questionIds: [arrangeQuestionId] }],
        },
      ],
    });
    const learner = await register('a3-review-masked');
    const attemptId = await startAttempt(learner.token, testId);
    const read = await get(
      `/exam/attempts/${String(attemptId)}`,
      learner.token,
    ).expect(200);
    const displayedTokens = (
      (read.body.data as ExamAttemptBody).sections[0]?.groups[0]?.questions[0]
        ?.answers as { tokens: Array<{ id: string; text: string }> }
    ).tokens;
    const snapshot = await prisma.examAttemptSnapshot.findUniqueOrThrow({
      where: { attemptId },
      select: { payload: true },
    });
    const storedQuestion = snapshotQuestionByKey(snapshot.payload, 'q1');
    const storedTokens = (
      storedQuestion.answers as { tokens: Array<{ id: string; text: string }> }
    ).tokens;
    const textById = new Map(
      storedTokens.map((token) => [token.id, token.text]),
    );
    const correctTexts = (
      storedQuestion.correctAnswer as { tokenIds: string[] }
    ).tokenIds.map((tokenId) => textById.get(tokenId) ?? '');
    const order = correctTexts.map((text) => {
      const match = displayedTokens.find((token) => token.text === text);
      if (match === undefined) throw new Error('A3 masked token missing');
      return match.id;
    });
    await saveAnswerFor(learner.token, attemptId, 'q1', { order });
    await submit(attemptId, learner.token, newKey()).expect(200);

    const review = await getReview(learner.token, attemptId).expect(200);
    const body = review.body.data as ExamReviewBody;
    const question = body.questions[0];
    if (question === undefined) throw new Error('A3 review question missing');
    const tokenIds = (
      question.answers as { tokens: Array<{ id: string }> }
    ).tokens.map((token) => token.id);
    const correct = question.correctAnswer as { tokenIds: string[] };

    // TL-133: the display ids are t1…tn in display order; the authored ids
    // never leave the frozen snapshot.
    expect(tokenIds).toEqual(['t1', 't2']);
    expect([...correct.tokenIds].sort()).toEqual([...tokenIds].sort());
    expect(question.learnerAnswer).toEqual({ order });
    expect(correct.tokenIds).toEqual(order);
    expect(JSON.stringify(review.body)).not.toContain('authored');
  });

  it('53c. returns the frozen snapshot after the live question changes (Q148)', async () => {
    const fixture = await fourTypeAttempt('a3-review-frozen');
    // The first question of the fixture test is the mcq (q1).
    const placement = await prisma.testQuestion.findFirstOrThrow({
      where: { testId: fixture.testId },
      orderBy: { orderIndex: 'asc' },
      select: { questionId: true },
    });
    // Mutate the LIVE row after the snapshot was frozen at start.
    await prisma.question.update({
      where: { id: placement.questionId },
      data: {
        content: 'Nội dung live đã sửa',
        correctAnswer: { optionId: 'b' },
        explanation: 'Giải thích live',
      },
    });

    await saveAnswerFor(fixture.token, fixture.attemptId, 'q1', {
      choice: 'a',
    });
    await submit(fixture.attemptId, fixture.token, newKey()).expect(200);

    const review = await getReview(fixture.token, fixture.attemptId).expect(
      200,
    );
    const question = (review.body.data as ExamReviewBody).questions[0];
    if (question === undefined) throw new Error('A3 review question missing');
    expect(question).toMatchObject({
      key: 'q1',
      content: `Câu mcq M4.2b a3-review-frozen ${suffix}`,
      correctAnswer: { optionId: 'a' },
      explanation: null,
      isCorrect: true,
    });
  });

  it('53d. grades a timed_out attempt lazily on review and only once (Q147)', async () => {
    const fixture = await fourTypeAttempt('a3-review-timeout');
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: fixture.attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const first = await getReview(fixture.token, fixture.attemptId).expect(200);
    const body = first.body.data as ExamReviewBody;
    expect(body.status).toBe('timed_out');
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(1);
    const second = await getReview(fixture.token, fixture.attemptId).expect(
      200,
    );
    expect(second.body.data).toEqual(first.body.data);
    expect(
      await prisma.result.count({ where: { attemptId: fixture.attemptId } }),
    ).toBe(1);
  });

  it('53e. rejects an open or invalidated review without the answer key', async () => {
    const open = await fourTypeAttempt('a3-review-open');
    const openResponse = await getReview(open.token, open.attemptId).expect(
      409,
    );
    expect(openResponse.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_NOT_TERMINAL',
    });

    const invalidated = await fourTypeAttempt('a3-review-invalidated');
    await prisma.examAttempt.update({
      where: { id: invalidated.attemptId },
      data: { status: 'invalidated', invalidatedReason: 'operator repair' },
    });
    const closed = await getReview(
      invalidated.token,
      invalidated.attemptId,
    ).expect(409);
    expect(closed.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      details: { status: 'invalidated' },
    });
    const serialized = JSON.stringify(closed.body);
    for (const leaked of ['correctAnswer', 'explanation', 'questions']) {
      expect(serialized).not.toContain(leaked);
    }
    expect(
      await prisma.result.count({
        where: { attemptId: invalidated.attemptId },
      }),
    ).toBe(0);

    const foreign = await getReview(otherToken, open.attemptId).expect(404);
    expect(foreign.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_NOT_FOUND',
    });

    // A foreign caller of a TERMINAL attempt must still see 404, not the answer
    // key: the ownership filter runs before the terminal/status branches.
    const submitted = await fourTypeAttempt('a3-review-foreign-submitted');
    await submit(submitted.attemptId, submitted.token, newKey()).expect(200);
    const foreignTerminal = await getReview(
      otherToken,
      submitted.attemptId,
    ).expect(404);
    expect(foreignTerminal.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_NOT_FOUND',
    });
    expect(JSON.stringify(foreignTerminal.body)).not.toContain('correctAnswer');
    expect(JSON.stringify(foreignTerminal.body)).not.toContain('explanation');
  });

  it('53f. returns the frozen snapshot media refs for every review question (Q158/Q217)', async () => {
    const learner = await register('a3-review-media');
    const attemptId = await startAttempt(learner.token, publishedTestId);
    // Prove the fixture really has media on the attempt view.
    const attemptView = await get(
      `/exam/attempts/${String(attemptId)}`,
      learner.token,
    ).expect(200);
    const viewBody = attemptView.body.data as ExamAttemptBody;
    expect(viewBody.sections[0]?.groups[0]?.image).not.toBeNull();
    expect(viewBody.sections[1]?.groups[0]?.questions[0]?.audio).not.toBeNull();

    await submit(attemptId, learner.token, newKey()).expect(200);
    const review = await getReview(learner.token, attemptId).expect(200);
    const body = review.body.data as ExamReviewBody;
    expect(body.questions).toHaveLength(5);
    // Q158/Q217: question- and group-level refs come from the frozen snapshot,
    // not from the live rows, and never contain a signed URL.
    expect(body.questions[0]?.groupMedia.image).toMatchObject({
      mediaId: viewBody.sections[0]?.groups[0]?.image?.mediaId,
      kind: 'image',
    });
    expect(body.questions[4]?.audio).toMatchObject({
      mediaId: viewBody.sections[1]?.groups[0]?.questions[0]?.audio?.mediaId,
      kind: 'audio',
    });
    expect(body.questions[4]?.groupMedia.audio).toMatchObject({
      mediaId: viewBody.sections[1]?.groups[0]?.audio?.mediaId,
    });
    expect(JSON.stringify(body)).not.toContain('/media/');
  });

  function put(path: string, token?: string) {
    const call = request(app.getHttpServer()).put(`/api/v1${path}`);
    return token === undefined
      ? call
      : call.set('Authorization', `Bearer ${token}`);
  }

  function saveAnswer(
    token: string,
    attemptId: number,
    questionKey: string,
    body: object,
  ) {
    return put(
      `/exam/attempts/${String(attemptId)}/answers/${questionKey}`,
      token,
    ).send(body);
  }

  async function startAttempt(token: string, testId: number): Promise<number> {
    const response = await post(`/exam/tests/${String(testId)}/attempts`, token)
      .send({ idempotencyKey: newKey() })
      .expect(201);
    return (response.body.data as ExamAttemptBody).id;
  }

  async function seedPrivateMediaObject(
    filename: string,
    type: MediaType,
  ): Promise<number> {
    const body = Buffer.from(`m42b-${filename}-${randomUUID()}`);
    const contentType = type === MediaType.audio ? 'audio/mpeg' : 'image/png';
    const key = `media/m42b/${filename}-${randomUUID()}`;
    const checksum = createHash('sha256').update(body).digest('hex');
    await storage.putPrivateObject({ key, body, contentType, checksum });
    const media = await prisma.media.create({
      data: {
        url: `urn:hsk:test:m42b-${filename}-${randomUUID()}`,
        type,
        mimeType: contentType,
        size: body.length,
        storageProvider: storage.provider,
        storageKey: key,
        checksum,
        processingStatus: MediaProcessingStatus.ready,
      },
      select: { id: true },
    });
    createdMediaIds.push(media.id);
    return media.id;
  }

  async function seedMediaWithStatus(
    filename: string,
    type: MediaType,
    processingStatus: MediaProcessingStatus,
  ): Promise<number> {
    const media = await prisma.media.create({
      data: {
        url: `urn:hsk:test:m42b-${filename}-${randomUUID()}`,
        type,
        mimeType: type === MediaType.audio ? 'audio/mpeg' : 'image/png',
        processingStatus,
      },
      select: { id: true },
    });
    createdMediaIds.push(media.id);
    return media.id;
  }

  /**
   * One attempt whose frozen snapshot has all four objective types (keys q1–q4
   * in placement order), used by the M4.2b autosave cases.
   */
  async function fourTypeAttempt(label: string): Promise<{
    attemptId: number;
    token: string;
    testId: number;
    userId: number;
  }> {
    const mcqId = await seedQuestion({
      type: QuestionType.mcq,
      skill: Skill.reading,
      content: `Câu mcq M4.2b ${label} ${suffix}`,
      answers: {
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
      },
      correctAnswer: { optionId: 'a' },
    });
    const trueFalseId = await seedQuestion({
      type: QuestionType.true_false,
      skill: Skill.reading,
      content: `Câu đúng sai M4.2b ${label} ${suffix}`,
      answers: {},
      correctAnswer: { value: true },
    });
    const fillBlankId = await seedQuestion({
      type: QuestionType.fill_blank,
      skill: Skill.reading,
      content: `Câu điền từ M4.2b ${label} ${suffix}`,
      answers: {},
      correctAnswer: { acceptedTexts: ['你好'], caseSensitive: false },
    });
    const arrangeId = await seedQuestion({
      type: QuestionType.arrange_sentence,
      skill: Skill.reading,
      content: `Câu sắp xếp M4.2b ${label} ${suffix}`,
      answers: {
        tokens: [
          { id: 't2', text: '二' },
          { id: 't1', text: '一' },
        ],
      },
      correctAnswer: { tokenIds: ['t1', 't2'] },
    });
    const testId = await seedTest({
      title: `Đề M4.2b ${label} ${suffix}`,
      status: ContentStatus.published,
      passScore: 0,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          groups: [
            {
              title: null,
              questionIds: [mcqId, trueFalseId, fillBlankId, arrangeId],
            },
          ],
        },
      ],
    });
    const learner = await register(`m42b-${label}`);
    return {
      attemptId: await startAttempt(learner.token, testId),
      token: learner.token,
      testId,
      userId: learner.userId,
    };
  }

  function snapshotQuestionByKey(
    payload: Prisma.JsonValue,
    key: string,
  ): Prisma.JsonObject {
    const sections = (payload as Prisma.JsonObject)
      .sections as Prisma.JsonArray;
    for (const section of sections) {
      const groups = (section as Prisma.JsonObject).groups as Prisma.JsonArray;
      for (const group of groups) {
        const questions = (group as Prisma.JsonObject)
          .questions as Prisma.JsonArray;
        for (const question of questions) {
          const record = question as Prisma.JsonObject;
          if (record.key === key) return record;
        }
      }
    }
    throw new Error(`Snapshot question ${key} missing.`);
  }

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
    imageId?: number;
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
        imageId: input.imageId ?? null,
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
    // A2: a test may freeze no pass line at all (`Test.passScore` is nullable).
    passScore: number | null;
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
