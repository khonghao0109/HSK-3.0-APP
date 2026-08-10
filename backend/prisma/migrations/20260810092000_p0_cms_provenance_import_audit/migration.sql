-- P0-02: CMS workflow, provenance, import/audit, media and dictionary localization.
CREATE TYPE "MediaProcessingStatus" AS ENUM ('pending', 'processing', 'ready', 'failed', 'quarantined');
CREATE TYPE "ContentEntityType" AS ENUM ('level', 'lesson', 'topic', 'story', 'word', 'sentence', 'lesson_exercise', 'question', 'test', 'media');
CREATE TYPE "ContentReviewDecision" AS ENUM ('approved', 'changes_requested', 'rejected');
CREATE TYPE "ImportJobStatus" AS ENUM ('pending', 'validating', 'ready', 'importing', 'completed', 'failed', 'cancelled');

CREATE TABLE "DataSource" (
  "id" SERIAL NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "referenceUrl" TEXT,
  "license" TEXT,
  "attribution" TEXT,
  "receivedAt" TIMESTAMP(3),
  "importedAt" TIMESTAMP(3),
  "contentHash" TEXT,
  "notes" TEXT,
  "createdById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WordSource" (
  "id" SERIAL NOT NULL,
  "wordId" INTEGER NOT NULL,
  "dataSourceId" INTEGER NOT NULL,
  "sourceKey" TEXT,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WordSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentRevision" (
  "id" SERIAL NOT NULL,
  "entityType" "ContentEntityType" NOT NULL,
  "entityId" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "contentHash" TEXT,
  "authorId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentRevision_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "ContentReview" (
  "id" SERIAL NOT NULL,
  "revisionId" INTEGER NOT NULL,
  "reviewerId" INTEGER,
  "decision" "ContentReviewDecision" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" BIGSERIAL NOT NULL,
  "actorId" INTEGER,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "correlationId" TEXT,
  "beforeSummary" JSONB,
  "afterSummary" JSONB,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImportJob" (
  "id" SERIAL NOT NULL,
  "dataSourceId" INTEGER,
  "createdById" INTEGER,
  "entityType" "ContentEntityType" NOT NULL,
  "status" "ImportJobStatus" NOT NULL DEFAULT 'pending',
  "idempotencyKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileChecksum" TEXT NOT NULL,
  "totalRows" INTEGER NOT NULL DEFAULT 0,
  "validRows" INTEGER NOT NULL DEFAULT 0,
  "errorRows" INTEGER NOT NULL DEFAULT 0,
  "importedRows" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportJob_counts_check" CHECK (
    "totalRows" >= 0 AND "validRows" >= 0 AND "errorRows" >= 0 AND "importedRows" >= 0 AND
    "validRows" + "errorRows" <= "totalRows" AND "importedRows" <= "validRows"
  )
);

CREATE TABLE "ImportRowError" (
  "id" BIGSERIAL NOT NULL,
  "importJobId" INTEGER NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "errorCode" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "normalizedPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportRowError_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImportRowError_rowNumber_check" CHECK ("rowNumber" > 0)
);

-- Add nullable ownership/provenance metadata so legacy content remains valid.
ALTER TABLE "Level"
  ADD COLUMN "status" "ContentStatus",
  ADD COLUMN "dataSourceId" INTEGER,
  ADD COLUMN "createdById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "publishedById" INTEGER,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Lesson"
  ADD COLUMN "dataSourceId" INTEGER,
  ADD COLUMN "createdById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "publishedById" INTEGER,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "Topic"
  ADD COLUMN "dataSourceId" INTEGER,
  ADD COLUMN "createdById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "publishedById" INTEGER,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "Story"
  ADD COLUMN "dataSourceId" INTEGER,
  ADD COLUMN "createdById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "publishedById" INTEGER,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "Word"
  ADD COLUMN "pinyinNormalized" TEXT,
  ADD COLUMN "status" "ContentStatus",
  ADD COLUMN "createdById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "publishedById" INTEGER,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Sentence"
  ADD COLUMN "status" "ContentStatus",
  ADD COLUMN "dataSourceId" INTEGER,
  ADD COLUMN "createdById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "publishedById" INTEGER,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Question"
  ADD COLUMN "dataSourceId" INTEGER,
  ADD COLUMN "createdById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "publishedById" INTEGER,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "Test"
  ADD COLUMN "dataSourceId" INTEGER,
  ADD COLUMN "createdById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "publishedById" INTEGER,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "Media"
  ADD COLUMN "storageProvider" TEXT,
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "originalFilename" TEXT,
  ADD COLUMN "checksum" TEXT,
  ADD COLUMN "processingStatus" "MediaProcessingStatus",
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "dataSourceId" INTEGER,
  ADD COLUMN "uploadedById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "WordLevel" ADD COLUMN "dataSourceId" INTEGER;

