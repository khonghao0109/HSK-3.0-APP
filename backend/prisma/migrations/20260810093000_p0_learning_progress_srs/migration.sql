-- P0-03: learning progress/activity history and SRS source of truth.
CREATE TYPE "LearningEventType" AS ENUM ('lesson_started', 'lesson_completed', 'topic_started', 'topic_completed', 'exercise_submitted', 'word_saved');
CREATE TYPE "ReviewCardState" AS ENUM ('new', 'learning', 'review', 'suspended');
CREATE TYPE "ReviewGrade" AS ENUM ('again', 'hard', 'good', 'easy');
CREATE TYPE "ReviewSessionStatus" AS ENUM ('in_progress', 'completed', 'abandoned');

ALTER TABLE "LessonExercise" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "LessonExerciseAttempt"
  ADD COLUMN "attemptNumber" INTEGER,
  ADD COLUMN "contentSnapshot" JSONB,
  ADD COLUMN "exerciseVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "durationSeconds" INTEGER,
  ADD COLUMN "feedbackVersion" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3);

WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "userId", "exerciseId" ORDER BY "createdAt", "id"
  ) AS attempt_number
  FROM "LessonExerciseAttempt"
)
UPDATE "LessonExerciseAttempt" attempt
SET
  "attemptNumber" = ranked.attempt_number,
  "submittedAt" = COALESCE(attempt."submittedAt", attempt."createdAt"),
  "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE ranked."id" = attempt."id";

UPDATE "LessonExerciseAttempt" attempt
SET "contentSnapshot" = jsonb_build_object(
  'exerciseId', exercise."id",
  'version', exercise."version",
  'type', exercise."type",
  'prompt', exercise."prompt",
  'content', exercise."content",
  'answer', exercise."answer",
  'explanation', exercise."explanation"
)
FROM "LessonExercise" exercise
WHERE exercise."id" = attempt."exerciseId" AND attempt."contentSnapshot" IS NULL;

ALTER TABLE "LessonExerciseAttempt"
  ALTER COLUMN "attemptNumber" SET NOT NULL,
  ALTER COLUMN "contentSnapshot" SET NOT NULL,
  ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "Progress"
  ADD COLUMN "completionPercent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "currentTopicId" INTEGER,
  ADD COLUMN "currentExerciseId" INTEGER,
  ADD COLUMN "timeSpentSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "lastActivityAt" TIMESTAMP(3);

UPDATE "Progress"
SET
  "completionPercent" = CASE WHEN "status" = 'done' THEN 100 ELSE 0 END,
  "startedAt" = CASE WHEN "status" <> 'not_started' THEN "createdAt" ELSE NULL END,
  "completedAt" = CASE WHEN "status" = 'done' THEN "updatedAt" ELSE NULL END,
  "lastActivityAt" = CASE WHEN "status" <> 'not_started' THEN "updatedAt" ELSE NULL END;

CREATE TABLE "UserTopicProgress" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "topicId" INTEGER NOT NULL,
  "status" "ProgressStatus" NOT NULL DEFAULT 'not_started',
  "completionPercent" INTEGER NOT NULL DEFAULT 0,
  "timeSpentSeconds" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserTopicProgress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserTopicProgress_percent_check" CHECK ("completionPercent" BETWEEN 0 AND 100),
  CONSTRAINT "UserTopicProgress_time_check" CHECK ("timeSpentSeconds" >= 0)
);

