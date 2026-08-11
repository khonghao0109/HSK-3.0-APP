import {
  LESSON_EXERCISE_AUTHORING_LIMITS,
  LessonExerciseAuthoringValidationError,
  normalizeLessonExerciseText,
  validateLessonExerciseAuthoring,
} from './lesson-exercise-authoring.validator';

describe('LessonExercise authoring validator', () => {
  const mcq = {
    type: 'mcq' as const,
    prompt: 'Choose the greeting.',
    content: {
      options: [
        { id: 'opt-a', text: '你好' },
        { id: 'opt-b', text: '再见' },
      ],
    },
    answer: { optionId: 'opt-a' },
    explanation: 'The first option is the greeting.',
  };

  const listeningChoice = {
    type: 'listening_choice' as const,
    prompt: 'Choose what you hear.',
    content: {
      options: [
        { id: 'heard-a', text: '你好' },
        { id: 'heard-b', text: '谢谢' },
      ],
    },
    answer: { optionId: 'heard-b' },
    mediaId: 42,
  };

  const fillBlank = {
    type: 'fill_blank' as const,
    prompt: 'Complete: 我___汉语。',
    content: {},
    answer: {
      acceptedTexts: ['学习', '在 学习'],
      caseSensitive: false,
    },
  };

  const arrangeSentence = {
    type: 'arrange_sentence' as const,
    prompt: 'Arrange the sentence.',
    content: {
      tokens: [
        { id: 'token-1', text: '我' },
        { id: 'token-2', text: '学习' },
        { id: 'token-3', text: '汉语' },
      ],
    },
    answer: { tokenIds: ['token-1', 'token-2', 'token-3'] },
  };

  it.each([
    ['mcq', mcq],
    ['listening_choice', listeningChoice],
    ['fill_blank', fillBlank],
    ['arrange_sentence', arrangeSentence],
  ] as const)(
    'accepts and canonicalizes publishable %s authoring',
    (_type, input) => {
      expect(validateLessonExerciseAuthoring(input, 'publish')).toMatchObject(
        input,
      );
    },
  );

  it('stores speaking_repeat as a structurally safe draft but rejects publish', () => {
    const speakingDraft = {
      type: 'speaking_repeat' as const,
      prompt: 'Repeat: 你好。',
      content: {},
      answer: {},
    };

    expect(validateLessonExerciseAuthoring(speakingDraft, 'draft')).toEqual(
      speakingDraft,
    );
    expectValidationError(speakingDraft, 'publish', {
      code: 'unsupported_publish_type',
      path: 'type',
    });
  });

  it('normalizes persisted text and identifier comparisons with Unicode NFKC', () => {
    expect(normalizeLessonExerciseText('ＡＢＣ')).toBe('ABC');

    const canonical = validateLessonExerciseAuthoring(
      {
        type: 'mcq',
        prompt: 'Ｃｈｏｏｓｅ',
        content: {
          options: [
            { id: 'ｏｐｔ-a', text: 'ＡＢＣ' },
            { id: 'opt-b', text: '你好' },
          ],
        },
        answer: { optionId: 'ｏｐｔ-a' },
      },
      'publish',
    );

    expect(canonical).toMatchObject({
      prompt: 'Choose',
      content: {
        options: [
          { id: 'opt-a', text: 'ABC' },
          { id: 'opt-b', text: '你好' },
        ],
      },
      answer: { optionId: 'opt-a' },
    });
  });

  it.each([
    ['score', 100],
    ['isCorrect', true],
    ['version', 99],
    ['createdById', 1],
    ['status', 'published'],
  ])('rejects server/client-controlled top-level key %s', (key, value) => {
    expectValidationError({ ...mcq, [key]: value }, 'draft', {
      code: 'unknown_field',
      path: '$.$unknown',
    });
  });

  it('enforces exact nested object keys', () => {
    expectValidationError(
      {
        ...mcq,
        content: { ...mcq.content, debug: true },
      },
      'draft',
      { code: 'unknown_field', path: 'content.$unknown' },
    );
    expectValidationError(
      {
        ...mcq,
        content: {
          options: [
            { ...mcq.content.options[0], correct: true },
            mcq.content.options[1],
          ],
        },
      },
      'draft',
      { code: 'unknown_field', path: 'content.options[0].$unknown' },
    );
    expectValidationError(
      { ...mcq, answer: { ...mcq.answer, score: 100 } },
      'draft',
      { code: 'unknown_field', path: 'answer.$unknown' },
    );
  });

  it('never reflects an attacker-controlled unknown property name', () => {
    const secretKey = 'AUTHORITATIVEANSWERSECRET';
    const error = captureValidationError(
      { ...mcq, [secretKey]: true },
      'draft',
    );

    expect(error).toMatchObject({
      code: 'unknown_field',
      path: '$.$unknown',
    });
    expect(String(error)).not.toContain(secretKey);
  });

  it.each(['opt a', ' opt-a', 'opt-a ', 'opt\ta'])(
    'rejects an ambiguous stable option id %p',
    (id) => {
      expectValidationError(
        {
          ...mcq,
          content: {
            options: [{ id, text: '你好' }, mcq.content.options[1]],
          },
          answer: { optionId: id },
        },
        'draft',
        { code: 'invalid_stable_id', path: 'content.options[0].id' },
      );
    },
  );

  it('rejects duplicate option ids, including duplicates created by NFKC', () => {
    expectValidationError(
      {
        ...mcq,
        content: {
          options: [
            { id: 'ｏｐｔ-a', text: '你好' },
            { id: 'opt-a', text: '再见' },
          ],
        },
      },
      'draft',
      { code: 'duplicate_stable_id', path: 'content.options[1].id' },
    );
  });

  it('requires the authoritative option to exist in the authored option set', () => {
    expectValidationError(
      { ...mcq, answer: { optionId: 'missing-option' } },
      'draft',
      { code: 'authoritative_option_not_found', path: 'answer.optionId' },
    );
  });

  it.each([
    ['missing', ['token-1', 'token-2']],
    ['duplicate', ['token-1', 'token-2', 'token-2']],
    ['extra', ['token-1', 'token-2', 'token-3', 'token-4']],
  ])(
    'rejects an arrange_sentence authoritative token set that is %s',
    (_case, tokenIds) => {
      expectValidationError(
        { ...arrangeSentence, answer: { tokenIds } },
        'draft',
        { code: 'invalid_token_set', path: 'answer.tokenIds' },
      );
    },
  );

  it('allows authoritative arrange order to differ while requiring the exact token set', () => {
    const canonical = validateLessonExerciseAuthoring(
      {
        ...arrangeSentence,
        answer: { tokenIds: ['token-3', 'token-1', 'token-2'] },
      },
      'publish',
    );

    expect(canonical.answer).toEqual({
      tokenIds: ['token-3', 'token-1', 'token-2'],
    });
  });

  it('requires at least one non-empty fill_blank accepted text', () => {
    expectValidationError(
      { ...fillBlank, answer: { acceptedTexts: [] } },
      'draft',
      { code: 'accepted_texts_required', path: 'answer.acceptedTexts' },
    );
    expectValidationError(
      { ...fillBlank, answer: { acceptedTexts: ['   '] } },
      'draft',
      { code: 'non_empty_string_required', path: 'answer.acceptedTexts[0]' },
    );
  });

  it('requires listening_choice media at publish and forbids media on other types', () => {
    const withoutMedia = {
      type: listeningChoice.type,
      prompt: listeningChoice.prompt,
      content: listeningChoice.content,
      answer: listeningChoice.answer,
    };
    expectValidationError(withoutMedia, 'publish', {
      code: 'media_required',
      path: 'mediaId',
    });
    expectValidationError({ ...mcq, mediaId: 42 }, 'draft', {
      code: 'media_not_allowed',
      path: 'mediaId',
    });
    expectValidationError(
      { ...listeningChoice, mediaId: 2_147_483_648 },
      'draft',
      {
        code: 'positive_safe_integer_required',
        path: 'mediaId',
      },
    );
  });

  it('rejects strings, arrays, JSON size and nesting beyond explicit bounds', () => {
    expectValidationError(
      {
        ...mcq,
        prompt: 'x'.repeat(
          LESSON_EXERCISE_AUTHORING_LIMITS.maxStringLength + 1,
        ),
      },
      'draft',
      { code: 'string_too_long', path: 'prompt' },
    );

    expectValidationError(
      {
        ...mcq,
        content: {
          options: Array.from(
            {
              length: LESSON_EXERCISE_AUTHORING_LIMITS.maxArrayLength + 1,
            },
            (_value, index) => ({ id: `option-${index}`, text: 'x' }),
          ),
        },
      },
      'draft',
      { code: 'array_too_large', path: 'content.options' },
    );

    const perOptionTextLength = Math.floor(
      LESSON_EXERCISE_AUTHORING_LIMITS.maxJsonBytes / 20,
    );
    expectValidationError(
      {
        ...mcq,
        content: {
          options: Array.from({ length: 20 }, (_value, index) => ({
            id: `option-${index}`,
            text: 'x'.repeat(perOptionTextLength),
          })),
        },
      },
      'draft',
      { code: 'payload_too_large', path: '$' },
    );

    expectValidationError(
      {
        ...mcq,
        content: {
          ...mcq.content,
          nested: deeplyNested(LESSON_EXERCISE_AUTHORING_LIMITS.maxDepth + 1),
        },
      },
      'draft',
      { code: 'max_depth_exceeded', path: '$' },
    );
  });

  it('returns only a safe code/path and never attaches or prints the raw answer', () => {
    const secret = 'AUTHORITATIVE-ANSWER-MUST-NOT-LEAK';
    const error = captureValidationError(
      {
        ...mcq,
        answer: { optionId: 'opt-a', internal: secret },
      },
      'draft',
    );

    expect(error).toMatchObject({
      code: 'unknown_field',
      path: 'answer.$unknown',
    });
    expect(error.path).toMatch(/^[A-Za-z0-9.$[\]]+$/);
    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(Object.keys(error)).not.toEqual(
      expect.arrayContaining(['input', 'payload', 'answer', 'value']),
    );
  });
});

function expectValidationError(
  input: Parameters<typeof validateLessonExerciseAuthoring>[0],
  mode: Parameters<typeof validateLessonExerciseAuthoring>[1],
  expected: { code: string; path: string },
): void {
  expect(captureValidationError(input, mode)).toMatchObject(expected);
}

function captureValidationError(
  input: Parameters<typeof validateLessonExerciseAuthoring>[0],
  mode: Parameters<typeof validateLessonExerciseAuthoring>[1],
): LessonExerciseAuthoringValidationError {
  try {
    validateLessonExerciseAuthoring(input, mode);
  } catch (error) {
    expect(error).toBeInstanceOf(LessonExerciseAuthoringValidationError);
    return error as LessonExerciseAuthoringValidationError;
  }
  throw new Error('Expected LessonExercise authoring validation to fail.');
}

function deeplyNested(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) {
    value = { child: value };
  }
  return value;
}
