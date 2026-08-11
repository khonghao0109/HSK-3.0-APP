import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

import { canonicalJson } from '../../../common/utils/canonical-json';

const MAX_JSON_BYTES = 100_000;
const MAX_JSON_DEPTH = 20;

@ValidatorConstraint({ name: 'boundedJsonPayload', async: false })
export class BoundedJsonPayload implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!Array.isArray(value) && !isPlainObject(value)) return false;

    try {
      if (jsonDepth(value) > MAX_JSON_DEPTH) return false;
      return Buffer.byteLength(canonicalJson(value), 'utf8') <= MAX_JSON_BYTES;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return `content must be valid JSON no larger than ${MAX_JSON_BYTES} bytes and ${MAX_JSON_DEPTH} levels deep`;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function jsonDepth(value: unknown): number {
  if (Array.isArray(value)) {
    return 1 + Math.max(0, ...value.map((item) => jsonDepth(item)));
  }
  if (isPlainObject(value)) {
    return 1 + Math.max(0, ...Object.values(value).map(jsonDepth));
  }
  return 0;
}
