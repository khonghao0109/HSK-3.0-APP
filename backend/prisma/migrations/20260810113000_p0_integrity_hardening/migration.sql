-- P0 Integrity Hardening: curriculum bands, SRS ownership, immutable retention,
-- and evidence-based public dictionary prefix indexes.

-- Verify before enforce. Do not infer or silently repair product decisions.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "UserGoal" goal
    JOIN "Level" level ON level."id" = goal."targetLevelId"
    WHERE goal."targetBand" IS NOT NULL
      AND goal."targetBand" NOT BETWEEN level."minBand" AND level."maxBand"
  ) THEN
    RAISE EXCEPTION 'P0 hardening found UserGoal.targetBand outside its target Level range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "PlacementAttempt" placement
    LEFT JOIN "Level" level ON level."id" = placement."recommendedLevelId"
    WHERE placement."recommendedBand" IS NOT NULL
      AND (
        placement."recommendedLevelId" IS NULL OR
        placement."recommendedBand" NOT BETWEEN level."minBand" AND level."maxBand"
      )
  ) THEN
    RAISE EXCEPTION 'P0 hardening found PlacementAttempt.recommendedBand without a matching Level range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "LearningPlan" plan
    JOIN "Level" level ON level."id" = plan."targetLevelId"
    WHERE plan."targetBand" IS NOT NULL
      AND plan."targetBand" NOT BETWEEN level."minBand" AND level."maxBand"
  ) THEN
    RAISE EXCEPTION 'P0 hardening found LearningPlan.targetBand outside its target Level range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Result" result
    JOIN "Test" test ON test."id" = result."testId"
    JOIN "Level" level ON level."id" = test."levelId"
    WHERE result."awardedBand" IS NOT NULL
      AND result."awardedBand" NOT BETWEEN level."minBand" AND level."maxBand"
  ) THEN
    RAISE EXCEPTION 'P0 hardening found Result.awardedBand outside its Test Level range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ReviewEvent" event
    JOIN "ReviewCard" card ON card."id" = event."cardId"
    JOIN "ReviewSession" session ON session."id" = event."sessionId"
    WHERE event."sessionId" IS NOT NULL
      AND card."userId" <> session."userId"
  ) THEN
    RAISE EXCEPTION 'P0 hardening found ReviewEvent rows whose card/session owners differ';
  END IF;
END
$$;

-- Result.awardedBand is meaningful for every Test but must fit that Test's Level.
-- The cross-table trigger below is authoritative; this row-local check is a fast guard.
ALTER TABLE "Result" DROP CONSTRAINT "Result_awardedBand_check";
ALTER TABLE "Result"
  ADD CONSTRAINT "Result_awardedBand_check"
    CHECK ("awardedBand" IS NULL OR "awardedBand" BETWEEN 1 AND 9);

ALTER TABLE "PlacementAttempt"
  ADD CONSTRAINT "PlacementAttempt_recommendedLevel_band_pair_check"
    CHECK ("recommendedBand" IS NULL OR "recommendedLevelId" IS NOT NULL);

