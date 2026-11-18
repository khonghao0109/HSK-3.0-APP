import { ContentStatus, type Prisma } from '@prisma/client';

/**
 * Q119 / TL-111: a learner may start a test when it is published, not
 * soft-deleted, and inside its optional availability window. The learner's
 * level is deliberately not part of this predicate.
 */
export type ExamTestVisibility = {
  status: ContentStatus;
  deletedAt: Date | null;
  availableFrom: Date | null;
  availableTo: Date | null;
};

/** `availableFrom` is inclusive, `availableTo` is exclusive. */
export function isExamTestVisible(
  test: ExamTestVisibility,
  now: Date,
): boolean {
  if (test.status !== ContentStatus.published) return false;
  if (test.deletedAt !== null) return false;
  if (
    test.availableFrom !== null &&
    test.availableFrom.getTime() > now.getTime()
  ) {
    return false;
  }
  if (
    test.availableTo !== null &&
    test.availableTo.getTime() <= now.getTime()
  ) {
    return false;
  }
  return true;
}

/**
 * M4.5 B1: the same predicate as `isExamTestVisible`, as a Prisma filter so the
 * list stays a fixed number of queries instead of loading every row and
 * filtering it in memory. Both must stay in sync; the e2e visibility cases
 * (`backend/test/exam-list.e2e-spec.ts`) pin the SQL version to the predicate.
 */
export function visibleExamTestWhere(now: Date): Prisma.TestWhereInput {
  return {
    status: ContentStatus.published,
    deletedAt: null,
    AND: [
      { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
      { OR: [{ availableTo: null }, { availableTo: { gt: now } }] },
    ],
  };
}
