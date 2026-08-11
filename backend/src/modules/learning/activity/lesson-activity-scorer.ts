import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ExerciseType } from '@prisma/client';

import {
  LessonExerciseAuthoringValidationError,
  normalizeLessonExerciseText,
  validateLessonExerciseAuthoring,
} from '../../../common/validation/lesson-exercise-authoring.validator';

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
  if (input.type === ExerciseType.speaking_repeat) {
    throw new UnprocessableEntityException(
      'speaking_repeat is unsupported in Lesson Activity V1.',
    );
  }

  let authored: ReturnType<typeof validateLessonExerciseAuthoring>;
  try {
    authored = validateLessonExerciseAuthoring(
      {
        type: input.type,
        prompt: 'Runtime scoring contract',
        content: input.content,
        answer: input.authoritativeAnswer,
      },
      'draft',
    );
  } catch (error) {
    if (error instanceof LessonExerciseAuthoringValidationError) {
      throw invalidAuthoring();
    }
    throw error;
  }

  let isCorrect: boolean;
  switch (authored.type) {
    case ExerciseType.mcq:
    case ExerciseType.listening_choice:
      isCorrect = scoreChoice(
        authored.content,
        authored.answer,
        input.submittedAnswer,
      );
      break;
    case ExerciseType.fill_blank:
      isCorrect = scoreFillBlank(authored.answer, input.submittedAnswer);
      break;
    case ExerciseType.arrange_sentence:
      isCorrect = scoreArrangeSentence(
        authored.content,
        authored.answer,
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
  content: Record<string, unknown>,
  authoritativeAnswer: Record<string, unknown>,
  submittedAnswer: unknown,
): boolean {
  const options = content.options as Array<{ id: string; text: string }>;
  const optionIds = options.map((option) => option.id);
  const correctOptionId = authoritativeAnswer.optionId as string;
  const submitted = requireClientRecord(submittedAnswer);
  if (!hasExactKeys(submitted, ['optionId'])) throw invalidClientAnswer();
  const submittedOptionId = requireClientStableId(submitted.optionId);
  if (!optionIds.includes(submittedOptionId)) throw invalidClientAnswer();
  return submittedOptionId === correctOptionId;
}

function scoreFillBlank(
  authoritativeAnswer: Record<string, unknown>,
  submittedAnswer: unknown,
): boolean {
  const caseSensitive = authoritativeAnswer.caseSensitive === true;
  const acceptedTexts = authoritativeAnswer.acceptedTexts as string[];
  const normalizedAccepted = acceptedTexts.map((value) =>
    normalizeFillBlank(value, caseSensitive),
  );
  const submitted = requireClientRecord(submittedAnswer);
  if (!hasExactKeys(submitted, ['text'])) throw invalidClientAnswer();
  const normalizedSubmitted = normalizeFillBlank(
    requireClientText(submitted.text),
    caseSensitive,
  );
  return normalizedAccepted.includes(normalizedSubmitted);
}

function scoreArrangeSentence(
  content: Record<string, unknown>,
  authoritativeAnswer: Record<string, unknown>,
  submittedAnswer: unknown,
): boolean {
  const tokenIds = (content.tokens as Array<{ id: string; text: string }>).map(
    (token) => token.id,
  );
  const correctTokenIds = authoritativeAnswer.tokenIds as string[];
  const submitted = requireClientRecord(submittedAnswer);
  if (!hasExactKeys(submitted, ['tokenIds'])) throw invalidClientAnswer();
  if (!Array.isArray(submitted.tokenIds) || submitted.tokenIds.length === 0) {
    throw invalidClientAnswer();
  }
  const submittedTokenIds = submitted.tokenIds.map(requireClientStableId);
  if (!isExactTokenSet(submittedTokenIds, tokenIds)) {
    throw invalidClientAnswer();
  }
  return submittedTokenIds.every(
    (tokenId, index) => tokenId === correctTokenIds[index],
  );
}

function normalizeFillBlank(value: string, caseSensitive: boolean): string {
  const normalized = normalizeLessonExerciseText(value)
    .trim()
    .replace(/\s+/gu, ' ');
  return caseSensitive ? normalized : normalized.toLowerCase();
}

function isExactTokenSet(candidate: string[], expected: string[]): boolean {
  return (
    candidate.length === expected.length &&
    new Set(candidate).size === candidate.length &&
    candidate.every((tokenId) => expected.includes(tokenId))
  );
}

function requireClientRecord(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw invalidClientAnswer();
  }
  return value as Record<string, unknown>;
}

function requireClientText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidClientAnswer();
  }
  return value;
}

function requireClientStableId(value: unknown): string {
  if (typeof value !== 'string') throw invalidClientAnswer();
  const normalized = normalizeLessonExerciseText(value);
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    /\s/u.test(normalized) ||
    !/^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u.test(normalized)
  ) {
    throw invalidClientAnswer();
  }
  return normalized;
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
