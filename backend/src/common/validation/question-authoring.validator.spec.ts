import { QuestionType, Skill } from '@prisma/client';

import {
  QUESTION_SNAPSHOT_FIELDS,
  QuestionAuthoringValidationError,
  normalizeQuestionTagName,
  slugifyQuestionTag,
  validateQuestionAuthoring,
} from './question-authoring.validator';

const base = {
  type: QuestionType.mcq,
  skill: Skill.reading,
  levelId: 1,
  content: 'Chọn nghĩa đúng của 你好',
  answers: {
    options: [
      { id: 'hello', text: 'Xin chào' },
      { id: 'bye', text: 'Tạm biệt' },
    ],
  },
  correctAnswer: { optionId: 'hello' },
};

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof QuestionAuthoringValidationError) return error.code;
    throw error;
  }
  throw new Error('expected QuestionAuthoringValidationError');
}

describe('question authoring validator (M4.1a TL-78)', () => {
  it('builds the canonical snapshot for mcq with prompt-content and answer fields', () => {
    const snapshot = validateQuestionAuthoring({
      ...base,
      content: '  Chọn nghĩa đúng của 你好  ',
      explanation: '  你好 là xin chào  ',
      objective: '  Nhận biết lời chào  ',
      difficulty: 2,
      audioId: 7,
      imageId: null,
      tags: ['Gia đình', 'Từ vựng'],
    });
    expect(snapshot).toEqual({
      type: 'mcq',
      skill: 'reading',
      levelId: 1,
      content: 'Chọn nghĩa đúng của 你好',
      answers: {
        options: [
          { id: 'hello', text: 'Xin chào' },
          { id: 'bye', text: 'Tạm biệt' },
        ],
      },
      correctAnswer: { optionId: 'hello' },
      explanation: '你好 là xin chào',
      objective: 'Nhận biết lời chào',
      difficulty: 2,
      audioId: 7,
      imageId: null,
      tags: ['gia-dinh', 'tu-vung'],
    });
    expect(Object.keys(snapshot).sort()).toEqual(
      [...QUESTION_SNAPSHOT_FIELDS].sort(),
    );
  });

  it('accepts fill_blank with accepted texts and an optional case flag', () => {
    const snapshot = validateQuestionAuthoring({
      ...base,
      type: QuestionType.fill_blank,
      answers: {},
      correctAnswer: { acceptedTexts: ['你好'], caseSensitive: false },
    });
    expect(snapshot.answers).toEqual({});
    expect(snapshot.correctAnswer).toEqual({
      acceptedTexts: ['你好'],
      caseSensitive: false,
    });
  });

  it('accepts arrange_sentence tokens and their authoritative order', () => {
    const snapshot = validateQuestionAuthoring({
      ...base,
      type: QuestionType.arrange_sentence,
      answers: {
        tokens: [
          { id: 't1', text: '我' },
          { id: 't2', text: '是' },
        ],
      },
      correctAnswer: { tokenIds: ['t1', 't2'] },
    });
    expect(snapshot.answers).toEqual({
      tokens: [
        { id: 't1', text: '我' },
        { id: 't2', text: '是' },
      ],
    });
    expect(snapshot.correctAnswer).toEqual({ tokenIds: ['t1', 't2'] });
  });

  it('maps true_false to an empty answers object and a boolean correctAnswer', () => {
    const snapshot = validateQuestionAuthoring({
      ...base,
      type: QuestionType.true_false,
      content: '你好 là lời chào.',
      answers: {},
      correctAnswer: { value: true },
      imageId: 9,
    });
    expect(snapshot.answers).toEqual({});
    expect(snapshot.correctAnswer).toEqual({ value: true });
    expect(snapshot.imageId).toBe(9);
  });

  it('rejects a true_false answer that is not boolean', () => {
    expect(
      codeOf(() =>
        validateQuestionAuthoring({
          ...base,
          type: QuestionType.true_false,
          answers: {},
          correctAnswer: { value: 'true' },
        }),
      ),
    ).toBe('boolean_required');
  });

  it('rejects true_false answers that carry extra keys', () => {
    expect(
      codeOf(() =>
        validateQuestionAuthoring({
          ...base,
          type: QuestionType.true_false,
          answers: { options: [] },
          correctAnswer: { value: false },
        }),
      ),
    ).toBe('unknown_field');
  });

  it('rejects the legacy enum values and unknown question types', () => {
    for (const type of ['listening', 'reading', 'writing', 'speaking']) {
      expect(codeOf(() => validateQuestionAuthoring({ ...base, type }))).toBe(
        'invalid_question_type',
      );
    }
    expect(
      codeOf(() => validateQuestionAuthoring({ ...base, type: 'essay' })),
    ).toBe('invalid_question_type');
  });

  it('accepts the four skills and rejects an invalid skill', () => {
    for (const skill of ['listening', 'reading', 'writing', 'speaking']) {
      expect(validateQuestionAuthoring({ ...base, skill }).skill).toBe(skill);
    }
    expect(
      codeOf(() => validateQuestionAuthoring({ ...base, skill: 'grammar' })),
    ).toBe('invalid_skill');
  });

  it('bounds prompt and explanation lengths', () => {
    expect(
      codeOf(() => validateQuestionAuthoring({ ...base, content: '   ' })),
    ).toBe('non_empty_string_required');
    expect(
      codeOf(() =>
        validateQuestionAuthoring({ ...base, content: 'x'.repeat(4_097) }),
      ),
    ).toBe('string_too_long');
    expect(
      codeOf(() =>
        validateQuestionAuthoring({
          ...base,
          explanation: 'x'.repeat(4_097),
        }),
      ),
    ).toBe('string_too_long');
    expect(
      codeOf(() =>
        validateQuestionAuthoring({ ...base, objective: 'x'.repeat(501) }),
      ),
    ).toBe('string_too_long');
  });

  it('normalizes empty explanation/objective to null', () => {
    const snapshot = validateQuestionAuthoring({
      ...base,
      explanation: '   ',
      objective: '',
    });
    expect(snapshot.explanation).toBeNull();
    expect(snapshot.objective).toBeNull();
  });

  it('bounds difficulty to the integers 1..3', () => {
    for (const difficulty of [1, 2, 3]) {
      expect(
        validateQuestionAuthoring({ ...base, difficulty }).difficulty,
      ).toBe(difficulty);
    }
    for (const difficulty of [0, 4, 1.5, '2']) {
      expect(
        codeOf(() => validateQuestionAuthoring({ ...base, difficulty })),
      ).toBe('invalid_difficulty');
    }
    expect(
      validateQuestionAuthoring({ ...base, difficulty: null }).difficulty,
    ).toBeNull();
  });

  it('bounds media ids to positive safe integers', () => {
    for (const field of ['audioId', 'imageId']) {
      expect(
        codeOf(() => validateQuestionAuthoring({ ...base, [field]: 0 })),
      ).toBe('positive_safe_integer_required');
      expect(
        codeOf(() =>
          validateQuestionAuthoring({ ...base, [field]: 2_147_483_648 }),
        ),
      ).toBe('positive_safe_integer_required');
    }
  });

  it('deduplicates nothing: two tag names with the same slug are rejected', () => {
    expect(
      codeOf(() =>
        validateQuestionAuthoring({
          ...base,
          tags: ['Gia đình', 'gia-dinh'],
        }),
      ),
    ).toBe('duplicate_tag');
  });

  it('bounds tags to 10 names of 1..40 characters each', () => {
    expect(
      codeOf(() =>
        validateQuestionAuthoring({
          ...base,
          tags: Array.from({ length: 11 }, (_, index) => `tag ${index}`),
        }),
      ),
    ).toBe('array_too_large');
    expect(
      codeOf(() =>
        validateQuestionAuthoring({ ...base, tags: ['x'.repeat(41)] }),
      ),
    ).toBe('string_too_long');
    expect(
      codeOf(() => validateQuestionAuthoring({ ...base, tags: ['  '] })),
    ).toBe('non_empty_string_required');
  });

  it('sorts tag slugs and strips Vietnamese diacritics', () => {
    const snapshot = validateQuestionAuthoring({
      ...base,
      tags: ['Từ vựng', 'Ngữ pháp', 'Gia đình'],
    });
    expect(snapshot.tags).toEqual(['gia-dinh', 'ngu-phap', 'tu-vung']);
  });

  it('slugifies Vietnamese tag names for the Tag.slug column', () => {
    expect(slugifyQuestionTag('Gia đình')).toBe('gia-dinh');
    expect(slugifyQuestionTag('  Từ vựng ')).toBe('tu-vung');
    expect(slugifyQuestionTag('Ngữ pháp!')).toBe('ngu-phap');
    expect(slugifyQuestionTag('Đọc hiểu')).toBe('doc-hieu');
    expect(normalizeQuestionTagName('  Gia đình  ')).toBe('Gia đình');
  });

  it('rejects unknown snapshot fields', () => {
    expect(
      codeOf(() => validateQuestionAuthoring({ ...base, authoritative: true })),
    ).toBe('unknown_field');
  });

  it('rejects oversized canonical payloads', () => {
    const options = Array.from({ length: 100 }, (_, index) => ({
      id: `option-${index}`,
      text: '汉'.repeat(4_000),
    }));
    expect(
      codeOf(() =>
        validateQuestionAuthoring({
          ...base,
          answers: { options },
          correctAnswer: { optionId: 'option-0' },
        }),
      ),
    ).toBe('payload_too_large');
  });

  it('rejects payloads deeper than the shared depth limit', () => {
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 10; index += 1) nested = { nested };
    expect(
      codeOf(() =>
        validateQuestionAuthoring({
          ...base,
          answers: {},
          correctAnswer: nested,
          extraUnknown: nested,
        }),
      ),
    ).not.toBe('');
  });
});
