-- Exercise Authoring & Import Validation V1
-- Forward-only migration. Published legacy rows are intentionally not guessed or
-- backfilled because their JSON/media provenance cannot be proven relationally.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "LessonExercise" WHERE status = 'published') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Exercise Authoring V1 preflight failed: published LessonExercise rows require an explicit contract and media audit.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "LessonExercise"
    WHERE (status = 'archived') <> ("deletedAt" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Exercise Authoring V1 preflight failed: ambiguous LessonExercise archive state exists.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "LessonExercise" exercise
    JOIN "Lesson" lesson ON lesson.id = exercise."lessonId"
    LEFT JOIN "Topic" topic ON topic.id = exercise."topicId"
    WHERE lesson.status = 'archived'
      OR lesson."deletedAt" IS NOT NULL
      OR (
        exercise."topicId" IS NOT NULL
        AND (
          topic.id IS NULL
          OR topic."lessonId" <> exercise."lessonId"
          OR topic.status = 'archived'
          OR topic."deletedAt" IS NOT NULL
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Exercise Authoring V1 preflight failed: LessonExercise has an archived or incoherent parent.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ContentRevision" revision
    LEFT JOIN "LessonExercise" exercise
      ON exercise.id = revision."entityId"
    WHERE revision."entityType" = 'lesson_exercise'
      AND (
        exercise.id IS NULL
        OR NULLIF(btrim(revision."contentHash"), '') IS NULL
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Exercise Authoring V1 preflight failed: ambiguous LessonExercise revision history exists.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Media"
    WHERE char_length(url) = 0
      OR url ~ '[[:space:]]'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Exercise Authoring V1 preflight failed: blank Media URL requires an explicit asset audit.';
  END IF;
END
$$;

ALTER TABLE "Media"
  ADD CONSTRAINT "Media_url_nonblank_check"
    CHECK (char_length(url) > 0 AND url !~ '[[:space:]]');

ALTER TABLE "LessonExercise"
  ADD COLUMN "mediaId" INTEGER,
  ADD COLUMN "dataSourceId" INTEGER,
  ADD COLUMN "sourceKey" TEXT,
  ADD COLUMN "createdById" INTEGER,
  ADD COLUMN "updatedById" INTEGER,
  ADD COLUMN "publishedById" INTEGER,
  ADD COLUMN "publishedAt" TIMESTAMP(3);

ALTER TABLE "LessonExercise"
  DROP CONSTRAINT "LessonExercise_lessonId_fkey",
  DROP CONSTRAINT "LessonExercise_topicId_fkey";

ALTER TABLE "LessonExercise"
  ADD CONSTRAINT "LessonExercise_lessonId_fkey"
    FOREIGN KEY ("lessonId") REFERENCES "Lesson"(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "LessonExercise_topicId_fkey"
    FOREIGN KEY ("topicId") REFERENCES "Topic"(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "LessonExercise_mediaId_fkey"
    FOREIGN KEY ("mediaId") REFERENCES "Media"(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "LessonExercise_dataSourceId_fkey"
    FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "LessonExercise_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LessonExercise_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LessonExercise_publishedById_fkey"
    FOREIGN KEY ("publishedById") REFERENCES "User"(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "LessonExercise_sourceKey_check"
    CHECK (
      "sourceKey" IS NULL
      OR (
        "dataSourceId" IS NOT NULL
        AND char_length("sourceKey") BETWEEN 1 AND 128
        AND "sourceKey" = btrim("sourceKey")
        AND "sourceKey" !~ '[[:space:]]'
      )
    ),
  ADD CONSTRAINT "LessonExercise_publishedAt_check"
    CHECK (status <> 'published' OR "publishedAt" IS NOT NULL),
  ADD CONSTRAINT "LessonExercise_archive_state_check"
    CHECK ((status = 'archived') = ("deletedAt" IS NOT NULL)),
  ADD CONSTRAINT "LessonExercise_media_type_scope_check"
    CHECK ("mediaId" IS NULL OR type = 'listening_choice');

ALTER TABLE "ContentRevision"
  ADD CONSTRAINT "ContentRevision_lesson_exercise_hash_check"
    CHECK (
      "entityType" <> 'lesson_exercise'
      OR NULLIF(btrim("contentHash"), '') IS NOT NULL
    );

CREATE UNIQUE INDEX "LessonExercise_dataSourceId_sourceKey_key"
  ON "LessonExercise"("dataSourceId", "sourceKey");
CREATE INDEX "LessonExercise_mediaId_idx" ON "LessonExercise"("mediaId");
CREATE INDEX "LessonExercise_dataSourceId_idx" ON "LessonExercise"("dataSourceId");
CREATE INDEX "LessonExercise_createdById_idx" ON "LessonExercise"("createdById");
CREATE INDEX "LessonExercise_updatedById_idx" ON "LessonExercise"("updatedById");
CREATE INDEX "LessonExercise_publishedById_idx" ON "LessonExercise"("publishedById");

CREATE OR REPLACE FUNCTION hsk_check_lesson_exercise_publish_readiness()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  media_type "MediaType";
  media_status "MediaProcessingStatus";
  media_deleted_at TIMESTAMP(3);
  media_url TEXT;
BEGIN
  IF NEW.status <> 'published' THEN
    RETURN NEW;
  END IF;

  IF NEW."publishedAt" IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'LessonExercise_publish_readiness',
      MESSAGE = 'LessonExercise publish readiness violation: publishedAt is required.';
  END IF;

  IF NEW.type = 'speaking_repeat' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'LessonExercise_publish_readiness',
      MESSAGE = 'LessonExercise publish readiness violation: speaking_repeat is unsupported.';
  END IF;

  IF NEW.type = 'listening_choice' THEN
    IF NEW."mediaId" IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'LessonExercise_publish_readiness',
        MESSAGE = 'LessonExercise publish readiness violation: listening audio is required.';
    END IF;

    SELECT type, "processingStatus", "deletedAt", url
      INTO media_type, media_status, media_deleted_at, media_url
    FROM "Media"
    WHERE id = NEW."mediaId"
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'LessonExercise_publish_readiness',
        MESSAGE = 'LessonExercise publish readiness violation: listening media is unavailable.';
    END IF;

    IF media_type <> 'audio'
      OR media_status <> 'ready'
      OR media_deleted_at IS NOT NULL
      OR char_length(media_url) = 0
      OR media_url ~ '[[:space:]]'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'LessonExercise_publish_readiness',
        MESSAGE = 'LessonExercise publish readiness violation: listening media is not ready audio.';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "LessonExercise_publish_readiness"
BEFORE INSERT OR UPDATE OF status, type, "mediaId", "publishedAt"
ON "LessonExercise"
FOR EACH ROW
EXECUTE FUNCTION hsk_check_lesson_exercise_publish_readiness();

CREATE OR REPLACE FUNCTION hsk_check_lesson_exercise_live_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  lesson_status "ContentStatus";
  lesson_deleted_at TIMESTAMP(3);
  topic_lesson_id INTEGER;
  topic_status "ContentStatus";
  topic_deleted_at TIMESTAMP(3);
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.status = 'archived'
    AND NEW."lessonId" = OLD."lessonId"
    AND NEW."topicId" IS NOT DISTINCT FROM OLD."topicId"
  THEN
    RETURN NEW;
  END IF;

  SELECT status, "deletedAt"
    INTO lesson_status, lesson_deleted_at
  FROM "Lesson"
  WHERE id = NEW."lessonId"
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'LessonExercise_live_parent',
      MESSAGE = 'LessonExercise parent lesson does not exist.';
  END IF;

  IF lesson_status = 'archived' OR lesson_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'LessonExercise_live_parent',
      MESSAGE = 'LessonExercise parent lesson is archived.';
  END IF;

  IF NEW."topicId" IS NOT NULL THEN
    SELECT "lessonId", status, "deletedAt"
      INTO topic_lesson_id, topic_status, topic_deleted_at
    FROM "Topic"
    WHERE id = NEW."topicId"
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23503',
        CONSTRAINT = 'LessonExercise_live_parent',
        MESSAGE = 'LessonExercise parent topic does not exist.';
    END IF;

    IF topic_lesson_id <> NEW."lessonId"
      OR topic_status = 'archived'
      OR topic_deleted_at IS NOT NULL
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'LessonExercise_live_parent',
        MESSAGE = 'LessonExercise parent topic is archived or belongs to another lesson.';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "LessonExercise_live_parent"
BEFORE INSERT OR UPDATE OF "lessonId", "topicId", status
ON "LessonExercise"
FOR EACH ROW
EXECUTE FUNCTION hsk_check_lesson_exercise_live_parent();

CREATE OR REPLACE FUNCTION hsk_check_lesson_exercise_revision_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."entityType" = 'lesson_exercise' THEN
    PERFORM 1
    FROM "LessonExercise"
    WHERE id = NEW."entityId"
    FOR KEY SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23503',
        CONSTRAINT = 'ContentRevision_lesson_exercise_parent',
        MESSAGE = 'LessonExercise revision parent does not exist.';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "ContentRevision_lesson_exercise_parent"
BEFORE INSERT ON "ContentRevision"
FOR EACH ROW
EXECUTE FUNCTION hsk_check_lesson_exercise_revision_parent();

CREATE OR REPLACE FUNCTION hsk_restrict_lesson_exercise_revision_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- LessonExercise is archive-only. Rejecting every physical delete also closes
  -- the MVCC race where a concurrent ContentRevision INSERT could otherwise
  -- become invisible to a DELETE statement snapshot after waiting on its lock.
  RAISE EXCEPTION USING
    ERRCODE = '23503',
    CONSTRAINT = 'LessonExercise_revision_parent_restrict',
    MESSAGE = 'LessonExercise cannot be hard-deleted; archive it instead.';
END
$$;

CREATE TRIGGER "LessonExercise_revision_parent_restrict"
BEFORE DELETE ON "LessonExercise"
FOR EACH ROW
EXECUTE FUNCTION hsk_restrict_lesson_exercise_revision_delete();
