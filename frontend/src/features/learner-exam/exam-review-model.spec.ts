import { describe, expect, it } from 'vitest';

import type { ExamReviewQuestionParsed } from './exam-contract';
import {
  correctAnswerText,
  filterQuestions,
  firstWrongQuestion,
  groupReviewQuestions,
  learnerAnswerText,
  mcqOptions,
  optionLetter,
  parseReviewFilter,
  parseReviewQuestionOrder,
  questionStatus,
  REVIEW_FILTERS,
  reviewCellHref,
  reviewFilterHref,
  reviewQuestionHref,
  reviewRetryHref,
  reviewSummary,
  sectionTitle,
  selectReviewQuestion,
} from './exam-review-model';

function question(
  overrides: Partial<ExamReviewQuestionParsed> = {},
): ExamReviewQuestionParsed {
  return {
    key: 'q1',
    orderIndex: 1,
    type: 'mcq',
    skill: 'reading',
    sectionKey: 's1',
    groupKey: 's1-g1',
    content: 'Chọn đáp án đúng.',
    answers: {
      options: [
        { id: 'a', text: 'Đáp án đúng' },
        { id: 'b', text: 'Đáp án sai' },
      ],
    },
    learnerAnswer: { choice: 'a' },
    correctAnswer: { optionId: 'a' },
    explanation: 'Vì A đúng.',
    isCorrect: true,
    isFlagged: false,
    groupMedia: { audio: null, image: null },
    audio: null,
    image: null,
    ...overrides,
  };
}

