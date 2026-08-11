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
  submittedAt: Date | null;
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
    submittedAt: attempt.submittedAt,
  };
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
