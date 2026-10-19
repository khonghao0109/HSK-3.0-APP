import { describe, expect, it } from 'vitest';

import {
  API_ERROR_DETAILS_LIMITS,
  BackendRequestError,
  normalizeApiFailure,
} from './api-error';

describe('safe API error normalization', () => {
  it.each([
    [400, 'invalid_request', false],
    [401, 'session_expired', false],
    [403, 'forbidden', false],
    [404, 'not_found', false],
    [409, 'conflict', false],
    [422, 'validation', false],
    [429, 'rate_limited', true],
    [503, 'unavailable', true],
  ] as const)('maps HTTP %i to %s', (status, kind, retryable) => {
    expect(
      normalizeApiFailure({ status, body: { message: 'raw backend message' } }),
    ).toMatchObject({ status, kind, retryable });
  });

  it('never reflects backend payloads, credentials, SQL, or authoritative answers', () => {
    const secret = 'postgresql://admin:password@production/hsk';
    const error = normalizeApiFailure({
      status: 500,
      body: { message: secret, sql: 'SELECT answer FROM LessonExercise' },
      requestId: 'request-safe-123',
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain('SELECT answer');
    expect(error.requestId).toBe('request-safe-123');
  });

  it('keeps the string error.code of a backend error envelope', () => {
    const failure = normalizeApiFailure({
      status: 400,
      body: {
        success: false,
        error: { code: 'INVALID_RESET_TOKEN', message: 'expired' },
      },
    });
    expect(failure).toMatchObject({
      status: 400,
      kind: 'invalid_request',
      message: 'The request is not valid.',
      code: 'INVALID_RESET_TOKEN',
    });
    expect(new BackendRequestError(failure).code).toBe('INVALID_RESET_TOKEN');
  });

  it('keeps only the filtered path and per-row errors of details (M5.1b1, F1)', () => {
    const failure = normalizeApiFailure({
      status: 422,
      body: {
        success: false,
        error: {
          code: 'invalid_token_set',
          message: 'LessonExercise validation failed at answer.tokenIds.',
          details: {
            path: 'answer.tokenIds',
            errors: [
              { rowNumber: 1, code: 'missing_field', path: 'prompt' },
              {
                rowNumber: 2,
                code: 'invalid_stable_id',
                path: 'content.tokens[0].id',
              },
              { rowNumber: '2', code: 'string_row_number', path: 'prompt' },
              { rowNumber: 3, code: 'x'.repeat(65), path: 'prompt' },
              { rowNumber: 4, code: 'valid_code', path: `p${'x'.repeat(201)}` },
              { rowNumber: 5, code: '', path: 'prompt' },
              'not-a-row',
            ],
            sql: 'SELECT answer FROM LessonExercise',
            authorId: 7,
            pathHint: 'ignored',
          },
        },
      },
    });
    expect(failure.details).toEqual({
      path: 'answer.tokenIds',
      errors: [
        { rowNumber: 1, code: 'missing_field', path: 'prompt' },
        {
          rowNumber: 2,
          code: 'invalid_stable_id',
          path: 'content.tokens[0].id',
        },
      ],
    });
    expect(JSON.stringify(failure)).not.toContain('SELECT answer');
    expect(JSON.stringify(failure)).not.toContain('ignored');
    const error = new BackendRequestError(failure);
    expect(error.details).toEqual(failure.details);
  });

  it('caps details.errors at 100 rows and drops over-long details entirely', () => {
    const rows = Array.from({ length: 130 }, (_, index) => ({
      rowNumber: index + 1,
      code: 'invalid_row',
      path: `rows[${index}]`,
    }));
    const capped = normalizeApiFailure({
      status: 422,
      body: {
        success: false,
        error: { code: 'import_invalid', details: { errors: rows } },
      },
    });
    expect(capped.details?.errors).toHaveLength(
      API_ERROR_DETAILS_LIMITS.maxErrors,
    );
    expect(capped.details?.errors?.[0]).toEqual({
      rowNumber: 1,
      code: 'invalid_row',
      path: 'rows[0]',
    });
    expect(capped.details?.errors?.[99]).toEqual({
      rowNumber: 100,
      code: 'invalid_row',
      path: 'rows[99]',
    });

    const tooLong = normalizeApiFailure({
      status: 422,
      body: {
        success: false,
        error: {
          details: {
            path: `p${'x'.repeat(API_ERROR_DETAILS_LIMITS.maxPathLength)}`,
            errors: 'not-an-array',
            metadata: { sql: 'SELECT 1' },
          },
        },
      },
    });
    expect('details' in tooLong).toBe(false);

    const unknownOnly = normalizeApiFailure({
      status: 422,
      body: { success: false, error: { details: { sql: 'SELECT 1' } } },
    });
    expect('details' in unknownOnly).toBe(false);
  });

  it.each([
    ['no body', undefined],
    ['a body that was not JSON', null],
    ['a text body', 'Bad Gateway'],
    ['a non-string code', { success: false, error: { code: 400 } }],
    ['an envelope without error', { success: false }],
  ])('leaves code undefined for %s', (_label, body) => {
    const failure = normalizeApiFailure({ status: 400, body });
    expect(failure.code).toBeUndefined();
    expect('code' in failure).toBe(false);
    expect(new BackendRequestError(failure).code).toBeUndefined();
  });
});
