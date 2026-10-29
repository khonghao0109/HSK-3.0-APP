import { describe, expect, it } from 'vitest';

import {
  buildExamAnswer,
  buildFillBlankAnswer,
  flattenQuestions,
  isArrangementComplete,
  isSupportedType,
  questionIndexFor,
  questionKicker,
  questionPrompt,
  tokenCount,
  type ExamAnswerRow,
  type ExamAttemptView,
  type ExamQuestion,
} from './exam-take-model';

function question(overrides: Partial<ExamQuestion>): ExamQuestion {
  return {
    key: 'q1',
    orderIndex: 1,
    type: 'mcq',
    skill: 'reading',
    content: 'Câu hỏi',
    answers: {
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
    },
    audio: null,
    image: null,
    ...overrides,
  } as ExamQuestion;
}

function attempt(): ExamAttemptView {
  const value: ExamAttemptView = {
    id: 41,
    testId: 7,
    status: 'in_progress',
    startedAt: '2026-10-27T09:00:00.000Z',
    expiresAt: '2026-10-27T10:30:00.000Z',
    serverNow: '2026-10-27T09:00:00.000Z',
    remainingSeconds: 5_400,
    maxScore: 200,
    questionCount: 3,
    test: {
      title: 'Đề thi',
      instruction: null,
      levelCode: 'HSK4',
      durationMinutes: 90,
      passScore: 120,
    },
    sections: [
      {
        key: 's1',
        orderIndex: 1,
        title: 'Đọc hiểu',
        instruction: null,
        skill: 'reading',
        groups: [
          {
            key: 's1-g1',
            orderIndex: 1,
            title: null,
            instruction: 'Chọn đáp án đúng.',
            content: null,
            audio: null,
            image: null,
            questions: [question({ key: 'q1' }), question({ key: 'q2' })],
          },
          {
            key: 's1-g2',
            orderIndex: 2,
            title: null,
            instruction: null,
            content: null,
            audio: null,
            image: null,
            questions: [
              question({ key: 'q3', type: 'fill_blank', answers: {} }),
            ],
          },
        ],
      },
      {
        key: 's2',
        orderIndex: 2,
        title: 'Nghe',
        instruction: null,
        skill: 'listening',
        groups: [
          {
            key: 's2-g1',
            orderIndex: 1,
            title: null,
            instruction: null,
            content: null,
            audio: null,
            image: null,
            questions: [question({ key: 'q4', skill: 'listening' })],
          },
        ],
      },
    ],
    answers: [],
  };
  return value;
}

describe('exam take model (TL-141)', () => {
  it('flattens questions by section → group → orderIndex with 1-based numbering', () => {
    const flat = flattenQuestions(attempt());
    expect(flat.map((entry) => entry.question.key)).toEqual([
      'q1',
      'q2',
      'q3',
      'q4',
    ]);
    expect(flat.map((entry) => entry.number)).toEqual([1, 2, 3, 4]);
    expect(questionKicker(flat[0] as never)).toBe('Phần 1 · Đọc');
    expect(questionKicker(flat[3] as never)).toBe('Phần 2 · Nghe');
  });

  it('uses the instruction, then the documented copy per type', () => {
    const flat = flattenQuestions(attempt());
    expect(questionPrompt(flat[0] as never)).toBe('Chọn đáp án đúng.');
    expect(questionPrompt(flat[2] as never)).toBe('Điền vào chỗ trống.');
    expect(
      questionPrompt({
        ...flat[3],
        group: { ...flat[3]?.group, instruction: null },
      } as never),
    ).toBe('Nghe và chọn đáp án đúng.');
    expect(
      questionPrompt({
        ...flat[0],
        group: { ...flat[0]?.group, instruction: null },
        section: { ...flat[0]?.section, instruction: null },
      } as never),
    ).toBe('Chọn đáp án đúng.');
  });

  it('starts at the first unanswered question, or q1 when everything is done', () => {
    const flat = flattenQuestions(attempt());
    const row = (questionKey: string): ExamAnswerRow => ({
      questionKey,
      answer: { choice: 'a' },
      isFlagged: false,
      version: 1,
      answeredAt: '2026-10-27T09:00:00.000Z',
      lastSavedAt: '2026-10-27T09:00:00.000Z',
    });
    expect(questionIndexFor(flat, [row('q1')])).toBe(1);
    expect(
      questionIndexFor(
        flat,
        ['q1', 'q2', 'q3', 'q4'].map((key) => row(key)),
      ),
    ).toBe(0);
  });

  it('builds the four answer shapes and clears incomplete answers', () => {
    const mcq = question({ type: 'mcq' });
    expect(buildExamAnswer(mcq, { choice: 'a' })).toEqual({
      answer: { choice: 'a' },
    });
    expect(buildExamAnswer(mcq, {})).toEqual({ answer: null });

    const trueFalse = question({ type: 'true_false', answers: {} });
    expect(buildExamAnswer(trueFalse, { value: false })).toEqual({
      answer: { value: false },
    });
    expect(buildExamAnswer(trueFalse, {})).toEqual({ answer: null });

    const fill = question({ type: 'fill_blank', answers: {} });
    expect(buildFillBlankAnswer('  你好  ')).toEqual({
      action: 'send',
      answer: { text: '你好' },
    });
    expect(buildFillBlankAnswer('   ')).toEqual({ action: 'clear' });
    expect(buildFillBlankAnswer('好'.repeat(201))).toMatchObject({
      action: 'error',
      message: 'Câu trả lời tối đa 200 ký tự.',
    });
    expect(buildExamAnswer(fill, { text: '  x  ' })).toEqual({
      answer: { text: 'x' },
    });

    const arrange = question({
      type: 'arrange_sentence',
      answers: {
        tokens: [
          { id: 't1', text: '一' },
          { id: 't2', text: '二' },
        ],
      },
    });
    expect(tokenCount(arrange)).toBe(2);
    expect(buildExamAnswer(arrange, { order: ['t1'] })).toEqual({
      answer: null,
    });
    expect(buildExamAnswer(arrange, { order: ['t2', 't1'] })).toEqual({
      answer: { order: ['t2', 't1'] },
    });
    expect(isArrangementComplete(arrange, { order: ['t2', 't1'] })).toBe(true);
  });

  it('marks only the four objective types as supported', () => {
    expect(isSupportedType('mcq')).toBe(true);
    expect(isSupportedType('true_false')).toBe(true);
    expect(isSupportedType('fill_blank')).toBe(true);
    expect(isSupportedType('arrange_sentence')).toBe(true);
    expect(isSupportedType('writing')).toBe(false);
    expect(isSupportedType('speaking')).toBe(false);
  });
});
