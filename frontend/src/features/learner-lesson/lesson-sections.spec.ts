import { describe, expect, it } from 'vitest';

import {
  lessonRows,
  parseLessonId,
  type LessonSectionCounts,
} from './lesson-sections';

const sections = (
  w: number,
  vt: number,
  vd: number,
  gt: number,
  gd: number,
  pt: number,
  pa: number,
): LessonSectionCounts => ({
  vocabulary: { wordCount: w, topicCount: vt, topicsDone: vd },
  grammar: { topicCount: gt, topicsDone: gd },
  practice: { exerciseCount: pt, attempted: pa },
});

describe('lessonRows', () => {
  it('labels each row and counts grammar and practice (Q36)', () => {
    expect(lessonRows(sections(6, 1, 1, 2, 1, 3, 2), false)).toEqual([
      {
        kind: 'vocabulary',
        title: 'Từ vựng',
        meta: '6 từ mới',
        count: null,
        done: true,
        locked: false,
      },
      {
        kind: 'grammar',
        title: 'Ngữ pháp',
        meta: '2 điểm ngữ pháp',
        count: { label: '1/2', tail: 'đã học', percent: 50 },
        done: false,
        locked: false,
      },
      {
        kind: 'practice',
        title: 'Luyện tập',
        meta: '3 bài luyện tập',
        count: { label: '2/3', tail: 'đã làm', percent: (2 / 3) * 100 },
        done: false,
        locked: false,
      },
    ]);
  });

  it('hides rows whose total is 0 (Q35)', () => {
    expect(
      lessonRows(sections(3, 1, 0, 1, 0, 0, 0), false).map((row) => row.kind),
    ).toEqual(['vocabulary', 'grammar']);
    expect(lessonRows(sections(0, 0, 0, 0, 0, 0, 0), false)).toEqual([]);
  });

  it.each([
    [1, 0, false],
    [2, 1, false],
    [0, 0, false],
    [2, 2, true],
  ])(
    'marks Từ vựng done only when every vocabulary topic is (%i topics, %i done)',
    (topics, done, expected) => {
      const [row] = lessonRows(sections(4, topics, done, 0, 0, 0, 0), false);
      expect(row?.done).toBe(expected);
    },
  );

  it('locks every row and drops counts on a locked lesson (Q44)', () => {
    const rows = lessonRows(sections(3, 1, 1, 1, 0, 2, 1), true);
    expect(
      rows.map((row) => [row.kind, row.locked, row.done, row.count]),
    ).toEqual([
      ['vocabulary', true, false, null],
      ['grammar', true, false, null],
      ['practice', true, false, null],
    ]);
  });
});

describe('parseLessonId', () => {
  it.each([
    ['1', 1],
    ['42', 42],
    ['2147483647', 2147483647],
  ])('accepts %s', (raw, id) => {
    expect(parseLessonId(raw)).toBe(id);
  });

  it.each([
    'abc',
    '0',
    '-1',
    '01',
    '1.5',
    ' 1',
    '',
    '2147483648',
    '99999999999',
  ])('rejects %j', (raw) => {
    expect(parseLessonId(raw)).toBeNull();
  });
});
