import { describe, expect, it } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from './api-error';

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
