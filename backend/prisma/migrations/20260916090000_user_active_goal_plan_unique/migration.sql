-- At most one active UserGoal and one active LearningPlan per user (C-04).
-- OnboardingService already serializes writers with User FOR UPDATE; these
-- partial unique indexes are the database backstop for any other writer.
-- Prisma owns the migration transaction: no explicit BEGIN/COMMIT (H.11a).

-- SHARE blocks concurrent inserts/updates between preflight and index build.
LOCK TABLE "UserGoal" IN SHARE MODE;
LOCK TABLE "LearningPlan" IN SHARE MODE;

DO $$
DECLARE
  duplicate_goal_users INTEGER;
  duplicate_plan_users INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_goal_users
  FROM (
    SELECT "userId"
    FROM "UserGoal"
    WHERE "isActive" = true
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) duplicates;

  SELECT COUNT(*) INTO duplicate_plan_users
  FROM (
    SELECT "userId"
    FROM "LearningPlan"
    WHERE "status" = 'active'
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_goal_users > 0 OR duplicate_plan_users > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'Active goal/plan uniqueness preflight failed: %s user(s) with multiple active goals, %s user(s) with multiple active learning plans.',
        duplicate_goal_users,
        duplicate_plan_users
      ),
      HINT = 'Deactivate or cancel the older rows through a reviewed data repair before deploying.';
  END IF;
END
$$;

CREATE UNIQUE INDEX "UserGoal_userId_active_key"
  ON "UserGoal" ("userId")
  WHERE "isActive" = true;

CREATE UNIQUE INDEX "LearningPlan_userId_active_key"
  ON "LearningPlan" ("userId")
  WHERE "status" = 'active';