CREATE TABLE "LearningEvent" (
  "id" BIGSERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "type" "LearningEventType" NOT NULL,
  "lessonId" INTEGER,
  "topicId" INTEGER,
  "exerciseId" INTEGER,
  "attemptId" INTEGER,
  "resourceType" TEXT,
  "resourceId" INTEGER,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewCard" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "wordId" INTEGER NOT NULL,
  "state" "ReviewCardState" NOT NULL DEFAULT 'new',
  "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "intervalDays" INTEGER NOT NULL DEFAULT 0,
  "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  "repetitions" INTEGER NOT NULL DEFAULT 0,
  "lapses" INTEGER NOT NULL DEFAULT 0,
  "lastReviewedAt" TIMESTAMP(3),
  "schedulerVersion" TEXT NOT NULL DEFAULT 'sm2-p0-v1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewCard_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewCard_interval_check" CHECK ("intervalDays" >= 0),
  CONSTRAINT "ReviewCard_ease_check" CHECK ("easeFactor" BETWEEN 1.3 AND 5.0),
  CONSTRAINT "ReviewCard_repetitions_check" CHECK ("repetitions" >= 0),
  CONSTRAINT "ReviewCard_lapses_check" CHECK ("lapses" >= 0)
);

CREATE TABLE "ReviewSession" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "status" "ReviewSessionStatus" NOT NULL DEFAULT 'in_progress',
  "mode" TEXT NOT NULL,
  "plannedCount" INTEGER NOT NULL DEFAULT 0,
  "reviewedCount" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT,
  "summary" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewSession_counts_check" CHECK (
    "plannedCount" >= 0 AND "reviewedCount" >= 0 AND "reviewedCount" <= "plannedCount"
  ),
  CONSTRAINT "ReviewSession_completedAt_check" CHECK (
    ("status" = 'completed' AND "completedAt" IS NOT NULL) OR
    ("status" <> 'completed' AND "completedAt" IS NULL)
  )
);

CREATE TABLE "ReviewEvent" (
  "id" BIGSERIAL NOT NULL,
  "cardId" INTEGER NOT NULL,
  "sessionId" INTEGER,
  "grade" "ReviewGrade" NOT NULL,
  "previousState" "ReviewCardState" NOT NULL,
  "nextState" "ReviewCardState" NOT NULL,
  "previousDueAt" TIMESTAMP(3) NOT NULL,
  "nextDueAt" TIMESTAMP(3) NOT NULL,
  "previousIntervalDays" INTEGER NOT NULL,
  "nextIntervalDays" INTEGER NOT NULL,
  "previousEaseFactor" DOUBLE PRECISION NOT NULL,
  "nextEaseFactor" DOUBLE PRECISION NOT NULL,
  "durationMs" INTEGER,
  "idempotencyKey" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReviewEvent_interval_check" CHECK ("previousIntervalDays" >= 0 AND "nextIntervalDays" >= 0),
  CONSTRAINT "ReviewEvent_ease_check" CHECK (
    "previousEaseFactor" BETWEEN 1.3 AND 5.0 AND "nextEaseFactor" BETWEEN 1.3 AND 5.0
  ),
  CONSTRAINT "ReviewEvent_duration_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0)
);

ALTER TABLE "LessonExercise"
  ADD CONSTRAINT "LessonExercise_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "LessonExercise_order_check" CHECK ("orderIndex" > 0);
ALTER TABLE "LessonExerciseAttempt"
  ADD CONSTRAINT "LessonExerciseAttempt_number_check" CHECK ("attemptNumber" > 0),
  ADD CONSTRAINT "LessonExerciseAttempt_version_check" CHECK ("exerciseVersion" > 0),
  ADD CONSTRAINT "LessonExerciseAttempt_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100),
  ADD CONSTRAINT "LessonExerciseAttempt_duration_check" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0);
ALTER TABLE "Progress"
  ADD CONSTRAINT "Progress_percent_check" CHECK ("completionPercent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "Progress_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100),
  ADD CONSTRAINT "Progress_time_check" CHECK ("timeSpentSeconds" >= 0),
  ADD CONSTRAINT "Progress_completedAt_check" CHECK (
    ("status" = 'done' AND "completedAt" IS NOT NULL AND "completionPercent" = 100) OR
    ("status" <> 'done' AND "completedAt" IS NULL)
  );
ALTER TABLE "PronunciationPractice"
  ADD CONSTRAINT "PronunciationPractice_target_check" CHECK (
    ("targetType" = 'word' AND "wordId" IS NOT NULL AND "sentenceId" IS NULL) OR
    ("targetType" = 'sentence' AND "sentenceId" IS NOT NULL AND "wordId" IS NULL)
  );