ALTER TABLE "PlacementAttempt" DROP CONSTRAINT "PlacementAttempt_recommendedLevelId_fkey";
ALTER TABLE "PlacementAttempt" ADD CONSTRAINT "PlacementAttempt_recommendedLevelId_fkey"
  FOREIGN KEY ("recommendedLevelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "hsk_check_curriculum_band_integrity"() RETURNS trigger AS $$
DECLARE
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
    FROM "Level" WHERE "id" = NEW."targetLevelId";
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
    FROM "Level" WHERE "id" = NEW."recommendedLevelId";
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
    FROM "Level" WHERE "id" = NEW."targetLevelId";
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
    SELECT level."minBand", level."maxBand"
      INTO expected_min_band, expected_max_band
    FROM "Test" test
    JOIN "Level" level ON level."id" = test."levelId"
    WHERE test."id" = NEW."testId";
    IF NEW."awardedBand" NOT BETWEEN expected_min_band AND expected_max_band THEN
      RAISE EXCEPTION 'Result awardedBand % is outside Test % Level range %..%',
        NEW."awardedBand", NEW."testId", expected_min_band, expected_max_band;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'Test' THEN
    SELECT result."id" INTO invalid_row_id
    FROM "Result" result
    JOIN "Level" level ON level."id" = NEW."levelId"
    WHERE result."testId" = NEW."id"
      AND result."awardedBand" IS NOT NULL
      AND result."awardedBand" NOT BETWEEN level."minBand" AND level."maxBand"
    LIMIT 1;
    IF invalid_row_id IS NOT NULL THEN
      RAISE EXCEPTION 'Test % Level update would invalidate Result % awardedBand', NEW."id", invalid_row_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'Level' THEN
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

CREATE CONSTRAINT TRIGGER "UserGoal_band_integrity"
AFTER INSERT OR UPDATE ON "UserGoal"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_curriculum_band_integrity"();

CREATE CONSTRAINT TRIGGER "PlacementAttempt_band_integrity"
AFTER INSERT OR UPDATE ON "PlacementAttempt"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_curriculum_band_integrity"();

CREATE CONSTRAINT TRIGGER "LearningPlan_band_integrity"
AFTER INSERT OR UPDATE ON "LearningPlan"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_curriculum_band_integrity"();

CREATE CONSTRAINT TRIGGER "Result_band_integrity"
AFTER INSERT OR UPDATE ON "Result"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_curriculum_band_integrity"();

CREATE CONSTRAINT TRIGGER "Test_result_band_integrity"
AFTER UPDATE ON "Test"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_curriculum_band_integrity"();

CREATE CONSTRAINT TRIGGER "Level_child_band_integrity"
AFTER UPDATE ON "Level"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_curriculum_band_integrity"();

-- A ReviewEvent may group a card into a session only when both belong to the same user.
-- Parent update triggers close the invariant from both directions.
CREATE FUNCTION "hsk_check_review_event_ownership"() RETURNS trigger AS $$
DECLARE
  invalid_event_id BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'ReviewEvent' THEN
    IF NEW."sessionId" IS NOT NULL AND EXISTS (
      SELECT 1
      FROM "ReviewCard" card
      JOIN "ReviewSession" session ON session."id" = NEW."sessionId"
      WHERE card."id" = NEW."cardId"
        AND card."userId" <> session."userId"
    ) THEN
      RAISE EXCEPTION 'ReviewEvent card % and session % must belong to the same user',
        NEW."cardId", NEW."sessionId";
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'ReviewCard' THEN
    SELECT event."id" INTO invalid_event_id
    FROM "ReviewEvent" event
    JOIN "ReviewSession" session ON session."id" = event."sessionId"
    WHERE event."cardId" = NEW."id"
      AND session."userId" <> NEW."userId"
    LIMIT 1;
    IF invalid_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'ReviewCard % owner update would invalidate ReviewEvent %', NEW."id", invalid_event_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'ReviewSession' THEN
    SELECT event."id" INTO invalid_event_id
    FROM "ReviewEvent" event
    JOIN "ReviewCard" card ON card."id" = event."cardId"
    WHERE event."sessionId" = NEW."id"
      AND card."userId" <> NEW."userId"
    LIMIT 1;
    IF invalid_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'ReviewSession % owner update would invalidate ReviewEvent %', NEW."id", invalid_event_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ReviewEvent_owner_integrity"
AFTER INSERT OR UPDATE ON "ReviewEvent"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_review_event_ownership"();

CREATE CONSTRAINT TRIGGER "ReviewCard_event_owner_integrity"
AFTER UPDATE ON "ReviewCard"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_review_event_ownership"();

CREATE CONSTRAINT TRIGGER "ReviewSession_event_owner_integrity"
AFTER UPDATE ON "ReviewSession"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_review_event_ownership"();

-- Immutable facts retain their parent identity through anonymization. A physical
-- parent delete is rejected by an FK instead of trying to mutate/delete the fact
-- and surfacing an opaque immutable-trigger error.
ALTER TABLE "LearningEvent" DROP CONSTRAINT "LearningEvent_userId_fkey";
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningEvent" DROP CONSTRAINT "LearningEvent_lessonId_fkey";
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_lessonId_fkey"
  FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningEvent" DROP CONSTRAINT "LearningEvent_topicId_fkey";
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_topicId_fkey"
  FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningEvent" DROP CONSTRAINT "LearningEvent_exerciseId_fkey";
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_exerciseId_fkey"
  FOREIGN KEY ("exerciseId") REFERENCES "LessonExercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningEvent" DROP CONSTRAINT "LearningEvent_attemptId_fkey";
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "LessonExerciseAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReviewEvent" DROP CONSTRAINT "ReviewEvent_sessionId_fkey";
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ReviewSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExamAttemptSnapshot" DROP CONSTRAINT "ExamAttemptSnapshot_attemptId_fkey";
ALTER TABLE "ExamAttemptSnapshot" ADD CONSTRAINT "ExamAttemptSnapshot_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamAttemptEvent" DROP CONSTRAINT "ExamAttemptEvent_attemptId_fkey";
ALTER TABLE "ExamAttemptEvent" ADD CONSTRAINT "ExamAttemptEvent_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentRevision" DROP CONSTRAINT "ContentRevision_authorId_fkey";
ALTER TABLE "ContentRevision" ADD CONSTRAINT "ContentRevision_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReviewCard" DROP CONSTRAINT "ReviewCard_userId_fkey";
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewSession" DROP CONSTRAINT "ReviewSession_userId_fkey";
ALTER TABLE "ReviewSession" ADD CONSTRAINT "ReviewSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LessonExerciseAttempt" DROP CONSTRAINT "LessonExerciseAttempt_userId_fkey";
ALTER TABLE "LessonExerciseAttempt" ADD CONSTRAINT "LessonExerciseAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PronunciationAttempt" DROP CONSTRAINT "PronunciationAttempt_userId_fkey";
ALTER TABLE "PronunciationAttempt" ADD CONSTRAINT "PronunciationAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Result" DROP CONSTRAINT "Result_userId_fkey";
ALTER TABLE "Result" ADD CONSTRAINT "Result_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- EXPLAIN ANALYZE on the representative 121k-word local corpus showed sequential
-- scans for both public pinyin and Hanzi prefix lookup. text_pattern_ops makes
-- LIKE 'prefix%' indexable; the partial predicate keeps the public index bounded.
CREATE INDEX "Word_public_pinyin_prefix_idx"
  ON "Word" ("pinyinNormalized" text_pattern_ops)
  WHERE "status" = 'published' AND "deletedAt" IS NULL AND "isPure" = true;
CREATE INDEX "Word_public_hanzi_prefix_idx"
  ON "Word" ("hanzi" text_pattern_ops)
  WHERE "status" = 'published' AND "deletedAt" IS NULL AND "isPure" = true;
