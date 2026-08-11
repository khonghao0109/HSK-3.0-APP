import { createHash } from 'node:crypto';

import { POSTGRESQL_INT4_MAX } from '../../../common/constants/database.constants';
import {
  LESSON_EXERCISE_ORDER_INDEX_LIMITS,
  LessonExerciseAuthoringValidationError,
  LessonExerciseAuthoringValue,
  normalizeLessonExerciseText,
  validateLessonExerciseAuthoring,
} from '../../../common/validation/lesson-exercise-authoring.validator';
import { canonicalJson } from '../../../common/utils/canonical-json';

export type ExerciseImportError = {
  rowNumber: number;
  code: string;
  path: string;
};

export type NormalizedExerciseImportRow = {
  rowNumber: number;
  sourceKey: string;
  publishable: boolean;
  value: LessonExerciseAuthoringValue & {
    lessonId: number;
    topicId: number | null;
    orderIndex: number;
  };
};

export type ExerciseImportValidation = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: ExerciseImportError[];
  normalizedRows: NormalizedExerciseImportRow[];
};

export type ExerciseImportPersistenceErrorKind =
  | 'idempotency_conflict'
  | 'duplicate_source_key'
  | 'retryable_conflict'
  | 'timeout'
  | 'connection'
  | 'constraint'
  | 'unknown';

const ROW_KEYS = new Set([
  'sourceKey',
  'lessonId',
  'topicId',
  'orderIndex',
  'type',
  'prompt',
  'content',
  'answer',
  'explanation',
  'mediaId',
]);

export function validateExerciseImportRows(
  rows: readonly unknown[],
): ExerciseImportValidation {
  const candidates: NormalizedExerciseImportRow[] = [];
  const errors: ExerciseImportError[] = [];

  rows.forEach((rawRow, index) => {
    const rowNumber = index + 1;
    try {
      const row = requireRow(rawRow);
      if (Object.keys(row).some((key) => !ROW_KEYS.has(key))) {
        throw rowError('unknown_field', '$.$unknown');
      }

      const sourceKey = requireSourceKey(row.sourceKey);
      const lessonId = requirePostgresqlId(row.lessonId, 'lessonId');
      const topicId =
        row.topicId === undefined || row.topicId === null
          ? null
          : requirePostgresqlId(row.topicId, 'topicId');
      const orderIndex = requireOrderIndex(row.orderIndex);
      const authoringInput = Object.fromEntries(
        ['type', 'prompt', 'content', 'answer', 'explanation', 'mediaId']
          .filter((key) => row[key] !== undefined)
          .map((key) => [key, row[key]]),
      );
      const value = validateLessonExerciseAuthoring(authoringInput, 'draft');
      let publishable = true;
      try {
        validateLessonExerciseAuthoring(value, 'publish');
      } catch (error) {
        if (!(error instanceof LessonExerciseAuthoringValidationError)) {
          throw error;
        }
        publishable = false;
      }
      candidates.push({
        rowNumber,
        sourceKey,
        publishable,
        value: { ...value, lessonId, topicId, orderIndex },
      });
    } catch (error) {
      const safe = asSafeRowError(error);
      errors.push({ rowNumber, code: safe.code, path: safe.path });
    }
  });

  const keyRows = new Map<string, number[]>();
  for (const candidate of candidates) {
    const rowNumbers = keyRows.get(candidate.sourceKey) ?? [];
    rowNumbers.push(candidate.rowNumber);
    keyRows.set(candidate.sourceKey, rowNumbers);
  }
  const duplicateRows = new Set<number>();
  for (const rowNumbers of keyRows.values()) {
    if (rowNumbers.length < 2) continue;
    for (const rowNumber of rowNumbers) {
      duplicateRows.add(rowNumber);
      errors.push({
        rowNumber,
        code: 'duplicate_source_key',
        path: 'sourceKey',
      });
    }
  }

  errors.sort(
    (left, right) =>
      left.rowNumber - right.rowNumber ||
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
  const normalizedRows = candidates.filter(
    (candidate) => !duplicateRows.has(candidate.rowNumber),
  );
  return {
    totalRows: rows.length,
    validRows: normalizedRows.length,
    invalidRows: rows.length - normalizedRows.length,
    errors,
    normalizedRows,
  };
}

export function createExerciseImportPreviewHash(input: {
  dataSourceId: number;
  rows: readonly unknown[];
  fileName?: string;
}): string {
  const validation = validateExerciseImportRows(input.rows);
  const canonicalPayload = {
    contractVersion: 'lesson-exercise-import-v1',
    dataSourceId: input.dataSourceId,
    ...(input.fileName === undefined
      ? {}
      : { fileName: normalizeLessonExerciseText(input.fileName) }),
    rows: validation.normalizedRows.map((row) => ({
      sourceKey: row.sourceKey,
      ...row.value,
    })),
    errors: validation.errors,
  };
  return createHash('sha256')
    .update(canonicalJson(canonicalPayload))
    .digest('hex');
}

export function classifyExerciseImportPersistenceError(
  error: unknown,
): ExerciseImportPersistenceErrorKind {
  const evidence = collectSafeErrorEvidence(error);
  if (
    evidence.codes.has('P2028') ||
    evidence.codes.has('55P03') ||
    evidence.codes.has('57014')
  ) {
    return 'timeout';
  }
  if (
    evidence.codes.has('P2034') ||
    evidence.codes.has('40001') ||
    evidence.codes.has('40P01')
  ) {
    return 'retryable_conflict';
  }
  if (
    [
      'P1000',
      'P1001',
      'P1002',
      'P1003',
      'P1008',
      'P1010',
      'P1011',
      'P1017',
      'P2024',
    ].some((code) => evidence.codes.has(code)) ||
    [...evidence.codes].some((code) => /^08[A-Z0-9]{3}$/u.test(code))
  ) {
    return 'connection';
  }
  if (evidence.codes.has('P2002') || evidence.codes.has('23505')) {
    if (
      evidence.identifiers.has('LessonExercise_dataSourceId_sourceKey_key') ||
      evidence.identifiers.has('dataSourceId') ||
      evidence.identifiers.has('sourceKey')
    ) {
      return 'duplicate_source_key';
    }
    if (
      evidence.identifiers.has('ImportJob_idempotencyKey_key') ||
      evidence.identifiers.has('idempotencyKey')
    ) {
      return 'idempotency_conflict';
    }
    return 'constraint';
  }
  if (evidence.codes.has('23503') || evidence.codes.has('23514')) {
    return 'constraint';
  }
  return 'unknown';
}

function requireRow(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw rowError('object_required', '$');
  }
  return Object.fromEntries(Object.entries(value));
}

