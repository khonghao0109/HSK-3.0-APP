import { BadRequestException } from '@nestjs/common';

import { sha256CanonicalJson } from '../../../common/utils/canonical-json';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new BadRequestException(
      'Idempotency-Key must be 8-128 characters using letters, numbers, dot, underscore, colon or hyphen.',
    );
  }
  return value;
}

export function buildActivityRequestHash(value: unknown): string {
  return sha256CanonicalJson(value);
}
