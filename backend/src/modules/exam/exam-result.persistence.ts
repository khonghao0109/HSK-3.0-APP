import { InternalServerErrorException } from '@nestjs/common';
import { ExamAttemptStatus, type Prisma } from '@prisma/client';

import {
  EXAM_SCORING_VERSION,
  ExamScoringError,
  scoreExamAttempt,
  type ExamScoringResult,
  type ExamScoringTag,
} from './exam-scoring';
import { readExamSnapshotPayload } from './exam-snapshot.reader';

/**
 * Fields of the locked attempt row `ensureAttemptResult` needs. The caller has
 * already selected them while holding the row lock.
 */
export type ExamResultAttempt = {
  id: number;
  userId: number;
  testId: number;
  status: ExamAttemptStatus;
  /**
   * `ExamAttempt.scoringVersion` — the authoring/config version frozen when the
   * attempt started, recorded in the breakdown next to the grading version.
   */
  scoringVersion: string;
};

export type EnsureAttemptResultOutcome =
  | { kind: 'existing'; resultId: number }
  | { kind: 'created'; resultId: number }
  | { kind: 'scoring_failed'; error: ExamScoringError };

/**
 * M4.3 / TL-163: creates the single `Result` row of a committed exam attempt.
 *
 * Preconditions:
 * 1. the caller already holds `lockAttempt` FOR UPDATE on this attempt row. The
 *    row lock is what makes the read-first check safe (two submit writers
 *    serialize on the attempt, so the second one observes the first one's
 *    Result and writes nothing); this function cannot verify the lock itself.
 * 2. `attempt.status` is `submitted` or `timed_out`. This one IS asserted below:
 *    an open attempt would be rejected by the `Result_attempt_integrity` trigger
 *    anyway, so failing here turns a data bug into a clear programming error.
 *
 * A unique conflict from a writer that bypassed the lock is not caught here —
 * the whole transaction rolls back and the retry in `submitAttempt` re-reads the
 * committed winner.
 *
 * `awardedBand` is always null in A2 (Q145), so the insert skips the band
 * trigger's `Test FOR SHARE` branch and only takes the `FOR KEY SHARE` locks of
 * the `Result_testId_fkey` and `Result_userId_fkey` foreign keys (Test, User).
 */
export async function ensureAttemptResult(
  tx: Prisma.TransactionClient,
  attempt: ExamResultAttempt,
  now: Date,
): Promise<EnsureAttemptResultOutcome> {
  assertTerminalAttempt(attempt);

  const existing = await tx.result.findUnique({
    where: { attemptId: attempt.id },
    select: { id: true },
  });
  if (existing !== null) return { kind: 'existing', resultId: existing.id };

  const snapshot = await tx.examAttemptSnapshot.findUnique({
    where: { attemptId: attempt.id },
    select: { payload: true, contentHash: true },
  });
  if (snapshot === null) {
    throw new InternalServerErrorException('Exam attempt snapshot is missing.');
  }
  const payload = readExamSnapshotPayload(snapshot.payload);

  const answers = await loadExamAnswers(tx, attempt.id);
  const tagsByQuestionId = await loadQuestionTags(tx, payload);

  let scoring: ExamScoringResult;
  try {
    scoring = scoreExamAttempt({
      payload,
      answers,
      tagsByQuestionId,
      passScore: payload.test.passScore,
    });
  } catch (error: unknown) {
    // Grading fails closed: an unknown answer shape is a data bug, so the
    // submit still commits but no Result is written (A3 grades lazily).
    if (error instanceof ExamScoringError) {
      return { kind: 'scoring_failed', error };
    }
    throw error;
  }

  const created = await tx.result.create({
    data: {
      userId: attempt.userId,
      testId: attempt.testId,
      attemptId: attempt.id,
      score: scoring.score,
      maxScore: scoring.maxScore,
      passed: scoring.passed,
      awardedBand: null,
      scoringVersion: EXAM_SCORING_VERSION,
      publishedAt: now,
      detailJson: buildDetailJson({
        attemptScoringVersion: attempt.scoringVersion,
        snapshotContentHash: snapshot.contentHash,
        scoring,
      }),
      skillScores: {
        create: scoring.skills.map((skill) => ({
          skill: skill.skill,
          score: skill.score,
          total: skill.total,
        })),
      },
    },
    select: { id: true },
  });

  // Q155: the attempt keeps the score only; per-answer grading is not stored on
  // `ExamAnswer`.
  await tx.examAttempt.update({
    where: { id: attempt.id },
    data: { score: scoring.score },
  });

  return { kind: 'created', resultId: created.id };
}

