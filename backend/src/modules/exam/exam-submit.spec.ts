import { ExamAttemptStatus, Prisma, QuestionType, Skill } from '@prisma/client';
import type { HttpException } from '@nestjs/common';

import { ExamService } from './exam.service';

/**
 * TL-150/TL-151: the submit state machine. These tests drive the service through
 * its public `submitAttempt` seam with a fake Prisma client, so the assertions
 * are about the documented contract (transition, replay ledger, error codes and
 * the counts in the response) rather than about Prisma calls as an end in
 * themselves.
 */

type AttemptRow = {
  id: number;
  testId: number;
  status: ExamAttemptStatus;
  startedAt: Date;
  expiresAt: Date;
  maxScore: number | null;
  submittedAt: Date | null;
};

type EventRow = { type: string; metadata: Prisma.JsonValue };

const NOW = new Date('2026-10-30T10:00:00.000Z');
const EXPIRES_LATER = new Date(NOW.getTime() + 60 * 60 * 1_000);
const EXPIRES_PAST_GRACE = new Date(NOW.getTime() - 10_000);

function snapshotPayload(questionCount: number): Prisma.JsonObject {
  return {
    schemaVersion: 1,
    test: {
      id: 7,
      title: 'Đề thi thử',
      instruction: null,
      levelCode: 'HSK1',
      durationMinutes: 90,
      passScore: 0,
      maxScore: 100 * questionCount,
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
            key: 'g1',
            orderIndex: 1,
            title: null,
            instruction: null,
            content: null,
            audio: null,
            image: null,
            questions: Array.from(
              { length: questionCount },
              (_unused, index) => ({
                key: `q${String(index + 1)}`,
                orderIndex: index + 1,
                questionId: 100 + index,
                questionVersion: 1,
                type: QuestionType.mcq,
                skill: Skill.reading,
                content: 'Câu hỏi',
                answers: { options: [{ id: 'a', text: 'A' }] },
                audio: null,
                image: null,
                correctAnswer: { optionId: 'a' },
                explanation: null,
              }),
            ),
          },
        ],
      },
    ],
  };
}

type SubmitHarness = {
  service: ExamService;
  updates: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }>;
  events: Array<{ data: Record<string, unknown> }>;
  counts: Array<Record<string, unknown>>;
  findAttemptCalls: number;
};

function harness(input: {
  attempt?: AttemptRow | null;
  event?: EventRow | null;
  updateCount?: number;
  rereadStatus?: ExamAttemptStatus;
  answeredCount?: number;
  flaggedCount?: number;
  questionCount?: number;
  now?: Date;
}): SubmitHarness {
  const attempt: AttemptRow | null = input.attempt ?? {
    id: 42,
    testId: 7,
    status: ExamAttemptStatus.in_progress,
    startedAt: new Date(NOW.getTime() - 60_000),
    expiresAt: EXPIRES_LATER,
    maxScore: 100,
    submittedAt: null,
  };
  const now = input.now ?? NOW;
  const updates: SubmitHarness['updates'] = [];
  const events: SubmitHarness['events'] = [];
  const counts: SubmitHarness['counts'] = [];
  const state = { findAttemptCalls: 0 };

  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('clock_timestamp')) return Promise.resolve([{ now }]);
      return Promise.resolve([{ id: 42 }]);
    }),
    examAttempt: {
      findUniqueOrThrow: jest.fn(() => {
        if (attempt === null) {
          return Promise.reject(new Error('not found'));
        }
        return Promise.resolve(attempt);
      }),
      findUnique: jest.fn(() => {
        state.findAttemptCalls += 1;
        return Promise.resolve({
          status: input.rereadStatus ?? ExamAttemptStatus.submitted,
        });
      }),
      updateMany: jest.fn(
        (data: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          updates.push(data);
          return Promise.resolve({ count: input.updateCount ?? 1 });
        },
      ),
    },
    examAttemptEvent: {
      findUnique: jest.fn(() => Promise.resolve(input.event ?? null)),
      create: jest.fn((data: { data: Record<string, unknown> }) => {
        events.push(data);
        return Promise.resolve({ id: 1 });
      }),
    },
    examAttemptSnapshot: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          payload: snapshotPayload(input.questionCount ?? 2),
        }),
      ),
    },
    examAnswer: {
      count: jest.fn((args: Record<string, unknown>) => {
        counts.push(args);
        const value =
          args['where'] !== undefined &&
          (args['where'] as Record<string, unknown>)['isFlagged'] === true
            ? (input.flaggedCount ?? 1)
            : (input.answeredCount ?? 2);
        return Promise.resolve(value);
      }),
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
    updates,
    events,
    counts,
    get findAttemptCalls() {
      return state.findAttemptCalls;
    },
  };
}

