import { BadRequestException } from '@nestjs/common';

import {
  CanonicalJsonDepthError,
  sha256CanonicalJson,
} from '../../../common/utils/canonical-json';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

// A key identifies one client retry window, not a permanent record of the
// write. Replay is answered from LearningEvent, so without this bound every
// stored event stays replayable for the lifetime of the table (D-02).
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new BadRequestException(
      'Idempotency-Key must be 8-128 characters using letters, numbers, dot, underscore, colon or hyphen.',
    );
  }
  return value;
}

export function isIdempotencyKeyExpired(
  storedAt: Date,
  now: Date = new Date(),
): boolean {
  const age = now.getTime() - storedAt.getTime();
  return Number.isFinite(age) && age > IDEMPOTENCY_KEY_TTL_MS;
}

export function assertIdempotencyKeyWithinTtl(
  storedAt: Date,
  now: Date = new Date(),
): void {
  if (isIdempotencyKeyExpired(storedAt, now)) {
    throw new BadRequestException(
      'Idempotency-Key has expired. Please use a fresh key.',
    );
  }
}

export function buildActivityRequestHash(value: unknown): string {
  try {
    return sha256CanonicalJson(value);
  } catch (error: unknown) {
    // The activity answer is unvalidated client JSON; a payload nested past the
    // canonical-JSON bound is a bad request, not a server fault.
    if (error instanceof CanonicalJsonDepthError) {
      throw new BadRequestException(
        `Payload exceeds maximum nesting depth of ${String(error.maxDepth)}.`,
      );
    }
    throw error;
  }
}
