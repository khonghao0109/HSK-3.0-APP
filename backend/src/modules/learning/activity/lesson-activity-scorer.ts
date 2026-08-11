import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ExerciseType } from '@prisma/client';

export const LESSON_ACTIVITY_SCORING_VERSION = 'lesson-activity-v1';

export type LessonActivityScore = {
  score: number;
  isCorrect: boolean;
  feedbackVersion: typeof LESSON_ACTIVITY_SCORING_VERSION;
};

export function scoreLessonExercise(input: {
  type: ExerciseType;
  content: unknown;
  authoritativeAnswer: unknown;
  submittedAnswer: unknown;
}): LessonActivityScore {
  if (input.type === 'speaking_repeat') {
    throw new UnprocessableEntityException(
      'speaking_repeat is unsupported in Lesson Activity V1.',
    );
  }

  let isCorrect: boolean;
  switch (input.type) {
    case 'mcq':
    case 'listening_choice':
      isCorrect = scoreChoice(
        input.content,
        input.authoritativeAnswer,
        input.submittedAnswer,
      );
      break;
    case 'fill_blank':
      isCorrect = scoreFillBlank(
        input.authoritativeAnswer,
        input.submittedAnswer,
      );
      break;
    case 'arrange_sentence':
      isCorrect = scoreArrangeSentence(
        input.content,
        input.authoritativeAnswer,
        input.submittedAnswer,
      );
      break;
    default:
      throw invalidAuthoring();
  }

  return {
    score: isCorrect ? 100 : 0,
    isCorrect,
    feedbackVersion: LESSON_ACTIVITY_SCORING_VERSION,
  };
}

function scoreChoice(
  content: unknown,
  authoritativeAnswer: unknown,
  submittedAnswer: unknown,
): boolean {
  const contentRecord = requireRecord(content, 'authoring');
  if (!hasExactKeys(contentRecord, ['options'])) throw invalidAuthoring();
  const options = contentRecord.options;
  if (!Array.isArray(options) || options.length < 2) throw invalidAuthoring();

  const optionIds = options.map((option) => {
    const record = requireRecord(option, 'authoring');
    if (!hasExactKeys(record, ['id', 'text'])) throw invalidAuthoring();
    const id = requireNonEmptyString(record.id, 'authoring');
    requireNonEmptyString(record.text, 'authoring');
    return id;
  });
  if (new Set(optionIds).size !== optionIds.length) throw invalidAuthoring();

  const authoritative = requireRecord(authoritativeAnswer, 'authoring');
  if (!hasExactKeys(authoritative, ['optionId'])) throw invalidAuthoring();
  const correctOptionId = requireNonEmptyString(
    authoritative.optionId,
    'authoring',
  );
  if (!optionIds.includes(correctOptionId)) throw invalidAuthoring();

  const submitted = requireRecord(submittedAnswer, 'client');
  if (!hasExactKeys(submitted, ['optionId'])) throw invalidClientAnswer();
  const submittedOptionId = requireNonEmptyString(submitted.optionId, 'client');
  if (!optionIds.includes(submittedOptionId)) throw invalidClientAnswer();
  return submittedOptionId === correctOptionId;
}

function scoreFillBlank(
  authoritativeAnswer: unknown,
  submittedAnswer: unknown,
): boolean {
  const authoritative = requireRecord(authoritativeAnswer, 'authoring');
  if (
    !hasExactKeys(authoritative, ['acceptedTexts']) &&
    !hasExactKeys(authoritative, ['acceptedTexts', 'caseSensitive'])
  ) {
    throw invalidAuthoring();
  }
  const acceptedTexts = authoritative.acceptedTexts;
  if (!Array.isArray(acceptedTexts) || acceptedTexts.length === 0) {
    throw invalidAuthoring();
  }
  if (
    authoritative.caseSensitive !== undefined &&
    typeof authoritative.caseSensitive !== 'boolean'
  ) {
    throw invalidAuthoring();
  }
  const caseSensitive = authoritative.caseSensitive === true;
  const normalizedAccepted = acceptedTexts.map((value) =>
    normalizeFillBlank(
      requireNonEmptyString(value, 'authoring'),
      caseSensitive,
    ),
  );

  const submitted = requireRecord(submittedAnswer, 'client');
  if (!hasExactKeys(submitted, ['text'])) throw invalidClientAnswer();
  const normalizedSubmitted = normalizeFillBlank(
    requireNonEmptyString(submitted.text, 'client'),
    caseSensitive,
  );
  return normalizedAccepted.includes(normalizedSubmitted);
}