ALTER TABLE "WordMeaning"
  ADD COLUMN "meaningOrder" INTEGER,
  ADD COLUMN "meaningEnNormalized" TEXT,
  ADD COLUMN "meaningViNormalized" TEXT,
  ADD COLUMN "partOfSpeech" TEXT,
  ADD COLUMN "usage" TEXT,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "dataSourceId" INTEGER,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updatedAt" TIMESTAMP(3),
  ALTER COLUMN "meaningEn" DROP NOT NULL;

-- Existing records were publicly served before CMS workflow existed.
UPDATE "Level" SET "status" = 'published', "publishedAt" = COALESCE("publishedAt", "createdAt");
UPDATE "Lesson" SET "publishedAt" = COALESCE("publishedAt", "createdAt") WHERE "status" = 'published';
UPDATE "Topic" SET "publishedAt" = COALESCE("publishedAt", "createdAt") WHERE "status" = 'published';
UPDATE "Story" SET "publishedAt" = COALESCE("publishedAt", "createdAt") WHERE "status" = 'published';
UPDATE "Question" SET "publishedAt" = COALESCE("publishedAt", "createdAt") WHERE "status" = 'published';
UPDATE "Test" SET "publishedAt" = COALESCE("publishedAt", "createdAt") WHERE "status" = 'published';
UPDATE "Word" SET "pinyinNormalized" = lower(btrim("pinyin")), "status" = 'published', "publishedAt" = "createdAt";
UPDATE "Sentence" SET "status" = 'published', "publishedAt" = "createdAt";
UPDATE "Media" SET "processingStatus" = 'ready';

WITH ranked AS (
  SELECT "id", row_number() OVER (PARTITION BY "wordId" ORDER BY "id") AS meaning_order
  FROM "WordMeaning"
)
UPDATE "WordMeaning" meaning
SET
  "meaningOrder" = ranked.meaning_order,
  "meaningEnNormalized" = NULLIF(lower(btrim(meaning."meaningEn")), ''),
  "meaningViNormalized" = NULLIF(lower(btrim(meaning."meaningVi")), ''),
  "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE ranked."id" = meaning."id";

ALTER TABLE "Level" ALTER COLUMN "status" SET DEFAULT 'draft', ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Word"
  ALTER COLUMN "pinyinNormalized" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'draft',
  ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Sentence" ALTER COLUMN "status" SET DEFAULT 'draft', ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "Media" ALTER COLUMN "processingStatus" SET DEFAULT 'pending', ALTER COLUMN "processingStatus" SET NOT NULL;
ALTER TABLE "WordMeaning" ALTER COLUMN "meaningOrder" SET NOT NULL, ALTER COLUMN "updatedAt" SET NOT NULL;

ALTER TABLE "Media"
  ADD CONSTRAINT "Media_size_check" CHECK ("size" IS NULL OR "size" >= 0),
  ADD CONSTRAINT "Media_duration_check" CHECK ("duration" IS NULL OR "duration" >= 0);
ALTER TABLE "WordMeaning"
  ADD CONSTRAINT "WordMeaning_translation_check" CHECK (
    NULLIF(btrim("meaningEn"), '') IS NOT NULL OR NULLIF(btrim("meaningVi"), '') IS NOT NULL
  ),
  ADD CONSTRAINT "WordMeaning_order_check" CHECK ("meaningOrder" > 0);

