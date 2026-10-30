import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ExamAttemptStatus } from '@prisma/client';

import type { ExamAnswerViewDto } from './dto/exam-response.dto';

/**
 * TL-111/TL-121 error codes of the learner exam endpoints. Every "not usable"
 * reason of the intro/start collapses into EXAM_TEST_NOT_FOUND so a draft or
 * archived test cannot be probed from the outside; an attempt of another
 * learner collapses into EXAM_ATTEMPT_NOT_FOUND for the same reason.
 */
export const EXAM_ERROR_CODES = {
  testNotFound: 'EXAM_TEST_NOT_FOUND',
  testUnavailable: 'EXAM_TEST_UNAVAILABLE',
  idempotencyKeyReused: 'EXAM_IDEMPOTENCY_KEY_REUSED',
  attemptNotFound: 'EXAM_ATTEMPT_NOT_FOUND',
  questionNotFound: 'EXAM_QUESTION_NOT_FOUND',
  answerInvalid: 'EXAM_ANSWER_INVALID',
  answerVersionConflict: 'EXAM_ANSWER_VERSION_CONFLICT',
  attemptExpired: 'EXAM_ATTEMPT_EXPIRED',
  attemptClosed: 'EXAM_ATTEMPT_CLOSED',
  attemptAlreadySubmitted: 'EXAM_ATTEMPT_ALREADY_SUBMITTED',
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

/** TL-121: the key is not in this attempt's frozen snapshot. */
export function examQuestionNotFound(): NotFoundException {
  return new NotFoundException({
    code: EXAM_ERROR_CODES.questionNotFound,
    message: 'Exam question was not found in this attempt.',
  });
}

/** TL-122: the answer does not match `snapshot.type`; `field` points at it. */
export function examAnswerInvalid(field: string): BadRequestException {
  return new BadRequestException({
    code: EXAM_ERROR_CODES.answerInvalid,
    message: 'Exam answer is not valid for this question.',
    field,
  });
}

/** TL-123: optimistic concurrency failed; `current` is the winning row view. */
export function examAnswerVersionConflict(
  current: ExamAnswerViewDto | null,
): ConflictException {
  return new ConflictException({
    code: EXAM_ERROR_CODES.answerVersionConflict,
    message: 'Exam answer version does not match; reload and retry.',
    current,
  });
}

/**
 * TL-124: the batch envelope itself is malformed (a repeated `questionKey`).
 * Same shape as the global validation pipe so a client sees one contract.
 */
export function examBatchValidationFailed(
  codes: string[],
): BadRequestException {
  return new BadRequestException({
    code: 'REQUEST_VALIDATION_FAILED',
    message: 'Request validation failed.',
    errors: [{ path: '$.items', codes }],
  });
}

/** TL-126: the server grace window has passed and the attempt timed out. */
export function examAttemptExpired(): ConflictException {
  return new ConflictException({
    code: EXAM_ERROR_CODES.attemptExpired,
    message: 'Exam attempt has expired.',
  });
}

/** TL-126: the attempt is no longer `in_progress` (submitted/timed_out/…). */
export function examAttemptClosed(
  status: ExamAttemptStatus,
): ConflictException {
  return new ConflictException({
    code: EXAM_ERROR_CODES.attemptClosed,
    message: 'Exam attempt is no longer in progress.',
    status,
  });
}

/**
 * TL-151: a different submit key arrived for an attempt that is already
 * `submitted`. It is distinct from `EXAM_ATTEMPT_CLOSED` so a second tab can
 * treat the outcome as "already done" instead of a failed action.
 */
export function examAttemptAlreadySubmitted(): ConflictException {
  return new ConflictException({
    code: EXAM_ERROR_CODES.attemptAlreadySubmitted,
    message: 'Exam attempt was already submitted.',
    status: 'submitted',
  });
}
