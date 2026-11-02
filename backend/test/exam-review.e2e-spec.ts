/// <reference types="jest" />
import { createHash, randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { InMemoryObjectStorageAdapter } from '../src/infrastructure/storage/in-memory-object-storage.adapter';
import { OBJECT_STORAGE } from '../src/infrastructure/storage/object-storage.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * M4.5 B2a: Q217 review context (section/group keys, stored flag, snapshot
 * media refs) and Q158/Q218 media grants for finished attempts.
 *
 * Kept in its own spec so the six grant branches and the review context have
 * readable names in the gate output; the older `exam-attempt.e2e-spec.ts`
 * still owns the rest of the learner exam flow.
 */

type ReviewBody = {
  attemptId: number;
  status: string;
  testTitle: string;
  questions: Array<{
    key: string;
    orderIndex: number;
    type: string;
    skill: string;
    isCorrect: boolean;
    isFlagged: boolean;
    sectionKey: string;
    groupKey: string;
    groupMedia: {
      audio: SnapshotMediaBody | null;
      image: SnapshotMediaBody | null;
    };
    audio: SnapshotMediaBody | null;
    image: SnapshotMediaBody | null;
  }>;
};

type SnapshotMediaBody = {
  mediaId: number;
  kind: MediaType;
  mimeType: string | null;
  durationMs: number | null;
};

type GrantsBody = {
  grants: Array<{
    mediaId: number;
    kind: MediaType;
    url: string;
    expiresAt: string;
  }>;
  unavailable: number[];
};

