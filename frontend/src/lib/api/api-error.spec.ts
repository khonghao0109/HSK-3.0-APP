import { describe, expect, it } from 'vitest';

import { normalizeApiFailure } from './api-error';

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
});
