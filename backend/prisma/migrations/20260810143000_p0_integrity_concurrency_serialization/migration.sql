-- P0 Integrity Concurrency & Test Safety.
-- Forward-only fix: serialize cross-table validation and prevent parent-key
-- cascades from rewriting immutable/history facts.

-- Refuse to harden over an already-invalid state. Deploy this migration while
-- application writers are paused; ALTER TABLE below also takes the required
-- relation locks before the migration commits.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "UserGoal" goal
    JOIN "Level" level ON level."id" = goal."targetLevelId"
    WHERE goal."targetBand" IS NOT NULL
      AND goal."targetBand" NOT BETWEEN level."minBand" AND level."maxBand"
  ) OR EXISTS (
    SELECT 1
    FROM "PlacementAttempt" placement
    LEFT JOIN "Level" level ON level."id" = placement."recommendedLevelId"
    WHERE placement."recommendedBand" IS NOT NULL
      AND (
        placement."recommendedLevelId" IS NULL OR
        placement."recommendedBand" NOT BETWEEN level."minBand" AND level."maxBand"
      )
  ) OR EXISTS (
    SELECT 1
    FROM "LearningPlan" plan
    JOIN "Level" level ON level."id" = plan."targetLevelId"
    WHERE plan."targetBand" IS NOT NULL
      AND plan."targetBand" NOT BETWEEN level."minBand" AND level."maxBand"
  ) OR EXISTS (
    SELECT 1
    FROM "Result" result
    JOIN "Test" test ON test."id" = result."testId"
    JOIN "Level" level ON level."id" = test."levelId"
    WHERE result."awardedBand" IS NOT NULL
      AND result."awardedBand" NOT BETWEEN level."minBand" AND level."maxBand"
  ) THEN
    RAISE EXCEPTION 'P0 concurrency hardening found an invalid curriculum band relation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ReviewEvent" event
    JOIN "ReviewCard" card ON card."id" = event."cardId"
    JOIN "ReviewSession" session ON session."id" = event."sessionId"
    WHERE event."sessionId" IS NOT NULL
      AND card."userId" <> session."userId"
  ) THEN
    RAISE EXCEPTION 'P0 concurrency hardening found cross-user ReviewEvent ownership';
  END IF;
END
$$;

