import { describe, expect, it } from 'vitest';

import {
  emptyExerciseFormValue,
  exerciseFormToPayload,
  exercisePrefillFromSnapshot,
  type ExerciseFormValue,
  type ExercisePayload,
} from './exercise-form-values';

function contentTokens(payload: ExercisePayload) {
  return payload.content.tokens as { id: string; text: string }[];
}

function formValue(
  overrides: Partial<ExerciseFormValue> = {},
): ExerciseFormValue {
  return {
    ...emptyExerciseFormValue(),
    prompt: '  Đề bài  ',
    orderIndex: '3',
    ...overrides,
  };
}

const mcqSnapshot = {
  type: 'mcq',
  prompt: 'Chọn lời chào đúng',
  content: {
    options: [
      { id: 'opt-1', text: '你好' },
      { id: 'opt-2', text: '再见' },
    ],
  },
  answer: { optionId: 'opt-1' },
  explanation: '你好 là lời chào.',
  mediaId: null,
  orderIndex: 3,
};

describe('exerciseFormToPayload (TL-19)', () => {
  it('maps mcq: options + optionId, explanation rỗng → null, mediaId null', () => {
    expect(
      exerciseFormToPayload(
        formValue({
          type: 'mcq',
          options: [
            { id: 'opt-1', text: ' 你好 ' },
            { id: 'opt-2', text: ' 再见 ' },
          ],
          correctOptionId: 'opt-2',
          explanation: '   ',
        }),
      ),
    ).toEqual({
      type: 'mcq',
      prompt: 'Đề bài',
      content: {
        options: [
          { id: 'opt-1', text: '你好' },
          { id: 'opt-2', text: '再见' },
        ],
      },
      answer: { optionId: 'opt-2' },
      explanation: null,
      orderIndex: 3,
      mediaId: null,
    });
  });

  it('maps listening_choice: giữ mediaId, bỏ mediaId của loại khác', () => {
    expect(
      exerciseFormToPayload(
        formValue({
          type: 'listening_choice',
          options: [
            { id: 'opt-1', text: 'A' },
            { id: 'opt-2', text: 'B' },
          ],
          correctOptionId: 'opt-1',
          mediaId: 12,
        }),
      ),
    ).toMatchObject({ mediaId: 12, answer: { optionId: 'opt-1' } });

    expect(
      exerciseFormToPayload(
        formValue({
          type: 'mcq',
          options: [
            { id: 'opt-1', text: 'A' },
            { id: 'opt-2', text: 'B' },
          ],
          correctOptionId: 'opt-1',
          mediaId: 12,
        }),
      ).mediaId,
    ).toBeNull();
  });

  it('maps fill_blank: content {}, acceptedTexts trim, caseSensitive chỉ khi true', () => {
    const base = {
      type: 'fill_blank' as const,
      acceptedTexts: [' 预订 ', '预定 '],
      explanation: ' Giải thích ',
    };
    expect(exerciseFormToPayload(formValue(base))).toEqual({
      type: 'fill_blank',
      prompt: 'Đề bài',
      content: {},
      answer: { acceptedTexts: ['预订', '预定'] },
      explanation: 'Giải thích',
      orderIndex: 3,
      mediaId: null,
    });
    expect(
      exerciseFormToPayload(formValue({ ...base, caseSensitive: true })).answer,
    ).toEqual({ acceptedTexts: ['预订', '预定'], caseSensitive: true });
  });

  it('maps arrange_sentence: tokens trim, tokenIds đúng thứ tự đáp án (X1)', () => {
    const payload = exerciseFormToPayload(
      formValue({
        type: 'arrange_sentence',
        tokens: [
          { id: 'tok-1', text: ' 我 ' },
          { id: 'tok-2', text: ' 想 ' },
          { id: 'tok-3', text: ' 去 ' },
        ],
        tokenOrder: ['tok-2', 'tok-3', 'tok-1'],
        tokenDisplayOrder: [],
      }),
      { randomInt: () => 0 },
    );
    expect(payload.answer).toEqual({ tokenIds: ['tok-2', 'tok-3', 'tok-1'] });
    expect(payload.content).toEqual({
      tokens: [
        { id: 'tok-3', text: '去' },
        { id: 'tok-1', text: '我' },
        { id: 'tok-2', text: '想' },
      ],
    });
    expect(contentTokens(payload).map((token) => token.id)).not.toEqual([
      'tok-2',
      'tok-3',
      'tok-1',
    ]);
  });

  it('maps speaking_repeat: content {} khi câu mẫu rỗng, answer {}', () => {
    expect(
      exerciseFormToPayload(
        formValue({ type: 'speaking_repeat', referenceText: '   ' }),
      ),
    ).toMatchObject({ content: {}, answer: {}, mediaId: null });
    expect(
      exerciseFormToPayload(
        formValue({
          type: 'speaking_repeat',
          referenceText: ' 我想预订一个房间。 ',
        }),
      ).content,
    ).toEqual({ referenceText: '我想预订一个房间。' });
  });
});

