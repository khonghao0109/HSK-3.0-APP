import { ConflictException, NotFoundException } from '@nestjs/common';

/** M3.2 Q253/Q254 error codes of the review session routes. */
export const REVIEW_ERROR_CODES = {
  nothingDue: 'REVIEW_NOTHING_DUE',
  sessionNotFound: 'REVIEW_SESSION_NOT_FOUND',
  sessionNotActive: 'REVIEW_SESSION_NOT_ACTIVE',
  sessionExpired: 'REVIEW_SESSION_EXPIRED',
  cardNotInSession: 'REVIEW_CARD_NOT_IN_SESSION',
  cardAlreadyReviewed: 'REVIEW_CARD_ALREADY_REVIEWED',
  cardUnavailable: 'REVIEW_CARD_UNAVAILABLE',
} as const;

const conflict = (code: string, message: string) =>
  new ConflictException({ code, message });

export const reviewErrors = {
  nothingDue: () =>
    conflict(REVIEW_ERROR_CODES.nothingDue, 'No review card is due.'),
  /** Also for a session of another learner: its existence is not revealed. */
  sessionNotFound: () =>
    new NotFoundException({
      code: REVIEW_ERROR_CODES.sessionNotFound,
      message: 'Review session was not found.',
    }),
  sessionNotActive: () =>
    conflict(
      REVIEW_ERROR_CODES.sessionNotActive,
      'Review session is no longer in progress.',
    ),
  sessionExpired: () =>
    conflict(REVIEW_ERROR_CODES.sessionExpired, 'Review session has expired.'),
  cardNotInSession: () =>
    conflict(
      REVIEW_ERROR_CODES.cardNotInSession,
      'Review card is not part of this session.',
    ),
  cardAlreadyReviewed: () =>
    conflict(
      REVIEW_ERROR_CODES.cardAlreadyReviewed,
      'Review card was already graded in this session.',
    ),
  cardUnavailable: () =>
    conflict(
      REVIEW_ERROR_CODES.cardUnavailable,
      'Review card is no longer available.',
    ),
  /** Same answer as a reused key on `POST /dictionary/words/:id/save`. */
  idempotencyKeyReused: () =>
    new ConflictException(
      'Idempotency-Key was already used for a different request.',
    ),
};
