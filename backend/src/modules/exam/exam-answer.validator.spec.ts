import { QuestionType, type Prisma } from '@prisma/client';

import { validateExamAnswerShape } from './exam-answer.validator';

/** TL-122: learner answer shapes are validated against the frozen snapshot. */

function mcq(): { type: QuestionType; answers: Prisma.JsonValue } {
  return {
    type: QuestionType.mcq,
    answers: {
      options: [
        { id: 'a', text: 'Đáp án đúng' },
        { id: 'b', text: 'Đáp án sai' },
      ],
    },
  };
}

function arrange(): { type: QuestionType; answers: Prisma.JsonValue } {
  return {
    type: QuestionType.arrange_sentence,
    answers: {
      tokens: [
        { id: 't2', text: '二' },
        { id: 't1', text: '一' },
        { id: 't3', text: '三' },
      ],
    },
  };
}

describe('validateExamAnswerShape', () => {
  it('accepts an mcq choice that exists in the snapshot options', () => {
    expect(validateExamAnswerShape(mcq(), { choice: 'a' })).toEqual({
      ok: true,
      value: { choice: 'a' },
    });
  });

  it('rejects an mcq answer with a wrong shape or an unknown option id', () => {
    for (const answer of [
      'a',
      null,
      [],
      {},
      { choice: 'z' },
      { choice: 'a', extra: true },
      { optionId: 'a' },
    ]) {
      const result = validateExamAnswerShape(mcq(), answer);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.field).toBe('answer.choice');
    }
  });

  it('accepts a boolean true_false answer only', () => {
    const question = { type: QuestionType.true_false, answers: {} };
    expect(validateExamAnswerShape(question, { value: false })).toEqual({
      ok: true,
      value: { value: false },
    });
    for (const answer of [{ value: 'true' }, { value: 1 }, {}, true]) {
      const result = validateExamAnswerShape(question, answer);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.field).toBe('answer.value');
    }
  });

  it('normalises and trims a fill_blank answer and enforces 1..200 code points', () => {
    const question = { type: QuestionType.fill_blank, answers: {} };
    // U+0065 U+0301 (decomposed) must be stored as NFC U+00E9.
    expect(validateExamAnswerShape(question, { text: '  e\u0301  ' })).toEqual({
      ok: true,
      value: { text: '\u00e9' },
    });

    for (const answer of [{ text: '   ' }, { text: '' }, { text: 42 }, {}]) {
      const result = validateExamAnswerShape(question, answer);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.field).toBe('answer.text');
    }

    expect(
      validateExamAnswerShape(question, { text: '好'.repeat(200) }).ok,
    ).toBe(true);
    expect(
      validateExamAnswerShape(question, { text: '好'.repeat(201) }).ok,
    ).toBe(false);
    // Code points, not UTF-16 units: an emoji counts once.
    expect(
      validateExamAnswerShape(question, { text: '😀'.repeat(200) }).ok,
    ).toBe(true);
  });

  it('requires a full permutation of the snapshot tokens for arrange_sentence', () => {
    expect(
      validateExamAnswerShape(arrange(), { order: ['t1', 't2', 't3'] }),
    ).toEqual({ ok: true, value: { order: ['t1', 't2', 't3'] } });

    for (const answer of [
      { order: ['t1', 't2'] },
      { order: ['t1', 't2', 't3', 't4'] },
      { order: ['t1', 't1', 't2'] },
      { order: ['t1', 't2', 't9'] },
      { order: [] },
      { order: 't1,t2,t3' },
      {},
    ]) {
      const result = validateExamAnswerShape(arrange(), answer);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.field).toBe('answer.order');
    }
  });

  it('rejects a question type that is not one of the four objective types', () => {
    const result = validateExamAnswerShape(
      { type: QuestionType.writing, answers: {} },
      { text: 'abc' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('answer');
  });
});