describe('exam review model (M4.5 B2b)', () => {
  it('formats the four question types with the learner and correct answer', () => {
    expect(learnerAnswerText(question())).toBe('A. Đáp án đúng');
    expect(correctAnswerText(question())).toBe('A. Đáp án đúng');

    const trueFalse = question({
      type: 'true_false',
      answers: {},
      learnerAnswer: { value: false },
      correctAnswer: { value: true },
    });
    expect(learnerAnswerText(trueFalse)).toBe('Sai');
    expect(correctAnswerText(trueFalse)).toBe('Đúng');

    const fill = question({
      type: 'fill_blank',
      answers: {},
      learnerAnswer: { text: '你好' },
      correctAnswer: { acceptedTexts: ['你好', '您好'], caseSensitive: false },
    });
    expect(learnerAnswerText(fill)).toBe('你好');
    expect(correctAnswerText(fill)).toBe('你好 / 您好');

    const arrange = question({
      type: 'arrange_sentence',
      answers: {
        tokens: [
          { id: 't1', text: '我' },
          { id: 't2', text: '想' },
          { id: 't3', text: '买' },
        ],
      },
      learnerAnswer: { order: ['t1', 't2', 't3'] },
      correctAnswer: { tokenIds: ['t1', 't2', 't3'] },
    });
    expect(learnerAnswerText(arrange)).toBe('我想买');
    expect(correctAnswerText(arrange)).toBe('我想买');
  });

  it('marks options with the chosen and correct state and letters', () => {
    const options = mcqOptions(
      question({ learnerAnswer: { choice: 'b' }, isCorrect: false }),
    );
    expect(
      options.map((option) => [
        option.letter,
        option.isChosen,
        option.isCorrect,
      ]),
    ).toEqual([
      ['A', false, true],
      ['B', true, false],
    ]);
    expect(optionLetter(0)).toBe('A');
    expect(optionLetter(25)).toBe('Z');
    expect(optionLetter(26)).toBe('27');
  });

  it('derives correct / wrong / blank and counts them', () => {
    const correct = question();
    const wrong = question({
      key: 'q2',
      orderIndex: 2,
      learnerAnswer: { choice: 'b' },
      isCorrect: false,
      isFlagged: true,
    });
    const blank = question({
      key: 'q3',
      orderIndex: 3,
      learnerAnswer: null,
      isCorrect: false,
    });
    expect(questionStatus(correct)).toBe('correct');
    expect(questionStatus(wrong)).toBe('wrong');
    expect(questionStatus(blank)).toBe('blank');
    expect(reviewSummary([correct, wrong, blank])).toEqual({
      total: 3,
      answered: 2,
      blank: 1,
      flagged: 1,
      wrong: 1,
      correct: 1,
    });
    expect(firstWrongQuestion([correct, blank, wrong])?.key).toBe('q2');
    expect(firstWrongQuestion([correct])).toBeNull();
  });

  it('filters all / correct / wrong / flagged and parses the URL value (Q240)', () => {
    const correct = question();
    const wrong = question({
      key: 'q2',
      orderIndex: 2,
      isCorrect: false,
      learnerAnswer: { choice: 'b' },
      isFlagged: true,
    });
    const questions = [correct, wrong];
    expect(REVIEW_FILTERS).toEqual([
      { value: 'all', label: 'Tất cả' },
      { value: 'correct', label: 'Đúng' },
      { value: 'wrong', label: 'Sai' },
      { value: 'flagged', label: 'Đánh dấu' },
    ]);
    expect(filterQuestions(questions, 'all').map((item) => item.key)).toEqual([
      'q1',
      'q2',
    ]);
    expect(
      filterQuestions(questions, 'correct').map((item) => item.key),
    ).toEqual(['q1']);
    expect(filterQuestions(questions, 'wrong').map((item) => item.key)).toEqual(
      ['q2'],
    );
    expect(
      filterQuestions(questions, 'flagged').map((item) => item.key),
    ).toEqual(['q2']);
    expect(parseReviewFilter('correct')).toBe('correct');
    expect(parseReviewFilter('wrong')).toBe('wrong');
    expect(parseReviewFilter('flagged')).toBe('flagged');
    expect(parseReviewFilter('nonsense')).toBe('all');
    expect(parseReviewFilter(undefined)).toBe('all');
    expect(reviewFilterHref(41, 'correct')).toBe(
      '/learn/exam/attempts/41/review?filter=correct',
    );
  });

  it('groups by the frozen section/group keys in order', () => {
    const questions = [
      question(),
      question({ key: 'q2', orderIndex: 2, groupKey: 's1-g2' }),
      question({
        key: 'q3',
        orderIndex: 3,
        sectionKey: 's2',
        groupKey: 's2-g1',
        skill: 'listening',
      }),
    ];
    const sections = groupReviewQuestions(questions);
    expect(sections.map((section) => section.key)).toEqual(['s1', 's2']);
    expect(sections[0]?.title).toBe('Đọc · Phần 1');
    expect(sections[1]?.title).toBe('Nghe · Phần 2');
    expect(sections[0]?.groups.map((group) => group.label)).toEqual([
      'Nhóm 1',
      'Nhóm 2',
    ]);
    expect(sections[0]?.groups[0]?.questions.map((item) => item.key)).toEqual([
      'q1',
    ]);
    expect(sectionTitle('s3', 'writing', 1)).toBe('Viết · Phần 3');
  });

  it('selects the current, previous and next question from the filtered list and builds question/cell/retry hrefs (Q239)', () => {
    const q1 = question({ key: 'q1', orderIndex: 1, isCorrect: true });
    const q2 = question({
      key: 'q2',
      orderIndex: 2,
      isCorrect: false,
      learnerAnswer: { choice: 'b' },
      isFlagged: true,
    });
    const q3 = question({ key: 'q3', orderIndex: 3, isCorrect: true });
    const q5 = question({ key: 'q5', orderIndex: 5, isCorrect: true });
    const correctFiltered = filterQuestions([q1, q2, q3, q5], 'correct');

    expect(parseReviewQuestionOrder('5')).toBe(5);
    expect(parseReviewQuestionOrder(undefined)).toBeNull();
    expect(parseReviewQuestionOrder('')).toBeNull();
    expect(parseReviewQuestionOrder('0')).toBeNull();
    expect(parseReviewQuestionOrder('-1')).toBeNull();
    expect(parseReviewQuestionOrder('abc')).toBeNull();
    expect(parseReviewQuestionOrder('2.5')).toBeNull();

    // Empty list returns null
    expect(selectReviewQuestion([], 1)).toBeNull();
    expect(selectReviewQuestion([], null)).toBeNull();
    expect(selectReviewQuestion([])).toBeNull();

    // Missing or out-of-filter q falls back to the first filtered question (start of list: prev is null)
    for (const fallbackInput of [null, undefined, 0, -3, 2, 99]) {
      const selected = selectReviewQuestion(correctFiltered, fallbackInput);
      expect(selected?.current.key).toBe('q1');
      expect(selected?.prev).toBeNull();
      expect(selected?.next?.key).toBe('q3');
    }

    // Valid q in the middle of the filtered list
    const middle = selectReviewQuestion(correctFiltered, 3);
    expect(middle?.current.key).toBe('q3');
    expect(middle?.prev?.key).toBe('q1');
    expect(middle?.next?.key).toBe('q5');

    // End of the filtered list: next is null
    const last = selectReviewQuestion(correctFiltered, 5);
    expect(last?.current.key).toBe('q5');
    expect(last?.prev?.key).toBe('q3');
    expect(last?.next).toBeNull();

    // Single-question list: both prev and next are null
    const single = selectReviewQuestion([q2], 2);
    expect(single?.current.key).toBe('q2');
    expect(single?.prev).toBeNull();
    expect(single?.next).toBeNull();

    // Href builders preserve filter when filtering and include #q-<n> on grid cells
    expect(reviewQuestionHref(41, 'all', 5)).toBe(
      '/learn/exam/attempts/41/review?q=5',
    );
    expect(reviewQuestionHref(41, 'wrong', 2)).toBe(
      '/learn/exam/attempts/41/review?filter=wrong&q=2',
    );
    expect(reviewCellHref(41, 'all', 5)).toBe(
      '/learn/exam/attempts/41/review?q=5#q-5',
    );
    expect(reviewCellHref(41, 'wrong', 2)).toBe(
      '/learn/exam/attempts/41/review?filter=wrong&q=2#q-2',
    );
    expect(reviewRetryHref(41, 'all', null)).toBe(
      '/learn/exam/attempts/41/review',
    );
    expect(reviewRetryHref(41, 'wrong', null)).toBe(
      '/learn/exam/attempts/41/review?filter=wrong',
    );
    expect(reviewRetryHref(41, 'all', 3)).toBe(
      '/learn/exam/attempts/41/review?q=3',
    );
    expect(reviewRetryHref(41, 'flagged', 2)).toBe(
      '/learn/exam/attempts/41/review?filter=flagged&q=2',
    );
  });
});