function requireSourceKey(value: unknown): string {
  if (typeof value !== 'string')
    throw rowError('invalid_source_key', 'sourceKey');
  const normalized = normalizeLessonExerciseText(value);
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    /\s/u.test(normalized) ||
    !/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u.test(normalized)
  ) {
    throw rowError('invalid_source_key', 'sourceKey');
  }
  return normalized;
}

function requirePositiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw rowError('positive_safe_integer_required', path);
  }
  return value as number;
}

function requirePostgresqlId(value: unknown, path: string): number {
  const id = requirePositiveSafeInteger(value, path);
  if (id > POSTGRESQL_INT4_MAX) {
    throw rowError('positive_safe_integer_required', path);
  }
  return id;
}

function requireOrderIndex(value: unknown): number {
  const orderIndex = requirePositiveSafeInteger(value, 'orderIndex');
  if (orderIndex > LESSON_EXERCISE_ORDER_INDEX_LIMITS.max) {
    throw rowError('positive_safe_integer_required', 'orderIndex');
  }
  return orderIndex;
}

class ExerciseImportRowValidationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string) {
    super(`Exercise import row validation failed (${code}) at ${path}.`);
    this.name = 'ExerciseImportRowValidationError';
    this.code = code;
    this.path = path;
  }
}

function rowError(code: string, path: string): Error {
  return new ExerciseImportRowValidationError(code, path);
}

function asSafeRowError(error: unknown): { code: string; path: string } {
  if (error instanceof LessonExerciseAuthoringValidationError) {
    return { code: error.code, path: error.path };
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.code === 'string' && typeof record.path === 'string') {
      return { code: record.code, path: record.path };
    }
  }
  return { code: 'invalid_row', path: '$' };
}

function collectSafeErrorEvidence(error: unknown): {
  codes: Set<string>;
  identifiers: Set<string>;
} {
  const codes = new Set<string>();
  const identifiers = new Set<string>();
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== 'object') break;
    const record = current as Record<string, unknown>;
    for (const key of ['code', 'sqlState', 'sqlstate']) {
      if (typeof record[key] === 'string') codes.add(record[key]);
    }
    for (const key of ['constraint', 'constraintName']) {
      if (typeof record[key] === 'string') identifiers.add(record[key]);
    }
    const target = record.target;
    if (typeof target === 'string') identifiers.add(target);
    if (Array.isArray(target)) {
      for (const value of target) {
        if (typeof value === 'string') identifiers.add(value);
      }
    }
    current = record.cause ?? record.meta;
  }
  return { codes, identifiers };
}
