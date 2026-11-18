import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ExamAttemptStatus, QuestionType, Skill } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import * as scoring from './exam-scoring';
import { ExamService } from './exam.service';

/**
 * M4.3 / TL-165 / TL-166: the result and review read paths. The service is
 * driven through its public seams (`getAttemptResult`, `getAttemptReview`) with
 * a fake Prisma client, so the assertions are about the documented contract:
 * owner-only 404, the lazy timeout, lazy grading exactly once (Q147), the
 * scoring-failed 409 (Q156), the invalidated 409 (Q157) and the "read back the
 * stored Result, never re-grade" rule.
 */

const NOW = new Date('2026-11-02T10:00:00.000Z');
const STARTED_AT = new Date(NOW.getTime() - 60 * 60 * 1_000);
const SUBMITTED_AT = new Date(NOW.getTime() - 10_000);
const EXPIRES_LATER = new Date(NOW.getTime() + 60 * 60 * 1_000);
const EXPIRES_PAST_GRACE = new Date(NOW.getTime() - 10_000);

type AttemptRow = {
  id: number;
  userId: number;
  testId: number;
  status: ExamAttemptStatus;
  startedAt: Date;
  expiresAt: Date;
  submittedAt: Date | null;
  maxScore: number | null;
  scoringVersion: string;
};

type StoredResultRow = {
  id: number;
  score: number;
  maxScore: number | null;
  passed: boolean | null;
  scoringVersion: string | null;
  publishedAt: Date | null;
  detailJson: Prisma.JsonValue;
};

function snapshotPayload(): Prisma.JsonObject {
  return {
    schemaVersion: 1,
    test: {
      id: 7,
      title: 'Đề A3',
      instruction: null,
      levelCode: 'HSK1',
      durationMinutes: 90,
      passScore: 50,
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
                questionId: 101,
                questionVersion: 1,
                type: QuestionType.mcq,
                skill: Skill.reading,
                content: 'Câu một',
                answers: { options: [{ id: 'a', text: 'A' }] },
                audio: null,
                image: null,
                correctAnswer: { optionId: 'a' },
                explanation: 'Vì A đúng.',
              },
            ],
          },
        ],
      },
    ],
  };
}

function storedDetail(overrides: Prisma.JsonObject = {}): Prisma.JsonObject {
  return {
    schemaVersion: 1,
    attemptScoringVersion: 'hsk-p0-v1',
    snapshotContentHash: 'a'.repeat(64),
    counts: {
      answeredCount: 1,
      correctCount: 1,
      incorrectCount: 0,
      unansweredCount: 0,
    },
    sections: [
      {
        key: 's1',
        skill: Skill.reading,
        questionCount: 1,
        correctCount: 1,
        score: 100,
        maxScore: 100,
      },
    ],
    weakAreas: [],
    questions: [{ key: 'q1', isCorrect: true }],
    ...overrides,
  };
}

function storedResult(
  overrides: Partial<StoredResultRow> = {},
): StoredResultRow {
  return {
    id: 77,
    score: 100,
    maxScore: 100,
    passed: true,
    scoringVersion: 'exam-score-v1',
    publishedAt: NOW,
    detailJson: storedDetail(),
    ...overrides,
  };
}

type HarnessInput = {
  attempt?: AttemptRow | null;
  /** false simulates another learner's (or an unknown) attempt id. */
  locked?: boolean;
  /** A committed Result already exists (the second read after grading). */
  existingResult?: StoredResultRow | null;
  /** Simulates a Result row that vanished between grading and the read back. */
  missingStoredResult?: boolean;
  answers?: Array<{ snapshotQuestionKey: string; answer: Prisma.JsonValue }>;
};

type Harness = {
  service: ExamService;
  resultCreates: Array<{ data: Record<string, unknown> }>;
  scoreUpdates: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }>;
  timedOutEvents: Array<{ data: Record<string, unknown> }>;
  attemptUpdates: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }>;
  resultReads: number;
};

