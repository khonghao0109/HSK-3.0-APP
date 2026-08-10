-- P0-04: reusable question placement, exam attempts, autosave and immutable snapshots.
CREATE TYPE "ExamAttemptStatus" AS ENUM ('in_progress', 'submitted', 'timed_out', 'invalidated');
CREATE TYPE "ExamAttemptEventType" AS ENUM ('started', 'autosaved', 'submitted', 'timed_out', 'invalidated');

ALTER TABLE "Question"
  ADD COLUMN "difficulty" INTEGER,
  ADD COLUMN "objective" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "contentHash" TEXT;

ALTER TABLE "Test"
  ADD COLUMN "slug" TEXT,
  ADD COLUMN "instruction" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "scoringVersion" TEXT NOT NULL DEFAULT 'hsk-p0-v1',
  ADD COLUMN "attemptLimit" INTEGER,
  ADD COLUMN "passScore" INTEGER,
  ADD COLUMN "availableFrom" TIMESTAMP(3),
  ADD COLUMN "availableTo" TIMESTAMP(3);

ALTER TABLE "Result"
  ADD COLUMN "attemptId" INTEGER,
  ADD COLUMN "scoringVersion" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

-- Derive the denormalized test key from the existing section relation.
ALTER TABLE "QuestionGroup" ADD COLUMN "testId" INTEGER;
UPDATE "QuestionGroup" group_row
SET "testId" = section."testId"
FROM "TestSection" section
WHERE section."id" = group_row."sectionId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "QuestionGroup" WHERE "testId" IS NULL) THEN
    RAISE EXCEPTION 'P0-04 found QuestionGroup rows without a valid TestSection';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "TestQuestion" tq
    JOIN "Question" question ON question."id" = tq."questionId"
    JOIN "QuestionGroup" group_row ON group_row."id" = question."groupId"
    WHERE question."groupId" IS NOT NULL AND group_row."testId" <> tq."testId"
  ) THEN
    RAISE EXCEPTION 'P0-04 found Question.groupId placement that belongs to a different Test';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "TestQuestion" tq
    JOIN "Question" question ON question."id" = tq."questionId"
    WHERE question."groupId" IS NULL
      AND (SELECT count(*) FROM "TestSection" section WHERE section."testId" = tq."testId") <> 1
  ) THEN
    RAISE EXCEPTION 'P0-04 cannot infer a section for an ungrouped TestQuestion; each affected Test must have exactly one section';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "TestQuestion" GROUP BY "testId", "orderIndex" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'P0-04 found duplicate TestQuestion orderIndex values within a Test';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "QuestionGroup" GROUP BY "sectionId", "orderIndex" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'P0-04 found duplicate QuestionGroup orderIndex values within a section';
  END IF;
END
$$;

ALTER TABLE "QuestionGroup" ALTER COLUMN "testId" SET NOT NULL;

CREATE TABLE "Tag" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionTag" (
  "questionId" INTEGER NOT NULL,
  "tagId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuestionTag_pkey" PRIMARY KEY ("questionId", "tagId")
);

CREATE TABLE "TestQuestionPlacement" (
  "id" SERIAL NOT NULL,
  "testQuestionId" INTEGER NOT NULL,
  "testId" INTEGER NOT NULL,
  "sectionId" INTEGER NOT NULL,
  "groupId" INTEGER,
  "orderIndex" INTEGER NOT NULL,
  CONSTRAINT "TestQuestionPlacement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TestQuestionPlacement_order_check" CHECK ("orderIndex" > 0)
);

CREATE TABLE "ExamAttempt" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "testId" INTEGER NOT NULL,
  "status" "ExamAttemptStatus" NOT NULL DEFAULT 'in_progress',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "remainingSeconds" INTEGER NOT NULL,
  "score" INTEGER,
  "maxScore" INTEGER,
  "snapshotVersion" INTEGER NOT NULL DEFAULT 1,
  "scoringVersion" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "invalidatedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExamAttempt_time_check" CHECK ("expiresAt" > "startedAt" AND "remainingSeconds" >= 0),
  CONSTRAINT "ExamAttempt_score_check" CHECK (
    ("score" IS NULL OR "score" >= 0) AND
    ("maxScore" IS NULL OR "maxScore" >= 0) AND
    ("score" IS NULL OR "maxScore" IS NULL OR "score" <= "maxScore")
  ),
  CONSTRAINT "ExamAttempt_version_check" CHECK ("snapshotVersion" > 0),
  CONSTRAINT "ExamAttempt_final_state_check" CHECK (
    ("status" = 'in_progress' AND "submittedAt" IS NULL) OR
    ("status" IN ('submitted', 'timed_out') AND "submittedAt" IS NOT NULL) OR
    "status" = 'invalidated'
  )
);

