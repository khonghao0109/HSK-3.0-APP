import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return serializeCanonicalValue(value);
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function serializeCanonicalValue(value: unknown): string {
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
    return `[${value.map((item) => serializeCanonicalValue(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
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
        return `${JSON.stringify(key)}:${serializeCanonicalValue(entryValue)}`;
      });
    return `{${entries.join(',')}}`;
  }

  throw new TypeError(`Canonical JSON does not support ${typeof value}.`);
}

function compareUtf16CodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