CREATE UNIQUE INDEX "LessonExerciseAttempt_userId_exerciseId_attemptNumber_key" ON "LessonExerciseAttempt"("userId", "exerciseId", "attemptNumber");
CREATE UNIQUE INDEX "LessonExerciseAttempt_userId_idempotencyKey_key" ON "LessonExerciseAttempt"("userId", "idempotencyKey");
CREATE INDEX "LessonExerciseAttempt_exerciseId_createdAt_idx" ON "LessonExerciseAttempt"("exerciseId", "createdAt");
CREATE INDEX "LessonExerciseAttempt_userId_createdAt_idx" ON "LessonExerciseAttempt"("userId", "createdAt");
CREATE INDEX "LessonExercise_status_deletedAt_idx" ON "LessonExercise"("status", "deletedAt");
CREATE INDEX "Progress_userId_status_lastActivityAt_idx" ON "Progress"("userId", "status", "lastActivityAt");
CREATE INDEX "Progress_currentTopicId_idx" ON "Progress"("currentTopicId");
CREATE INDEX "Progress_currentExerciseId_idx" ON "Progress"("currentExerciseId");
CREATE UNIQUE INDEX "UserTopicProgress_userId_topicId_key" ON "UserTopicProgress"("userId", "topicId");
CREATE INDEX "UserTopicProgress_userId_status_lastActivityAt_idx" ON "UserTopicProgress"("userId", "status", "lastActivityAt");
CREATE INDEX "UserTopicProgress_topicId_idx" ON "UserTopicProgress"("topicId");
CREATE UNIQUE INDEX "LearningEvent_userId_idempotencyKey_key" ON "LearningEvent"("userId", "idempotencyKey");
CREATE INDEX "LearningEvent_userId_occurredAt_idx" ON "LearningEvent"("userId", "occurredAt");
CREATE INDEX "LearningEvent_userId_type_occurredAt_idx" ON "LearningEvent"("userId", "type", "occurredAt");
CREATE INDEX "LearningEvent_lessonId_idx" ON "LearningEvent"("lessonId");
CREATE INDEX "LearningEvent_topicId_idx" ON "LearningEvent"("topicId");
CREATE INDEX "LearningEvent_exerciseId_idx" ON "LearningEvent"("exerciseId");
CREATE INDEX "LearningEvent_attemptId_idx" ON "LearningEvent"("attemptId");
CREATE UNIQUE INDEX "ReviewCard_userId_wordId_key" ON "ReviewCard"("userId", "wordId");
CREATE INDEX "ReviewCard_userId_state_dueAt_idx" ON "ReviewCard"("userId", "state", "dueAt");
CREATE INDEX "ReviewCard_wordId_idx" ON "ReviewCard"("wordId");
CREATE UNIQUE INDEX "ReviewSession_userId_idempotencyKey_key" ON "ReviewSession"("userId", "idempotencyKey");
CREATE INDEX "ReviewSession_userId_status_startedAt_idx" ON "ReviewSession"("userId", "status", "startedAt");
CREATE UNIQUE INDEX "ReviewEvent_cardId_idempotencyKey_key" ON "ReviewEvent"("cardId", "idempotencyKey");
CREATE INDEX "ReviewEvent_cardId_reviewedAt_idx" ON "ReviewEvent"("cardId", "reviewedAt");
CREATE INDEX "ReviewEvent_sessionId_reviewedAt_idx" ON "ReviewEvent"("sessionId", "reviewedAt");
CREATE INDEX "UserWordProgress_userId_status_idx" ON "UserWordProgress"("userId", "status");
CREATE INDEX "PronunciationAttempt_userId_createdAt_idx" ON "PronunciationAttempt"("userId", "createdAt");
CREATE INDEX "PronunciationPractice_status_deletedAt_idx" ON "PronunciationPractice"("status", "deletedAt");

