import { describe, expect, it } from 'vitest';

import {
  PRE_SUBMIT_REVIEW_HEADING,
  PRE_SUBMIT_REVIEW_LEGEND,
  PRE_SUBMIT_REVIEW_TIP,
  PRE_SUBMIT_REVIEW_TIP_LABEL,
  PRE_SUBMIT_REVIEW_TITLE,
  buildPreSubmitReview,
  reviewCellLabel,
  type PreSubmitReviewAnswerState,
  type PreSubmitReviewQuestion,
} from './exam-pre-submit-review-model';

type SectionSeed = {
  key: string;
  orderIndex: number;
  skill: 'listening' | 'reading' | 'writing' | 'speaking';
};

function questions(
  section: SectionSeed,
  keys: readonly string[],
  firstNumber: number,
): PreSubmitReviewQuestion[] {
  return keys.map((key, position) => ({
    number: firstNumber + position,
    question: { key },
    section,
  }));
}

function states(
  rows: ReadonlyArray<[string, { answer: object | null; isFlagged?: boolean }]>,
): Map<string, PreSubmitReviewAnswerState> {
  return new Map(
    rows.map(([key, row]) => [
      key,
      { answer: row.answer, isFlagged: row.isFlagged ?? false },
    ]),
  );
}

const READING: SectionSeed = { key: 's1', orderIndex: 1, skill: 'reading' };
const WRITING: SectionSeed = { key: 's2', orderIndex: 2, skill: 'writing' };

describe('pre-submit review model (M4.5 B2c / Q225)', () => {
  it('exposes the Q225 copy and the legend labels', () => {
    expect(PRE_SUBMIT_REVIEW_TITLE).toBe('Xem lại bài thi');
    expect(PRE_SUBMIT_REVIEW_HEADING).toBe('Chọn câu hỏi để xem lại');
    expect(PRE_SUBMIT_REVIEW_TIP_LABEL).toBe('Mẹo:');
    expect(PRE_SUBMIT_REVIEW_TIP).toBe('Nhấn số câu để quay lại câu đó.');
    expect(PRE_SUBMIT_REVIEW_LEGEND.map((item) => item.key)).toEqual([
      'answered',
      'unanswered',
      'flagged',
    ]);
    expect(PRE_SUBMIT_REVIEW_LEGEND.map((item) => item.label)).toEqual([
      'Đã trả lời',
      'Chưa trả lời',
      'Đánh dấu',
    ]);
  });

  it('counts answered, unanswered and flagged, including a flagged unanswered question', () => {
    const model = buildPreSubmitReview({
      flat: questions(READING, ['q1', 'q2', 'q3', 'q4'], 1),
      answers: states([
        ['q1', { answer: { choice: 'a' } }],
        ['q2', { answer: { choice: 'b' }, isFlagged: true }],
        ['q3', { answer: null, isFlagged: true }],
      ]),
      currentIndex: 0,
    });

    expect(model.summary).toEqual({
      answered: 2,
      unanswered: 2,
      flagged: 2,
      total: 4,
    });
  });

  it('groups cells by section in flat order with the part kicker as title', () => {
    const model = buildPreSubmitReview({
      flat: [
        ...questions(READING, ['q1', 'q2'], 1),
        ...questions(WRITING, ['q3'], 3),
      ],
      answers: states([]),
      currentIndex: 0,
    });

    expect(model.sections.map((section) => section.key)).toEqual(['s1', 's2']);
    expect(model.sections.map((section) => section.title)).toEqual([
      'Phần 1 · Đọc',
      'Phần 2 · Viết',
    ]);
    expect(model.sections[0]?.cells.map((cell) => cell.number)).toEqual([1, 2]);
    expect(model.sections[1]?.cells.map((cell) => cell.number)).toEqual([3]);
    expect(model.cells.map((cell) => cell.index)).toEqual([0, 1, 2]);
  });

  it('merges a section key that reappears instead of duplicating it', () => {
    const model = buildPreSubmitReview({
      flat: [
        ...questions(READING, ['q1'], 1),
        ...questions(WRITING, ['q2'], 2),
        ...questions(READING, ['q3'], 3),
      ],
      answers: states([]),
      currentIndex: 0,
    });

    expect(model.sections.map((section) => section.key)).toEqual(['s1', 's2']);
    expect(model.sections[0]?.cells.map((cell) => cell.number)).toEqual([1, 3]);
  });

  it('labels cells with all four aria-label combinations', () => {
    expect(reviewCellLabel(1, true, false)).toBe('Câu 1, đã trả lời');
    expect(reviewCellLabel(2, true, true)).toBe(
      'Câu 2, đã trả lời, đã đánh dấu',
    );
    expect(reviewCellLabel(3, false, false)).toBe('Câu 3, chưa trả lời');
    // Q225: ví dụ chốt của Tech Lead.
    expect(reviewCellLabel(12, false, true)).toBe(
      'Câu 12, chưa trả lời, đã đánh dấu',
    );

    const model = buildPreSubmitReview({
      flat: questions(READING, ['q1', 'q2'], 1),
      answers: states([
        ['q1', { answer: { choice: 'a' }, isFlagged: true }],
        ['q2', { answer: null }],
      ]),
      currentIndex: 1,
    });
    expect(model.cells.map((cell) => cell.label)).toEqual([
      'Câu 1, đã trả lời, đã đánh dấu',
      'Câu 2, chưa trả lời',
    ]);
  });

  it('marks exactly one current cell, and none when the index is out of range', () => {
    const build = (currentIndex: number) =>
      buildPreSubmitReview({
        flat: questions(READING, ['q1', 'q2'], 1),
        answers: states([]),
        currentIndex,
      });

    expect(build(1).cells.map((cell) => cell.current)).toEqual([false, true]);
    expect(build(2).cells.map((cell) => cell.current)).toEqual([false, false]);
    expect(build(-1).cells.map((cell) => cell.current)).toEqual([false, false]);
  });

  it('returns zero counts and no sections for an empty exam', () => {
    const model = buildPreSubmitReview({
      flat: [],
      answers: states([]),
      currentIndex: 0,
    });
    expect(model.summary).toEqual({
      answered: 0,
      unanswered: 0,
      flagged: 0,
      total: 0,
    });
    expect(model.sections).toEqual([]);
    expect(model.cells).toEqual([]);
  });

  it('never leaks answers, correct answers or explanations (Q225)', () => {
    const model = buildPreSubmitReview({
      flat: questions(READING, ['q1'], 1),
      answers: states([['q1', { answer: { choice: 'a' }, isFlagged: true }]]),
      currentIndex: 0,
    });

    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain('correct');
    expect(serialized).not.toContain('Đáp án đúng');
    expect(serialized).not.toContain('Giải thích');
    expect(serialized).not.toContain('choice');
    expect(serialized).not.toContain('"a"');
  });
});
