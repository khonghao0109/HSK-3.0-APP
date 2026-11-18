import { ExamAttemptStatus, Skill } from '@prisma/client';

import {
  examHistoryWhere,
  readExamHistorySnapshot,
  toExamHistoryItem,
  type ExamHistoryAttemptRow,
} from './exam-history.model';

const now = new Date('2026-11-09T10:00:00.000Z');
const expiresAt = new Date('2026-11-09T09:00:00.000Z');
const snapshot = {
  title: 'Đề đóng băng',
  levelCode: 'HSK3',
  passScore: 180,
  maxScore: 300,
};

function row(
  overrides: Partial<ExamHistoryAttemptRow> = {},
): ExamHistoryAttemptRow {
  return {
    id: 7,
    testId: 3,
    status: ExamAttemptStatus.submitted,
    submittedAt: new Date('2026-11-09T08:30:00.000Z'),
    expiresAt,
    result: null,
    ...overrides,
  };
}

describe('examHistoryWhere', () => {
  it('counts an in-progress attempt as over only from expiresAt + grace, inclusive', () => {
    const where = examHistoryWhere(11, now, 5);

    expect(where).toEqual({
      userId: 11,
      OR: [
        {
          status: {
            in: [ExamAttemptStatus.submitted, ExamAttemptStatus.timed_out],
          },
        },
        {
          status: ExamAttemptStatus.in_progress,
          expiresAt: { lte: new Date('2026-11-09T09:59:55.000Z') },
        },
      ],
    });
  });

  it('filters on the level frozen in the snapshot', () => {
    expect(examHistoryWhere(11, now, 5, 'HSK4').snapshot).toEqual({
      payload: { path: ['test', 'levelCode'], equals: 'HSK4' },
    });
  });
});

describe('toExamHistoryItem', () => {
  it('reports an expired in-progress attempt as timed out, finished at its deadline', () => {
    const item = toExamHistoryItem(
      row({ status: ExamAttemptStatus.in_progress, submittedAt: null }),
      snapshot,
    );

    expect(item.status).toBe('timed_out');
    expect(item.finishedAt).toEqual(expiresAt);
  });

  it('uses submittedAt as the finish time when the attempt has one', () => {
    expect(toExamHistoryItem(row(), snapshot).finishedAt).toEqual(
      new Date('2026-11-09T08:30:00.000Z'),
    );
  });

  it('leaves every score empty until a Result exists', () => {
    expect(toExamHistoryItem(row(), snapshot)).toMatchObject({
      score: null,
      maxScore: null,
      passed: null,
      skills: [],
      passScore: 180,
      testTitle: 'Đề đóng băng',
      levelCode: 'HSK3',
    });
  });

  it('maps a stored Result and keeps passed: null', () => {
    const item = toExamHistoryItem(
      row({
        result: {
          score: 120,
          maxScore: 200,
          passed: null,
          skillScores: [{ skill: Skill.listening, score: 60, total: 100 }],
        },
      }),
      snapshot,
    );

    expect(item).toMatchObject({
      score: 120,
      maxScore: 200,
      passed: null,
      skills: [{ skill: Skill.listening, score: 60, maxScore: 100 }],
    });
  });

  it('falls back to the snapshot maxScore like the result page', () => {
    const item = toExamHistoryItem(
      row({
        result: { score: 120, maxScore: null, passed: true, skillScores: [] },
      }),
      snapshot,
    );

    expect(item.maxScore).toBe(300);
  });
});

describe('readExamHistorySnapshot', () => {
  it('fails closed when the frozen fields are missing', () => {
    expect(() => readExamHistorySnapshot(undefined)).toThrow(
      'Exam attempt snapshot is missing.',
    );
    const valid = {
      attemptId: 1,
      title: 'Đề',
      levelCode: 'HSK3',
      passScore: null,
      maxScore: 300,
    };
    expect(readExamHistorySnapshot(valid).passScore).toBeNull();
    for (const broken of [
      { title: null },
      { levelCode: 3 },
      { maxScore: null },
      { passScore: 'high' },
    ]) {
      expect(() => readExamHistorySnapshot({ ...valid, ...broken })).toThrow(
        'Exam snapshot payload is invalid.',
      );
    }
  });
});
