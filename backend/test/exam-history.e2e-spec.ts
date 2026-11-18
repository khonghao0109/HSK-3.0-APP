/// <reference types="jest" />
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentStatus, ExamAttemptStatus, Skill } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { createSafeValidationException } from '../src/common/validation/safe-validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertDisposableTestDatabase } from './utils/assert-disposable-database';

type HistoryItem = {
  attemptId: number;
  testId: number;
  testTitle: string;
  levelCode: string;
  status: string;
  finishedAt: string;
  score: number | null;
  maxScore: number | null;
  passScore: number | null;
  passed: boolean | null;
  skills: Array<{ skill: Skill; score: number; maxScore: number }>;
};

type HistoryBody = {
  data: HistoryItem[];
  meta: {
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
};

type ErrorBody = { error: { code: string } };

type Learner = { userId: number; token: string };

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const SECRET_MARKER = 'history-answer-key-must-not-leak';

describe('Exam history E2E (M4.5 B3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hsk3LevelId: number;
  let hsk4LevelId: number;
  let learnerCount = 0;

  const secondsAgo = (seconds: number) =>
    new Date(Date.now() - seconds * 1_000);

  function http() {
    return request(app.getHttpServer());
  }

  async function history(token: string, query = ''): Promise<HistoryBody> {
    const response = await http()
      .get(`/api/v1/exam/attempts${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return response.body as HistoryBody;
  }

  async function register(): Promise<Learner> {
    learnerCount += 1;
    const response = await http()
      .post('/api/v1/auth/register')
      .send({
        email: `exam-history-${String(learnerCount)}-${suffix}@example.com`,
        password: 'StrongPassword123!',
        name: `Exam History ${String(learnerCount)}`,
      })
      .expect(201);
    return {
      userId: response.body.data.user.id as number,
      token: response.body.data.accessToken as string,
    };
  }

  async function upsertLevel(code: string, order: number): Promise<number> {
    const level = await prisma.level.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name: code,
        orderIndex: order,
        minBand: order,
        maxBand: order,
        curriculumVersion: 'HSK_3_0',
        status: ContentStatus.published,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    return level.id;
  }

  /** Each attempt gets its own Test: one live attempt per user and test. */
  async function seedAttempt(input: {
    userId: number;
    status: ExamAttemptStatus;
    expiresAt?: Date;
    submittedAt?: Date | null;
    frozenTitle?: string;
    frozenLevel?: string;
    passScore?: number | null;
  }): Promise<{ attemptId: number; testId: number }> {
    const test = await prisma.test.create({
      data: {
        levelId: hsk3LevelId,
        title: 'Live title',
        duration: 90,
        passScore: 120,
        scoringVersion: 'hsk-p0-v1',
        // Draft: the e2e database is shared and the exam list counts published tests.
        status: ContentStatus.draft,
      },
      select: { id: true },
    });
    const finished = input.status !== ExamAttemptStatus.in_progress;
    const attempt = await prisma.examAttempt.create({
      data: {
        userId: input.userId,
        testId: test.id,
        status: input.status,
        startedAt: secondsAgo(7_200),
        expiresAt: input.expiresAt ?? secondsAgo(3_600),
        submittedAt:
          input.submittedAt === undefined
            ? finished
              ? secondsAgo(4_000)
              : null
            : input.submittedAt,
        remainingSeconds: 0,
        scoringVersion: 'hsk-p0-v1',
        idempotencyKey: `exam-history-${String(test.id)}`,
      },
      select: { id: true },
    });
    await prisma.examAttemptSnapshot.create({
      data: {
        attemptId: attempt.id,
        testVersion: 1,
        snapshotVersion: 1,
        contentHash: `hash-${String(attempt.id)}`,
        payload: {
          schemaVersion: 1,
          test: {
            id: test.id,
            title: input.frozenTitle ?? 'Frozen title',
            levelCode: input.frozenLevel ?? 'HSK3',
            passScore: input.passScore === undefined ? 180 : input.passScore,
            maxScore: 300,
          },
          sections: [
            {
              groups: [
                {
                  questions: [
                    {
                      content: SECRET_MARKER,
                      correctAnswer: SECRET_MARKER,
                      explanation: SECRET_MARKER,
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    return { attemptId: attempt.id, testId: test.id };
  }

  async function seedResult(
    userId: number,
    seeded: { attemptId: number; testId: number },
  ): Promise<void> {
    await prisma.result.create({
      data: {
        userId,
        testId: seeded.testId,
        attemptId: seeded.attemptId,
        score: 200,
        maxScore: 300,
        passed: true,
        scoringVersion: 'hsk-p0-v1',
        detailJson: { schemaVersion: 1, secret: SECRET_MARKER },
        publishedAt: new Date(),
        skillScores: {
          create: [{ skill: Skill.listening, score: 70, total: 100 }],
        },
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires a token', async () => {
    await http().get('/api/v1/exam/attempts').expect(401);
  });

  it('returns the full row for a graded attempt, without caching', async () => {
    const learner = await register();
    const seeded = await seedAttempt({
      userId: learner.userId,
      status: ExamAttemptStatus.submitted,
    });
    await seedResult(learner.userId, seeded);

    const response = await http()
      .get('/api/v1/exam/attempts')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-store');
    expect((response.body as HistoryBody).data).toEqual([
      {
        attemptId: seeded.attemptId,
        testId: seeded.testId,
        testTitle: 'Frozen title',
        levelCode: 'HSK3',
        status: 'submitted',
        finishedAt: expect.any(String),
        score: 200,
        maxScore: 300,
        passScore: 180,
        passed: true,
        skills: [{ skill: 'listening', score: 70, maxScore: 100 }],
      },
    ]);
  });

  it('never leaks the answer key or the stored grading detail', async () => {
    const learner = await register();
    const seeded = await seedAttempt({
      userId: learner.userId,
      status: ExamAttemptStatus.submitted,
    });
    await seedResult(learner.userId, seeded);

    const text = JSON.stringify(await history(learner.token));

    expect(text).not.toContain(SECRET_MARKER);
    expect(text).not.toContain('correctAnswer');
    expect(text).not.toContain('explanation');
  });

  it('shows only the caller’s own attempts', async () => {
    const owner = await register();
    const stranger = await register();
    const mine = await seedAttempt({
      userId: owner.userId,
      status: ExamAttemptStatus.submitted,
    });
    await seedAttempt({
      userId: stranger.userId,
      status: ExamAttemptStatus.submitted,
    });

    const body = await history(owner.token);

    expect(body.data.map((item) => item.attemptId)).toEqual([mine.attemptId]);
  });

  it('lists finished and expired attempts only, around the 5 s grace', async () => {
    const learner = await register();
    const userId = learner.userId;
    const submitted = await seedAttempt({
      userId,
      status: ExamAttemptStatus.submitted,
    });
    const timedOut = await seedAttempt({
      userId,
      status: ExamAttemptStatus.timed_out,
    });
    const pastGrace = await seedAttempt({
      userId,
      status: ExamAttemptStatus.in_progress,
      expiresAt: secondsAgo(6),
    });
    await seedAttempt({
      userId,
      status: ExamAttemptStatus.in_progress,
      expiresAt: secondsAgo(2),
    });
    await seedAttempt({
      userId,
      status: ExamAttemptStatus.in_progress,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await seedAttempt({ userId, status: ExamAttemptStatus.invalidated });

    const body = await history(learner.token);

    expect(body.data.map((item) => [item.attemptId, item.status])).toEqual([
      [pastGrace.attemptId, 'timed_out'],
      [timedOut.attemptId, 'timed_out'],
      [submitted.attemptId, 'submitted'],
    ]);
  });

  it('returns null scores and no skills before a Result exists', async () => {
    const learner = await register();
    await seedAttempt({
      userId: learner.userId,
      status: ExamAttemptStatus.timed_out,
      passScore: null,
    });

    const [item] = (await history(learner.token)).data;

    expect(item).toMatchObject({
      score: null,
      maxScore: null,
      passScore: null,
      passed: null,
      skills: [],
    });
  });

  it('pages newest first and caps limit at 50', async () => {
    const learner = await register();
    const ids: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const seeded = await seedAttempt({
        userId: learner.userId,
        status: ExamAttemptStatus.submitted,
      });
      ids.push(seeded.attemptId);
    }

    const second = await history(learner.token, '?page=2&limit=2');

    expect(second.data.map((item) => item.attemptId)).toEqual([ids[0]]);
    expect(second.meta.pagination).toEqual({
      page: 2,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    await history(learner.token, '?limit=50');
    const tooLarge = await http()
      .get('/api/v1/exam/attempts?limit=51')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(400);
    expect((tooLarge.body as ErrorBody).error.code).toBe(
      'REQUEST_VALIDATION_FAILED',
    );
  });

  it('filters by the frozen level and rejects an unknown one', async () => {
    const learner = await register();
    const hsk4 = await seedAttempt({
      userId: learner.userId,
      status: ExamAttemptStatus.submitted,
      frozenLevel: 'HSK4',
    });
    await seedAttempt({
      userId: learner.userId,
      status: ExamAttemptStatus.submitted,
    });

    const body = await history(learner.token, '?levelCode=HSK4');

    expect(body.data.map((item) => item.attemptId)).toEqual([hsk4.attemptId]);
    expect(body.meta.pagination.total).toBe(1);
    for (const bad of ['HSK9', 'hsk4']) {
      const response = await http()
        .get(`/api/v1/exam/attempts?levelCode=${bad}`)
        .set('Authorization', `Bearer ${learner.token}`)
        .expect(400);
      expect((response.body as ErrorBody).error.code).toBe(
        'REQUEST_VALIDATION_FAILED',
      );
    }
  });

  it('keeps the frozen title and level after the Test changes', async () => {
    const learner = await register();
    const seeded = await seedAttempt({
      userId: learner.userId,
      status: ExamAttemptStatus.submitted,
      frozenTitle: 'Tên lúc thi',
    });
    await prisma.test.update({
      where: { id: seeded.testId },
      data: { title: 'Tên mới', levelId: hsk4LevelId, passScore: 1 },
    });

    const [item] = (await history(learner.token)).data;

    expect(item).toMatchObject({
      testTitle: 'Tên lúc thi',
      levelCode: 'HSK3',
      passScore: 180,
    });
  });

  it('writes nothing when it reports an expired attempt', async () => {
    const learner = await register();
    const seeded = await seedAttempt({
      userId: learner.userId,
      status: ExamAttemptStatus.in_progress,
      expiresAt: secondsAgo(60),
    });
    const read = () =>
      prisma.examAttempt.findUniqueOrThrow({
        where: { id: seeded.attemptId },
        include: { events: true, result: true },
      });
    const before = await read();

    const [item] = (await history(learner.token)).data;

    expect(item?.status).toBe('timed_out');
    expect(await read()).toEqual(before);
    expect(before.status).toBe(ExamAttemptStatus.in_progress);
    expect(before.events).toEqual([]);
    expect(before.result).toBeNull();
  });

  it('runs the same Prisma operations for one row and for many', async () => {
    const learner = await register();
    for (let index = 0; index < 4; index += 1) {
      const seeded = await seedAttempt({
        userId: learner.userId,
        status: ExamAttemptStatus.submitted,
      });
      await seedResult(learner.userId, seeded);
    }
    let operations = 0;
    let counting = false;
    const selects: unknown[] = [];
    prisma.$use((params, next) => {
      // The throttler's cleanup timer shares this client and only runs executeRaw.
      if (counting && params.action !== 'executeRaw') {
        operations += 1;
        if (params.model === 'ExamAttempt' && params.action === 'findMany') {
          selects.push((params.args as { select: unknown }).select);
        }
      }
      return next(params);
    });
    const count = async (query: string): Promise<number> => {
      operations = 0;
      counting = true;
      await history(learner.token, query);
      counting = false;
      return operations;
    };

    const one = await count('?limit=1');
    const many = await count('?limit=4');

    expect(many).toBe(one);
    expect(selects).toHaveLength(2);
    expect(selects[1]).not.toHaveProperty('snapshot');
  });

  it('keeps attempts/:attemptId routed to the single-attempt read', async () => {
    const learner = await register();
    const response = await http()
      .get('/api/v1/exam/attempts/2147483647')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(404);
    expect((response.body as ErrorBody).error.code).toBe(
      'EXAM_ATTEMPT_NOT_FOUND',
    );
  });

  it('limits each learner to 60 reads a minute', async () => {
    const learner = await register();
    for (let index = 0; index < 60; index += 1) {
      await history(learner.token);
    }
    await http()
      .get('/api/v1/exam/attempts')
      .set('Authorization', `Bearer ${learner.token}`)
      .expect(429);
  });
});