const FORBIDDEN_GRANT_KEYS = [
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

const INTERNAL_REVIEW_KEYS = [
  'questionId',
  'questionVersion',
  'contentHash',
  'snapshotQuestionKey',
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

function expectNoKeys(body: unknown, forbidden: string[]): void {
  const keys = collectKeys(body);
  for (const key of forbidden) {
    expect(keys.filter((candidate) => candidate === key)).toEqual([]);
  }
}

describe('Exam review context and finished-attempt media grants E2E (M4.5 B2a)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: InMemoryObjectStorageAdapter;

  let levelId: number;
  let imageId: number;
  let audioId: number;
  let testId: number;

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const password = 'StrongPassword123!';
  const createdTestIds: number[] = [];
  const createdQuestionIds: number[] = [];
  const createdMediaIds: number[] = [];

  function http() {
    return request(app.getHttpServer());
  }

  function get(path: string, token: string) {
    return http().get(`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
  }

  function post(path: string, token: string) {
    return http()
      .post(`/api/v1${path}`)
      .set('Authorization', `Bearer ${token}`);
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
    // A grant needs a private object that `isUsableMediaContent` accepts
    // (checksum + storageKey + size + the running adapter provider).
    const body = Buffer.from(`m45b2a-${filename}-${randomUUID()}`);
    const contentType = type === MediaType.audio ? 'audio/mpeg' : 'image/png';
    const key = `media/m45b2a/${filename}-${randomUUID()}`;
    const checksum = createHash('sha256').update(body).digest('hex');
    await storage.putPrivateObject({ key, body, contentType, checksum });
    const media = await prisma.media.create({
      data: {
        url: `urn:hsk:test:m45b2a-${filename}-${randomUUID()}`,
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

  async function seedQuestion(input: {
    type: QuestionType;
    skill: Skill;
    content: string;
    answers: Prisma.InputJsonValue;
    correctAnswer: Prisma.InputJsonValue;
    explanation?: string | null;
    audioId?: number;
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
        status: ContentStatus.published,
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
    sections: Array<{
      skill: Skill;
      title: string;
      imageId?: number;
      audioId?: number;
      questionIds: number[];
    }>;
  }): Promise<number> {
    const test = await prisma.test.create({
      data: {
        levelId,
        title: input.title,
        instruction: null,
        duration: 90,
        passScore: 60,
        scoringVersion: 'hsk-p0-v1',
        status: ContentStatus.published,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    createdTestIds.push(test.id);

    let questionOrder = 0;
    for (let index = 0; index < input.sections.length; index += 1) {
      const section = input.sections[index];
      if (section === undefined) continue;
      const createdSection = await prisma.testSection.create({
        data: {
          testId: test.id,
          skill: section.skill,
          title: section.title,
          instruction: null,
          orderIndex: index + 1,
        },
        select: { id: true },
      });
      const createdGroup = await prisma.questionGroup.create({
        data: {
          testId: test.id,
          sectionId: createdSection.id,
          title: null,
          instruction: null,
          audioId: section.audioId ?? null,
          imageId: section.imageId ?? null,
          orderIndex: 1,
        },
        select: { id: true },
      });
      for (const questionId of section.questionIds) {
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
    return test.id;
  }

  async function register(
    label: string,
  ): Promise<{ userId: number; token: string }> {
    const response = await http()
      .post('/api/v1/auth/register')
      .send({
        // Local part kept under the 64-char limit; the UUID makes it unique.
        email: `m45b2a-${randomUUID()}@example.com`,
        password,
        name: `Exam Review E2E ${label}`,
      })
      .expect(201);
    return {
      userId: response.body.data.user.id as number,
      token: response.body.data.accessToken as string,
    };
  }

  async function startAttempt(token: string): Promise<number> {
    const response = await post(`/exam/tests/${String(testId)}/attempts`, token)
      .send({ idempotencyKey: randomUUID() })
      .expect(201);
    return response.body.data.id as number;
  }

  async function saveAnswer(
    token: string,
    attemptId: number,
    questionKey: string,
    answer: Prisma.InputJsonValue,
    isFlagged = false,
  ): Promise<void> {
    await http()
      .put(`/api/v1/exam/attempts/${String(attemptId)}/answers/${questionKey}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        answer,
        isFlagged,
        expectedVersion: null,
        idempotencyKey: randomUUID(),
      })
      .expect(200);
  }

  async function submitAttempt(
    token: string,
    attemptId: number,
  ): Promise<void> {
    await post(`/exam/attempts/${String(attemptId)}/submit`, token)
      .send({ idempotencyKey: randomUUID() })
      .expect(200);
  }

  function getReview(token: string, attemptId: number) {
    return get(`/exam/attempts/${String(attemptId)}/review`, token);
  }

  function getGrants(token: string, attemptId: number) {
    return get(`/exam/attempts/${String(attemptId)}/media-grants`, token);
  }

  function expectNoStore(response: { headers: Record<string, string> }): void {
    expect(response.headers['cache-control']).toBe('no-store');
  }

  function ttlSeconds(expiresAt: string, nowMs: number): number {
    return (
      Math.floor(Date.parse(expiresAt) / 1_000) - Math.floor(nowMs / 1_000)
    );
  }

  beforeAll(async () => {
    assertDisposableTestDatabase();

    const moduleFixture = await Test.createTestingModule({
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

    levelId = await upsertLevel('HSK4', 4);
    imageId = await seedMedia('review-group-image.png', MediaType.image);
    audioId = await seedMedia('review-group-audio.mp3', MediaType.audio);

    const mcqId = await seedQuestion({
      type: QuestionType.mcq,
      skill: Skill.reading,
      content: `Câu mcq B2a ${suffix}`,
      answers: {
        options: [
          { id: 'a', text: 'Đáp án đúng' },
          { id: 'b', text: 'Đáp án sai' },
        ],
      },
      correctAnswer: { optionId: 'a' },
      explanation: 'Chọn A.',
    });
    const trueFalseId = await seedQuestion({
      type: QuestionType.true_false,
      skill: Skill.reading,
      content: `Câu đúng sai B2a ${suffix}`,
      answers: {},
      correctAnswer: { value: true },
      explanation: 'Khẳng định đúng.',
    });
    const fillBlankId = await seedQuestion({
      type: QuestionType.fill_blank,
      skill: Skill.listening,
      content: `Câu điền từ B2a ${suffix}`,
      answers: {},
      correctAnswer: { acceptedTexts: ['你好'], caseSensitive: false },
      explanation: 'Từ cần điền.',
      audioId,
    });
    const arrangeId = await seedQuestion({
      type: QuestionType.arrange_sentence,
      skill: Skill.listening,
      content: `Câu sắp xếp B2a ${suffix}`,
      answers: {
        tokens: [
          { id: 't2', text: '二' },
          { id: 't1', text: '一' },
        ],
      },
      correctAnswer: { tokenIds: ['t1', 't2'] },
      explanation: null,
    });

    testId = await seedTest({
      title: `Đề review B2a ${suffix}`,
      sections: [
        {
          skill: Skill.reading,
          title: 'Đọc hiểu',
          imageId,
          questionIds: [mcqId, trueFalseId],
        },
        {
          skill: Skill.listening,
          title: 'Nghe hiểu',
          audioId,
          questionIds: [fillBlankId, arrangeId],
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.test.updateMany({
      where: { id: { in: createdTestIds } },
      data: { status: ContentStatus.archived, deletedAt: new Date() },
    });
    await prisma.question.updateMany({
      where: { id: { in: createdQuestionIds } },
      data: { status: ContentStatus.archived, deletedAt: new Date() },
    });
    await prisma.media.updateMany({
      where: { id: { in: createdMediaIds } },
      data: { deletedAt: new Date() },
    });
    await app?.close();
  });

  async function submittedAttempt(): Promise<{
    token: string;
    attemptId: number;
  }> {
    const learner = await register(`context-${randomUUID()}`);
    const attemptId = await startAttempt(learner.token);
    await saveAnswer(learner.token, attemptId, 'q1', { choice: 'a' }, true);
    await saveAnswer(learner.token, attemptId, 'q2', { value: false });
    await saveAnswer(learner.token, attemptId, 'q4', {
      order: ['t1', 't2'],
    });
    await submitAttempt(learner.token, attemptId);
    return { token: learner.token, attemptId };
  }

  it('1. review exposes Q217 context and Q158 snapshot media refs without internals', async () => {
    const { token, attemptId } = await submittedAttempt();

    const response = await getReview(token, attemptId).expect(200);
    expectNoStore(response);
    const body = response.body.data as ReviewBody;

    expect(body.status).toBe('submitted');
    expect(body.questions.map((question) => question.key)).toEqual([
      'q1',
      'q2',
      'q3',
      'q4',
    ]);
    expect(body.questions.map((question) => question.sectionKey)).toEqual([
      's1',
      's1',
      's2',
      's2',
    ]);
    expect(body.questions.map((question) => question.groupKey)).toEqual([
      's1-g1',
      's1-g1',
      's2-g1',
      's2-g1',
    ]);
    // Q217: the stored flag, not a live read; unanswered q3/q4 are false.
    expect(body.questions.map((question) => question.isFlagged)).toEqual([
      true,
      false,
      false,
      false,
    ]);

    // Q158: snapshot media refs only — no signed URL.
    expect(body.questions[0]).toMatchObject({
      audio: null,
      image: null,
      groupMedia: {
        audio: null,
        image: {
          mediaId: imageId,
          kind: MediaType.image,
          mimeType: 'image/png',
          durationMs: null,
        },
      },
    });
    expect(body.questions[2]).toMatchObject({
      audio: {
        mediaId: audioId,
        kind: MediaType.audio,
        mimeType: 'audio/mpeg',
        durationMs: null,
      },
      groupMedia: {
        audio: {
          mediaId: audioId,
          kind: MediaType.audio,
        },
        image: null,
      },
    });
    expect(body.questions[3]).toMatchObject({
      audio: null,
      image: null,
      groupMedia: {
        audio: { mediaId: audioId, kind: MediaType.audio },
        image: null,
      },
    });

    // R11/internal identity: no questionId/questionVersion/contentHash and no
    // signed media URL anywhere in the review payload.
    expectNoKeys(body, INTERNAL_REVIEW_KEYS);
    expect(JSON.stringify(body)).not.toContain('/media/');
    for (const mediaRef of [
      body.questions[0]?.groupMedia.image,
      body.questions[2]?.audio,
      body.questions[3]?.groupMedia.audio,
    ]) {
      expect(Object.keys(mediaRef ?? {}).sort()).toEqual([
        'durationMs',
        'kind',
        'mediaId',
        'mimeType',
      ]);
    }
  });

  it('2. grants for a submitted attempt use the fixed 300 s review TTL', async () => {
    const { token, attemptId } = await submittedAttempt();

    const before = Date.now();
    const response = await getGrants(token, attemptId).expect(200);
    expectNoStore(response);
    expectNoKeys(response.body, FORBIDDEN_GRANT_KEYS);
    const data = response.body.data as GrantsBody;

    expect(data.grants.map((grant) => grant.mediaId).sort()).toEqual(
      [imageId, audioId].sort(),
    );
    expect(data.unavailable).toEqual([]);
    for (const grant of data.grants) {
      const ttl = ttlSeconds(grant.expiresAt, before);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(300);
      expect(ttl).toBeGreaterThanOrEqual(295);
    }
  });

  it('3. grants for a timed_out attempt also use the fixed 300 s TTL', async () => {
    const learner = await register('grant-timeout');
    const attemptId = await startAttempt(learner.token);
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });
    // The lazy timeout + grading path of GET review turns it terminal.
    await getReview(learner.token, attemptId).expect(200);

    const before = Date.now();
    const response = await getGrants(learner.token, attemptId).expect(200);
    const data = response.body.data as GrantsBody;
    expect(data.grants.length).toBeGreaterThan(0);
    for (const grant of data.grants) {
      const ttl = ttlSeconds(grant.expiresAt, before);
      expect(ttl).toBeLessThanOrEqual(300);
      expect(ttl).toBeGreaterThanOrEqual(295);
    }
  });

  it('4. grants for an invalidated attempt answer 409 EXAM_ATTEMPT_CLOSED', async () => {
    const learner = await register('grant-closed');
    const attemptId = await startAttempt(learner.token);
    await prisma.examAttempt.update({
      where: { id: attemptId },
      data: { status: 'invalidated', invalidatedReason: 'e2e review grant' },
    });

    const response = await getGrants(learner.token, attemptId).expect(409);
    expect(response.body.error).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      details: { status: 'invalidated' },
    });
  });

  it('5. grants for another learner answer 404 EXAM_ATTEMPT_NOT_FOUND', async () => {
    const { attemptId } = await submittedAttempt();
    const other = await register('grant-other');

    const response = await getGrants(other.token, attemptId).expect(404);
    expect(response.body.error.code).toBe('EXAM_ATTEMPT_NOT_FOUND');
    expectNoKeys(response.body, FORBIDDEN_GRANT_KEYS);
  });

  it('6. in_progress grants keep the remaining-clock TTL (TL-128 regression)', async () => {
    const learner = await register('grant-live');
    const attemptId = await startAttempt(learner.token);
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: attemptId },
      data: { expiresAt: new Date(nowMs + 30_000) },
    });

    const before = Date.now();
    const response = await getGrants(learner.token, attemptId).expect(200);
    const data = response.body.data as GrantsBody;
    expect(data.grants.map((grant) => grant.mediaId).sort()).toEqual(
      [imageId, audioId].sort(),
    );
    for (const grant of data.grants) {
      const ttl = ttlSeconds(grant.expiresAt, before);
      // 30 s of clock + the 60 s grant margin, i.e. not the fixed review TTL.
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(95);
    }
    expect(
      (
        await prisma.examAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          select: { status: true },
        })
      ).status,
    ).toBe('in_progress');
  });

  it('7. expired in_progress grants stay read-only: 409 EXPIRED, status unchanged', async () => {
    const learner = await register('grant-expired-readonly');
    const attemptId = await startAttempt(learner.token);
    const nowMs = Date.now();
    await prisma.examAttempt.update({
      where: { id: attemptId },
      data: {
        startedAt: new Date(nowMs - 91 * 60_000),
        expiresAt: new Date(nowMs - 10_000),
      },
    });

    const response = await getGrants(learner.token, attemptId).expect(409);
    expect(response.body.error.code).toBe('EXAM_ATTEMPT_EXPIRED');
    // The read never reclassifies the attempt as terminal in the same request.
    expect(
      (
        await prisma.examAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          select: { status: true },
        })
      ).status,
    ).toBe('in_progress');
    expect(await prisma.result.count({ where: { attemptId } })).toBe(0);
  });

  it('8. a finished attempt lists unusable snapshot media in unavailable', async () => {
    const { token, attemptId } = await submittedAttempt();
    await prisma.media.update({
      where: { id: imageId },
      data: {
        processingStatus: MediaProcessingStatus.quarantined,
        deletedAt: new Date(),
      },
    });

    const response = await getGrants(token, attemptId).expect(200);
    const data = response.body.data as GrantsBody;
    expect(data.grants.map((grant) => grant.mediaId)).toEqual([audioId]);
    expect(data.unavailable).toEqual([imageId]);
  });
});