describe('arrange_sentence — thứ tự hiển thị khác thứ tự đáp án (X1, TL-24)', () => {
  const tokens = [
    { id: 'tok-1', text: '我' },
    { id: 'tok-2', text: '想' },
    { id: 'tok-3', text: '去' },
  ];
  const answerIds = ['tok-1', 'tok-2', 'tok-3'];
  const base = formValue({
    type: 'arrange_sentence',
    tokens,
    tokenOrder: answerIds,
    tokenDisplayOrder: [],
  });

  it('tạo mới: xáo tới khi content order khác answer order, cùng tập id', () => {
    const payload = exerciseFormToPayload(base, { randomInt: () => 1 });
    const contentIds = contentTokens(payload).map((token) => token.id);
    expect(payload.answer).toEqual({ tokenIds: answerIds });
    expect(contentIds).not.toEqual(answerIds);
    expect([...contentIds].sort()).toEqual([...answerIds].sort());
    expect(contentTokens(payload)).toHaveLength(3);
  });

  it('nguồn ngẫu nhiên suy biến vẫn cho thứ tự hiển thị khác đáp án', () => {
    const payload = exerciseFormToPayload(base, { randomInt: () => 0 });
    const contentIds = contentTokens(payload).map((token) => token.id);
    expect(contentIds).not.toEqual(answerIds);
    expect([...contentIds].sort()).toEqual([...answerIds].sort());
  });

  it('sửa chỉ đề bài: content.tokens giữ nguyên byte thứ tự hiển thị đã lưu', () => {
    const previous = ['tok-3', 'tok-1', 'tok-2'];
    const payload = exerciseFormToPayload(
      formValue({
        ...base,
        prompt: 'Đề bài mới',
        tokenDisplayOrder: previous,
      }),
      { previousDisplayTokenIds: previous, randomInt: () => 0 },
    );
    expect(contentTokens(payload).map((token) => token.id)).toEqual(previous);
    expect(JSON.stringify(payload.content)).toBe(
      JSON.stringify({
        tokens: [
          { id: 'tok-3', text: '去' },
          { id: 'tok-1', text: '我' },
          { id: 'tok-2', text: '想' },
        ],
      }),
    );
    expect(payload.answer).toEqual({ tokenIds: answerIds });
  });

  it('thêm mảnh: mảnh mới nối cuối, mảnh xoá bỏ khỏi cả hai', () => {
    const previous = ['tok-3', 'tok-1', 'tok-2'];
    const withNew = formValue({
      ...base,
      tokens: [...tokens, { id: 'tok-4', text: '你' }],
      tokenOrder: [...answerIds, 'tok-4'],
      tokenDisplayOrder: previous,
    });
    const added = exerciseFormToPayload(withNew, {
      previousDisplayTokenIds: previous,
      randomInt: () => 0,
    });
    expect(contentTokens(added).map((token) => token.id)).toEqual([
      'tok-3',
      'tok-1',
      'tok-2',
      'tok-4',
    ]);

    const removed = formValue({
      ...base,
      tokens: [tokens[0]!, tokens[2]!],
      tokenOrder: ['tok-1', 'tok-3'],
      tokenDisplayOrder: previous,
    });
    const deleted = exerciseFormToPayload(removed, {
      previousDisplayTokenIds: previous,
      randomInt: () => 0,
    });
    expect(contentTokens(deleted).map((token) => token.id)).toEqual([
      'tok-3',
      'tok-1',
    ]);
    expect(deleted.answer).toEqual({ tokenIds: ['tok-1', 'tok-3'] });
  });

  it('thứ tự hiển thị cũ trùng thứ tự đáp án (dữ liệu cũ) → xáo lại', () => {
    const payload = exerciseFormToPayload(
      formValue({
        ...base,
        tokenDisplayOrder: answerIds,
      }),
      { previousDisplayTokenIds: answerIds, randomInt: () => 1 },
    );
    expect(contentTokens(payload).map((token) => token.id)).not.toEqual(
      answerIds,
    );
  });

  it('Y4: so theo chữ đã trim → trùng chữ nhưng khác id vẫn xáo để chuỗi chữ khác đáp án', () => {
    // Đáp án tok-1/tok-2/tok-3 = 好/好/吗 → chuỗi chữ "好好吗".
    // Nguồn ngẫu nhiên cho ra [tok-2, tok-1, tok-3]: id khác đáp án nhưng
    // chuỗi chữ vẫn "好好吗", nên phải xáo lại tới khi chuỗi chữ khác.
    const duplicateTextTokens = [
      { id: 'tok-1', text: ' 好 ' },
      { id: 'tok-2', text: '好' },
      { id: 'tok-3', text: '吗' },
    ];
    const payload = exerciseFormToPayload(
      formValue({
        type: 'arrange_sentence',
        tokens: duplicateTextTokens,
        tokenOrder: ['tok-1', 'tok-2', 'tok-3'],
        tokenDisplayOrder: [],
      }),
      {
        randomInt: (maxExclusive) => (maxExclusive === 3 ? 2 : 0),
      },
    );
    const display = contentTokens(payload);
    expect([...display.map((token) => token.id)].sort()).toEqual([
      'tok-1',
      'tok-2',
      'tok-3',
    ]);
    expect(display.map((token) => token.text).join('')).not.toBe('好好吗');
    expect(payload.answer).toEqual({
      tokenIds: ['tok-1', 'tok-2', 'tok-3'],
    });
  });
});

