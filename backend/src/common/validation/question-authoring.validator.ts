import { QuestionType, Skill } from '@prisma/client';

import { POSTGRESQL_INT4_MAX } from '../constants/database.constants';
import { canonicalJson } from '../utils/canonical-json';

import {
  LESSON_EXERCISE_AUTHORING_LIMITS,
  LessonExerciseAuthoringValidationError,
  normalizeLessonExerciseText,
  validateArrange,
  validateChoice,
  validateFillBlank,
} from './lesson-exercise-authoring.validator';

/**
 * M4.1a (TL-78): validator for the question bank's four objective formats.
 * The mcq/fill_blank/arrange_sentence shapes reuse the LessonExercise
 * validators unchanged; true_false is question-bank specific. Article mapping
 * (TL-78): `content` is the prompt, `answers` is the validated answer content,
 * `correctAnswer` is the validated authoritative answer.
 */
export const QUESTION_AUTHORING_LIMITS = {
  maxStringLength: LESSON_EXERCISE_AUTHORING_LIMITS.maxStringLength,
  maxObjectiveLength: 500,
  maxArrayLength: LESSON_EXERCISE_AUTHORING_LIMITS.maxArrayLength,
  maxJsonBytes: LESSON_EXERCISE_AUTHORING_LIMITS.maxJsonBytes,
  maxDepth: LESSON_EXERCISE_AUTHORING_LIMITS.maxDepth,
  maxTags: 10,
  maxTagNameLength: 40,
} as const;

export const QUESTION_AUTHORING_TYPES = [
  QuestionType.mcq,
  QuestionType.true_false,
  QuestionType.fill_blank,
  QuestionType.arrange_sentence,
] as const;

export type QuestionAuthoringType = (typeof QUESTION_AUTHORING_TYPES)[number];

const SUPPORTED_TYPES = new Set<string>(QUESTION_AUTHORING_TYPES);
const SUPPORTED_SKILLS = new Set<string>(Object.values(Skill));

export type QuestionAuthoringValue = {
  type: QuestionAuthoringType;
  skill: Skill;
  levelId: number;
  /** Question.content: the prompt, trimmed, 1–4096 characters. */
  content: string;
  /** Question.answers: validated answer content (options / tokens / {}). */
  answers: Record<string, unknown>;
  /** Question.correctAnswer: validated authoritative answer. */
  correctAnswer: Record<string, unknown>;
  explanation: string | null;
  objective: string | null;
  difficulty: number | null;
  audioId: number | null;
  imageId: number | null;
  /** Normalized slugs, deduplicated and sorted (TL-79). */
  tags: string[];
};

/** Snapshot stored on ContentRevision and hashed with canonical JSON (TL-79). */
export type QuestionSnapshot = QuestionAuthoringValue;

export const QUESTION_SNAPSHOT_FIELDS = [
  'type',
  'skill',
  'levelId',
  'content',
  'answers',
  'correctAnswer',
  'explanation',
  'objective',
  'difficulty',
  'audioId',
  'imageId',
  'tags',
] as const satisfies readonly (keyof QuestionSnapshot)[];

export class QuestionAuthoringValidationError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string) {
    const safePath = sanitizePath(path);
    super(`Question authoring validation failed (${code}) at ${safePath}.`);
    this.name = 'QuestionAuthoringValidationError';
    this.code = code;
    this.path = safePath;
  }
}

export function isQuestionAuthoringType(
  value: unknown,
): value is QuestionAuthoringType {
  return typeof value === 'string' && SUPPORTED_TYPES.has(value);
}

/**
 * Tag slug (TL-80): Vietnamese diacritics removed (đ → d), lower case,
 * words joined with `-`.
 */
