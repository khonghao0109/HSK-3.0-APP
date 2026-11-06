-- TL-112 / Q120: at most one in-progress ExamAttempt per (user, test).
-- ExamService serializes starters with "User" FOR NO KEY UPDATE; this partial
-- unique index is the database backstop for every other writer (SQL operations,
-- scripts, future code). Prisma 5 cannot express a partial index, so it lives
-- here only and the predicate is documented in the runbook (mục 24).
-- Prisma owns the migration transaction: no explicit BEGIN/COMMIT (H.11a).

-- SHARE blocks concurrent inserts/updates between preflight and index build.
LOCK TABLE "ExamAttempt" IN SHARE MODE;

DO $$
DECLARE
  duplicate_pairs INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_pairs
  FROM (
    SELECT "userId", "testId"
    FROM "ExamAttempt"
    WHERE "status" = 'in_progress'
    GROUP BY "userId", "testId"
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_pairs > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'In-progress ExamAttempt uniqueness preflight failed: %s (user, test) pair(s) with more than one in-progress attempt.',
        duplicate_pairs
      ),
      HINT = 'Time out or invalidate the older attempts through a reviewed data repair before deploying.';
  END IF;
END
$$;

CREATE UNIQUE INDEX "ExamAttempt_one_in_progress_per_user_test"
  ON "ExamAttempt" ("userId", "testId")
  WHERE "status" = 'in_progress';
