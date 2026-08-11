import { ExerciseType } from '@prisma/client';

import { POSTGRESQL_INT4_MAX } from '../constants/database.constants';
import { canonicalJson } from '../utils/canonical-json';

export const LESSON_EXERCISE_AUTHORING_LIMITS = {
  maxStringLength: 4_096,
  maxArrayLength: 100,
  maxJsonBytes: 65_536,
  maxDepth: 8,
} as const;

export const LESSON_EXERCISE_ORDER_INDEX_LIMITS = {
  min: 1,
  max: 1_000_000,
} as const;

export type LessonExerciseAuthoringMode = 'draft' | 'publish';

export type LessonExerciseAuthoringValue = {
  type: ExerciseType;
  prompt: string;
  content: Record<string, unknown>;
  answer: Record<string, unknown>;
  explanation?: string | null;
  mediaId?: number | null;
};

const SUPPORTED_TYPES = new Set<string>(Object.values(ExerciseType));
const PUBLISHABLE_TYPES = new Set<ExerciseType>([
  ExerciseType.mcq,
  ExerciseType.listening_choice,
  ExerciseType.fill_blank,
  ExerciseType.arrange_sentence,
]);

export class LessonExerciseAuthoringValidationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string) {
    const safePath = sanitizePath(path);
    super(
      `LessonExercise authoring validation failed (${code}) at ${safePath}.`,
    );
    this.name = 'LessonExerciseAuthoringValidationError';
    this.code = code;
    this.path = safePath;
  }
}

export function normalizeLessonExerciseText(value: string): string {
  return value.normalize('NFKC');
}

export function isLessonExerciseTypePublishable(type: ExerciseType): boolean {
  return PUBLISHABLE_TYPES.has(type);
}

export function validateLessonExerciseAuthoring(
  input: unknown,
  mode: LessonExerciseAuthoringMode,
): LessonExerciseAuthoringValue {
  assertGlobalBounds(input);
  const record = requireRecord(input, '$');
  assertAllowedKeys(record, [
    'type',
    'prompt',
    'content',
    'answer',
    'explanation',
    'mediaId',
  ]);
  for (const field of ['type', 'prompt', 'content', 'answer']) {
    if (!(field in record)) fail('required_field', field);
  }

  if (typeof record.type !== 'string' || !SUPPORTED_TYPES.has(record.type)) {
    fail('invalid_exercise_type', 'type');
  }
  const type = record.type as ExerciseType;
  if (mode === 'publish' && !isLessonExerciseTypePublishable(type)) {
    fail('unsupported_publish_type', 'type');
  }

  const prompt = requireHumanText(record.prompt, 'prompt');
  const explanation =
    record.explanation === undefined || record.explanation === null
      ? record.explanation
      : requireHumanText(record.explanation, 'explanation');
  const mediaId = readMediaId(record.mediaId, type, mode);

  let content: Record<string, unknown>;
  let answer: Record<string, unknown>;
  switch (type) {
    case ExerciseType.mcq:
    case ExerciseType.listening_choice: {
      ({ content, answer } = validateChoice(record.content, record.answer));
      break;
    }
    case ExerciseType.fill_blank: {
      ({ content, answer } = validateFillBlank(record.content, record.answer));
      break;
    }
    case ExerciseType.arrange_sentence: {
      ({ content, answer } = validateArrange(record.content, record.answer));
      break;
    }
    case ExerciseType.speaking_repeat: {
      const speakingContent = requireRecord(record.content, 'content');
      answer = requireRecord(record.answer, 'answer');
      assertAllowedKeys(speakingContent, ['referenceText'], 'content');
      assertAllowedKeys(answer, [], 'answer');
      content =
        speakingContent.referenceText === undefined
          ? {}
          : {
              referenceText: requireHumanText(
                speakingContent.referenceText,
                'content.referenceText',
              ),
            };
      break;
    }
  }

  const result: LessonExerciseAuthoringValue = {
    type,
    prompt,
    content,
    answer,
  };
  if (explanation !== undefined) result.explanation = explanation;
  if (mediaId !== undefined) result.mediaId = mediaId;
  assertPayloadBytes(result);
  return result;
}