describe('exercisePrefillFromSnapshot (TL-15)', () => {
  it('đọc snapshot mcq hợp lệ, explanation null → chuỗi rỗng', () => {
    expect(
      exercisePrefillFromSnapshot({ ...mcqSnapshot, explanation: null }, null),
    ).toEqual({
      type: 'mcq',
      prompt: 'Chọn lời chào đúng',
      explanation: '',
      orderIndex: '3',
      options: [
        { id: 'opt-1', text: '你好' },
        { id: 'opt-2', text: '再见' },
      ],
      correctOptionId: 'opt-1',
      acceptedTexts: [],
      caseSensitive: false,
      tokens: [],
      tokenOrder: [],
      tokenDisplayOrder: [],
      referenceText: '',
      mediaId: null,
    });
  });

  it('đọc snapshot listening_choice kèm mediaId', () => {
    expect(
      exercisePrefillFromSnapshot(
        { ...mcqSnapshot, type: 'listening_choice', mediaId: 8 },
        null,
      ),
    ).toMatchObject({
      type: 'listening_choice',
      mediaId: 8,
      correctOptionId: 'opt-1',
    });
  });

  it('đọc snapshot fill_blank kèm caseSensitive', () => {
    expect(
      exercisePrefillFromSnapshot(
        {
          type: 'fill_blank',
          prompt: 'Điền từ',
          content: {},
          answer: {
            acceptedTexts: ['预订', '预定'],
            caseSensitive: true,
          },
          explanation: null,
          mediaId: null,
          orderIndex: 4,
        },
        null,
      ),
    ).toMatchObject({
      type: 'fill_blank',
      acceptedTexts: ['预订', '预定'],
      caseSensitive: true,
      orderIndex: '4',
    });
  });

  it('đọc snapshot arrange_sentence theo answer.tokenIds (thứ tự đúng)', () => {
    expect(
      exercisePrefillFromSnapshot(
        {
          type: 'arrange_sentence',
          prompt: 'Sắp xếp câu',
          content: {
            tokens: [
              { id: 'tok-1', text: '我' },
              { id: 'tok-2', text: '想' },
              { id: 'tok-3', text: '去' },
            ],
          },
          answer: { tokenIds: ['tok-3', 'tok-1', 'tok-2'] },
          explanation: null,
          mediaId: null,
          orderIndex: 5,
        },
        null,
      ),
    ).toMatchObject({
      type: 'arrange_sentence',
      tokens: [
        { id: 'tok-3', text: '去' },
        { id: 'tok-1', text: '我' },
        { id: 'tok-2', text: '想' },
      ],
      tokenOrder: ['tok-3', 'tok-1', 'tok-2'],
      // X1: content.tokens giữ thứ tự hiển thị đã lưu của bản sửa.
      tokenDisplayOrder: ['tok-1', 'tok-2', 'tok-3'],
    });
  });

  it('đọc snapshot speaking_repeat với câu mẫu', () => {
    expect(
      exercisePrefillFromSnapshot(
        {
          type: 'speaking_repeat',
          prompt: 'Nói lại',
          content: { referenceText: '你好。' },
          answer: {},
          explanation: null,
          mediaId: null,
          orderIndex: 6,
        },
        null,
      ),
    ).toMatchObject({ type: 'speaking_repeat', referenceText: '你好。' });
  });

  it('snapshot hỏng → fallback live hợp lệ', () => {
    const live = {
      type: 'fill_blank',
      prompt: 'Live',
      content: {},
      answer: { acceptedTexts: ['đáp án'] },
      explanation: 'live',
      mediaId: null,
      orderIndex: 2,
    };
    expect(
      exercisePrefillFromSnapshot('không phải object', live),
    ).toMatchObject({
      type: 'fill_blank',
      prompt: 'Live',
      acceptedTexts: ['đáp án'],
      explanation: 'live',
      orderIndex: '2',
    });
  });

  it('snapshot sai shape/loại lạ/orderIndex ngoài miền → fallback live', () => {
    const live = mcqSnapshot;
    const broken = [
      null,
      'abc',
      { ...mcqSnapshot, type: 'future_type' },
      { ...mcqSnapshot, content: { options: [{ id: 'opt-1', text: '你好' }] } },
      { ...mcqSnapshot, answer: { optionId: 'opt-9' } },
      { ...mcqSnapshot, orderIndex: 0 },
      { ...mcqSnapshot, orderIndex: '3' },
      { ...mcqSnapshot, mediaId: '12' },
      {
        ...mcqSnapshot,
        type: 'arrange_sentence',
        content: { tokens: [{ id: 'tok-1', text: '我' }] },
        answer: { tokenIds: ['tok-1'] },
      },
    ];
    for (const snapshot of broken) {
      expect(exercisePrefillFromSnapshot(snapshot, live)).toMatchObject({
        type: 'mcq',
        prompt: 'Chọn lời chào đúng',
        correctOptionId: 'opt-1',
      });
    }
  });

  it('cả snapshot và live đều hỏng → mcq rỗng mặc định an toàn', () => {
    const value = exercisePrefillFromSnapshot({ type: 'mcq' }, null);
    expect(value).toEqual(emptyExerciseFormValue());
    expect(value.type).toBe('mcq');
    expect(value.prompt).toBe('');
    expect(value.options).toEqual([]);
    expect(value.correctOptionId).toBe('');
  });
});
