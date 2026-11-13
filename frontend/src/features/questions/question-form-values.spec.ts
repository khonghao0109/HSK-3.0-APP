import { describe, expect, it } from 'vitest';

import {
  QUESTION_TYPE_OPTIONS,
  emptyQuestionFormValue,
  fieldForServerPath,
  questionActorLabel,
  questionFormToPayload,
  questionPrefillFromRow,
  type QuestionFormValue,
} from './question-values';

function base(overrides: Partial<QuestionFormValue> = {}): QuestionFormValue {
  return {
    ...emptyQuestionFormValue(2),
    content: 'Chọn nghĩa đúng của 你好',
    explanation: 'Giải thích',
    tags: ['Gia đình'],
    ...overrides,
  };
}

describe('question form values (TL-91)', () => {
  it('builds the mcq payload with options and the authoritative option id', () => {
    const value = base();
    value.options = [
      { id: 'opt-1', text: 'Xin chào' },
      { id: 'opt-2', text: 'Tạm biệt' },
    ];
    value.correctOptionId = 'opt-2';
    value.difficulty = '2';
    const result = questionFormToPayload(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({
      type: 'mcq',
      skill: 'reading',
      levelId: 2,
      content: 'Chọn nghĩa đúng của 你好',
      answers: {
        options: [
          { id: 'opt-1', text: 'Xin chào' },
          { id: 'opt-2', text: 'Tạm biệt' },
        ],
      },
      correctAnswer: { optionId: 'opt-2' },
      explanation: 'Giải thích',
      objective: null,
      difficulty: 2,
      audioId: null,
      imageId: null,
      tags: ['Gia đình'],
    });
  });

  it('builds true_false, fill_blank and arrange_sentence payloads', () => {
    const trueFalse = questionFormToPayload(
      base({ type: 'true_false', trueFalse: 'false' }),
    );
    expect(trueFalse.ok && trueFalse.payload).toMatchObject({
      answers: {},
      correctAnswer: { value: false },
    });

    const fillBlank = questionFormToPayload(
      base({
        type: 'fill_blank',
        acceptedTexts: ['học', '  '],
        caseSensitive: true,
      }),
    );
    expect(fillBlank.ok && fillBlank.payload).toMatchObject({
      answers: {},
      correctAnswer: { acceptedTexts: ['học'], caseSensitive: true },
    });

    const arrange = questionFormToPayload(
      base({
        type: 'arrange_sentence',
        tokens: [
          { id: 'tok-1', text: '我' },
          { id: 'tok-2', text: '是' },
        ],
      }),
    );
    expect(arrange.ok && arrange.payload).toMatchObject({
      answers: {
        tokens: [
          { id: 'tok-1', text: '我' },
          { id: 'tok-2', text: '是' },
        ],
      },
      correctAnswer: { tokenIds: ['tok-1', 'tok-2'] },
    });
  });

  it('reports client errors in focus order without calling the backend', () => {
    const value = base({ levelId: '', content: '   ' });
    value.options = [
      { id: 'opt-1', text: 'A' },
      { id: 'opt-2', text: 'B' },
    ];
    value.correctOptionId = '';
    const result = questionFormToPayload(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.order.slice(0, 3)).toEqual([
      'levelId',
      'content',
      'correctOptionId',
    ]);
  });

  it('prefills the form from the materialized Question row', () => {
    const prefill = questionPrefillFromRow({
      type: 'arrange_sentence',
      skill: 'reading',
      levelId: 3,
      content: 'Sắp xếp câu',
      answers: {
        tokens: [
          { id: 'tok-1', text: '我' },
          { id: 'tok-2', text: '是' },
        ],
      },
      correctAnswer: { tokenIds: ['tok-2', 'tok-1'] },
      explanation: null,
      objective: 'Mục tiêu',
      difficulty: 2,
      audioId: 7,
      imageId: null,
      tags: [{ name: 'Gia đình' }],
    });
    expect(prefill).toMatchObject({
      type: 'arrange_sentence',
      levelId: 3,
      difficulty: '2',
      audioId: 7,
      imageId: '',
      tags: ['Gia đình'],
      content: 'Sắp xếp câu',
      objective: 'Mục tiêu',
    });
    // Thứ tự mảnh = thứ tự đáp án đúng.
    expect(prefill.tokens.map((token) => token.id)).toEqual(['tok-2', 'tok-1']);
  });

  it('maps backend validator paths to form fields', () => {
    expect(fieldForServerPath('content.options[1].text')).toBe('options');
    expect(fieldForServerPath('answers.options')).toBe('options');
    expect(fieldForServerPath('correctAnswer.optionId')).toBe(
      'correctOptionId',
    );
    expect(fieldForServerPath('correctAnswer.value')).toBe('trueFalse');
    expect(fieldForServerPath('answer.acceptedTexts[0]')).toBe('acceptedTexts');
    expect(fieldForServerPath('correctAnswer.tokenIds')).toBe('tokens');
    expect(fieldForServerPath('tags[0]')).toBe('tags');
    expect(fieldForServerPath('unknown.field')).toBeNull();
  });

  it('labels the revision author for the history block (TL-90)', () => {
    expect(questionActorLabel({ id: 5, name: 'Lan' }, 9)).toBe('Lan');
    expect(questionActorLabel({ id: 9, name: 'Lan' }, 9)).toBe('Bạn');
    expect(questionActorLabel({ id: 5, name: null }, 9)).toBe(
      'Quản trị viên #5',
    );
    expect(questionActorLabel(null, 9)).toBe('—');
  });

  it('exposes the four objective types only (Q112)', () => {
    expect(QUESTION_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      'mcq',
      'true_false',
      'fill_blank',
      'arrange_sentence',
    ]);
  });
});