export function slugifyQuestionTag(name: string): string {
  return normalizeLessonExerciseText(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/gu, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export function normalizeQuestionTagName(value: string): string {
  return normalizeLessonExerciseText(value).trim();
}

export function validateQuestionAuthoring(
  input: unknown,
): QuestionAuthoringValue {
  assertGlobalBounds(input);
  const record = requireRecord(input, '$');
  assertAllowedKeys(record, [...QUESTION_SNAPSHOT_FIELDS]);
  for (const field of [
    'type',
    'skill',
    'levelId',
    'content',
    'answers',
    'correctAnswer',
  ]) {
    if (!(field in record)) fail('required_field', field);
  }

  if (!isQuestionAuthoringType(record.type)) {
    fail('invalid_question_type', 'type');
  }
  const type = record.type;
  if (typeof record.skill !== 'string' || !SUPPORTED_SKILLS.has(record.skill)) {
    fail('invalid_skill', 'skill');
  }
  const skill = record.skill as Skill;
  const levelId = requirePositiveInt(record.levelId, 'levelId');
  const content = requireHumanText(record.content, 'content');
  const explanation = readOptionalHumanText(
    record.explanation,
    'explanation',
    QUESTION_AUTHORING_LIMITS.maxStringLength,
  );
  const objective = readOptionalHumanText(
    record.objective,
    'objective',
    QUESTION_AUTHORING_LIMITS.maxObjectiveLength,
  );
  const difficulty = readDifficulty(record.difficulty);
  const audioId = readOptionalMediaId(record.audioId, 'audioId');
  const imageId = readOptionalMediaId(record.imageId, 'imageId');
  const tags = readTags(record.tags);

  let answers: Record<string, unknown>;
  let correctAnswer: Record<string, unknown>;
  try {
    switch (type) {
      case QuestionType.mcq:
        ({ content: answers, answer: correctAnswer } = validateChoice(
          record.answers,
          record.correctAnswer,
        ));
        break;
      case QuestionType.fill_blank:
        ({ content: answers, answer: correctAnswer } = validateFillBlank(
          record.answers,
          record.correctAnswer,
        ));
        break;
      case QuestionType.arrange_sentence:
        ({ content: answers, answer: correctAnswer } = validateArrange(
          record.answers,
          record.correctAnswer,
        ));
        break;
      case QuestionType.true_false: {
        const rawAnswers = requireRecord(record.answers, 'answers');
        assertAllowedKeys(rawAnswers, [], 'answers');
        const rawCorrect = requireRecord(record.correctAnswer, 'correctAnswer');
        assertAllowedKeys(rawCorrect, ['value'], 'correctAnswer');
        if (typeof rawCorrect.value !== 'boolean') {
          fail('boolean_required', 'correctAnswer.value');
        }
        answers = {};
        correctAnswer = { value: rawCorrect.value };
        break;
      }
      default:
        // QUESTION_AUTHORING_TYPES is exhaustive; this guards future values.
        fail('invalid_question_type', 'type');
    }
  } catch (error) {
    if (error instanceof LessonExerciseAuthoringValidationError) {
      throw new QuestionAuthoringValidationError(error.code, error.path);
    }
    throw error;
  }

  const result: QuestionAuthoringValue = {
    type,
    skill,
    levelId,
    content,
    answers,
    correctAnswer,
    explanation,
    objective,
    difficulty,
    audioId,
    imageId,
    tags,
  };
  assertPayloadBytes(result);
  return result;
}

function readOptionalHumanText(
  value: unknown,
  path: string,
  maxLength: number,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('string_required', path);
  const normalized = normalizeLessonExerciseText(value).trim();
  if (normalized.length === 0) return null;
  if (normalized.length > maxLength) fail('string_too_long', path);
  return normalized;
}

function readDifficulty(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 3
  ) {
    fail('invalid_difficulty', 'difficulty');
  }
  return value as number;
}

function readOptionalMediaId(value: unknown, path: string): number | null {
  if (value === undefined || value === null) return null;
  return requirePositiveInt(value, path);
}

function requirePositiveInt(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > POSTGRESQL_INT4_MAX
  ) {
    fail('positive_safe_integer_required', path);
  }
  return value as number;
}

function readTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('array_required', 'tags');
  if (value.length > QUESTION_AUTHORING_LIMITS.maxTags) {
    fail('array_too_large', 'tags');
  }
  const slugs = new Set<string>();
  value.forEach((rawName, index) => {
    const path = `tags[${index}]`;
    if (typeof rawName !== 'string') fail('string_required', path);
    const name = normalizeLessonExerciseText(rawName).trim();
    if (name.length === 0) fail('non_empty_string_required', path);
    if (name.length > QUESTION_AUTHORING_LIMITS.maxTagNameLength) {
      fail('string_too_long', path);
    }
    const slug = slugifyQuestionTag(name);
    if (slug.length === 0) fail('invalid_tag', path);
    if (slugs.has(slug)) fail('duplicate_tag', path);
    slugs.add(slug);
  });
  return [...slugs].sort();
}

function assertGlobalBounds(value: unknown): void {
  if (
    boundedJsonDepth(value, QUESTION_AUTHORING_LIMITS.maxDepth) >
    QUESTION_AUTHORING_LIMITS.maxDepth
  ) {
    fail('max_depth_exceeded', '$');
  }
  assertPayloadBytes(value);
}

function assertPayloadBytes(value: unknown): void {
  let serialized: string;
  try {
    serialized = canonicalJson(value, QUESTION_AUTHORING_LIMITS.maxDepth);
  } catch {
    fail('invalid_json', '$');
  }
  if (
    Buffer.byteLength(serialized, 'utf8') >
    QUESTION_AUTHORING_LIMITS.maxJsonBytes
  ) {
    fail('payload_too_large', '$');
  }
}

// Saturates at maxDepth + 1 so adversarial payloads cannot drive the stack.
function boundedJsonDepth(value: unknown, remainingDepth: number): number {
  const children = Array.isArray(value)
    ? value
    : isPlainRecord(value)
      ? Object.values(value)
      : null;
  if (children === null) return 0;
  if (remainingDepth <= 0) return 1;

  let deepestChild = 0;
  for (const child of children) {
    const childDepth = boundedJsonDepth(child, remainingDepth - 1);
    if (childDepth > deepestChild) deepestChild = childDepth;
  }
  return 1 + deepestChild;
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

function requireHumanText(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('string_required', path);
  const normalized = normalizeLessonExerciseText(value).trim();
  if (normalized.length === 0) fail('non_empty_string_required', path);
  if (normalized.length > QUESTION_AUTHORING_LIMITS.maxStringLength) {
    fail('string_too_long', path);
  }
  return normalized;
}

function sanitizePath(path: string): string {
  const safe = path.replace(/[^A-Za-z0-9.$[\]]/gu, '');
  return safe.length > 0 ? safe : '$';
}

function fail(code: string, path: string): never {
  throw new QuestionAuthoringValidationError(code, path);
}