CREATE UNIQUE INDEX "DataSource_code_key" ON "DataSource"("code");
CREATE UNIQUE INDEX "DataSource_name_version_key" ON "DataSource"("name", "version");
CREATE INDEX "DataSource_createdById_idx" ON "DataSource"("createdById");
CREATE UNIQUE INDEX "WordSource_wordId_dataSourceId_key" ON "WordSource"("wordId", "dataSourceId");
CREATE INDEX "WordSource_dataSourceId_wordId_idx" ON "WordSource"("dataSourceId", "wordId");
CREATE UNIQUE INDEX "ContentRevision_entityType_entityId_revision_key" ON "ContentRevision"("entityType", "entityId", "revision");
CREATE INDEX "ContentRevision_entityType_entityId_createdAt_idx" ON "ContentRevision"("entityType", "entityId", "createdAt");
CREATE INDEX "ContentRevision_authorId_createdAt_idx" ON "ContentRevision"("authorId", "createdAt");
CREATE INDEX "ContentReview_revisionId_createdAt_idx" ON "ContentReview"("revisionId", "createdAt");
CREATE INDEX "ContentReview_reviewerId_createdAt_idx" ON "ContentReview"("reviewerId", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");
CREATE UNIQUE INDEX "ImportJob_idempotencyKey_key" ON "ImportJob"("idempotencyKey");
CREATE INDEX "ImportJob_status_createdAt_idx" ON "ImportJob"("status", "createdAt");
CREATE INDEX "ImportJob_dataSourceId_idx" ON "ImportJob"("dataSourceId");
CREATE INDEX "ImportJob_createdById_createdAt_idx" ON "ImportJob"("createdById", "createdAt");
CREATE UNIQUE INDEX "ImportRowError_importJobId_rowNumber_errorCode_key" ON "ImportRowError"("importJobId", "rowNumber", "errorCode");
CREATE INDEX "ImportRowError_importJobId_rowNumber_idx" ON "ImportRowError"("importJobId", "rowNumber");
CREATE UNIQUE INDEX "Media_storageProvider_storageKey_key" ON "Media"("storageProvider", "storageKey");
CREATE INDEX "Media_type_processingStatus_idx" ON "Media"("type", "processingStatus");
CREATE INDEX "Media_checksum_idx" ON "Media"("checksum");
CREATE INDEX "Media_dataSourceId_idx" ON "Media"("dataSourceId");
CREATE INDEX "Media_uploadedById_idx" ON "Media"("uploadedById");
CREATE INDEX "Media_deletedAt_idx" ON "Media"("deletedAt");
CREATE INDEX "Level_status_deletedAt_orderIndex_idx" ON "Level"("status", "deletedAt", "orderIndex");
CREATE INDEX "Level_dataSourceId_idx" ON "Level"("dataSourceId");
CREATE INDEX "Level_createdById_idx" ON "Level"("createdById");
CREATE INDEX "Level_updatedById_idx" ON "Level"("updatedById");
CREATE INDEX "Level_publishedById_idx" ON "Level"("publishedById");
CREATE INDEX "Lesson_levelId_status_deletedAt_orderIndex_idx" ON "Lesson"("levelId", "status", "deletedAt", "orderIndex");
CREATE INDEX "Lesson_dataSourceId_idx" ON "Lesson"("dataSourceId");
CREATE INDEX "Lesson_createdById_idx" ON "Lesson"("createdById");
CREATE INDEX "Lesson_updatedById_idx" ON "Lesson"("updatedById");
CREATE INDEX "Lesson_publishedById_idx" ON "Lesson"("publishedById");
CREATE INDEX "Topic_lessonId_status_deletedAt_orderIndex_idx" ON "Topic"("lessonId", "status", "deletedAt", "orderIndex");
CREATE INDEX "Topic_dataSourceId_idx" ON "Topic"("dataSourceId");
CREATE INDEX "Topic_createdById_idx" ON "Topic"("createdById");
CREATE INDEX "Topic_updatedById_idx" ON "Topic"("updatedById");
CREATE INDEX "Topic_publishedById_idx" ON "Topic"("publishedById");
CREATE INDEX "Story_levelId_status_deletedAt_orderIndex_idx" ON "Story"("levelId", "status", "deletedAt", "orderIndex");
CREATE INDEX "Story_dataSourceId_idx" ON "Story"("dataSourceId");
CREATE INDEX "Story_createdById_idx" ON "Story"("createdById");
CREATE INDEX "Story_updatedById_idx" ON "Story"("updatedById");
CREATE INDEX "Story_publishedById_idx" ON "Story"("publishedById");
CREATE INDEX "Word_pinyinNormalized_idx" ON "Word"("pinyinNormalized");
CREATE INDEX "Word_isPure_status_deletedAt_idx" ON "Word"("isPure", "status", "deletedAt");
CREATE INDEX "Word_createdById_idx" ON "Word"("createdById");
CREATE INDEX "Word_updatedById_idx" ON "Word"("updatedById");
CREATE INDEX "Word_publishedById_idx" ON "Word"("publishedById");
CREATE INDEX "Sentence_status_deletedAt_idx" ON "Sentence"("status", "deletedAt");
CREATE INDEX "Sentence_dataSourceId_idx" ON "Sentence"("dataSourceId");
CREATE INDEX "Sentence_createdById_idx" ON "Sentence"("createdById");
CREATE INDEX "Sentence_updatedById_idx" ON "Sentence"("updatedById");
CREATE INDEX "Sentence_publishedById_idx" ON "Sentence"("publishedById");
CREATE INDEX "Question_dataSourceId_idx" ON "Question"("dataSourceId");
CREATE INDEX "Question_createdById_idx" ON "Question"("createdById");
CREATE INDEX "Question_updatedById_idx" ON "Question"("updatedById");
CREATE INDEX "Question_publishedById_idx" ON "Question"("publishedById");
CREATE INDEX "Test_dataSourceId_idx" ON "Test"("dataSourceId");
CREATE INDEX "Test_createdById_idx" ON "Test"("createdById");
CREATE INDEX "Test_updatedById_idx" ON "Test"("updatedById");
CREATE INDEX "Test_publishedById_idx" ON "Test"("publishedById");
CREATE INDEX "WordLevel_levelId_wordId_idx" ON "WordLevel"("levelId", "wordId");
CREATE INDEX "WordLevel_dataSourceId_idx" ON "WordLevel"("dataSourceId");
CREATE UNIQUE INDEX "WordMeaning_wordId_meaningOrder_key" ON "WordMeaning"("wordId", "meaningOrder");
CREATE INDEX "WordMeaning_meaningEnNormalized_idx" ON "WordMeaning"("meaningEnNormalized");
CREATE INDEX "WordMeaning_meaningViNormalized_idx" ON "WordMeaning"("meaningViNormalized");
CREATE INDEX "WordMeaning_dataSourceId_idx" ON "WordMeaning"("dataSourceId");

-- Replace single-column content indexes with the published-read access patterns.
DROP INDEX "Media_type_idx";
DROP INDEX "Lesson_levelId_idx";
DROP INDEX "Lesson_status_idx";
DROP INDEX "Lesson_deletedAt_idx";
DROP INDEX "Topic_lessonId_idx";
DROP INDEX "Topic_status_idx";
DROP INDEX "Topic_deletedAt_idx";
DROP INDEX "Story_levelId_idx";
DROP INDEX "Story_status_idx";
DROP INDEX "Story_deletedAt_idx";
DROP INDEX "Story_levelId_orderIndex_idx";
DROP INDEX "Story_lessonId_idx";
DROP INDEX "Word_pinyin_idx";
DROP INDEX "Word_isPure_idx";
DROP INDEX "WordLevel_levelId_idx";
DROP INDEX "WordLevel_wordId_idx";

ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WordSource" ADD CONSTRAINT "WordSource_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WordSource" ADD CONSTRAINT "WordSource_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentRevision" ADD CONSTRAINT "ContentRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentReview" ADD CONSTRAINT "ContentReview_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ContentRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentReview" ADD CONSTRAINT "ContentReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportRowError" ADD CONSTRAINT "ImportRowError_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Media" ADD CONSTRAINT "Media_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Media" ADD CONSTRAINT "Media_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Media" ADD CONSTRAINT "Media_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Level" ADD CONSTRAINT "Level_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Level" ADD CONSTRAINT "Level_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Level" ADD CONSTRAINT "Level_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Level" ADD CONSTRAINT "Level_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Story" ADD CONSTRAINT "Story_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Story" ADD CONSTRAINT "Story_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Story" ADD CONSTRAINT "Story_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Story" ADD CONSTRAINT "Story_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Word" ADD CONSTRAINT "Word_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Word" ADD CONSTRAINT "Word_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Word" ADD CONSTRAINT "Word_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WordMeaning" ADD CONSTRAINT "WordMeaning_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WordLevel" ADD CONSTRAINT "WordLevel_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sentence" ADD CONSTRAINT "Sentence_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Test" ADD CONSTRAINT "Test_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Test" ADD CONSTRAINT "Test_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Test" ADD CONSTRAINT "Test_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Test" ADD CONSTRAINT "Test_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Provenance baseline from the repository's immutable raw files.
INSERT INTO "DataSource" (
  "code", "name", "version", "referenceUrl", "license", "attribution", "receivedAt", "importedAt", "contentHash", "notes", "updatedAt"
) VALUES
  ('CC_CEDICT_2026_05_04', 'CC-CEDICT', '2026-05-04', 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict', 'CC BY-SA 4.0', 'Published by MDBG', '2026-05-04T00:57:37Z', CURRENT_TIMESTAMP, '3e96e064010068a5b4233a01faea9ba754d055f6de2b13ae4a85f681f6dca3cb', 'Backfilled from backend/scripts/dictionary/raw/cedict_ts.u8', CURRENT_TIMESTAMP),
  ('HSK_WORD_LIST_HSK1', 'HSK 3.0 word list HSK1', 'repository-baseline-2026-06-11', 'repository://backend/scripts/dictionary/raw/HSK 1.txt', NULL, NULL, NULL, CURRENT_TIMESTAMP, '3081701aee20cec7b8d8c8f3f5041b667d5ed37810f1f750a708eeafbaa572a1', 'License/source authority must be verified before production publish', CURRENT_TIMESTAMP),
  ('HSK_WORD_LIST_HSK2', 'HSK 3.0 word list HSK2', 'repository-baseline-2026-06-11', 'repository://backend/scripts/dictionary/raw/HSK 2.txt', NULL, NULL, NULL, CURRENT_TIMESTAMP, '1e9150bd38b18d5ec602d7d9d898c16bd28bfba6a3d4c358b04a3238364a44c7', 'License/source authority must be verified before production publish', CURRENT_TIMESTAMP),
  ('HSK_WORD_LIST_HSK3', 'HSK 3.0 word list HSK3', 'repository-baseline-2026-06-11', 'repository://backend/scripts/dictionary/raw/HSK 3.txt', NULL, NULL, NULL, CURRENT_TIMESTAMP, '9ccd47f23f8f84d73c84608edfce75d81dee71480244d8929e102ef74e960c8a', 'License/source authority must be verified before production publish', CURRENT_TIMESTAMP),
  ('HSK_WORD_LIST_HSK4', 'HSK 3.0 word list HSK4', 'repository-baseline-2026-06-11', 'repository://backend/scripts/dictionary/raw/HSK 4.txt', NULL, NULL, NULL, CURRENT_TIMESTAMP, 'a1f458ff843a6a39541901046c1508f2ca1443626fc9a3f3cc3c8157672a4bed', 'License/source authority must be verified before production publish', CURRENT_TIMESTAMP),
  ('HSK_WORD_LIST_HSK5', 'HSK 3.0 word list HSK5', 'repository-baseline-2026-06-11', 'repository://backend/scripts/dictionary/raw/HSK 5.txt', NULL, NULL, NULL, CURRENT_TIMESTAMP, '051d6e691add4a86b8bf91e42490ddb3b775e74bfd15463845cb10b1d6610dc1', 'License/source authority must be verified before production publish', CURRENT_TIMESTAMP),
  ('HSK_WORD_LIST_HSK6', 'HSK 3.0 word list HSK6', 'repository-baseline-2026-06-11', 'repository://backend/scripts/dictionary/raw/HSK 6.txt', NULL, NULL, NULL, CURRENT_TIMESTAMP, '1a81273a1ae95f41f8a39fcf8fdd1d59ca9cdf7e810894be6dce195670a8b9b8', 'License/source authority must be verified before production publish', CURRENT_TIMESTAMP),
  ('HSK_WORD_LIST_HSK7_9', 'HSK 3.0 word list HSK7_9', 'repository-baseline-2026-06-11', 'repository://backend/scripts/dictionary/raw/HSK 7-9.txt', NULL, NULL, NULL, CURRENT_TIMESTAMP, '6d344f9ce169e677a49d1bbb6b8c2c34590863347d2156c85efad9f28f6dc84e', 'License/source authority must be verified before production publish', CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "WordSource" ("wordId", "dataSourceId", "sourceKey", "isPrimary")
SELECT word."id", source."id", word."hanzi" || ':' || word."pinyin", true
FROM "Word" word
JOIN "DataSource" source ON source."code" = 'CC_CEDICT_2026_05_04'
ON CONFLICT ("wordId", "dataSourceId") DO NOTHING;

UPDATE "WordMeaning" meaning
SET "dataSourceId" = source."id"
FROM "DataSource" source
WHERE source."code" = 'CC_CEDICT_2026_05_04' AND meaning."dataSourceId" IS NULL;

UPDATE "Level" level
SET "dataSourceId" = source."id"
FROM "DataSource" source
WHERE source."code" = 'HSK_WORD_LIST_' || level."code" AND level."dataSourceId" IS NULL;

UPDATE "WordLevel" mapping
SET "dataSourceId" = source."id"
FROM "Level" level, "DataSource" source
WHERE mapping."levelId" = level."id"
  AND source."code" = 'HSK_WORD_LIST_' || level."code"
  AND mapping."dataSourceId" IS NULL;