function harness(input: HarnessInput = {}): Harness {
  const attempt: AttemptRow | null =
    input.attempt === undefined
      ? {
          id: 42,
          userId: 1,
          testId: 7,
          status: ExamAttemptStatus.submitted,
          startedAt: STARTED_AT,
          expiresAt: EXPIRES_LATER,
          submittedAt: SUBMITTED_AT,
          maxScore: 100,
          scoringVersion: 'hsk-p0-v1',
        }
      : input.attempt;
  const locked = input.locked ?? true;
  const existingResult = input.existingResult ?? null;
  const missingStoredResult = input.missingStoredResult ?? false;
  const answers = input.answers ?? [
    { snapshotQuestionKey: 'q1', answer: { choice: 'a' } },
  ];

  const state = { resultReads: 0 };
  const resultCreates: Harness['resultCreates'] = [];
  const scoreUpdates: Harness['scoreUpdates'] = [];
  const timedOutEvents: Harness['timedOutEvents'] = [];
  const attemptUpdates: Harness['attemptUpdates'] = [];
  let createdResult: StoredResultRow | null = null;

  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('clock_timestamp'))
        return Promise.resolve([{ now: NOW }]);
      return Promise.resolve(locked ? [{ id: 42 }] : []);
    }),
    examAttempt: {
      findUniqueOrThrow: jest.fn(() =>
        attempt === null
          ? Promise.reject(new Error('attempt missing'))
          : Promise.resolve(attempt),
      ),
      findUnique: jest.fn(() =>
        Promise.resolve({ status: attempt?.status ?? null }),
      ),
      updateMany: jest.fn(
        (data: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          attemptUpdates.push(data);
          return Promise.resolve({ count: 1 });
        },
      ),
      update: jest.fn(
        (data: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          scoreUpdates.push(data);
          return Promise.resolve({ id: 42 });
        },
      ),
    },
    examAttemptSnapshot: {
      findUnique: jest.fn(() =>
        Promise.resolve({ payload: snapshotPayload(), contentHash: 'frozen' }),
      ),
    },
    examAnswer: {
      findMany: jest.fn(() => Promise.resolve(answers)),
    },
    questionTag: {
      findMany: jest.fn(() => Promise.resolve([])),
    },
    examAttemptEvent: {
      create: jest.fn((data: { data: Record<string, unknown> }) => {
        timedOutEvents.push(data);
        return Promise.resolve({ id: 1 });
      }),
    },
    result: {
      findUnique: jest.fn(() => {
        state.resultReads += 1;
        if (state.resultReads === 1) {
          // `ensureAttemptResult` read-first: only the id is selected.
          return Promise.resolve(
            existingResult === null ? null : { id: existingResult.id },
          );
        }
        return Promise.resolve(
          missingStoredResult ? null : (existingResult ?? createdResult),
        );
      }),
      create: jest.fn((data: { data: Record<string, unknown> }) => {
        resultCreates.push(data);
        createdResult = {
          id: 88,
          score: data.data['score'] as number,
          maxScore: (data.data['maxScore'] as number | null) ?? null,
          passed: (data.data['passed'] as boolean | null) ?? null,
          scoringVersion: data.data['scoringVersion'] as string,
          publishedAt: data.data['publishedAt'] as Date,
          detailJson: data.data['detailJson'] as Prisma.JsonValue,
        };
        return Promise.resolve({ id: 88 });
      }),
    },
    resultSkillScore: {
      findMany: jest.fn(() =>
        Promise.resolve([{ skill: Skill.reading, score: 100, total: 100 }]),
      ),
    },
  };

  const prisma = {
    $transaction: jest.fn((callback: (client: unknown) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
  };

  const service = new ExamService(prisma as never, {
    checkpoint: jest.fn(() => Promise.resolve()),
  });

  return {
    service,
    resultCreates,
    scoreUpdates,
    timedOutEvents,
    attemptUpdates,
    get resultReads() {
      return state.resultReads;
    },
  };
}

async function rejection(
  promise: Promise<unknown>,
): Promise<HttpExceptionShape> {
  try {
    await promise;
  } catch (error: unknown) {
    return error as HttpExceptionShape;
  }
  throw new Error('Expected the promise to reject.');
}

type HttpExceptionShape = {
  getStatus: () => number;
  getResponse: () => Record<string, unknown>;
};

function bodyOf(error: HttpExceptionShape): Record<string, unknown> {
  return error.getResponse();
}

describe('ExamService.getAttemptResult (A3/TL-165)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("hides another learner's or an unknown attempt behind 404", async () => {
    const h = harness({ locked: false });
    const error = await rejection(h.service.getAttemptResult(1, 42));

    expect(error.getStatus()).toBe(404);
    expect(bodyOf(error)).toMatchObject({ code: 'EXAM_ATTEMPT_NOT_FOUND' });
    expect(h.resultCreates).toEqual([]);
    expect(h.resultReads).toBe(0);
  });

  it('answers 409 EXAM_ATTEMPT_NOT_TERMINAL while the attempt is in progress', async () => {
    const h = harness({
      attempt: {
        id: 42,
        userId: 1,
        testId: 7,
        status: ExamAttemptStatus.in_progress,
        startedAt: STARTED_AT,
        expiresAt: EXPIRES_LATER,
        submittedAt: null,
        maxScore: 100,
        scoringVersion: 'hsk-p0-v1',
      },
    });
    const error = await rejection(h.service.getAttemptResult(1, 42));

    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error)).toMatchObject({
      code: 'EXAM_ATTEMPT_NOT_TERMINAL',
    });
    expect(h.resultCreates).toEqual([]);
    expect(h.timedOutEvents).toEqual([]);
  });

  it('answers 409 EXAM_ATTEMPT_CLOSED for an invalidated attempt without grading', async () => {
    const h = harness({
      attempt: {
        id: 42,
        userId: 1,
        testId: 7,
        status: ExamAttemptStatus.invalidated,
        startedAt: STARTED_AT,
        expiresAt: EXPIRES_LATER,
        submittedAt: null,
        maxScore: 100,
        scoringVersion: 'hsk-p0-v1',
      },
    });
    const error = await rejection(h.service.getAttemptResult(1, 42));

    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error)).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      status: 'invalidated',
    });
    expect(h.resultCreates).toEqual([]);
    expect(h.resultReads).toBe(0);
  });

  it('applies the lazy timeout, then grades it lazily on the same read (Q147)', async () => {
    const h = harness({
      attempt: {
        id: 42,
        userId: 1,
        testId: 7,
        status: ExamAttemptStatus.in_progress,
        startedAt: STARTED_AT,
        expiresAt: EXPIRES_PAST_GRACE,
        submittedAt: null,
        maxScore: 100,
        scoringVersion: 'hsk-p0-v1',
      },
    });
    const response = await h.service.getAttemptResult(1, 42);

    // Exactly one transition, with the documented reason.
    expect(h.attemptUpdates).toHaveLength(1);
    expect(h.timedOutEvents).toHaveLength(1);
    expect(h.timedOutEvents[0]?.data).toMatchObject({
      type: 'timed_out',
      metadata: { reason: 'expired_on_read' },
    });
    // The terminal transition happened before the grading write.
    expect(h.resultCreates).toHaveLength(1);
    expect(response.data).toMatchObject({
      attemptId: 42,
      status: 'timed_out',
      // Q146: a timed-out attempt is graded like a submitted one.
      submittedAt: EXPIRES_PAST_GRACE,
      score: 100,
      maxScore: 100,
      passScore: 50,
      passed: true,
      scoringVersion: 'exam-score-v1',
      gradedAt: NOW,
    });
  });

  it('answers 409 EXAM_RESULT_UNAVAILABLE and logs a fixed warn when scoring fails (Q156)', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const h = harness({
      answers: [{ snapshotQuestionKey: 'q1', answer: { choice: 123 } }],
    });
    const error = await rejection(h.service.getAttemptResult(1, 42));

    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error)).toMatchObject({
      code: 'EXAM_RESULT_UNAVAILABLE',
    });
    expect(warn).toHaveBeenCalledWith('exam.grading.failed', {
      attemptId: 42,
      error: 'ExamScoringError',
    });
    expect(h.resultCreates).toEqual([]);
    expect(h.scoreUpdates).toEqual([]);
  });

  it('reads the stored Result back without grading again (existing)', async () => {
    const grader = jest.spyOn(scoring, 'scoreExamAttempt');
    const h = harness({
      existingResult: storedResult({
        id: 77,
        score: 42,
        maxScore: 100,
        passed: false,
      }),
    });
    const response = await h.service.getAttemptResult(1, 42);

    // The stored numbers win; a re-grade would return 100/true here.
    expect(grader).not.toHaveBeenCalled();
    expect(response.data).toMatchObject({
      attemptId: 42,
      score: 42,
      maxScore: 100,
      passed: false,
      skills: [{ skill: Skill.reading, score: 100, maxScore: 100 }],
      sections: [
        {
          key: 's1',
          title: 'Đọc hiểu',
          skill: Skill.reading,
          questionCount: 1,
          correctCount: 1,
          score: 100,
          maxScore: 100,
        },
      ],
      counts: {
        answeredCount: 1,
        correctCount: 1,
        incorrectCount: 0,
        unansweredCount: 0,
      },
    });
    expect(h.resultCreates).toEqual([]);
    expect(h.scoreUpdates).toEqual([]);
  });

  it('creates exactly one Result when none exists yet and mirrors the score on the attempt', async () => {
    const h = harness({ existingResult: null });
    const response = await h.service.getAttemptResult(1, 42);

    expect(h.resultCreates).toHaveLength(1);
    expect(h.resultCreates[0]?.data).toMatchObject({
      userId: 1,
      attemptId: 42,
      score: 100,
      maxScore: 100,
      passed: true,
      scoringVersion: 'exam-score-v1',
    });
    // A3a/Q155: the attempt score is only written with a non-null maxScore.
    expect(h.scoreUpdates).toEqual([
      { where: { id: 42 }, data: { score: 100 } },
    ]);
    expect(response.data.score).toBe(100);
  });

  it('fails closed and logs a fixed line when the stored detailJson is invalid', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const h = harness({
      existingResult: storedResult({
        detailJson: { schemaVersion: 2 } as Prisma.JsonObject,
      }),
    });
    const error = await rejection(h.service.getAttemptResult(1, 42));

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getStatus()).toBe(500);
    expect(bodyOf(error)).toMatchObject({
      message: 'Exam result is unavailable.',
    });
    // Q147/stored-shape guard: fixed message + attemptId only, never the stored
    // breakdown or an answer.
    expect(errorLog).toHaveBeenCalledWith('exam.result.detail.invalid', {
      attemptId: 42,
    });
  });

  it('fails closed and logs exam.result.internal when the terminal attempt has no submittedAt', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const h = harness({
      attempt: {
        id: 42,
        userId: 1,
        testId: 7,
        status: ExamAttemptStatus.submitted,
        startedAt: STARTED_AT,
        expiresAt: EXPIRES_LATER,
        submittedAt: null,
        maxScore: 100,
        scoringVersion: 'hsk-p0-v1',
      },
    });
    const error = await rejection(h.service.getAttemptResult(1, 42));

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getStatus()).toBe(500);
    expect(bodyOf(error)).toMatchObject({
      message: 'Exam result is unavailable.',
    });
    expect(errorLog).toHaveBeenCalledWith('exam.result.internal', {
      attemptId: 42,
      reason: 'missing_submitted_at',
    });
  });

  it('fails closed and logs exam.result.internal when the stored Result row vanished', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const h = harness({
      existingResult: storedResult(),
      missingStoredResult: true,
    });
    const error = await rejection(h.service.getAttemptResult(1, 42));

    expect(error.getStatus()).toBe(500);
    expect(bodyOf(error)).toMatchObject({
      message: 'Exam result is unavailable.',
    });
    expect(errorLog).toHaveBeenCalledWith('exam.result.internal', {
      attemptId: 42,
      reason: 'missing_result_row',
    });
  });

  it('fails closed and logs exam.result.internal when the stored Result row is incomplete', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const h = harness({
      existingResult: storedResult({ publishedAt: null }),
    });
    const error = await rejection(h.service.getAttemptResult(1, 42));

    expect(error.getStatus()).toBe(500);
    expect(bodyOf(error)).toMatchObject({
      message: 'Exam result is unavailable.',
    });
    expect(errorLog).toHaveBeenCalledWith('exam.result.internal', {
      attemptId: 42,
      reason: 'incomplete_result_row',
    });
  });

  it('fails closed and logs exam.result.internal when the breakdown names an unknown section', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const broken = storedDetail();
    broken.sections = [
      {
        key: 's9',
        skill: Skill.reading,
        questionCount: 1,
        correctCount: 1,
        score: 100,
        maxScore: 100,
      },
    ];
    const h = harness({ existingResult: storedResult({ detailJson: broken }) });
    const error = await rejection(h.service.getAttemptResult(1, 42));

    expect(error.getStatus()).toBe(500);
    expect(bodyOf(error)).toMatchObject({
      message: 'Exam result is unavailable.',
    });
    expect(errorLog).toHaveBeenCalledWith('exam.result.internal', {
      attemptId: 42,
      reason: 'unknown_section',
    });
  });
});

