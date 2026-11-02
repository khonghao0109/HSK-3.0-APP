/// <reference types="jest" />
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ContentStatus,
  ExamAttemptStatus,
  QuestionType,
  Skill,
} from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { apiError } from './utils/api-envelope';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

/**
 * M4.5 B1: `GET /api/v1/exam/tests` (Q209–Q214).
 *
 * Isolation: every fixture test lives under the dedicated `HSK3` level and
 * every list call filters `levelCode=HSK3`, so the shared e2e database (other
 * specs keep their rows) cannot change the expected ids. The HSK4 fixture is
 * only used for the level filter and is asserted with `toContain`.
 */

type ExamListAttemptBody = {
  attemptId: number;
  status: 'submitted' | 'timed_out';
  score: number | null;
  maxScore: number | null;
  submittedAt: string;
  resultAvailable: boolean;
};

type ExamListActiveAttemptBody = {
  attemptId: number;
  expiresAt: string;
};

type ExamListItemBody = {
  testId: number;
  title: string;
  levelCode: string;
  duration: number;
  questionCount: number;
  skills: Skill[];
  status: 'not_started' | 'in_progress' | 'done';
  activeAttempt: ExamListActiveAttemptBody | null;
  latestAttempt: ExamListAttemptBody | null;
};

type ExamListBody = {
  success: true;
  data: ExamListItemBody[];
  meta: {
    requestId: string;
    timestamp: string;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
};

const password = 'StrongPassword123!';
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

describe('Exam test list E2E (M4.5 B1 / Q209–Q214)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let hsk3LevelId: number;
  let hsk4LevelId: number;

  let learner: { userId: number; token: string };
  let other: { userId: number; token: string };

  // HSK3 fixtures whose order is asserted by the sort/pagination cases.
  let testNewestId: number; // published 03/10, no finished attempt
  let testMiddleId: number; // published 02/10, active attempt
  let testOldestId: number; // published 01/10, submitted, scored
  let testCappedId: number; // HSK4, level filter only

  // Hidden fixtures (Q119): draft, soft-deleted, before window, after window.
  let draftTestId: number;
  let deletedTestId: number;
  let futureTestId: number;
  let pastTestId: number;

  let activeAttemptId: number;
  let expiredAttemptId: number;
  let finishedNoResultAttemptId: number;
  let invalidatedAttemptId: number;
  let otherLearnerAttemptId: number;

  const publishedAt = (iso: string) => new Date(iso);

  function http() {
    return request(app.getHttpServer());
  }

  function listUrl(query: string): string {
    return `/api/v1/exam/tests?${query}`;
  }

  async function listTests(
    token: string,
    query = 'levelCode=HSK3&limit=100',
  ): Promise<ExamListBody> {
    const response = await http()
      .get(listUrl(query))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return response.body as ExamListBody;
  }

  async function register(
    label: string,
  ): Promise<{ userId: number; token: string }> {
    const response = await http()
      .post('/api/v1/auth/register')
      .send({
        email: `exam-list-${label}-${suffix}@example.com`,
        password,
        name: `Exam List ${label}`,
      })
      .expect(201);
    return {
      userId: response.body.data.user.id as number,
      token: response.body.data.accessToken as string,
    };
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

  /**
   * Seeds a whole Test tree without the publish gate: the list reads live
   * rows, so the fixture only needs the relation counts and section order.
   */
  async function seedTest(input: {
    title: string;
    levelId: number;
    status: ContentStatus;
    publishedAt: Date | null;
    deletedAt?: Date;
    availableFrom?: Date;
    availableTo?: Date;
    sections: Array<{
      skill: Skill;
      title: string;
      questionCount: number;
    }>;
  }): Promise<number> {
    const created = await prisma.test.create({
      data: {
        levelId: input.levelId,
        title: input.title,
        instruction: null,
        duration: 90,
        passScore: 120,
        scoringVersion: 'hsk-p0-v1',
        status: input.status,
        publishedAt: input.publishedAt,
        deletedAt: input.deletedAt ?? null,
        availableFrom: input.availableFrom ?? null,
        availableTo: input.availableTo ?? null,
      },
      select: { id: true },
    });

    let questionOrder = 0;
    for (let index = 0; index < input.sections.length; index += 1) {
      const section = input.sections[index];
      if (!section) continue;
      const createdSection = await prisma.testSection.create({
        data: {
          testId: created.id,
          skill: section.skill,
          title: section.title,
          instruction: null,
          orderIndex: index + 1,
        },
        select: { id: true },
      });
      const group = await prisma.questionGroup.create({
        data: {
          testId: created.id,
          sectionId: createdSection.id,
          title: null,
          instruction: null,
          orderIndex: 1,
        },
        select: { id: true },
      });
      for (let count = 0; count < section.questionCount; count += 1) {
        questionOrder += 1;
        const question = await prisma.question.create({
          data: {
            levelId: input.levelId,
            type: QuestionType.mcq,
            skill: section.skill,
            content: `Câu ${String(questionOrder)} của ${input.title}`,
            answers: { options: [] },
            correctAnswer: { choice: 'a' },
            status: ContentStatus.published,
            publishedAt: new Date(),
          },
          select: { id: true },
        });
        const testQuestion = await prisma.testQuestion.create({
          data: {
            testId: created.id,
            questionId: question.id,
            orderIndex: questionOrder,
          },
          select: { id: true },
        });
        await prisma.testQuestionPlacement.create({
          data: {
            testQuestionId: testQuestion.id,
            testId: created.id,
            sectionId: createdSection.id,
            groupId: group.id,
            orderIndex: questionOrder,
          },
        });
      }
    }
    return created.id;
  }

  async function createAttempt(input: {
    userId: number;
    testId: number;
    status: ExamAttemptStatus;
    startedAt: Date;
    expiresAt: Date;
    submittedAt?: Date;
    maxScore?: number | null;
    invalidatedReason?: string;
  }): Promise<number> {
    const attempt = await prisma.examAttempt.create({
      data: {
        userId: input.userId,
        testId: input.testId,
        status: input.status,
        startedAt: input.startedAt,
        expiresAt: input.expiresAt,
        submittedAt: input.submittedAt ?? null,
        remainingSeconds:
          input.status === ExamAttemptStatus.in_progress ? 5400 : 0,
        maxScore: input.maxScore ?? null,
        scoringVersion: 'hsk-p0-v1',
        idempotencyKey: `exam-list-${String(Math.random())}`,
        invalidatedReason: input.invalidatedReason ?? null,
      },
      select: { id: true },
    });
    return attempt.id;
  }

  async function createResult(input: {
    userId: number;
    testId: number;
    attemptId: number;
    score: number;
    maxScore: number;
    publishedAt: Date;
  }): Promise<void> {
    await prisma.result.create({
      data: {
        userId: input.userId,
        testId: input.testId,
        attemptId: input.attemptId,
        score: input.score,
        maxScore: input.maxScore,
        passed: null,
        scoringVersion: 'hsk-p0-v1',
        detailJson: { schemaVersion: 1 },
        publishedAt: input.publishedAt,
      },
    });
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

    hsk3LevelId = await upsertLevel('HSK3', 3);
    hsk4LevelId = await upsertLevel('HSK4', 4);

    testNewestId = await seedTest({
      title: `Đề list mới nhất ${suffix}`,
      levelId: hsk3LevelId,
      status: ContentStatus.published,
      publishedAt: publishedAt('2026-10-03T00:00:00.000Z'),
      sections: [
        { skill: Skill.reading, title: 'Đọc hiểu', questionCount: 1 },
        { skill: Skill.listening, title: 'Nghe hiểu', questionCount: 2 },
      ],
    });
    testMiddleId = await seedTest({
      title: `Đề list đang làm ${suffix}`,
      levelId: hsk3LevelId,
      status: ContentStatus.published,
      publishedAt: publishedAt('2026-10-02T00:00:00.000Z'),
      sections: [
        { skill: Skill.listening, title: 'Nghe hiểu', questionCount: 1 },
      ],
    });
    testOldestId = await seedTest({
      title: `Đề list cũ nhất ${suffix}`,
      levelId: hsk3LevelId,
      status: ContentStatus.published,
      publishedAt: publishedAt('2026-10-01T00:00:00.000Z'),
      sections: [
        { skill: Skill.writing, title: 'Viết', questionCount: 1 },
        { skill: Skill.reading, title: 'Đọc hiểu', questionCount: 1 },
      ],
    });
    testCappedId = await seedTest({
      title: `Đề list cấp 4 ${suffix}`,
      levelId: hsk4LevelId,
      status: ContentStatus.published,
      publishedAt: publishedAt('2026-10-04T00:00:00.000Z'),
      sections: [{ skill: Skill.reading, title: 'Đọc hiểu', questionCount: 1 }],
    });

    draftTestId = await seedTest({
      title: `Đề list nháp ${suffix}`,
      levelId: hsk3LevelId,
      status: ContentStatus.draft,
      publishedAt: null,
      sections: [{ skill: Skill.reading, title: 'Đọc hiểu', questionCount: 1 }],
    });
    deletedTestId = await seedTest({
      title: `Đề list đã lưu trữ ${suffix}`,
      levelId: hsk3LevelId,
      status: ContentStatus.published,
      publishedAt: publishedAt('2026-10-05T00:00:00.000Z'),
      deletedAt: new Date('2026-10-05T01:00:00.000Z'),
      sections: [{ skill: Skill.reading, title: 'Đọc hiểu', questionCount: 1 }],
    });
    futureTestId = await seedTest({
      title: `Đề list chưa mở ${suffix}`,
      levelId: hsk3LevelId,
      status: ContentStatus.published,
      publishedAt: publishedAt('2026-10-06T00:00:00.000Z'),
      availableFrom: new Date('2099-01-01T00:00:00.000Z'),
      sections: [{ skill: Skill.reading, title: 'Đọc hiểu', questionCount: 1 }],
    });
    pastTestId = await seedTest({
      title: `Đề list đã đóng ${suffix}`,
      levelId: hsk3LevelId,
      status: ContentStatus.published,
      publishedAt: publishedAt('2026-10-07T00:00:00.000Z'),
      availableTo: new Date('2026-10-08T00:00:00.000Z'),
      sections: [{ skill: Skill.reading, title: 'Đọc hiểu', questionCount: 1 }],
    });

    learner = await register('learner');
    other = await register('other');

    const nowMs = Date.now();
    activeAttemptId = await createAttempt({
      userId: learner.userId,
      testId: testMiddleId,
      status: ExamAttemptStatus.in_progress,
      startedAt: new Date(nowMs - 60_000),
      expiresAt: new Date(nowMs + 60 * 60_000),
    });
    // An expired in-progress attempt is not "active" and the list must not
    // time it out (Q212/Q213, no writes).
    expiredAttemptId = await createAttempt({
      userId: learner.userId,
      testId: testOldestId,
      status: ExamAttemptStatus.in_progress,
      startedAt: new Date(nowMs - 91 * 60_000),
      expiresAt: new Date(nowMs - 10_000),
    });
    // Q214: finished but never graded — score null, resultAvailable false.
    finishedNoResultAttemptId = await createAttempt({
      userId: learner.userId,
      testId: testNewestId,
      status: ExamAttemptStatus.submitted,
      startedAt: new Date(nowMs - 120 * 60_000),
      expiresAt: new Date(nowMs - 30 * 60_000),
      submittedAt: new Date(nowMs - 40 * 60_000),
    });
    // Q213: invalidated must be skipped even when it is the newest row.
    invalidatedAttemptId = await createAttempt({
      userId: learner.userId,
      testId: testOldestId,
      status: ExamAttemptStatus.invalidated,
      startedAt: new Date(nowMs - 20 * 60_000),
      expiresAt: new Date(nowMs + 70 * 60_000),
      submittedAt: new Date(nowMs - 15 * 60_000),
      invalidatedReason: 'e2e fixture',
    });
    // Q211: the scored finished attempt of this learner is the one shown.
    const scoredAttemptId = await createAttempt({
      userId: learner.userId,
      testId: testOldestId,
      status: ExamAttemptStatus.submitted,
      startedAt: new Date(nowMs - 300 * 60_000),
      expiresAt: new Date(nowMs - 210 * 60_000),
      submittedAt: new Date(nowMs - 240 * 60_000),
      maxScore: 200,
    });
    await createResult({
      userId: learner.userId,
      testId: testOldestId,
      attemptId: scoredAttemptId,
      score: 180,
      maxScore: 200,
      publishedAt: new Date(nowMs - 240 * 60_000),
    });
    // Another learner's attempt must never leak into this list.
    otherLearnerAttemptId = await createAttempt({
      userId: other.userId,
      testId: testOldestId,
      status: ExamAttemptStatus.submitted,
      startedAt: new Date(nowMs - 60 * 60_000),
      expiresAt: new Date(nowMs + 30 * 60_000),
      submittedAt: new Date(nowMs - 50 * 60_000),
      maxScore: 200,
    });
    await createResult({
      userId: other.userId,
      testId: testOldestId,
      attemptId: otherLearnerAttemptId,
      score: 199,
      maxScore: 200,
      publishedAt: new Date(nowMs - 50 * 60_000),
    });
  });

  afterAll(async () => {
    // The e2e database is shared with the other specs: archive the fixture
    // tests (attempts keep a Restrict FK on Test) and the questions.
    await prisma.test.updateMany({
      where: {
        id: {
          in: [
            testNewestId,
            testMiddleId,
            testOldestId,
            testCappedId,
            draftTestId,
            deletedTestId,
            futureTestId,
            pastTestId,
          ],
        },
      },
      data: {
        status: ContentStatus.archived,
        deletedAt: new Date(),
      },
    });
    await prisma.question.updateMany({
      where: { content: { contains: suffix } },
      data: { status: ContentStatus.archived, deletedAt: new Date() },
    });
    await app?.close();
  });

  function byId(items: ExamListItemBody[]): Map<number, ExamListItemBody> {
    return new Map(items.map((item) => [item.testId, item]));
  }

  it('1. refuses the list without a bearer token', async () => {
    const response = await http().get(listUrl('levelCode=HSK3')).expect(401);
    expect(response.body).toEqual(
      apiError({ code: 'UNAUTHORIZED', message: 'Unauthorized' }),
    );
  });

  it('2. shows only published, live tests inside their window (Q119)', async () => {
    const body = await listTests(learner.token);

    expect(body.meta.pagination).toEqual({
      page: 1,
      limit: 100,
      total: 3,
      totalPages: 1,
    });
    expect(body.data.map((item) => item.testId)).toEqual([
      testNewestId,
      testMiddleId,
      testOldestId,
    ]);
    for (const hidden of [
      draftTestId,
      deletedTestId,
      futureTestId,
      pastTestId,
    ]) {
      expect(body.data.some((item) => item.testId === hidden)).toBe(false);
    }
  });

  it('3. filters by levelCode (Q209)', async () => {
    const hsk3 = await listTests(learner.token, 'levelCode=HSK3&limit=100');
    expect(hsk3.data).toHaveLength(3);
    expect(hsk3.meta.pagination.total).toBe(3);

    const hsk4 = await listTests(learner.token, 'levelCode=HSK4&limit=100');
    expect(hsk4.data.map((item) => item.testId)).toContain(testCappedId);
    expect(hsk4.data.every((item) => item.levelCode === 'HSK4')).toBe(true);
  });

  it('4. filters by skill when at least one section matches (Q210)', async () => {
    const mixed = await listTests(
      learner.token,
      'levelCode=HSK3&skill=listening&limit=100',
    );
    // The newest test carries listening as its second section; the middle
    // test carries it as its only section; the writing/reading test does not.
    expect(
      mixed.data.map((item) => item.testId).sort((left, right) => left - right),
    ).toEqual([testNewestId, testMiddleId].sort((left, right) => left - right));

    const writing = await listTests(
      learner.token,
      'levelCode=HSK3&skill=writing&limit=100',
    );
    expect(writing.data.map((item) => item.testId)).toEqual([testOldestId]);

    const speaking = await listTests(
      learner.token,
      'levelCode=HSK3&skill=speaking&limit=100',
    );
    expect(speaking.data).toEqual([]);
    expect(speaking.meta.pagination.total).toBe(0);
  });

  it('5. returns the card contract with skills in section order (Q210)', async () => {
    const body = await listTests(learner.token);
    const items = byId(body.data);

    expect(items.get(testNewestId)).toMatchObject({
      testId: testNewestId,
      title: `Đề list mới nhất ${suffix}`,
      levelCode: 'HSK3',
      duration: 90,
      questionCount: 3,
      skills: [Skill.reading, Skill.listening],
      status: 'done',
      activeAttempt: null,
    });
    expect(items.get(testMiddleId)).toMatchObject({
      questionCount: 1,
      skills: [Skill.listening],
      status: 'in_progress',
    });
    expect(items.get(testOldestId)).toMatchObject({
      questionCount: 2,
      skills: [Skill.writing, Skill.reading],
    });
  });

  it('6. reports the unfinished attempt and marks the test in_progress (Q212)', async () => {
    const body = await listTests(learner.token);
    const middle = byId(body.data).get(testMiddleId);

    expect(middle?.status).toBe('in_progress');
    expect(middle?.activeAttempt).toEqual({
      attemptId: activeAttemptId,
      expiresAt: expect.any(String),
    });
    expect(middle?.latestAttempt).toBeNull();
  });

  it('7. reports the latest scored finished attempt and skips invalidated (Q211/Q213)', async () => {
    const body = await listTests(learner.token);
    const oldest = byId(body.data).get(testOldestId);

    expect(oldest?.status).toBe('done');
    // The expired in-progress attempt is not active, and the list must not
    // write: it stays in_progress in the database.
    expect(oldest?.activeAttempt).toBeNull();
    expect(oldest?.latestAttempt).toMatchObject({
      status: 'submitted',
      score: 180,
      maxScore: 200,
      resultAvailable: true,
    });
    expect(oldest?.latestAttempt?.attemptId).not.toBe(invalidatedAttemptId);
    expect(oldest?.latestAttempt?.attemptId).not.toBe(otherLearnerAttemptId);
    expect(oldest?.latestAttempt?.attemptId).not.toBe(expiredAttemptId);

    const expired = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: expiredAttemptId },
      select: { status: true },
    });
    expect(expired.status).toBe(ExamAttemptStatus.in_progress);
  });

  it('8. reports score null and resultAvailable false without grading (Q214)', async () => {
    const before = await prisma.result.count({
      where: { attemptId: finishedNoResultAttemptId },
    });
    expect(before).toBe(0);

    const body = await listTests(learner.token);
    const newest = byId(body.data).get(testNewestId);

    expect(newest?.status).toBe('done');
    expect(newest?.latestAttempt).toMatchObject({
      attemptId: finishedNoResultAttemptId,
      status: 'submitted',
      score: null,
      maxScore: null,
      resultAvailable: false,
    });

    // Two reads, zero writes: the endpoint never grades lazily and never
    // turns the stale in-progress attempt into timed_out.
    await listTests(learner.token);
    expect(
      await prisma.result.count({
        where: { attemptId: finishedNoResultAttemptId },
      }),
    ).toBe(0);
    const attempt = await prisma.examAttempt.findUniqueOrThrow({
      where: { id: finishedNoResultAttemptId },
      select: { status: true },
    });
    expect(attempt.status).toBe(ExamAttemptStatus.submitted);
  });

  it("9. never exposes another learner's attempt (owner-only)", async () => {
    const mine = await listTests(learner.token);
    const oldest = byId(mine.data).get(testOldestId);
    expect(oldest?.latestAttempt?.score).toBe(180);

    // The other learner sees their own 199 and no active attempt of mine.
    const theirs = await listTests(other.token);
    const theirOldest = byId(theirs.data).get(testOldestId);
    expect(theirOldest?.latestAttempt).toMatchObject({
      attemptId: otherLearnerAttemptId,
      score: 199,
    });
    expect(byId(theirs.data).get(testMiddleId)?.status).toBe('not_started');
    expect(byId(theirs.data).get(testMiddleId)?.activeAttempt).toBeNull();
  });

  it('10. sorts by newest and oldest publishedAt (Q211)', async () => {
    const newest = await listTests(learner.token, 'levelCode=HSK3&limit=100');
    expect(newest.data.map((item) => item.testId)).toEqual([
      testNewestId,
      testMiddleId,
      testOldestId,
    ]);

    const oldest = await listTests(
      learner.token,
      'levelCode=HSK3&sort=oldest&limit=100',
    );
    expect(oldest.data.map((item) => item.testId)).toEqual([
      testOldestId,
      testMiddleId,
      testNewestId,
    ]);
  });

  it('11. sorts by score descending with unscored tests last (Q211)', async () => {
    const body = await listTests(
      learner.token,
      'levelCode=HSK3&sort=score&limit=100',
    );
    // 180 first; the two unscored tests tie and fall back to newest first.
    expect(body.data.map((item) => item.testId)).toEqual([
      testOldestId,
      testNewestId,
      testMiddleId,
    ]);
    expect(body.data.map((item) => item.latestAttempt?.score ?? null)).toEqual([
      180,
      null,
      null,
    ]);
  });

  it('12. paginates with the shared meta (page, limit, total, totalPages)', async () => {
    const first = await listTests(
      learner.token,
      'levelCode=HSK3&page=1&limit=2',
    );
    expect(first.data.map((item) => item.testId)).toEqual([
      testNewestId,
      testMiddleId,
    ]);
    expect(first.meta).toEqual({
      requestId: expect.any(String),
      timestamp: expect.any(String),
      pagination: { page: 1, limit: 2, total: 3, totalPages: 2 },
    });

    const second = await listTests(
      learner.token,
      'levelCode=HSK3&page=2&limit=2',
    );
    expect(second.data.map((item) => item.testId)).toEqual([testOldestId]);
    expect(second.meta.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });

    const beyond = await listTests(
      learner.token,
      'levelCode=HSK3&page=5&limit=2',
    );
    expect(beyond.data).toEqual([]);
    expect(beyond.meta.pagination.total).toBe(3);
  });

  it('13. answers no-store like every learner exam route', async () => {
    const response = await http()
      .get(listUrl('levelCode=HSK3'))
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['levelCode=HSK9'],
    ['levelCode=HSK0'],
    ['skill=pronunciation'],
    ['sort=random'],
    ['sort='],
    ['page=0'],
    ['page=abc'],
    ['limit=0'],
    ['limit=101'],
  ])('14. rejects the invalid query %s with 400', async (query) => {
    const response = await http()
      .get(listUrl(query))
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(400);
    expect(response.body.error.code).toBe('REQUEST_VALIDATION_FAILED');
  });
});
