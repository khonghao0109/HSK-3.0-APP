import { ExamAttemptStatus, Skill } from '@prisma/client';

import {
  collectExamTestSkills,
  compareExamListByScore,
  deriveExamListStatus,
  EXAM_LEVEL_CODES,
  isExamListFinishedStatus,
} from './exam-list.model';

describe('exam list model (M4.5 B1 / Q209–Q214)', () => {
  it('accepts exactly the seven HSK 3.0 level codes', () => {
    expect(EXAM_LEVEL_CODES).toEqual([
      'HSK1',
      'HSK2',
      'HSK3',
      'HSK4',
      'HSK5',
      'HSK6',
      'HSK7_9',
    ]);
  });

  describe('collectExamTestSkills (Q210)', () => {
    it('dedupes skills and keeps TestSection.orderIndex order', () => {
      expect(
        collectExamTestSkills([
          { orderIndex: 3, skill: Skill.listening },
          { orderIndex: 1, skill: Skill.reading },
          { orderIndex: 2, skill: Skill.listening },
          { orderIndex: 4, skill: Skill.writing },
        ]),
      ).toEqual([Skill.reading, Skill.listening, Skill.writing]);
    });

    it('keeps a single skill once and returns an empty list for no sections', () => {
      expect(
        collectExamTestSkills([{ orderIndex: 1, skill: Skill.speaking }]),
      ).toEqual([Skill.speaking]);
      expect(collectExamTestSkills([])).toEqual([]);
    });
  });

  describe('deriveExamListStatus (Q212)', () => {
    it.each([
      [true, true, 'in_progress'],
      [true, false, 'in_progress'],
      [false, true, 'done'],
      [false, false, 'not_started'],
    ] as const)(
      'active=%s finished=%s maps to %s',
      (hasActive, hasFinished, expected) => {
        expect(deriveExamListStatus(hasActive, hasFinished)).toBe(expected);
      },
    );
  });

  describe('isExamListFinishedStatus (Q213)', () => {
    it('accepts only submitted and timed_out', () => {
      expect(isExamListFinishedStatus(ExamAttemptStatus.submitted)).toBe(true);
      expect(isExamListFinishedStatus(ExamAttemptStatus.timed_out)).toBe(true);
      expect(isExamListFinishedStatus(ExamAttemptStatus.in_progress)).toBe(
        false,
      );
      expect(isExamListFinishedStatus(ExamAttemptStatus.invalidated)).toBe(
        false,
      );
    });
  });

  describe('compareExamListByScore (Q211)', () => {
    const published = (iso: string) => new Date(iso);

    it('sorts by score descending', () => {
      const rows = [
        {
          score: 120,
          publishedAt: published('2026-10-01T00:00:00.000Z'),
          testId: 1,
        },
        {
          score: 268,
          publishedAt: published('2026-10-01T00:00:00.000Z'),
          testId: 2,
        },
        {
          score: 200,
          publishedAt: published('2026-10-01T00:00:00.000Z'),
          testId: 3,
        },
      ];
      expect(rows.sort(compareExamListByScore).map((row) => row.score)).toEqual(
        [268, 200, 120],
      );
    });

    it('puts a test without a score last, even below a zero score', () => {
      const rows = [
        {
          score: null,
          publishedAt: published('2026-11-01T00:00:00.000Z'),
          testId: 1,
        },
        {
          score: 0,
          publishedAt: published('2026-10-01T00:00:00.000Z'),
          testId: 2,
        },
      ];
      expect(
        rows.sort(compareExamListByScore).map((row) => row.testId),
      ).toEqual([2, 1]);
    });

    it('breaks ties by newest publishedAt then id descending', () => {
      const rows = [
        {
          score: 180,
          publishedAt: published('2026-10-01T00:00:00.000Z'),
          testId: 7,
        },
        {
          score: 180,
          publishedAt: published('2026-10-02T00:00:00.000Z'),
          testId: 3,
        },
        {
          score: 180,
          publishedAt: published('2026-10-02T00:00:00.000Z'),
          testId: 9,
        },
      ];
      expect(
        rows.sort(compareExamListByScore).map((row) => row.testId),
      ).toEqual([9, 3, 7]);
    });
  });
});