function scoreArrangeSentence(
  content: unknown,
  authoritativeAnswer: unknown,
  submittedAnswer: unknown,
): boolean {
  const contentRecord = requireRecord(content, 'authoring');
  if (!hasExactKeys(contentRecord, ['tokens'])) throw invalidAuthoring();
  const tokens = contentRecord.tokens;
  if (!Array.isArray(tokens) || tokens.length < 2) throw invalidAuthoring();
  const tokenIds = tokens.map((token) => {
    const record = requireRecord(token, 'authoring');
    if (!hasExactKeys(record, ['id', 'text'])) throw invalidAuthoring();
    const id = requireNonEmptyString(record.id, 'authoring');
    requireNonEmptyString(record.text, 'authoring');
    return id;
  });
  if (new Set(tokenIds).size !== tokenIds.length) throw invalidAuthoring();

  const authoritative = requireRecord(authoritativeAnswer, 'authoring');
  if (!hasExactKeys(authoritative, ['tokenIds'])) throw invalidAuthoring();
  const correctTokenIds = requireStringArray(
    authoritative.tokenIds,
    'authoring',
  );
  if (!isExactTokenSet(correctTokenIds, tokenIds)) throw invalidAuthoring();

  const submitted = requireRecord(submittedAnswer, 'client');
  if (!hasExactKeys(submitted, ['tokenIds'])) throw invalidClientAnswer();
  const submittedTokenIds = requireStringArray(submitted.tokenIds, 'client');
  if (!isExactTokenSet(submittedTokenIds, tokenIds)) {
    throw invalidClientAnswer();
  }
  return submittedTokenIds.every(
    (tokenId, index) => tokenId === correctTokenIds[index],
  );
}

function normalizeFillBlank(value: string, caseSensitive: boolean): string {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return caseSensitive ? normalized : normalized.toLowerCase();
}

function isExactTokenSet(candidate: string[], expected: string[]): boolean {
  return (
    candidate.length === expected.length &&
    new Set(candidate).size === candidate.length &&
    candidate.every((tokenId) => expected.includes(tokenId))
  );
}

function requireStringArray(
  value: unknown,
  source: 'authoring' | 'client',
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw source === 'authoring' ? invalidAuthoring() : invalidClientAnswer();
  }
  return value.map((item) => requireNonEmptyString(item, source));
}

function requireRecord(
  value: unknown,
  source: 'authoring' | 'client',
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw source === 'authoring' ? invalidAuthoring() : invalidClientAnswer();
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(
  value: unknown,
  source: 'authoring' | 'client',
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw source === 'authoring' ? invalidAuthoring() : invalidClientAnswer();
  }
  return value;
}

function hasExactKeys(
  record: Record<string, unknown>,
  expectedKeys: string[],
): boolean {
  const actualKeys = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  return (
    actualKeys.length === expected.length &&
    actualKeys.every((key, index) => key === expected[index])
  );
}

function invalidAuthoring(): UnprocessableEntityException {
  return new UnprocessableEntityException(
    'Exercise authoring data is invalid for Lesson Activity V1.',
  );
}

function invalidClientAnswer(): BadRequestException {
  return new BadRequestException('Exercise answer payload is invalid.');
}