CREATE TABLE "ExamAttemptSnapshot" (
  "id" SERIAL NOT NULL,
  "attemptId" INTEGER NOT NULL,
  "testVersion" INTEGER NOT NULL,
  "snapshotVersion" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExamAttemptSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExamAttemptSnapshot_version_check" CHECK ("testVersion" > 0 AND "snapshotVersion" > 0)
);

CREATE TABLE "ExamAnswer" (
  "id" SERIAL NOT NULL,
  "attemptId" INTEGER NOT NULL,
  "snapshotQuestionKey" TEXT NOT NULL,
  "questionId" INTEGER,
  "answer" JSONB NOT NULL,
  "isFlagged" BOOLEAN NOT NULL DEFAULT false,
  "answeredAt" TIMESTAMP(3),
  "lastSavedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  "score" INTEGER,
  "detailJson" JSONB,
  "saveIdempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExamAnswer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExamAnswer_version_check" CHECK ("version" > 0),
  CONSTRAINT "ExamAnswer_score_check" CHECK ("score" IS NULL OR "score" >= 0)
);

CREATE TABLE "ExamAttemptEvent" (
  "id" BIGSERIAL NOT NULL,
  "attemptId" INTEGER NOT NULL,
  "type" "ExamAttemptEventType" NOT NULL,
  "idempotencyKey" TEXT,
  "metadata" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExamAttemptEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Question"
  ADD CONSTRAINT "Question_difficulty_check" CHECK ("difficulty" IS NULL OR "difficulty" BETWEEN 1 AND 5),
  ADD CONSTRAINT "Question_version_check" CHECK ("version" > 0);
ALTER TABLE "Test"
  ADD CONSTRAINT "Test_duration_check" CHECK ("duration" > 0),
  ADD CONSTRAINT "Test_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "Test_attemptLimit_check" CHECK ("attemptLimit" IS NULL OR "attemptLimit" > 0),
  ADD CONSTRAINT "Test_passScore_check" CHECK ("passScore" IS NULL OR "passScore" >= 0),
  ADD CONSTRAINT "Test_availability_check" CHECK ("availableTo" IS NULL OR "availableFrom" IS NULL OR "availableTo" > "availableFrom");
ALTER TABLE "TestSection"
  ADD CONSTRAINT "TestSection_order_check" CHECK ("orderIndex" > 0),
  ADD CONSTRAINT "TestSection_duration_check" CHECK ("duration" IS NULL OR "duration" > 0);
ALTER TABLE "QuestionGroup" ADD CONSTRAINT "QuestionGroup_order_check" CHECK ("orderIndex" > 0);
ALTER TABLE "TestQuestion" ADD CONSTRAINT "TestQuestion_order_check" CHECK ("orderIndex" > 0);
ALTER TABLE "Result" ADD CONSTRAINT "Result_score_check" CHECK ("score" >= 0);
ALTER TABLE "ResultSkillScore"
  ADD CONSTRAINT "ResultSkillScore_value_check" CHECK ("score" >= 0 AND "total" >= 0 AND "score" <= "total");

CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");
CREATE INDEX "QuestionTag_tagId_questionId_idx" ON "QuestionTag"("tagId", "questionId");
CREATE UNIQUE INDEX "Test_slug_key" ON "Test"("slug");
CREATE INDEX "Test_availableFrom_availableTo_idx" ON "Test"("availableFrom", "availableTo");
CREATE INDEX "Question_difficulty_idx" ON "Question"("difficulty");
CREATE UNIQUE INDEX "TestSection_id_testId_key" ON "TestSection"("id", "testId");
CREATE UNIQUE INDEX "QuestionGroup_sectionId_orderIndex_key" ON "QuestionGroup"("sectionId", "orderIndex");
CREATE UNIQUE INDEX "QuestionGroup_id_sectionId_testId_key" ON "QuestionGroup"("id", "sectionId", "testId");
CREATE INDEX "QuestionGroup_testId_idx" ON "QuestionGroup"("testId");
CREATE UNIQUE INDEX "TestQuestion_testId_orderIndex_key" ON "TestQuestion"("testId", "orderIndex");
CREATE UNIQUE INDEX "TestQuestion_id_testId_key" ON "TestQuestion"("id", "testId");
CREATE UNIQUE INDEX "TestQuestionPlacement_testQuestionId_key" ON "TestQuestionPlacement"("testQuestionId");
CREATE UNIQUE INDEX "TestQuestionPlacement_testQuestionId_testId_key" ON "TestQuestionPlacement"("testQuestionId", "testId");
CREATE UNIQUE INDEX "TestQuestionPlacement_testId_orderIndex_key" ON "TestQuestionPlacement"("testId", "orderIndex");
CREATE INDEX "TestQuestionPlacement_sectionId_orderIndex_idx" ON "TestQuestionPlacement"("sectionId", "orderIndex");
CREATE INDEX "TestQuestionPlacement_groupId_orderIndex_idx" ON "TestQuestionPlacement"("groupId", "orderIndex");
CREATE UNIQUE INDEX "ExamAttempt_userId_idempotencyKey_key" ON "ExamAttempt"("userId", "idempotencyKey");
CREATE INDEX "ExamAttempt_userId_status_expiresAt_idx" ON "ExamAttempt"("userId", "status", "expiresAt");
CREATE INDEX "ExamAttempt_testId_status_idx" ON "ExamAttempt"("testId", "status");
CREATE UNIQUE INDEX "ExamAttemptSnapshot_attemptId_key" ON "ExamAttemptSnapshot"("attemptId");
CREATE UNIQUE INDEX "ExamAnswer_attemptId_snapshotQuestionKey_key" ON "ExamAnswer"("attemptId", "snapshotQuestionKey");
CREATE UNIQUE INDEX "ExamAnswer_attemptId_saveIdempotencyKey_key" ON "ExamAnswer"("attemptId", "saveIdempotencyKey");
CREATE INDEX "ExamAnswer_questionId_idx" ON "ExamAnswer"("questionId");
CREATE INDEX "ExamAnswer_attemptId_lastSavedAt_idx" ON "ExamAnswer"("attemptId", "lastSavedAt");
CREATE UNIQUE INDEX "ExamAttemptEvent_attemptId_idempotencyKey_key" ON "ExamAttemptEvent"("attemptId", "idempotencyKey");
CREATE INDEX "ExamAttemptEvent_attemptId_occurredAt_idx" ON "ExamAttemptEvent"("attemptId", "occurredAt");
CREATE UNIQUE INDEX "Result_attemptId_key" ON "Result"("attemptId");
CREATE INDEX "Result_userId_createdAt_idx" ON "Result"("userId", "createdAt");
CREATE INDEX "Result_testId_createdAt_idx" ON "Result"("testId", "createdAt");
CREATE INDEX "Question_levelId_skill_status_deletedAt_idx" ON "Question"("levelId", "skill", "status", "deletedAt");
CREATE INDEX "Test_levelId_status_deletedAt_idx" ON "Test"("levelId", "status", "deletedAt");

-- Backfill placement before deprecating the incorrect Question.groupId relation.
INSERT INTO "TestQuestionPlacement" ("testQuestionId", "testId", "sectionId", "groupId", "orderIndex")
SELECT
  tq."id",
  tq."testId",
  COALESCE(group_row."sectionId", (
    SELECT section."id" FROM "TestSection" section WHERE section."testId" = tq."testId" LIMIT 1
  )),
  question."groupId",
  tq."orderIndex"
FROM "TestQuestion" tq
JOIN "Question" question ON question."id" = tq."questionId"
LEFT JOIN "QuestionGroup" group_row ON group_row."id" = question."groupId";

DO $$
BEGIN
  IF (SELECT count(*) FROM "TestQuestionPlacement") <> (SELECT count(*) FROM "TestQuestion") THEN
    RAISE EXCEPTION 'P0-04 placement backfill did not cover every TestQuestion';
  END IF;
END
$$;

ALTER TABLE "QuestionGroup" DROP CONSTRAINT "QuestionGroup_sectionId_fkey";
ALTER TABLE "Question" DROP CONSTRAINT "Question_groupId_fkey";
DROP INDEX "Question_groupId_idx";
ALTER TABLE "Question" DROP COLUMN "groupId";

ALTER TABLE "QuestionGroup" ADD CONSTRAINT "QuestionGroup_sectionId_testId_fkey" FOREIGN KEY ("sectionId", "testId") REFERENCES "TestSection"("id", "testId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionTag" ADD CONSTRAINT "QuestionTag_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuestionTag" ADD CONSTRAINT "QuestionTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestQuestionPlacement" ADD CONSTRAINT "TestQuestionPlacement_testQuestionId_testId_fkey" FOREIGN KEY ("testQuestionId", "testId") REFERENCES "TestQuestion"("id", "testId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestQuestionPlacement" ADD CONSTRAINT "TestQuestionPlacement_sectionId_testId_fkey" FOREIGN KEY ("sectionId", "testId") REFERENCES "TestSection"("id", "testId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestQuestionPlacement" ADD CONSTRAINT "TestQuestionPlacement_groupId_sectionId_testId_fkey" FOREIGN KEY ("groupId", "sectionId", "testId") REFERENCES "QuestionGroup"("id", "sectionId", "testId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExamAttemptSnapshot" ADD CONSTRAINT "ExamAttemptSnapshot_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamAnswer" ADD CONSTRAINT "ExamAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExamAttemptEvent" ADD CONSTRAINT "ExamAttemptEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Result" ADD CONSTRAINT "Result_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "ExamAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "Question_levelId_idx";
DROP INDEX "Question_skill_idx";
DROP INDEX "Question_status_idx";
DROP INDEX "Question_deletedAt_idx";
DROP INDEX "Question_levelId_skill_idx";
DROP INDEX "Test_levelId_idx";
DROP INDEX "Test_status_idx";
DROP INDEX "Test_deletedAt_idx";
DROP INDEX "TestSection_testId_idx";
DROP INDEX "QuestionGroup_sectionId_idx";
DROP INDEX "QuestionGroup_sectionId_orderIndex_idx";
DROP INDEX "TestQuestion_testId_idx";
DROP INDEX "TestQuestion_testId_orderIndex_idx";
DROP INDEX "Result_userId_idx";
DROP INDEX "Result_testId_idx";
DROP INDEX "Result_createdAt_idx";
DROP INDEX "ResultSkillScore_resultId_idx";

CREATE FUNCTION "hsk_check_result_attempt_integrity"() RETURNS trigger AS $$
DECLARE
  attempt_row "ExamAttempt"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'ExamAttempt' THEN
    IF EXISTS (
      SELECT 1 FROM "Result" result
      WHERE result."attemptId" = NEW."id"
        AND (
          result."userId" <> NEW."userId" OR
          result."testId" <> NEW."testId" OR
          NEW."status" NOT IN ('submitted', 'timed_out')
        )
    ) THEN
      RAISE EXCEPTION 'ExamAttempt update would invalidate its Result';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."attemptId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO attempt_row FROM "ExamAttempt" WHERE "id" = NEW."attemptId";
  IF attempt_row."id" IS NULL THEN
    RAISE EXCEPTION 'Result attempt does not exist';
  END IF;
  IF attempt_row."userId" <> NEW."userId" OR attempt_row."testId" <> NEW."testId" THEN
    RAISE EXCEPTION 'Result user/test must match its ExamAttempt';
  END IF;
  IF attempt_row."status" NOT IN ('submitted', 'timed_out') THEN
    RAISE EXCEPTION 'Result can only reference a submitted or timed-out ExamAttempt';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Result_attempt_integrity"
AFTER INSERT OR UPDATE ON "Result"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
EXECUTE FUNCTION "hsk_check_result_attempt_integrity"();

CREATE CONSTRAINT TRIGGER "ExamAttempt_result_integrity"
AFTER UPDATE ON "ExamAttempt"
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW
WHEN (OLD."status" IS DISTINCT FROM NEW."status" OR OLD."userId" IS DISTINCT FROM NEW."userId" OR OLD."testId" IS DISTINCT FROM NEW."testId")
EXECUTE FUNCTION "hsk_check_result_attempt_integrity"();

CREATE TRIGGER "ExamAttemptSnapshot_immutable"
BEFORE UPDATE OR DELETE ON "ExamAttemptSnapshot"
FOR EACH ROW EXECUTE FUNCTION "hsk_reject_immutable_mutation"();
CREATE TRIGGER "ExamAttemptEvent_immutable"
BEFORE UPDATE OR DELETE ON "ExamAttemptEvent"
FOR EACH ROW EXECUTE FUNCTION "hsk_reject_immutable_mutation"();
