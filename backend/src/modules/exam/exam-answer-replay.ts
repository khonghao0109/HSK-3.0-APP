import type { Prisma } from '@prisma/client';

/**
 * F6 / TL-123: the append-only `autosaved` event is the replay ledger. When a
 * unique-key conflict forces `saveAnswer` to re-read committed state, an
 * existing event for the same idempotency key with a different question or body
 * is a *reused key*, not a version conflict; only a genuinely new request can
 * fall through to the optimistic-version comparison.
 */
export type ExamAnswerEventView = {
  type: string;
  metadata: Prisma.JsonValue;
} | null;

type ExamAnswerEventMetadata = {
  questionKey?: unknown;
  bodySha256?: unknown;
};

export function isSameExamAnswerRequest(
  event: ExamAnswerEventView,
  questionKey: string,
  bodySha256: string | null,
): boolean {
  if (event === null || bodySha256 === null || event.type !== 'autosaved') {
    return false;
  }
  const metadata = event.metadata as ExamAnswerEventMetadata | null;
  return (
    metadata?.questionKey === questionKey && metadata.bodySha256 === bodySha256
  );
}

export type RecoveredAnswerConflict =
  | 'replay'
  | 'key_reused'
  | 'version_conflict';

export function decideRecoveredAnswerConflict(input: {
  event: ExamAnswerEventView;
  questionKey: string;
  bodySha256: string | null;
  rowExists: boolean;
}): RecoveredAnswerConflict {
  if (input.event === null) return 'version_conflict';
  if (
    !isSameExamAnswerRequest(input.event, input.questionKey, input.bodySha256)
  ) {
    return 'key_reused';
  }
  return input.rowExists ? 'replay' : 'version_conflict';
}
