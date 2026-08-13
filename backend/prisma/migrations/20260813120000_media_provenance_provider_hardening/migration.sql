-- Media provenance/provider hardening and unknown-write reconciliation.
-- Forward-only: secure_media_ingestion_v1 remains immutable.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "MediaIngestion" AS ingestion
    JOIN "DataSource" AS source ON source.id = ingestion."dataSourceId"
    WHERE ingestion.status = 'completed'
      AND NOT EXISTS (
        SELECT 1
        FROM "AuditLog" AS audit
        WHERE audit.action = 'media.ingestion.provenance_audited'
          AND audit."targetType" = 'media_ingestion'
          AND audit."targetId" = ingestion.id::text
          AND audit."afterSummary" @> jsonb_build_object(
            'ingestionId', ingestion.id,
            'mediaId', ingestion."mediaId",
            'dataSourceId', source.id,
            'sourceCode', source.code,
            'sourceVersion', source.version,
            'sourceLicense', source.license,
            'sourceAttribution', source.attribution,
            'sourceReferenceUrl', source."referenceUrl",
            'sourceContentHash', source."contentHash"
          )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Completed MediaIngestion rows require an exact immutable provenance audit before this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "MediaIngestion" AS ingestion
    JOIN "DataSource" AS source ON source.id = ingestion."dataSourceId"
    WHERE NULLIF(btrim(source.code), '') IS NULL
      OR NULLIF(btrim(source.version), '') IS NULL
      OR NULLIF(btrim(source.license), '') IS NULL
      OR (source."referenceUrl" IS NOT NULL AND NULLIF(btrim(source."referenceUrl"), '') IS NULL)
      OR (source.attribution IS NOT NULL AND NULLIF(btrim(source.attribution), '') IS NULL)
      OR (source."contentHash" IS NOT NULL AND NULLIF(btrim(source."contentHash"), '') IS NULL)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'MediaIngestion references ambiguous provenance that requires correction before this migration.';
  END IF;
END
$$;

ALTER TABLE "MediaIngestion"
  ADD COLUMN "sourceCodeSnapshot" TEXT,
  ADD COLUMN "sourceVersionSnapshot" TEXT,
  ADD COLUMN "sourceLicenseSnapshot" TEXT,
  ADD COLUMN "sourceAttributionSnapshot" TEXT,
  ADD COLUMN "sourceReferenceUrlSnapshot" TEXT,
  ADD COLUMN "sourceContentHashSnapshot" TEXT,
  ADD COLUMN "cleanupAbsentObservedAt" TIMESTAMP(3);

-- The v1 lifecycle trigger rejects all terminal updates. This transaction-scoped,
-- owner-controlled backfill is the only exception and is re-protected immediately.
ALTER TABLE "MediaIngestion"
  DISABLE TRIGGER "MediaIngestion_lifecycle_guard";

UPDATE "MediaIngestion" AS ingestion
SET
  "sourceCodeSnapshot" = source.code,
  "sourceVersionSnapshot" = source.version,
  "sourceLicenseSnapshot" = source.license,
  "sourceAttributionSnapshot" = source.attribution,
  "sourceReferenceUrlSnapshot" = source."referenceUrl",
  "sourceContentHashSnapshot" = source."contentHash"
FROM "DataSource" AS source
WHERE source.id = ingestion."dataSourceId";

ALTER TABLE "MediaIngestion"
  ENABLE TRIGGER "MediaIngestion_lifecycle_guard";

ALTER TABLE "MediaIngestion"
  ALTER COLUMN "sourceCodeSnapshot" SET NOT NULL,
  ALTER COLUMN "sourceVersionSnapshot" SET NOT NULL,
  ALTER COLUMN "sourceLicenseSnapshot" SET NOT NULL,
  ADD CONSTRAINT "MediaIngestion_provenance_snapshot_check" CHECK (
    "sourceCodeSnapshot" = btrim("sourceCodeSnapshot")
    AND char_length("sourceCodeSnapshot") BETWEEN 1 AND 255
    AND "sourceVersionSnapshot" = btrim("sourceVersionSnapshot")
    AND char_length("sourceVersionSnapshot") BETWEEN 1 AND 255
    AND "sourceLicenseSnapshot" = btrim("sourceLicenseSnapshot")
    AND char_length("sourceLicenseSnapshot") BETWEEN 1 AND 2000
    AND (
      "sourceAttributionSnapshot" IS NULL
      OR (
        "sourceAttributionSnapshot" = btrim("sourceAttributionSnapshot")
        AND char_length("sourceAttributionSnapshot") BETWEEN 1 AND 2000
      )
    )
    AND (
      "sourceReferenceUrlSnapshot" IS NULL
      OR (
        "sourceReferenceUrlSnapshot" = btrim("sourceReferenceUrlSnapshot")
        AND char_length("sourceReferenceUrlSnapshot") BETWEEN 1 AND 2000
      )
    )
    AND (
      "sourceContentHashSnapshot" IS NULL
      OR (
        "sourceContentHashSnapshot" = btrim("sourceContentHashSnapshot")
        AND char_length("sourceContentHashSnapshot") BETWEEN 1 AND 255
      )
    )
  ),
  ADD CONSTRAINT "MediaIngestion_cleanup_absence_check" CHECK (
    "cleanupAbsentObservedAt" IS NULL OR "storageKey" IS NOT NULL
  );

CREATE FUNCTION hsk_snapshot_media_ingestion_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_record "DataSource"%ROWTYPE;
BEGIN
  SELECT * INTO source_record
  FROM "DataSource"
  WHERE id = NEW."dataSourceId"
  FOR SHARE;

  IF NOT FOUND
    OR NULLIF(btrim(source_record.code), '') IS NULL
    OR NULLIF(btrim(source_record.version), '') IS NULL
    OR NULLIF(btrim(source_record.license), '') IS NULL
    OR (source_record."referenceUrl" IS NOT NULL AND NULLIF(btrim(source_record."referenceUrl"), '') IS NULL)
    OR (source_record.attribution IS NOT NULL AND NULLIF(btrim(source_record.attribution), '') IS NULL)
    OR (source_record."contentHash" IS NOT NULL AND NULLIF(btrim(source_record."contentHash"), '') IS NULL)
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_provenance_snapshot_check',
      MESSAGE = 'MediaIngestion provenance is not approved.';
  END IF;

  IF (NEW."sourceCodeSnapshot" IS NOT NULL AND NEW."sourceCodeSnapshot" IS DISTINCT FROM source_record.code)
    OR (NEW."sourceVersionSnapshot" IS NOT NULL AND NEW."sourceVersionSnapshot" IS DISTINCT FROM source_record.version)
    OR (NEW."sourceLicenseSnapshot" IS NOT NULL AND NEW."sourceLicenseSnapshot" IS DISTINCT FROM source_record.license)
    OR (NEW."sourceAttributionSnapshot" IS NOT NULL AND NEW."sourceAttributionSnapshot" IS DISTINCT FROM source_record.attribution)
    OR (NEW."sourceReferenceUrlSnapshot" IS NOT NULL AND NEW."sourceReferenceUrlSnapshot" IS DISTINCT FROM source_record."referenceUrl")
    OR (NEW."sourceContentHashSnapshot" IS NOT NULL AND NEW."sourceContentHashSnapshot" IS DISTINCT FROM source_record."contentHash")
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_provenance_snapshot_check',
      MESSAGE = 'MediaIngestion provenance snapshot does not match its source.';
  END IF;

  NEW."sourceCodeSnapshot" := source_record.code;
  NEW."sourceVersionSnapshot" := source_record.version;
  NEW."sourceLicenseSnapshot" := source_record.license;
  NEW."sourceAttributionSnapshot" := source_record.attribution;
  NEW."sourceReferenceUrlSnapshot" := source_record."referenceUrl";
  NEW."sourceContentHashSnapshot" := source_record."contentHash";
  RETURN NEW;
END;
$$;

-- PostgreSQL fires same-kind triggers by name; this must precede completed coherence.
CREATE TRIGGER "MediaIngestion_00_provenance_snapshot"
BEFORE INSERT ON "MediaIngestion"
FOR EACH ROW EXECUTE FUNCTION hsk_snapshot_media_ingestion_provenance();

CREATE FUNCTION hsk_guard_data_source_media_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.code IS DISTINCT FROM NEW.code
    OR OLD.version IS DISTINCT FROM NEW.version
    OR OLD.license IS DISTINCT FROM NEW.license
    OR OLD."referenceUrl" IS DISTINCT FROM NEW."referenceUrl"
    OR OLD.attribution IS DISTINCT FROM NEW.attribution
    OR OLD."contentHash" IS DISTINCT FROM NEW."contentHash"
  THEN
    IF EXISTS (
      SELECT 1 FROM "MediaIngestion"
      WHERE "dataSourceId" = OLD.id
      FOR KEY SHARE
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'DataSource_media_provenance_guard',
        MESSAGE = 'Referenced media provenance is immutable; create a new DataSource version.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DataSource_media_provenance_guard"
BEFORE UPDATE OF code, version, license, "referenceUrl", attribution, "contentHash"
ON "DataSource"
FOR EACH ROW EXECUTE FUNCTION hsk_guard_data_source_media_provenance();

CREATE OR REPLACE FUNCTION hsk_guard_media_ingestion_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion history cannot be deleted.';
  END IF;

  IF OLD."actorId" IS DISTINCT FROM NEW."actorId"
    OR OLD."dataSourceId" IS DISTINCT FROM NEW."dataSourceId"
    OR OLD."idempotencyKeyHash" IS DISTINCT FROM NEW."idempotencyKeyHash"
    OR OLD."requestFingerprint" IS DISTINCT FROM NEW."requestFingerprint"
    OR OLD."originalFilename" IS DISTINCT FROM NEW."originalFilename"
    OR OLD."declaredMimeType" IS DISTINCT FROM NEW."declaredMimeType"
    OR OLD."storageProvider" IS DISTINCT FROM NEW."storageProvider"
    OR OLD."sourceCodeSnapshot" IS DISTINCT FROM NEW."sourceCodeSnapshot"
    OR OLD."sourceVersionSnapshot" IS DISTINCT FROM NEW."sourceVersionSnapshot"
    OR OLD."sourceLicenseSnapshot" IS DISTINCT FROM NEW."sourceLicenseSnapshot"
    OR OLD."sourceAttributionSnapshot" IS DISTINCT FROM NEW."sourceAttributionSnapshot"
    OR OLD."sourceReferenceUrlSnapshot" IS DISTINCT FROM NEW."sourceReferenceUrlSnapshot"
    OR OLD."sourceContentHashSnapshot" IS DISTINCT FROM NEW."sourceContentHashSnapshot"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion identity and provenance are immutable.';
  END IF;

  IF OLD.status IN ('completed', 'rejected')
    OR (OLD.status = 'failed' AND OLD."failureCode" = 'OBJECT_CLEANED')
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'Terminal MediaIngestion history is immutable.';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status
    AND NOT (
      (OLD.status = 'pending' AND NEW.status IN ('processing', 'rejected', 'failed'))
      OR (OLD.status = 'processing' AND NEW.status IN ('completed', 'rejected', 'failed', 'cleanup_required'))
      OR (OLD.status = 'failed' AND NEW.status = 'processing')
      OR (OLD.status = 'cleanup_required' AND NEW.status IN ('processing', 'failed'))
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion state transition is invalid.';
  END IF;

  IF OLD."processingToken" IS DISTINCT FROM NEW."processingToken"
    AND NOT (
      OLD.status = 'failed' AND NEW.status = 'processing'
      OR OLD.status = 'cleanup_required' AND NEW.status = 'processing'
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion fencing identity change is invalid.';
  END IF;

  IF OLD."storageKey" IS NOT NULL
    AND OLD."storageKey" IS DISTINCT FROM NEW."storageKey"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion object identity is immutable.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION hsk_check_completed_media_ingestion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "Media" AS media
    JOIN "DataSource" AS source ON source.id = NEW."dataSourceId"
    WHERE media.id = NEW."mediaId"
      AND media."uploadedById" = NEW."actorId"
      AND media."dataSourceId" = NEW."dataSourceId"
      AND media."storageProvider" = NEW."storageProvider"
      AND media."storageKey" = NEW."storageKey"
      AND media.checksum = NEW.checksum
      AND media."mimeType" = NEW."validatedMimeType"
      AND media.size = NEW.size
      AND media."processingStatus" = 'ready'
      AND media."deletedAt" IS NULL
      AND source.code = NEW."sourceCodeSnapshot"
      AND source.version = NEW."sourceVersionSnapshot"
      AND source.license = NEW."sourceLicenseSnapshot"
      AND source.attribution IS NOT DISTINCT FROM NEW."sourceAttributionSnapshot"
      AND source."referenceUrl" IS NOT DISTINCT FROM NEW."sourceReferenceUrlSnapshot"
      AND source."contentHash" IS NOT DISTINCT FROM NEW."sourceContentHashSnapshot"
      AND (
        (NEW."validatedMimeType" IN ('image/jpeg', 'image/png') AND media.type = 'image')
        OR (NEW."validatedMimeType" IN ('audio/mpeg', 'audio/wav') AND media.type = 'audio')
      )
      AND media.url = '/api/v1/media/' || media.id || '/access'
    FOR SHARE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_completed_media_coherence',
      MESSAGE = 'Completed MediaIngestion does not match ready media and immutable provenance.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON COLUMN "MediaIngestion"."cleanupAbsentObservedAt" IS
  'First verified object-absence observation for bounded unknown-PUT settling; completion requires a later observation.';
COMMENT ON COLUMN "MediaIngestion"."sourceCodeSnapshot" IS
  'Immutable provenance captured from DataSource at ingestion claim.';

COMMIT;
