import { ExamAttemptStatus, type Skill } from '@prisma/client';

/**
 * M4.5 B1 (Q209…Q214): pure rules of the learner exam list (`GET /exam/tests`).
 * Kept out of the service so the ordering/dedup/status rules are unit-tested
 * without a database, the same way `exam-eligibility.ts` carries the
 * visibility predicate.
 */

/** Q209: the Level codes of the HSK 3.0 curriculum (`Level.code`). */
export const EXAM_LEVEL_CODES = [
  'HSK1',
  'HSK2',
  'HSK3',
  'HSK4',
  'HSK5',
  'HSK6',
  'HSK7_9',
] as const;

export type ExamLevelCode = (typeof EXAM_LEVEL_CODES)[number];

/** Q211: `newest` is the default; `score` sorts by the latest attempt score. */
export const EXAM_LIST_SORTS = ['newest', 'oldest', 'score'] as const;

export type ExamListSort = (typeof EXAM_LIST_SORTS)[number];

/** Q212: the card status; `done` only when a finished attempt exists. */
export type ExamListStatus = 'not_started' | 'in_progress' | 'done';

/**
 * TL-163/Q211: the only terminal statuses the list counts as "done".
 * `invalidated` is skipped (Q213) and `in_progress` is never "done": the list
 * does not write, so an expired in-progress attempt is simply ignored here.
 */
export const EXAM_LIST_FINISHED_STATUSES = [
  ExamAttemptStatus.submitted,
  ExamAttemptStatus.timed_out,
] as const;

export type ExamListSectionRef = { skill: Skill; orderIndex: number };

/**
 * Q210: every skill of the test, in `TestSection.orderIndex` order and without
 * repeats. The card shows all of them; `skill=` matches a test when at least
 * one of its sections carries that skill.
 */
export function collectExamTestSkills(
  sections: readonly ExamListSectionRef[],
): Skill[] {
  const ordered = [...sections].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  );
  const skills: Skill[] = [];
  for (const section of ordered) {
    if (!skills.includes(section.skill)) skills.push(section.skill);
  }
  return skills;
}

/**
 * Q212/Q211: an active attempt wins over a finished one, and a test with
 * neither is `not_started`.
 */
export function deriveExamListStatus(
  hasActiveAttempt: boolean,
  hasFinishedAttempt: boolean,
): ExamListStatus {
  if (hasActiveAttempt) return 'in_progress';
  return hasFinishedAttempt ? 'done' : 'not_started';
}

export type ExamListScoreRef = {
  /** Latest finished attempt score; `null` when that attempt is not graded. */
  score: number | null;
  publishedAt: Date | null;
  testId: number;
};

function publishedAtValue(item: ExamListScoreRef): number {
  return item.publishedAt === null ? 0 : item.publishedAt.getTime();
}

/**
 * Q211: `score` is descending; a test whose latest attempt has no score sorts
 * last. Ties (and unscored rows) fall back to `newest` (publishedAt desc, then
 * id desc) so the order is deterministic and pagination is stable.
 */
export function compareExamListByScore(
  left: ExamListScoreRef,
  right: ExamListScoreRef,
): number {
  const leftScore = left.score;
  const rightScore = right.score;
  if (leftScore !== rightScore) {
    if (leftScore === null) return 1;
    if (rightScore === null) return -1;
    return rightScore - leftScore;
  }
  const leftPublished = publishedAtValue(left);
  const rightPublished = publishedAtValue(right);
  if (leftPublished !== rightPublished) return rightPublished - leftPublished;
  return right.testId - left.testId;
}

/**
 * Q211 shortcut: `sort=score` cannot be pushed into the paginated SQL query
 * because the score of the latest attempt is a different relation; the service
 * loads at most this many visible tests, sorts them in memory and then slices
 * the page. Upgrade when the visible test catalogue can exceed it (then add a
 * denormalised `Test.latestScore` column or a raw `DISTINCT ON` query).
 */
export const EXAM_LIST_SCORE_SORT_MAX = 500;

/**
 * Q213: a finished attempt is `submitted` or `timed_out`; `invalidated` is
 * skipped by the list. The guard also narrows away `in_progress` for the
 * serializer source type.
 */
export function isExamListFinishedStatus(
  status: ExamAttemptStatus,
): status is 'submitted' | 'timed_out' {
  return (
    status === ExamAttemptStatus.submitted ||
    status === ExamAttemptStatus.timed_out
  );
}