describe('ExamService.getAttemptReview (A3/TL-166)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns every frozen question with the stored correctness and answer key', async () => {
    const h = harness({ existingResult: null });
    const response = await h.service.getAttemptReview(1, 42);

    expect(h.resultCreates).toHaveLength(1);
    expect(response.data).toMatchObject({
      attemptId: 42,
      status: 'submitted',
      testTitle: 'Đề A3',
      startedAt: STARTED_AT,
      submittedAt: SUBMITTED_AT,
    });
    const [question] = response.data.questions;
    expect(question).toMatchObject({
      key: 'q1',
      orderIndex: 1,
      type: QuestionType.mcq,
      skill: Skill.reading,
      content: 'Câu một',
      answers: { options: [{ id: 'a', text: 'A' }] },
      learnerAnswer: { choice: 'a' },
      correctAnswer: { optionId: 'a' },
      explanation: 'Vì A đúng.',
      isCorrect: true,
      audio: null,
      image: null,
    });
  });

  it('takes isCorrect from the stored detail, not from the answers (one source)', async () => {
    const h = harness({
      existingResult: storedResult({
        detailJson: storedDetail({
          questions: [{ key: 'q1', isCorrect: false }],
          counts: {
            answeredCount: 1,
            correctCount: 0,
            incorrectCount: 1,
            unansweredCount: 0,
          },
        }),
      }),
    });
    const response = await h.service.getAttemptReview(1, 42);

    // The learner answer is right, but the persisted grading says wrong.
    expect(response.data.questions[0]).toMatchObject({
      learnerAnswer: { choice: 'a' },
      correctAnswer: { optionId: 'a' },
      isCorrect: false,
    });
  });

  it('grades a timed_out attempt lazily into exactly one Result (Q147)', async () => {
    const h = harness({
      attempt: {
        id: 42,
        userId: 1,
        testId: 7,
        status: ExamAttemptStatus.timed_out,
        startedAt: STARTED_AT,
        expiresAt: EXPIRES_PAST_GRACE,
        submittedAt: EXPIRES_PAST_GRACE,
        maxScore: 100,
        scoringVersion: 'hsk-p0-v1',
      },
      existingResult: null,
    });
    const response = await h.service.getAttemptReview(1, 42);

    expect(h.resultCreates).toHaveLength(1);
    expect(response.data).toMatchObject({ status: 'timed_out' });
    expect(h.timedOutEvents).toEqual([]);
  });

  it('answers 409 EXAM_ATTEMPT_NOT_TERMINAL for an in-progress attempt', async () => {
    const h = harness({
      attempt: {
        id: 42,
        userId: 1,
        testId: 7,
        status: ExamAttemptStatus.in_progress,
        startedAt: STARTED_AT,
        expiresAt: EXPIRES_LATER,
        submittedAt: null,
        maxScore: 100,
        scoringVersion: 'hsk-p0-v1',
      },
    });
    const error = await rejection(h.service.getAttemptReview(1, 42));

    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error)).toMatchObject({ code: 'EXAM_ATTEMPT_NOT_TERMINAL' });
    expect(bodyOf(error)).not.toHaveProperty('questions');
    expect(JSON.stringify(bodyOf(error))).not.toContain('correctAnswer');
  });

  it('answers 409 EXAM_ATTEMPT_CLOSED for an invalidated attempt without the answer key (Q157)', async () => {
    const h = harness({
      attempt: {
        id: 42,
        userId: 1,
        testId: 7,
        status: ExamAttemptStatus.invalidated,
        startedAt: STARTED_AT,
        expiresAt: EXPIRES_LATER,
        submittedAt: null,
        maxScore: 100,
        scoringVersion: 'hsk-p0-v1',
      },
    });
    const error = await rejection(h.service.getAttemptReview(1, 42));

    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error)).toMatchObject({
      code: 'EXAM_ATTEMPT_CLOSED',
      status: 'invalidated',
    });
    const body = JSON.stringify(bodyOf(error));
    expect(body).not.toContain('correctAnswer');
    expect(body).not.toContain('explanation');
    expect(body).not.toContain('questions');
    expect(h.resultCreates).toEqual([]);
  });

  it("hides another learner's attempt behind 404", async () => {
    const h = harness({ locked: false });
    const error = await rejection(h.service.getAttemptReview(1, 42));
    expect(error.getStatus()).toBe(404);
    expect(bodyOf(error)).toMatchObject({ code: 'EXAM_ATTEMPT_NOT_FOUND' });
    // A foreign/unknown attempt writes nothing and emits no event.
    expect(h.resultCreates).toEqual([]);
    expect(h.resultReads).toBe(0);
    expect(h.timedOutEvents).toEqual([]);
  });

  it('fails closed and logs a fixed line when the review detailJson is invalid', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const h = harness({
      existingResult: storedResult({
        detailJson: { schemaVersion: 2 } as Prisma.JsonObject,
      }),
    });
    const error = await rejection(h.service.getAttemptReview(1, 42));

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(error.getStatus()).toBe(500);
    expect(bodyOf(error)).toMatchObject({
      message: 'Exam result is unavailable.',
    });
    expect(errorLog).toHaveBeenCalledWith('exam.result.detail.invalid', {
      attemptId: 42,
    });
  });

  it('fails closed and logs exam.result.internal when the breakdown misses a graded question', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const broken = storedDetail();
    broken.questions = [];
    const h = harness({ existingResult: storedResult({ detailJson: broken }) });
    const error = await rejection(h.service.getAttemptReview(1, 42));

    expect(error.getStatus()).toBe(500);
    expect(bodyOf(error)).toMatchObject({
      message: 'Exam result is unavailable.',
    });
    expect(errorLog).toHaveBeenCalledWith('exam.result.internal', {
      attemptId: 42,
      reason: 'missing_graded_question',
    });
  });

  it('answers 409 EXAM_RESULT_UNAVAILABLE when grading fails (Q156)', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const h = harness({
      answers: [{ snapshotQuestionKey: 'q1', answer: { choice: 123 } }],
    });
    const error = await rejection(h.service.getAttemptReview(1, 42));

    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error)).toMatchObject({ code: 'EXAM_RESULT_UNAVAILABLE' });
    expect(warn).toHaveBeenCalledWith('exam.grading.failed', {
      attemptId: 42,
      error: 'ExamScoringError',
    });
    expect(h.resultCreates).toEqual([]);
  });
});