/**
 * Awaits exactly one failing submit call. Calling the service twice per case
 * would be a second real submit attempt (and an unhandled rejection when the
 * first resolves), so every error case captures the single rejection here.
 */
async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(Error);
    return error as HttpException;
  }
  throw new Error('Expected the promise to reject.');
}

function bodyOf(error: HttpException): Record<string, unknown> {
  return error.getResponse() as Record<string, unknown>;
}

describe('ExamService.submitAttempt (TL-150/TL-151)', () => {
  it('submits an in-progress attempt with one conditional update and one event', async () => {
    const h = harness({});
    const response = await h.service.submitAttempt(1, 42, 'key-1');

    expect(response.data).toEqual({
      id: 42,
      status: 'submitted',
      submittedAt: NOW,
      serverNow: NOW,
      answeredCount: 2,
      unansweredCount: 0,
      flaggedCount: 1,
      replayed: false,
    });
    expect(h.updates).toEqual([
      {
        where: { id: 42, status: 'in_progress' },
        data: {
          status: 'submitted',
          submittedAt: NOW,
          remainingSeconds: 3_600,
        },
      },
    ]);
    expect(h.events).toEqual([
      {
        data: {
          attemptId: 42,
          type: 'submitted',
          idempotencyKey: 'key-1',
          metadata: {
            reason: 'user_submit',
            answeredCount: 2,
            unansweredCount: 0,
            flaggedCount: 1,
          },
          occurredAt: NOW,
        },
      },
    ]);
    // The answered count uses the intro predicate: an answer JSON null (a flag
    // with no answer) is not counted (F3).
    expect(h.counts[0]).toEqual({
      where: {
        attemptId: 42,
        NOT: { answer: { equals: Prisma.JsonNull } },
      },
    });
  });

  it('replays the same key without writing, using the stored event counts', async () => {
    const h = harness({
      attempt: {
        id: 42,
        testId: 7,
        status: ExamAttemptStatus.submitted,
        startedAt: new Date(NOW.getTime() - 60_000),
        expiresAt: EXPIRES_LATER,
        maxScore: 100,
        submittedAt: new Date(NOW.getTime() - 5_000),
      },
      event: {
        type: 'submitted',
        metadata: {
          reason: 'user_submit',
          answeredCount: 3,
          unansweredCount: 4,
          flaggedCount: 1,
        },
      },
      questionCount: 7,
    });

    const response = await h.service.submitAttempt(1, 42, 'key-1');

    expect(response.data).toMatchObject({
      id: 42,
      status: 'submitted',
      submittedAt: new Date(NOW.getTime() - 5_000),
      answeredCount: 3,
      unansweredCount: 4,
      flaggedCount: 1,
      replayed: true,
    });
    expect(h.updates).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('rejects an idempotency key that was already used by an autosave', async () => {
    const h = harness({
      event: { type: 'autosaved', metadata: { questionKey: 'q1' } },
    });
    const error = await rejection(h.service.submitAttempt(1, 42, 'key-1'));
    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error)).toMatchObject({
      code: 'EXAM_IDEMPOTENCY_KEY_REUSED',
    });
    expect(h.updates).toEqual([]);
  });

  it('rejects a submit on an already submitted attempt with its own code', async () => {
    const h = harness({
      attempt: {
        id: 42,
        testId: 7,
        status: ExamAttemptStatus.submitted,
        startedAt: new Date(NOW.getTime() - 60_000),
        expiresAt: EXPIRES_LATER,
        maxScore: 100,
        submittedAt: new Date(NOW.getTime() - 1_000),
      },
    });
    const error = await rejection(h.service.submitAttempt(1, 42, 'other-key'));
    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error)).toMatchObject({
      code: 'EXAM_ATTEMPT_ALREADY_SUBMITTED',
      status: 'submitted',
    });
  });

  it.each([ExamAttemptStatus.timed_out, ExamAttemptStatus.invalidated])(
    'maps an attempt in %s to EXAM_ATTEMPT_CLOSED',
    async (status) => {
      const h = harness({
        attempt: {
          id: 42,
          testId: 7,
          status,
          startedAt: new Date(NOW.getTime() - 60_000),
          expiresAt: EXPIRES_LATER,
          maxScore: 100,
          submittedAt: null,
        },
      });
      const error = await rejection(h.service.submitAttempt(1, 42, 'key-1'));
      expect(error.getStatus()).toBe(409);
      expect(bodyOf(error)).toMatchObject({
        code: 'EXAM_ATTEMPT_CLOSED',
        status,
      });
    },
  );

  it('commits the lazy timeout for a submit past the grace window, then answers 409', async () => {
    const h = harness({
      attempt: {
        id: 42,
        testId: 7,
        status: ExamAttemptStatus.in_progress,
        startedAt: new Date(NOW.getTime() - 91 * 60_000),
        expiresAt: EXPIRES_PAST_GRACE,
        maxScore: 100,
        submittedAt: null,
      },
    });

    const error = await rejection(h.service.submitAttempt(1, 42, 'key-1'));
    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error)).toMatchObject({
      code: 'EXAM_ATTEMPT_EXPIRED',
    });

    // The timeout must be written by the transaction that then commits, so the
    // event exists even though the request itself answers 409 (TL-151 step 5).
    expect(h.updates).toEqual([
      {
        where: { id: 42, status: 'in_progress' },
        data: {
          status: 'timed_out',
          submittedAt: EXPIRES_PAST_GRACE,
          remainingSeconds: 0,
        },
      },
    ]);
    expect(h.events).toEqual([
      {
        data: {
          attemptId: 42,
          type: 'timed_out',
          metadata: { reason: 'expired_on_submit' },
          occurredAt: NOW,
        },
      },
    ]);
  });

  it('re-reads the status when the conditional update loses the race', async () => {
    const h = harness({
      updateCount: 0,
      rereadStatus: ExamAttemptStatus.submitted,
    });
    const error = await rejection(h.service.submitAttempt(1, 42, 'key-1'));
    expect(error.getStatus()).toBe(409);
    expect(bodyOf(error)).toMatchObject({
      code: 'EXAM_ATTEMPT_ALREADY_SUBMITTED',
      status: 'submitted',
    });
    expect(h.findAttemptCalls).toBe(1);
    expect(h.events).toEqual([]);
  });

  it.each([ExamAttemptStatus.timed_out, ExamAttemptStatus.invalidated])(
    'maps a reread %s after a lost conditional update to EXAM_ATTEMPT_CLOSED',
    async (rereadStatus) => {
      const h = harness({ updateCount: 0, rereadStatus });
      const error = await rejection(h.service.submitAttempt(1, 42, 'key-1'));
      expect(error.getStatus()).toBe(409);
      expect(bodyOf(error)).toMatchObject({
        code: 'EXAM_ATTEMPT_CLOSED',
        status: rereadStatus,
      });
      expect(h.findAttemptCalls).toBe(1);
      expect(h.events).toEqual([]);
    },
  );

  it('reports a negative remaining time as zero inside the grace window', async () => {
    const expired = new Date(NOW.getTime() - 2_000);
    const h = harness({
      attempt: {
        id: 42,
        testId: 7,
        status: ExamAttemptStatus.in_progress,
        startedAt: new Date(NOW.getTime() - 91 * 60_000),
        expiresAt: expired,
        maxScore: 100,
        submittedAt: null,
      },
    });
    const response = await h.service.submitAttempt(1, 42, 'key-grace');
    expect(h.updates[0]?.data['remainingSeconds']).toBe(0);
    expect(response.data.status).toBe('submitted');
  });

  it('counts unanswered questions from the frozen snapshot', async () => {
    const h = harness({ answeredCount: 1, questionCount: 3 });
    const response = await h.service.submitAttempt(1, 42, 'key-1');
    expect(response.data).toMatchObject({
      answeredCount: 1,
      unansweredCount: 2,
    });
  });
});