-- Lock order for curriculum validation:
--   1. Test row (Result and Test paths only)
--   2. Level row
-- Other band-bearing children lock only their Level row. A Level UPDATE already
-- owns its Level row and never locks Test rows, avoiding a Level -> Test inversion.
-- Shared row locks allow concurrent child writes but serialize the rare parent
-- curriculum changes against those writes.
CREATE OR REPLACE FUNCTION "hsk_check_curriculum_band_integrity"() RETURNS trigger AS $$
DECLARE
  target_level_id INTEGER;
  expected_min_band INTEGER;
  expected_max_band INTEGER;
  invalid_row_id INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'UserGoal' THEN
    IF NEW."targetBand" IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT "minBand", "maxBand"
      INTO expected_min_band, expected_max_band
    FROM "Level"
    WHERE "id" = NEW."targetLevelId"
    FOR SHARE;
    IF NEW."targetBand" NOT BETWEEN expected_min_band AND expected_max_band THEN
      RAISE EXCEPTION 'UserGoal targetBand % is outside Level % range %..%',
        NEW."targetBand", NEW."targetLevelId", expected_min_band, expected_max_band;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'PlacementAttempt' THEN
    IF NEW."recommendedBand" IS NULL THEN
      RETURN NEW;
    END IF;
    IF NEW."recommendedLevelId" IS NULL THEN
      RAISE EXCEPTION 'PlacementAttempt recommendedBand requires recommendedLevelId';
    END IF;
    SELECT "minBand", "maxBand"
      INTO expected_min_band, expected_max_band
    FROM "Level"
    WHERE "id" = NEW."recommendedLevelId"
    FOR SHARE;
    IF NEW."recommendedBand" NOT BETWEEN expected_min_band AND expected_max_band THEN
      RAISE EXCEPTION 'PlacementAttempt recommendedBand % is outside Level % range %..%',
        NEW."recommendedBand", NEW."recommendedLevelId", expected_min_band, expected_max_band;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'LearningPlan' THEN
    IF NEW."targetBand" IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT "minBand", "maxBand"
      INTO expected_min_band, expected_max_band
    FROM "Level"
    WHERE "id" = NEW."targetLevelId"
    FOR SHARE;
    IF NEW."targetBand" NOT BETWEEN expected_min_band AND expected_max_band THEN
      RAISE EXCEPTION 'LearningPlan targetBand % is outside Level % range %..%',
        NEW."targetBand", NEW."targetLevelId", expected_min_band, expected_max_band;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'Result' THEN
    IF NEW."awardedBand" IS NULL THEN
      RETURN NEW;
    END IF;

    -- Always lock Test before Level. This prevents Test.levelId write skew.
    SELECT "levelId" INTO target_level_id
    FROM "Test"
    WHERE "id" = NEW."testId"
    FOR SHARE;

    SELECT "minBand", "maxBand"
      INTO expected_min_band, expected_max_band
    FROM "Level"
    WHERE "id" = target_level_id
    FOR SHARE;

    IF NEW."awardedBand" NOT BETWEEN expected_min_band AND expected_max_band THEN
      RAISE EXCEPTION 'Result awardedBand % is outside Test % Level range %..%',
        NEW."awardedBand", NEW."testId", expected_min_band, expected_max_band;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'Test' THEN
    -- UPDATE already owns the Test row, so Level is the next lock in the order.
    SELECT "minBand", "maxBand"
      INTO expected_min_band, expected_max_band
    FROM "Level"
    WHERE "id" = NEW."levelId"
    FOR SHARE;

    SELECT result."id" INTO invalid_row_id
    FROM "Result" result
    WHERE result."testId" = NEW."id"
      AND result."awardedBand" IS NOT NULL
      AND result."awardedBand" NOT BETWEEN expected_min_band AND expected_max_band
    LIMIT 1;
    IF invalid_row_id IS NOT NULL THEN
      RAISE EXCEPTION 'Test % Level update would invalidate Result % awardedBand', NEW."id", invalid_row_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'Level' THEN
    -- The UPDATE already owns this Level row. Child validators that started first
    -- hold FOR SHARE and make this UPDATE wait; validators that start later wait
    -- here and re-check the newly committed range.
    SELECT goal."id" INTO invalid_row_id
    FROM "UserGoal" goal
    WHERE goal."targetLevelId" = NEW."id"
      AND goal."targetBand" IS NOT NULL
      AND goal."targetBand" NOT BETWEEN NEW."minBand" AND NEW."maxBand"
    LIMIT 1;
    IF invalid_row_id IS NOT NULL THEN
      RAISE EXCEPTION 'Level % update would invalidate UserGoal % targetBand', NEW."id", invalid_row_id;
    END IF;

    SELECT placement."id" INTO invalid_row_id
    FROM "PlacementAttempt" placement
    WHERE placement."recommendedLevelId" = NEW."id"
      AND placement."recommendedBand" IS NOT NULL
      AND placement."recommendedBand" NOT BETWEEN NEW."minBand" AND NEW."maxBand"
    LIMIT 1;
    IF invalid_row_id IS NOT NULL THEN
      RAISE EXCEPTION 'Level % update would invalidate PlacementAttempt % recommendedBand', NEW."id", invalid_row_id;
    END IF;

    SELECT plan."id" INTO invalid_row_id
    FROM "LearningPlan" plan
    WHERE plan."targetLevelId" = NEW."id"
      AND plan."targetBand" IS NOT NULL
      AND plan."targetBand" NOT BETWEEN NEW."minBand" AND NEW."maxBand"
    LIMIT 1;
    IF invalid_row_id IS NOT NULL THEN
      RAISE EXCEPTION 'Level % update would invalidate LearningPlan % targetBand', NEW."id", invalid_row_id;
    END IF;

    SELECT result."id" INTO invalid_row_id
    FROM "Result" result
    JOIN "Test" test ON test."id" = result."testId"
    WHERE test."levelId" = NEW."id"
      AND result."awardedBand" IS NOT NULL
      AND result."awardedBand" NOT BETWEEN NEW."minBand" AND NEW."maxBand"
    LIMIT 1;
    IF invalid_row_id IS NOT NULL THEN
      RAISE EXCEPTION 'Level % update would invalidate Result % awardedBand', NEW."id", invalid_row_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ReviewEvent validates and locks its parents in one fixed order:
