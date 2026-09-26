import { createHash } from 'node:crypto';

// Serialization recurses once per nested container, so unvalidated input (an
// activity `answer`, a CMS snapshot) must not be allowed to drive the stack.
// The bound is a backstop: callers that own a stricter contract, such as
// LESSON_EXERCISE_AUTHORING_LIMITS.maxDepth, still reject earlier.
export const CANONICAL_JSON_MAX_DEPTH = 16;

export class CanonicalJsonDepthError extends TypeError {
  constructor(readonly maxDepth: number) {
    super(`Canonical JSON exceeds the maximum nesting depth of ${maxDepth}.`);
    this.name = 'CanonicalJsonDepthError';
  }
}

export function canonicalJson(
  value: unknown,
  maxDepth: number = CANONICAL_JSON_MAX_DEPTH,
): string {
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new TypeError(
      'Canonical JSON maximum depth must be a positive integer.',
    );
  }
  return serializeCanonicalValue(value, maxDepth, maxDepth);
}

export function sha256CanonicalJson(
  value: unknown,
  maxDepth: number = CANONICAL_JSON_MAX_DEPTH,
): string {
  return createHash('sha256')
    .update(canonicalJson(value, maxDepth))
    .digest('hex');
}

function serializeCanonicalValue(
  value: unknown,
  remainingDepth: number,
  maxDepth: number,
): string {
  if (value === null) return 'null';

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        'Canonical JSON does not support non-finite numbers.',
      );
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    assertRemainingDepth(remainingDepth, maxDepth);
    return `[${value
      .map((item) =>
        serializeCanonicalValue(item, remainingDepth - 1, maxDepth),
      )
      .join(',')}]`;
  }

  if (typeof value === 'object') {
    assertRemainingDepth(remainingDepth, maxDepth);
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON only supports plain objects.');
    }

    const objectValue = value as Record<string, unknown>;
    const entries = Object.keys(objectValue)
      .sort(compareUtf16CodeUnits)
      .map((key) => {
        const entryValue = objectValue[key];
        if (entryValue === undefined) {
          throw new TypeError('Canonical JSON does not support undefined.');
        }
        return `${JSON.stringify(key)}:${serializeCanonicalValue(
          entryValue,
          remainingDepth - 1,
          maxDepth,
        )}`;
      });
    return `{${entries.join(',')}}`;
  }

  throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
}

function assertRemainingDepth(remainingDepth: number, maxDepth: number): void {
  if (remainingDepth <= 0) {
    throw new CanonicalJsonDepthError(maxDepth);
  }
}

function compareUtf16CodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
