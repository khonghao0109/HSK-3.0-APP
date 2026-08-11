import {
  classifyExerciseImportPersistenceError,
  createExerciseImportPreviewHash,
  validateExerciseImportRows,
} from './lesson-exercise-import';

describe('LessonExercise import validation contract', () => {
  const validRow = {
    sourceKey: 'lesson-10-exercise-1',
    lessonId: 10,
    topicId: 20,
    orderIndex: 1,
    type: 'mcq' as const,
    prompt: 'Choose the greeting.',
    content: {
      options: [
        { id: 'option-a', text: '你好' },
        { id: 'option-b', text: '再见' },
      ],
    },
    answer: { optionId: 'option-a' },
  };

  it('returns deterministic one-based row errors and aggregate counts', () => {
    const rows = [
      validRow,
      { ...validRow, sourceKey: 'ambiguous key', orderIndex: 2 },
      {
        ...validRow,
        sourceKey: 'lesson-10-exercise-3',
        orderIndex: 3,
        type: 'fill_blank' as const,
        content: {},
        answer: { acceptedTexts: [] },
      },
    ];

    const first = validateExerciseImportRows(rows);
    const second = validateExerciseImportRows(
      rows.map((row) => reverseObjectKeyInsertionOrder(row)),
    );

    expect(first).toMatchObject({
      totalRows: 3,
      validRows: 1,
      invalidRows: 2,
      errors: [
        {
          rowNumber: 2,
          code: 'invalid_source_key',
          path: 'sourceKey',
        },
        {
          rowNumber: 3,
          code: 'accepted_texts_required',
          path: 'answer.acceptedTexts',
        },
      ],
    });
    expect(second).toEqual(first);
  });

  it('canonicalizes class-transformed row objects without trusting their prototype', () => {
    class TransformedRow {}
    const transformed = Object.assign(new TransformedRow(), validRow);

    expect(validateExerciseImportRows([transformed])).toMatchObject({
      totalRows: 1,
      validRows: 1,
      invalidRows: 0,
      errors: [],
    });
  });

  it('rejects every occurrence of a duplicate stable source key after NFKC', () => {
    const result = validateExerciseImportRows([
      { ...validRow, sourceKey: 'ｅｘercise-1', orderIndex: 1 },
      { ...validRow, sourceKey: 'unique-2', orderIndex: 2 },
      { ...validRow, sourceKey: 'exercise-1', orderIndex: 3 },
    ]);

    expect(result).toMatchObject({
      totalRows: 3,
      validRows: 1,
      invalidRows: 2,
      errors: [
        {
          rowNumber: 1,
          code: 'duplicate_source_key',
          path: 'sourceKey',
        },
        {
          rowNumber: 3,
          code: 'duplicate_source_key',
          path: 'sourceKey',
        },
      ],
    });
  });

  it.each([
    ['status', 'published'],
    ['version', 9],
    ['score', 100],
    ['isCorrect', true],
    ['createdById', 7],
    ['publishedAt', '2026-08-11T00:00:00.000Z'],
  ])('rejects server-controlled import row key %s', (key, value) => {
    expect(
      validateExerciseImportRows([{ ...validRow, [key]: value }]),
    ).toMatchObject({
      totalRows: 1,
      validRows: 0,
      invalidRows: 1,
      errors: [
        {
          rowNumber: 1,
          code: 'unknown_field',
          path: '$.$unknown',
        },
      ],
    });
  });

  it('never reflects an attacker-controlled import property name', () => {
    const secretKey = 'AUTHORITATIVEANSWERSECRET';
    const result = validateExerciseImportRows([
      { ...validRow, [secretKey]: true },
    ]);

    expect(result.errors).toEqual([
      { rowNumber: 1, code: 'unknown_field', path: '$.$unknown' },
    ]);
    expect(JSON.stringify(result)).not.toContain(secretKey);
  });

  it.each([
    ['zero lessonId', { ...validRow, lessonId: 0 }, 'lessonId'],
    [
      'unsafe lessonId',
      { ...validRow, lessonId: Number.MAX_SAFE_INTEGER + 1 },
      'lessonId',
    ],
    [
      'lessonId above PostgreSQL int4',
      { ...validRow, lessonId: 2_147_483_648 },
      'lessonId',
    ],
    ['zero topicId', { ...validRow, topicId: 0 }, 'topicId'],
    ['negative orderIndex', { ...validRow, orderIndex: -1 }, 'orderIndex'],
    [
      'orderIndex above the authoring limit',
      { ...validRow, orderIndex: 1_000_001 },
      'orderIndex',
    ],
  ])('rejects %s before persistence', (_label, row, path) => {
    expect(validateExerciseImportRows([row])).toMatchObject({
      totalRows: 1,
      validRows: 0,
      invalidRows: 1,
      errors: [
        {
          rowNumber: 1,
          code: 'positive_safe_integer_required',
          path,
        },
      ],
    });
  });

  it('accepts a speaking_repeat row only as draft import content', () => {
    const result = validateExerciseImportRows([
      {
        ...validRow,
        sourceKey: 'future-speaking-1',
        type: 'speaking_repeat',
        content: {},
        answer: {},
      },
    ]);

    expect(result).toMatchObject({
      totalRows: 1,
      validRows: 1,
      invalidRows: 0,
      errors: [],
      normalizedRows: [
        expect.objectContaining({
          rowNumber: 1,
          sourceKey: 'future-speaking-1',
          publishable: false,
          value: expect.objectContaining({ type: 'speaking_repeat' }),
        }),
      ],
    });
  });

  it('sanitizes errors without retaining the authoritative answer or raw row', () => {
    const secret = 'NEVER-LOG-THIS-AUTHORITATIVE-ANSWER';
    const result = validateExerciseImportRows([
      {
        ...validRow,
        answer: { optionId: secret, rawAnswer: secret },
      },
    ]);

    expect(result.errors).toEqual([
      {
        rowNumber: 1,
        code: 'unknown_field',
        path: 'answer.$unknown',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.errors[0]).not.toHaveProperty('payload');
    expect(result.errors[0]).not.toHaveProperty('value');
    expect(result.errors[0]).not.toHaveProperty('message');
  });
});

describe('LessonExercise import preview hash', () => {
  const row = {
    sourceKey: 'source-row-1',
    lessonId: 1,
    topicId: null,
    orderIndex: 1,
    type: 'fill_blank' as const,
    prompt: 'Complete the text.',
    content: {},
    answer: { acceptedTexts: ['ＡＢＣ'] },
  };

  it('is deterministic across object key insertion order and NFKC-equivalent text', () => {
    const first = createExerciseImportPreviewHash({
      dataSourceId: 9,
      rows: [row],
    });
    const second = createExerciseImportPreviewHash({
      rows: [
        reverseObjectKeyInsertionOrder({
          ...row,
          answer: { acceptedTexts: ['ABC'] },
        }),
      ],
      dataSourceId: 9,
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it('binds the preview token to source, ordered rows, source keys and answers', () => {
    const secondRow = {
      ...row,
      sourceKey: 'source-row-2',
      orderIndex: 2,
    };
    const baseline = createExerciseImportPreviewHash({
      dataSourceId: 9,
      rows: [row, secondRow],
    });

    expect(
      createExerciseImportPreviewHash({
        dataSourceId: 10,
        rows: [row, secondRow],
      }),
    ).not.toBe(baseline);
    expect(
      createExerciseImportPreviewHash({
        dataSourceId: 9,
        rows: [secondRow, row],
      }),
    ).not.toBe(baseline);
    expect(
      createExerciseImportPreviewHash({
        dataSourceId: 9,
        rows: [{ ...row, sourceKey: 'changed-key' }, secondRow],
      }),
    ).not.toBe(baseline);
    expect(
      createExerciseImportPreviewHash({
        dataSourceId: 9,
        rows: [
          { ...row, answer: { acceptedTexts: ['changed-answer'] } },
          secondRow,
        ],
      }),
    ).not.toBe(baseline);
  });
});

describe('LessonExercise import persistence error classifier', () => {
  it.each([
    [
      'Prisma idempotency unique',
      { code: 'P2002', meta: { target: ['idempotencyKey'] } },
      'idempotency_conflict',
    ],
    [
      'PostgreSQL source-key unique',
      {
        code: '23505',
        constraint: 'LessonExercise_dataSourceId_sourceKey_key',
      },
      'duplicate_source_key',
    ],
    ['Prisma serialization conflict', { code: 'P2034' }, 'retryable_conflict'],
    ['PostgreSQL serialization', { code: '40001' }, 'retryable_conflict'],
    ['PostgreSQL deadlock', { code: '40P01' }, 'retryable_conflict'],
    ['Prisma transaction timeout', { code: 'P2028' }, 'timeout'],
    ['PostgreSQL lock timeout', { code: '55P03' }, 'timeout'],
    ['PostgreSQL statement timeout', { code: '57014' }, 'timeout'],
    ['Prisma connection', { code: 'P1001' }, 'connection'],
    ['Prisma authentication', { code: 'P1000' }, 'connection'],
    ['Prisma connection timeout', { code: 'P1002' }, 'connection'],
    ['Prisma missing database', { code: 'P1003' }, 'connection'],
    ['Prisma operation timeout', { code: 'P1008' }, 'connection'],
    ['Prisma access denied', { code: 'P1010' }, 'connection'],
    ['Prisma TLS connection', { code: 'P1011' }, 'connection'],
    ['Prisma closed connection', { code: 'P1017' }, 'connection'],
    ['Prisma pool timeout', { code: 'P2024' }, 'connection'],
    ['PostgreSQL FK violation', { code: '23503' }, 'constraint'],
    ['PostgreSQL check violation', { code: '23514' }, 'constraint'],
    [
      'unrelated Prisma unique',
      { code: 'P2002', meta: { target: ['slug'] } },
      'constraint',
    ],
    ['unknown error', new Error('unexpected'), 'unknown'],
  ])('classifies %s without false-green', (_label, error, expected) => {
    expect(classifyExerciseImportPersistenceError(error)).toBe(expected);
  });

  it('recognizes safely nested driver codes without logging error contents', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const secret = 'postgresql://admin:secret@production/import-answer-secret';

    try {
      expect(
        classifyExerciseImportPersistenceError({
          code: 'P2010',
          meta: { code: '55P03', message: secret },
        }),
      ).toBe('timeout');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

function reverseObjectKeyInsertionOrder<T extends Record<string, unknown>>(
  value: T,
): T {
  return Object.fromEntries(Object.entries(value).reverse()) as T;
}