DROP INDEX "LessonExercise_lessonId_idx";
DROP INDEX "LessonExercise_status_idx";
DROP INDEX "LessonExercise_deletedAt_idx";
DROP INDEX "LessonExerciseAttempt_userId_idx";
DROP INDEX "LessonExerciseAttempt_exerciseId_idx";
DROP INDEX "LessonExerciseAttempt_createdAt_idx";
DROP INDEX "Progress_userId_idx";
DROP INDEX "Progress_status_idx";
DROP INDEX "LessonWord_lessonId_idx";
DROP INDEX "LessonWordExample_lessonWordId_idx";
DROP INDEX "LessonSentence_lessonId_idx";
DROP INDEX "PronunciationPractice_lessonId_idx";
DROP INDEX "PronunciationPractice_status_idx";
DROP INDEX "PronunciationPractice_deletedAt_idx";
DROP INDEX "PronunciationAttempt_userId_idx";
DROP INDEX "PronunciationAttempt_createdAt_idx";
DROP INDEX "UserWord_userId_idx";
DROP INDEX "UserWordProgress_userId_idx";
DROP INDEX "UserWordProgress_status_idx";

ALTER TABLE "LessonExerciseAttempt" DROP CONSTRAINT "LessonExerciseAttempt_exerciseId_fkey";
ALTER TABLE "LessonExerciseAttempt" ADD CONSTRAINT "LessonExerciseAttempt_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "LessonExercise"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Progress" ADD CONSTRAINT "Progress_currentTopicId_fkey" FOREIGN KEY ("currentTopicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Progress" ADD CONSTRAINT "Progress_currentExerciseId_fkey" FOREIGN KEY ("currentExerciseId") REFERENCES "LessonExercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserTopicProgress" ADD CONSTRAINT "UserTopicProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTopicProgress" ADD CONSTRAINT "UserTopicProgress_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "LessonExercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "LessonExerciseAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewSession" ADD CONSTRAINT "ReviewSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "ReviewCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ReviewSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the scheduler source of truth from both legacy saved-word tables.
WITH candidates AS (
  SELECT "userId", "wordId", 'new'::"ReviewCardState" AS state, "createdAt", 1 AS priority
  FROM "UserWord"
  UNION ALL
  SELECT "userId", "wordId",
    CASE WHEN "status" = 'done' THEN 'review'::"ReviewCardState" ELSE 'learning'::"ReviewCardState" END,
    "createdAt", 2 AS priority
  FROM "UserWordProgress"
), selected AS (
  SELECT DISTINCT ON ("userId", "wordId") "userId", "wordId", state, "createdAt"
  FROM candidates
  ORDER BY "userId", "wordId", priority DESC, "createdAt" ASC
)
INSERT INTO "ReviewCard" ("userId", "wordId", "state", "dueAt", "createdAt", "updatedAt")
SELECT "userId", "wordId", state, "createdAt", "createdAt", CURRENT_TIMESTAMP
FROM selected
ON CONFLICT ("userId", "wordId") DO NOTHING;

-- Cross-table constraints are deferred-capable and also validate parent updates.
CREATE FUNCTION "hsk_check_story_lesson_level"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'Story' THEN
    IF NEW."lessonId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Lesson" lesson
      WHERE lesson."id" = NEW."lessonId" AND lesson."levelId" = NEW."levelId"
    ) THEN
      RAISE EXCEPTION 'Story % and Lesson % must belong to the same Level', NEW."id", NEW."lessonId";
    END IF;
  ELSIF TG_TABLE_NAME = 'Lesson' AND EXISTS (
    SELECT 1 FROM "Story" story
    WHERE story."lessonId" = NEW."id" AND story."levelId" <> NEW."levelId"
  ) THEN
    RAISE EXCEPTION 'Lesson % level update would invalidate attached Story rows', NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Story_lesson_level_integrity"
AFTER INSERT OR UPDATE ON "Story"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_story_lesson_level"();

CREATE CONSTRAINT TRIGGER "Lesson_story_level_integrity"
AFTER UPDATE ON "Lesson"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_story_lesson_level"();

