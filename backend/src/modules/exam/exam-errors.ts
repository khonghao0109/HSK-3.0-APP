import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * TL-111 error codes of the learner exam endpoints. Every "not usable" reason
 * collapses into EXAM_TEST_NOT_FOUND so a draft or archived test cannot be
 * probed from the outside.
 */
export const EXAM_ERROR_CODES = {
  testNotFound: 'EXAM_TEST_NOT_FOUND',
  testUnavailable: 'EXAM_TEST_UNAVAILABLE',
  idempotencyKeyReused: 'EXAM_IDEMPOTENCY_KEY_REUSED',
  attemptNotFound: 'EXAM_ATTEMPT_NOT_FOUND',
} as const;

export const EXAM_REASONS_LIMIT = 20;

export function examTestNotFound(): NotFoundException {
  return new NotFoundException({
    code: EXAM_ERROR_CODES.testNotFound,
    message: 'Exam test was not found.',
  });
}

/**
 * The test content no longer passes the publish gate. `reasons` uses the same
 * codes as `TEST_NOT_PUBLISHABLE`; the global exception filter moves it into
 * `error.details.reasons`.
 */
export function examTestUnavailable(
  reasons: Array<{ code: string; field: string }>,
): ConflictException {
  return new ConflictException({
    code: EXAM_ERROR_CODES.testUnavailable,
    message: 'Exam test content is not available.',
    reasons: reasons.slice(0, EXAM_REASONS_LIMIT),
  });
}

export function examIdempotencyKeyReused(): ConflictException {
  return new ConflictException({
    code: EXAM_ERROR_CODES.idempotencyKeyReused,
    message: 'Idempotency key was already used for another exam test.',
  });
}

export function examAttemptNotFound(): NotFoundException {
  return new NotFoundException({
    code: EXAM_ERROR_CODES.attemptNotFound,
    message: 'Exam attempt was not found.',
  });
}