function validateChoice(
  rawContent: unknown,
  rawAnswer: unknown,
): Pick<LessonExerciseAuthoringValue, 'content' | 'answer'> {
  const content = requireRecord(rawContent, 'content');
  assertAllowedKeys(content, ['options'], 'content');
  const options = requireArray(content.options, 'content.options', 2);
  const ids = new Set<string>();
  const canonicalOptions = options.map((option, index) => {
    const path = `content.options[${index}]`;
    const record = requireRecord(option, path);
    assertAllowedKeys(record, ['id', 'text'], path);
    const id = requireStableId(record.id, `${path}.id`);
    if (ids.has(id)) fail('duplicate_stable_id', `${path}.id`);
    ids.add(id);
    return {
      id,
      text: requireHumanText(record.text, `${path}.text`),
    };
  });

  const answer = requireRecord(rawAnswer, 'answer');
  assertAllowedKeys(answer, ['optionId'], 'answer');
  const optionId = requireStableId(answer.optionId, 'answer.optionId');
  if (!ids.has(optionId)) {
    fail('authoritative_option_not_found', 'answer.optionId');
  }
  return {
    content: { options: canonicalOptions },
    answer: { optionId },
  };
}

function validateFillBlank(
  rawContent: unknown,
  rawAnswer: unknown,
): Pick<LessonExerciseAuthoringValue, 'content' | 'answer'> {
  const content = requireRecord(rawContent, 'content');
  assertAllowedKeys(content, [], 'content');
  const answer = requireRecord(rawAnswer, 'answer');
  assertAllowedKeys(answer, ['acceptedTexts', 'caseSensitive'], 'answer');
  const accepted = requireArray(
    answer.acceptedTexts,
    'answer.acceptedTexts',
    1,
  );
  if (accepted.length === 0) {
    fail('accepted_texts_required', 'answer.acceptedTexts');
  }
  const acceptedTexts = accepted.map((value, index) =>
    requireFillBlankText(value, `answer.acceptedTexts[${index}]`),
  );
  if (
    answer.caseSensitive !== undefined &&
    typeof answer.caseSensitive !== 'boolean'
  ) {
    fail('boolean_required', 'answer.caseSensitive');
  }
  return {
    content: {},
    answer: {
      acceptedTexts,
      ...(answer.caseSensitive === undefined
        ? {}
        : { caseSensitive: answer.caseSensitive }),
    },
  };
}

function validateArrange(
  rawContent: unknown,
  rawAnswer: unknown,
): Pick<LessonExerciseAuthoringValue, 'content' | 'answer'> {
  const content = requireRecord(rawContent, 'content');
  assertAllowedKeys(content, ['tokens'], 'content');
  const tokens = requireArray(content.tokens, 'content.tokens', 2);
  const ids = new Set<string>();
  const canonicalTokens = tokens.map((token, index) => {
    const path = `content.tokens[${index}]`;
    const record = requireRecord(token, path);
    assertAllowedKeys(record, ['id', 'text'], path);
    const id = requireStableId(record.id, `${path}.id`);
    if (ids.has(id)) fail('duplicate_stable_id', `${path}.id`);
    ids.add(id);
    return {
      id,
      text: requireHumanText(record.text, `${path}.text`),
    };
  });

  const answer = requireRecord(rawAnswer, 'answer');
  assertAllowedKeys(answer, ['tokenIds'], 'answer');
  const rawTokenIds = requireArray(answer.tokenIds, 'answer.tokenIds', 1);
  const tokenIds = rawTokenIds.map((value, index) =>
    requireStableId(value, `answer.tokenIds[${index}]`),
  );
  if (
    tokenIds.length !== canonicalTokens.length ||
    new Set(tokenIds).size !== tokenIds.length ||
    tokenIds.some((id) => !ids.has(id))
  ) {
    fail('invalid_token_set', 'answer.tokenIds');
  }
  return {
    content: { tokens: canonicalTokens },
    answer: { tokenIds },
  };
}