CREATE FUNCTION "hsk_check_topic_lesson_integrity"() RETURNS trigger AS $$
DECLARE
  expected_lesson_id INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'Topic' THEN
    IF EXISTS (SELECT 1 FROM "LessonWord" row WHERE row."topicId" = NEW."id" AND row."lessonId" <> NEW."lessonId")
      OR EXISTS (SELECT 1 FROM "LessonExercise" row WHERE row."topicId" = NEW."id" AND row."lessonId" <> NEW."lessonId")
      OR EXISTS (SELECT 1 FROM "PronunciationPractice" row WHERE row."topicId" = NEW."id" AND row."lessonId" <> NEW."lessonId")
      OR EXISTS (SELECT 1 FROM "Progress" row WHERE row."currentTopicId" = NEW."id" AND row."lessonId" <> NEW."lessonId")
    THEN
      RAISE EXCEPTION 'Topic % lesson update would invalidate child rows', NEW."id";
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'LessonExercise' AND EXISTS (
    SELECT 1 FROM "Progress" row WHERE row."currentExerciseId" = NEW."id" AND row."lessonId" <> NEW."lessonId"
  ) THEN
    RAISE EXCEPTION 'LessonExercise % lesson update would invalidate Progress rows', NEW."id";
  END IF;

  IF TG_TABLE_NAME = 'Progress' THEN
    IF NEW."currentTopicId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Topic" topic WHERE topic."id" = NEW."currentTopicId" AND topic."lessonId" = NEW."lessonId"
    ) THEN
      RAISE EXCEPTION 'Progress currentTopicId must belong to Progress.lessonId';
    END IF;
    IF NEW."currentExerciseId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "LessonExercise" exercise WHERE exercise."id" = NEW."currentExerciseId" AND exercise."lessonId" = NEW."lessonId"
    ) THEN
      RAISE EXCEPTION 'Progress currentExerciseId must belong to Progress.lessonId';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."topicId" IS NOT NULL THEN
    SELECT "lessonId" INTO expected_lesson_id FROM "Topic" WHERE "id" = NEW."topicId";
    IF expected_lesson_id IS DISTINCT FROM NEW."lessonId" THEN
      RAISE EXCEPTION '% topicId must belong to the same Lesson', TG_TABLE_NAME;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "LessonWord_topic_lesson_integrity"
AFTER INSERT OR UPDATE ON "LessonWord"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_topic_lesson_integrity"();
CREATE CONSTRAINT TRIGGER "LessonExercise_topic_lesson_integrity"
AFTER INSERT OR UPDATE ON "LessonExercise"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_topic_lesson_integrity"();
CREATE CONSTRAINT TRIGGER "PronunciationPractice_topic_lesson_integrity"
AFTER INSERT OR UPDATE ON "PronunciationPractice"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_topic_lesson_integrity"();
CREATE CONSTRAINT TRIGGER "Progress_current_resource_integrity"
AFTER INSERT OR UPDATE ON "Progress"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_topic_lesson_integrity"();
CREATE CONSTRAINT TRIGGER "Topic_child_lesson_integrity"
AFTER UPDATE ON "Topic"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_topic_lesson_integrity"();

-- Review history and learning events are append-only business facts.
CREATE FUNCTION "hsk_reject_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LearningEvent_immutable"
BEFORE UPDATE OR DELETE ON "LearningEvent"
FOR EACH ROW EXECUTE FUNCTION "hsk_reject_immutable_mutation"();
CREATE TRIGGER "ReviewEvent_immutable"
BEFORE UPDATE OR DELETE ON "ReviewEvent"
FOR EACH ROW EXECUTE FUNCTION "hsk_reject_immutable_mutation"();
CREATE TRIGGER "ContentRevision_immutable"
BEFORE UPDATE OR DELETE ON "ContentRevision"
FOR EACH ROW EXECUTE FUNCTION "hsk_reject_immutable_mutation"();
CREATE TRIGGER "AuditLog_immutable"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION "hsk_reject_immutable_mutation"();
