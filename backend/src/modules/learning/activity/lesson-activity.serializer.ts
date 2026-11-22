import {
  projectPublicExerciseMedia,
  type PublicExerciseMedia,
} from '../public-exercise.policy';

/**
 * Q-G9: the authored answer revealed to the learner, only after a wrong
 * attempt. Shape mirrors the scorer's `authoritativeAnswer` per type; matching
 * has no answer key (it is structural) and never appears here.
 */
export type LessonCorrectAnswer =
  | { optionId: string }
  | { acceptedTexts: string[]; caseSensitive: boolean }
  | { tokenIds: string[] };

export type LessonAttemptSummary = {
  attemptId: number;
  exerciseId: number;
  attemptNumber: number;
  isCorrect: boolean | null;
  score: number | null;
  durationSeconds: number | null;
  exerciseVersion: number;
  feedbackVersion: string | null;
  explanation: string | null;
  media: PublicExerciseMedia | null;
  submittedAt: Date | null;
  /** Present only on a wrong attempt; omitted (no key) otherwise. */
  correctAnswer?: LessonCorrectAnswer;
};

export function serializeLessonAttempt(attempt: {
  id: number;
  exerciseId: number;
  attemptNumber: number;
  isCorrect: boolean | null;
  score: number | null;
  durationSeconds: number | null;
  exerciseVersion: number;
  feedbackVersion: string | null;
  submittedAt: Date | null;
  contentSnapshot?: unknown;
  answer?: unknown;
  userId?: number;
  detailJson?: unknown;
}): LessonAttemptSummary {
  const correctAnswer = readSnapshotCorrectAnswer(
    attempt.contentSnapshot,
    attempt.isCorrect,
  );
  return {
    attemptId: attempt.id,
    exerciseId: attempt.exerciseId,
    attemptNumber: attempt.attemptNumber,
    isCorrect: attempt.isCorrect,
    score: attempt.score,
    durationSeconds: attempt.durationSeconds,
    exerciseVersion: attempt.exerciseVersion,
    feedbackVersion: attempt.feedbackVersion,
    explanation: readSnapshotExplanation(attempt.contentSnapshot),
    media: readSnapshotMedia(attempt.contentSnapshot),
    submittedAt: attempt.submittedAt,
    // Omit the key entirely when there is nothing safe to reveal.
    ...(correctAnswer === undefined ? {} : { correctAnswer }),
  };
}

/**
 * Reveals the authored answer from the immutable snapshot, only for a wrong
 * attempt. Reads the same `authoritativeAnswer` the scorer graded against, so
 * the revealed answer cannot drift from what was marked. Any missing or
 * malformed shape yields `undefined` (no key) rather than throwing — a replay
 * of an old attempt must never 500.
 */
function readSnapshotCorrectAnswer(
  snapshot: unknown,
  isCorrect: boolean | null,
): LessonCorrectAnswer | undefined {
  if (isCorrect !== false) return undefined;
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot)
  ) {
    return undefined;
  }
  const snap = snapshot as Record<string, unknown>;
  const answer = snap.authoritativeAnswer;
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
    return undefined;
  }
  const value = answer as Record<string, unknown>;
  switch (snap.type) {
    case 'mcq':
    case 'listening_choice':
      return typeof value.optionId === 'string'
        ? { optionId: value.optionId }
        : undefined;
    case 'fill_blank':
      return isStringArray(value.acceptedTexts)
        ? {
            acceptedTexts: value.acceptedTexts,
            caseSensitive: value.caseSensitive === true,
          }
        : undefined;
    case 'arrange_sentence':
      return isStringArray(value.tokenIds)
        ? { tokenIds: value.tokenIds }
        : undefined;
    // matching has no answer key; speaking_repeat never reaches a learner.
    default:
      return undefined;
  }
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function readSnapshotMedia(snapshot: unknown): PublicExerciseMedia | null {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot)
  ) {
    return null;
  }
  const value = snapshot as Record<string, unknown>;
  return projectPublicExerciseMedia(
    typeof value.type === 'string' ? value.type : '',
    value.media,
  );
}

function readSnapshotExplanation(snapshot: unknown): string | null {
  if (
    snapshot === null ||
    typeof snapshot !== 'object' ||
    Array.isArray(snapshot)
  ) {
    return null;
  }
  const explanation = (snapshot as Record<string, unknown>).explanation;
  return typeof explanation === 'string' ? explanation : null;
}
