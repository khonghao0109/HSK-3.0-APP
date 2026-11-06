import { ExamAttemptStatus, QuestionType, Skill } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { EXAM_SCORING_VERSION, ExamScoringError } from './exam-scoring';
import {
  ensureAttemptResult,
  type ExamResultAttempt,
} from './exam-result.persistence';

/**
 * M4.3 / TL-163: `ensureAttemptResult` is the only writer of the `Result` row
 * for a submitted exam attempt. The tests drive it through its transaction seam
 * with a fake Prisma client so the assertions are about the documented contract
 * (idempotent read-first, frozen snapshot + live tags, one insert, the attempt
 * score). A few cases pin the exact query arguments on purpose: the tag join
 * must stay restricted to the snapshot's question ids, and a read-first hit must
 * not touch anything else, so a widened query cannot slip through unnoticed.
 */

const NOW = new Date('2026-11-02T10:00:00.000Z');

function snapshotPayload(): Prisma.JsonObject {
  return {
    schemaVersion: 1,
    test: {
      id: 7,
      title: 'Đề thi thử',
      instruction: null,
      levelCode: 'HSK1',
      durationMinutes: 90,
      passScore: 150,
      maxScore: 200,
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
                explanation: null,
              },
              {
                key: 'q2',
                orderIndex: 2,
                questionId: 102,
                questionVersion: 1,
                type: QuestionType.true_false,
                skill: Skill.reading,
                content: 'Câu hai',
                answers: {},
                audio: null,
                image: null,
                correctAnswer: { value: true },
                explanation: null,
              },
            ],
          },
        ],
      },
      {
        key: 's2',
        orderIndex: 2,
        skill: Skill.listening,
        title: 'Nghe hiểu',
        instruction: null,
        maxScore: 100,
        groups: [
          {
            key: 'g2',
            orderIndex: 1,
            title: null,
            instruction: null,
            content: null,
            audio: null,
            image: null,
            questions: [
              {
                key: 'q3',
                orderIndex: 1,
                questionId: 103,
                questionVersion: 1,
                type: QuestionType.mcq,
                skill: Skill.listening,
                content: 'Câu ba',
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
}

const CONTENT_HASH =
  'a3ef5b1e5f9c2d7b8a4c6e0f1d2b3a4c5d6e7f8091a2b3c4d5e6f708192a3b4c';

type AttemptFixture = ExamResultAttempt;

function attemptRow(overrides: Partial<AttemptFixture> = {}): AttemptFixture {
  return {
    id: 42,
    userId: 3,
    testId: 7,
    status: ExamAttemptStatus.submitted,
    scoringVersion: 'hsk-p0-v1',
    maxScore: 200,
    ...overrides,
  };
}

type AnswerFixture = { snapshotQuestionKey: string; answer: Prisma.JsonValue };
type TagFixture = {
  questionId: number;
  tag: { slug: string; name: string };
};

type Harness = {
  outcome: Awaited<ReturnType<typeof ensureAttemptResult>>;
  creates: Array<{ data: Record<string, unknown> }>;
  attemptUpdates: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }>;
  tagQueries: Array<Record<string, unknown>>;
  called: string[];
};

function makeHarness(input: {
  attempt?: AttemptFixture;
  existingResultId?: number | null;
  answers?: AnswerFixture[];
  tags?: TagFixture[];
  createdId?: number;
  missingSnapshot?: boolean;
}): { tx: unknown; tracking: Harness } {
  const tracking: Harness = {
    outcome: { kind: 'existing', resultId: 0 },
    creates: [],
    attemptUpdates: [],
    tagQueries: [],
    called: [],
  };
  const existId = input.existingResultId ?? null;

  const tx = {
    result: {
      findUnique: jest.fn((args: Record<string, unknown>) => {
        tracking.called.push('result.findUnique');
        expect(args).toEqual({
          where: { attemptId: 42 },
          select: { id: true },
        });
        return Promise.resolve(existId === null ? null : { id: existId });
      }),
      create: jest.fn((args: { data: Record<string, unknown> }) => {
        tracking.called.push('result.create');
        tracking.creates.push(args);
        return Promise.resolve({ id: input.createdId ?? 99 });
      }),
    },
    examAttemptSnapshot: {
      findUnique: jest.fn((args: Record<string, unknown>) => {
        tracking.called.push('examAttemptSnapshot.findUnique');
        expect(args).toEqual({
          where: { attemptId: 42 },
          select: { payload: true, contentHash: true },
        });
        if (input.missingSnapshot === true) return Promise.resolve(null);
        return Promise.resolve({
          payload: snapshotPayload(),
          contentHash: CONTENT_HASH,
        });
      }),
    },
    examAnswer: {
      findMany: jest.fn((args: Record<string, unknown>) => {
        tracking.called.push('examAnswer.findMany');
        expect(args).toEqual({
          where: { attemptId: 42 },
          select: { snapshotQuestionKey: true, answer: true },
        });
        return Promise.resolve(
          input.answers ?? [
            { snapshotQuestionKey: 'q1', answer: { choice: 'b' } },
            { snapshotQuestionKey: 'q2', answer: null },
            { snapshotQuestionKey: 'q3', answer: { choice: 'b' } },
          ],
        );
      }),
    },
    questionTag: {
      findMany: jest.fn((args: Record<string, unknown>) => {
        tracking.called.push('questionTag.findMany');
        tracking.tagQueries.push(args);
        return Promise.resolve(
          input.tags ?? [
            { questionId: 101, tag: { slug: 'grammar', name: 'Ngữ pháp' } },
            { questionId: 102, tag: { slug: 'grammar', name: 'Ngữ pháp' } },
          ],
        );
      }),
    },
    examAttempt: {
      update: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          tracking.called.push('examAttempt.update');
          tracking.attemptUpdates.push(args);
          return Promise.resolve({ id: 42 });
        },
      ),
    },
  };

  return { tx, tracking };
}

async function run(
  input: Parameters<typeof makeHarness>[0] = {},
): Promise<Harness> {
  const { tx, tracking } = makeHarness(input);
  tracking.outcome = await ensureAttemptResult(
    tx as never,
    input.attempt ?? attemptRow(),
    NOW,
  );
  return tracking;
}

describe('ensureAttemptResult (TL-163)', () => {
  it('returns the existing result and writes nothing (idempotent read-first)', async () => {
    const h = await run({ existingResultId: 9 });

    expect(h.outcome).toEqual({ kind: 'existing', resultId: 9 });
    expect(h.called).toEqual(['result.findUnique']);
    expect(h.creates).toEqual([]);
    expect(h.attemptUpdates).toEqual([]);
  });

  it('creates one Result from the frozen snapshot and updates the attempt score', async () => {
    const h = await run({});

    expect(h.outcome).toEqual({ kind: 'created', resultId: 99 });
    expect(h.creates).toHaveLength(1);

    const data = h.creates[0]?.data;
    expect(data).toMatchObject({
      userId: 3,
      testId: 7,
      attemptId: 42,
      score: 0,
      maxScore: 200,
      passed: false,
      awardedBand: null,
      scoringVersion: EXAM_SCORING_VERSION,
      publishedAt: NOW,
    });

    // Q143: 0 correct in reading and listening => 0 + 0; the maximum is
    // 100 × sectionCount, and the pass line comes from the frozen passScore.
    expect(data?.['detailJson']).toEqual({
      schemaVersion: 1,
      attemptScoringVersion: 'hsk-p0-v1',
      snapshotContentHash: CONTENT_HASH,
      counts: {
        answeredCount: 2,
        correctCount: 0,
        incorrectCount: 2,
        unansweredCount: 1,
      },
      sections: [
        {
          key: 's1',
          skill: Skill.reading,
          questionCount: 2,
          correctCount: 0,
          score: 0,
          maxScore: 100,
        },
        {
          key: 's2',
          skill: Skill.listening,
          questionCount: 1,
          correctCount: 0,
          score: 0,
          maxScore: 100,
        },
      ],
      // Q154: the tag has only one answered question here, so it is not a
      // weak area yet (the dedicated case below answers two).
      weakAreas: [],
      questions: [
        { key: 'q1', isCorrect: false },
        { key: 'q2', isCorrect: false },
        { key: 'q3', isCorrect: false },
      ],
    });

    // The breakdown must never carry the answer key, the explanation or the
    // frozen question content (Q155).
    const serialized = JSON.stringify(data?.['detailJson']);
    expect(serialized).not.toContain('optionId');
    expect(serialized).not.toContain('correctAnswer');

    expect(data?.['skillScores']).toEqual({
      create: [
        { skill: Skill.reading, score: 0, total: 100 },
        { skill: Skill.listening, score: 0, total: 100 },
      ],
    });
    expect(h.attemptUpdates).toEqual([
      { where: { id: 42 }, data: { score: 0 } },
    ]);
  });

  it('lists a weak area only when the tag has at least two answered questions (Q154)', async () => {
    const h = await run({
      answers: [
        { snapshotQuestionKey: 'q1', answer: { choice: 'b' } },
        { snapshotQuestionKey: 'q2', answer: { value: false } },
        { snapshotQuestionKey: 'q3', answer: null },
      ],
    });

    const detail = h.creates[0]?.data['detailJson'] as Record<string, unknown>;
    expect(detail['weakAreas']).toEqual([
      {
        slug: 'grammar',
        name: 'Ngữ pháp',
        answered: 2,
        correct: 0,
        accuracy: 0,
        level: 'weak',
      },
    ]);
    expect(detail['counts']).toEqual({
      answeredCount: 2,
      correctCount: 0,
      incorrectCount: 2,
      unansweredCount: 1,
    });
  });

  it('scores a partially correct attempt across sections', async () => {
    const h = await run({
      answers: [
        { snapshotQuestionKey: 'q1', answer: { choice: 'a' } },
        { snapshotQuestionKey: 'q2', answer: { value: true } },
        { snapshotQuestionKey: 'q3', answer: { choice: 'b' } },
      ],
    });

    const data = h.creates[0]?.data;
    expect(data?.['score']).toBe(100);
    expect(data?.['passed']).toBe(false);
    expect(h.attemptUpdates[0]?.data).toEqual({ score: 100 });
  });

  // A3a/Q155: `ExamAttempt.score` is only meaningful next to its maximum, so a
  // null `maxScore` skips the mirror without skipping the Result.
  it('skips the attempt score update when the attempt has no maxScore', async () => {
    const h = await run({ attempt: attemptRow({ maxScore: null }) });

    expect(h.outcome).toEqual({ kind: 'created', resultId: 99 });
    expect(h.creates[0]?.data).toMatchObject({ score: 0, maxScore: 200 });
    expect(h.attemptUpdates).toEqual([]);
  });

  it('writes the attempt score when the attempt has a maxScore', async () => {
    const h = await run({ attempt: attemptRow({ maxScore: 200 }) });

    expect(h.outcome).toEqual({ kind: 'created', resultId: 99 });
    expect(h.attemptUpdates).toEqual([
      { where: { id: 42 }, data: { score: 0 } },
    ]);
  });

  it('reads tags only for the question ids frozen in the snapshot (Q154)', async () => {
    const h = await run({});

    expect(h.tagQueries).toHaveLength(1);
    expect(h.tagQueries[0]).toMatchObject({
      where: { questionId: { in: [101, 102, 103] } },
    });
  });

  it('returns scoring_failed and writes nothing when the answer shape is unknown', async () => {
    const h = await run({
      answers: [{ snapshotQuestionKey: 'q1', answer: { choice: 123 } }],
    });

    expect(h.outcome.kind).toBe('scoring_failed');
    if (h.outcome.kind === 'scoring_failed') {
      expect(h.outcome.error).toBeInstanceOf(ExamScoringError);
    }
    expect(h.creates).toEqual([]);
    expect(h.attemptUpdates).toEqual([]);
  });

  it('throws when the frozen snapshot is missing and writes nothing', async () => {
    const { tx, tracking } = makeHarness({ missingSnapshot: true });

    await expect(
      ensureAttemptResult(tx as never, attemptRow(), NOW),
    ).rejects.toThrow(/snapshot is missing/i);

    expect(tracking.creates).toEqual([]);
    expect(tracking.attemptUpdates).toEqual([]);
  });

  it('refuses an attempt that is not terminal (programming error)', async () => {
    const { tx, tracking } = makeHarness({});

    await expect(
      ensureAttemptResult(
        tx as never,
        attemptRow({ status: ExamAttemptStatus.in_progress }),
        NOW,
      ),
    ).rejects.toThrow(/terminal/i);

    expect(tracking.called).toEqual([]);
    expect(tracking.creates).toEqual([]);
    expect(tracking.attemptUpdates).toEqual([]);
  });
});