function readMediaId(
  value: unknown,
  type: ExerciseType,
  mode: LessonExerciseAuthoringMode,
): number | null | undefined {
  if (type !== ExerciseType.listening_choice) {
    if (value !== undefined && value !== null)
      fail('media_not_allowed', 'mediaId');
    return value === null ? null : undefined;
  }
  if (value === undefined || value === null) {
    if (mode === 'publish') fail('media_required', 'mediaId');
    return value === null ? null : undefined;
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > POSTGRESQL_INT4_MAX
  ) {
    fail('positive_safe_integer_required', 'mediaId');
  }
  return value as number;
}

function assertGlobalBounds(value: unknown): void {
  if (jsonDepth(value) > LESSON_EXERCISE_AUTHORING_LIMITS.maxDepth) {
    fail('max_depth_exceeded', '$');
  }
  assertPayloadBytes(value);
}

function assertPayloadBytes(value: unknown): void {
  let serialized: string;
  try {
    serialized = canonicalJson(value);
  } catch {
    fail('invalid_json', '$');
  }
  if (
    Buffer.byteLength(serialized, 'utf8') >
    LESSON_EXERCISE_AUTHORING_LIMITS.maxJsonBytes
  ) {
    fail('payload_too_large', '$');
  }
}

function jsonDepth(value: unknown): number {
  if (Array.isArray(value)) {
    return 1 + Math.max(0, ...value.map(jsonDepth));
  }
  if (isPlainRecord(value)) {
    return 1 + Math.max(0, ...Object.values(value).map(jsonDepth));
  }
  return 0;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) fail('object_required', path);
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowed: string[],
  path = '',
): void {
  const allowedSet = new Set(allowed);
  const hasUnknown = Object.keys(record).some((key) => !allowedSet.has(key));
  if (hasUnknown) {
    fail('unknown_field', path ? `${path}.$unknown` : '$.$unknown');
  }
}

function requireArray(
  value: unknown,
  path: string,
  minimum: number,
): unknown[] {
  if (!Array.isArray(value)) {
    if (minimum > 0 && path === 'answer.acceptedTexts') {
      fail('accepted_texts_required', path);
    }
    fail('array_required', path);
  }
  if (value.length < minimum) {
    if (path === 'answer.acceptedTexts') fail('accepted_texts_required', path);
    fail('array_too_small', path);
  }
  if (value.length > LESSON_EXERCISE_AUTHORING_LIMITS.maxArrayLength) {
    fail('array_too_large', path);
  }
  return value;
}

function requireHumanText(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('string_required', path);
  const normalized = normalizeLessonExerciseText(value).trim();
  if (normalized.length === 0) fail('non_empty_string_required', path);
  if (normalized.length > LESSON_EXERCISE_AUTHORING_LIMITS.maxStringLength) {
    fail('string_too_long', path);
  }
  return normalized;
}

function requireFillBlankText(value: unknown, path: string): string {
  return requireHumanText(value, path).replace(/\s+/gu, ' ');
}

function requireStableId(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('invalid_stable_id', path);
  const normalized = normalizeLessonExerciseText(value);
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    /\s/u.test(normalized) ||
    !/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u.test(normalized)
  ) {
    fail('invalid_stable_id', path);
  }
  return normalized;
}

function sanitizePath(path: string): string {
  const safe = path.replace(/[^A-Za-z0-9.$[\]]/gu, '');
  return safe.length > 0 ? safe : '$';
}

function fail(code: string, path: string): never {
  throw new LessonExerciseAuthoringValidationError(code, path);
}