function assertTerminalAttempt(attempt: ExamResultAttempt): void {
  if (
    attempt.status !== ExamAttemptStatus.submitted &&
    attempt.status !== ExamAttemptStatus.timed_out
  ) {
    throw new Error(
      `ensureAttemptResult requires a submitted or timed_out attempt (got "${attempt.status}"); the caller must lock the attempt and commit its terminal transition first.`,
    );
  }
}

/** `snapshotQuestionKey` → stored answer; a missing row or JSON null is blank. */
async function loadExamAnswers(
  tx: Prisma.TransactionClient,
  attemptId: number,
): Promise<Map<string, Prisma.JsonValue>> {
  const rows = await tx.examAnswer.findMany({
    where: { attemptId },
    select: { snapshotQuestionKey: true, answer: true },
  });
  const answers = new Map<string, Prisma.JsonValue>();
  for (const row of rows) {
    answers.set(row.snapshotQuestionKey, row.answer);
  }
  return answers;
}

/**
 * Q154: weak areas use the tags that are live at grading time, and only for the
 * question ids frozen in the snapshot — a question deleted from the bank after
 * the attempt must not change the breakdown's tag view.
 */
async function loadQuestionTags(
  tx: Prisma.TransactionClient,
  payload: ReturnType<typeof readExamSnapshotPayload>,
): Promise<Map<number, ExamScoringTag[]>> {
  const questionIds = new Set<number>();
  for (const section of payload.sections) {
    for (const group of section.groups) {
      for (const question of group.questions) {
        questionIds.add(question.questionId);
      }
    }
  }
  const tagsByQuestionId = new Map<number, ExamScoringTag[]>();
  if (questionIds.size === 0) return tagsByQuestionId;

  const rows = await tx.questionTag.findMany({
    where: { questionId: { in: [...questionIds].sort((a, b) => a - b) } },
    select: { questionId: true, tag: { select: { slug: true, name: true } } },
    orderBy: [{ questionId: 'asc' }, { tagId: 'asc' }],
  });
  for (const row of rows) {
    const tags = tagsByQuestionId.get(row.questionId) ?? [];
    tags.push({ slug: row.tag.slug, name: row.tag.name });
    tagsByQuestionId.set(row.questionId, tags);
  }
  return tagsByQuestionId;
}

/**
 * The persisted breakdown contract (Q155): counts, per-section and per-skill
 * totals, weak areas and the per-question correctness flag. It deliberately
 * carries no answer key, no explanation and no question content — the review
 * endpoint (A3/TL-165) re-reads the snapshot for that.
 */
function buildDetailJson(input: {
  attemptScoringVersion: string;
  snapshotContentHash: string;
  scoring: ExamScoringResult;
}): Prisma.InputJsonObject {
  const { attemptScoringVersion, snapshotContentHash, scoring } = input;
  return {
    schemaVersion: 1,
    attemptScoringVersion,
    snapshotContentHash,
    counts: {
      answeredCount: scoring.counts.answeredCount,
      correctCount: scoring.counts.correctCount,
      incorrectCount: scoring.counts.incorrectCount,
      unansweredCount: scoring.counts.unansweredCount,
    },
    sections: scoring.sections.map((section) => ({
      key: section.key,
      skill: section.skill,
      questionCount: section.questionCount,
      correctCount: section.correctCount,
      score: section.score,
      maxScore: section.maxScore,
    })),
    weakAreas: scoring.weakAreas.map((area) => ({
      slug: area.slug,
      name: area.name,
      answered: area.answered,
      correct: area.correct,
      accuracy: area.accuracy,
      level: area.level,
    })),
    questions: scoring.questions.map((question) => ({
      key: question.key,
      isCorrect: question.isCorrect,
    })),
  };
}