-- ReviewCard -> ReviewSession. Owner fields themselves are immutable below.
CREATE OR REPLACE FUNCTION "hsk_check_review_event_ownership"() RETURNS trigger AS $$
DECLARE
  card_user_id INTEGER;
  session_user_id INTEGER;
BEGIN
  IF TG_TABLE_NAME <> 'ReviewEvent' OR NEW."sessionId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "userId" INTO card_user_id
  FROM "ReviewCard"
  WHERE "id" = NEW."cardId"
  FOR SHARE;

  SELECT "userId" INTO session_user_id
  FROM "ReviewSession"
  WHERE "id" = NEW."sessionId"
  FOR SHARE;

  IF card_user_id <> session_user_id THEN
    RAISE EXCEPTION 'ReviewEvent card % and session % must belong to the same user',
      NEW."cardId", NEW."sessionId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "ReviewCard_event_owner_integrity" ON "ReviewCard";
DROP TRIGGER "ReviewSession_event_owner_integrity" ON "ReviewSession";

CREATE FUNCTION "hsk_reject_review_owner_change"() RETURNS trigger AS $$
BEGIN
  IF NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    RAISE EXCEPTION '% userId is immutable (row id %)', TG_TABLE_NAME, OLD."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReviewCard_owner_immutable"
BEFORE UPDATE OF "userId" ON "ReviewCard"
FOR EACH ROW EXECUTE FUNCTION "hsk_reject_review_owner_change"();

CREATE TRIGGER "ReviewSession_owner_immutable"
BEFORE UPDATE OF "userId" ON "ReviewSession"
FOR EACH ROW EXECUTE FUNCTION "hsk_reject_review_owner_change"();

-- Preserve both deletion and identity of immutable/history parents. The 16 names
-- below were verified against pg_constraint before this migration was authored.
ALTER TABLE "PlacementAttempt" DROP CONSTRAINT "PlacementAttempt_recommendedLevelId_fkey";
ALTER TABLE "PlacementAttempt" ADD CONSTRAINT "PlacementAttempt_recommendedLevelId_fkey"
  FOREIGN KEY ("recommendedLevelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "LearningEvent" DROP CONSTRAINT "LearningEvent_userId_fkey";
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LearningEvent" DROP CONSTRAINT "LearningEvent_lessonId_fkey";
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LearningEvent" DROP CONSTRAINT "LearningEvent_topicId_fkey";
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_topicId_fkey"
  FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LearningEvent" DROP CONSTRAINT "LearningEvent_exerciseId_fkey";
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_exerciseId_fkey"
  FOREIGN KEY ("exerciseId") REFERENCES "LessonExercise"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LearningEvent" DROP CONSTRAINT "LearningEvent_attemptId_fkey";
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "LessonExerciseAttempt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ReviewEvent" DROP CONSTRAINT "ReviewEvent_sessionId_fkey";
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ReviewSession"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ExamAttemptSnapshot" DROP CONSTRAINT "ExamAttemptSnapshot_attemptId_fkey";
ALTER TABLE "ExamAttemptSnapshot" ADD CONSTRAINT "ExamAttemptSnapshot_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ExamAttemptEvent" DROP CONSTRAINT "ExamAttemptEvent_attemptId_fkey";
ALTER TABLE "ExamAttemptEvent" ADD CONSTRAINT "ExamAttemptEvent_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ContentRevision" DROP CONSTRAINT "ContentRevision_authorId_fkey";
ALTER TABLE "ContentRevision" ADD CONSTRAINT "ContentRevision_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ReviewCard" DROP CONSTRAINT "ReviewCard_userId_fkey";
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ReviewSession" DROP CONSTRAINT "ReviewSession_userId_fkey";
ALTER TABLE "ReviewSession" ADD CONSTRAINT "ReviewSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LessonExerciseAttempt" DROP CONSTRAINT "LessonExerciseAttempt_userId_fkey";
ALTER TABLE "LessonExerciseAttempt" ADD CONSTRAINT "LessonExerciseAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "PronunciationAttempt" DROP CONSTRAINT "PronunciationAttempt_userId_fkey";
ALTER TABLE "PronunciationAttempt" ADD CONSTRAINT "PronunciationAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Result" DROP CONSTRAINT "Result_userId_fkey";
ALTER TABLE "Result" ADD CONSTRAINT "Result_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
