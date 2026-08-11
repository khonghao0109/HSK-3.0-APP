export type LessonActivityPersistenceErrorKind =
  | 'unique_conflict'
  | 'concurrent_retry'
  | 'timeout'
  | 'connection_error'
  | 'unknown';

export function classifyLessonActivityPersistenceError(
  error: unknown,
): LessonActivityPersistenceErrorKind {
  const codes = collectSafeErrorCodes(error);
  if (codes.has('P2002') || codes.has('23505')) return 'unique_conflict';
  if (codes.has('P2034') || codes.has('40P01')) {
    return 'concurrent_retry';
  }
  if (codes.has('P2028') || codes.has('55P03') || codes.has('57014')) {
    return 'timeout';
  }
  if (
    [...codes].some(
      (code) =>
        /^08[A-Z0-9]{3}$/.test(code) ||
        [
          'P1000',
          'P1001',
          'P1002',
          'P1003',
          'P1008',
          'P1017',
          'P2024',
        ].includes(code),
    )
  ) {
    return 'connection_error';
  }
  return 'unknown';
}

function collectSafeErrorCodes(error: unknown): Set<string> {
  const result = new Set<string>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== 'object') break;
    const record = current as Record<string, unknown>;
    for (const key of ['code', 'sqlState', 'sqlstate']) {
      if (typeof record[key] === 'string') result.add(record[key]);
    }
    current = record.cause ?? record.meta;
  }
  return result;
}
