import { describe, expect, it } from 'vitest';

import {
  examHistoryHref,
  examHistoryPassNote,
  parseExamHistoryQuery,
  toExamHistoryRow,
  type ExamHistoryItem,
} from './exam-history-model';

function item(overrides: Partial<ExamHistoryItem> = {}): ExamHistoryItem {
  return {
    attemptId: 9,
    testId: 3,
    testTitle: 'HSK 3 – Đề 04',
    levelCode: 'HSK3',
    status: 'submitted',
    finishedAt: '2026-05-18T18:00:00.000Z',
    score: 248,
    maxScore: 300,
    passScore: 180,
    passed: true,
    skills: [
      { skill: 'listening', score: 86, maxScore: 100 },
      { skill: 'reading', score: 84, maxScore: 100 },
    ],
    ...overrides,
  };
}

describe('toExamHistoryRow', () => {
  it('maps a graded attempt in the app time zone and links to its result', () => {
    expect(toExamHistoryRow(item())).toMatchObject({
      href: '/learn/exam/attempts/9/result',
      title: 'HSK 3 – Đề 04',
      date: '19/05/2026',
      score: '248',
      maxScore: '300',
      listening: '86',
      reading: '84',
      writing: '—',
    });
  });

  const statusCases: Array<[Partial<ExamHistoryItem>, string, string]> = [
    [{ passed: true }, 'Đạt', 'success'],
    [{ passed: false }, 'Chưa đạt', 'danger'],
    [{ passed: null }, '—', 'neutral'],
    [
      { passed: null, score: null, maxScore: null, skills: [] },
      'Đang chấm',
      'pending',
    ],
  ];

  it.each(statusCases)('%j reads %s', (overrides, label, tone) => {
    const row = toExamHistoryRow(item(overrides));
    expect(row.statusLabel).toBe(label);
    expect(row.statusTone).toBe(tone);
  });

  it('shows dashes and no denominator without scores', () => {
    expect(
      toExamHistoryRow(
        item({ score: null, maxScore: null, passed: null, skills: [] }),
      ),
    ).toMatchObject({
      score: '—',
      maxScore: null,
      listening: '—',
      reading: '—',
      writing: '—',
    });
  });

  it('keeps a score whose maximum is unknown without a denominator', () => {
    expect(toExamHistoryRow(item({ maxScore: null }))).toMatchObject({
      score: '248',
      maxScore: null,
    });
  });
});

describe('examHistoryPassNote', () => {
  it('states the threshold when every attempt shares it', () => {
    expect(examHistoryPassNote([item(), item({ attemptId: 8 })], 2)).toBe(
      'Điểm đạt HSK 3 là từ 180/300.',
    );
  });

  it.each([
    ['another threshold', [item(), item({ passScore: 120 })], 2],
    ['another level', [item(), item({ levelCode: 'HSK4' })], 2],
    ['another maximum', [item(), item({ maxScore: 200 })], 2],
    ['no threshold', [item({ passScore: null })], 1],
    ['no graded attempt', [item({ score: null, maxScore: null })], 1],
    ['attempts on other pages', [item()], 21],
    ['nothing', [], 0],
  ] as const)('stays silent with %s', (_name, items, total) => {
    expect(examHistoryPassNote(items, total)).toBeNull();
  });
});

describe('query', () => {
  it('reads a level and page, dropping malformed values', () => {
    expect(parseExamHistoryQuery({ levelCode: 'HSK4', page: '3' })).toEqual({
      levelCode: 'HSK4',
      page: 3,
    });
    expect(parseExamHistoryQuery({ levelCode: 'x', page: '0' })).toEqual({
      levelCode: null,
      page: 1,
    });
  });

  it('builds links that omit defaults', () => {
    expect(examHistoryHref({ levelCode: null, page: 1 })).toBe(
      '/learn/exam/history',
    );
    expect(examHistoryHref({ levelCode: 'HSK4', page: 2 })).toBe(
      '/learn/exam/history?levelCode=HSK4&page=2',
    );
  });
});
