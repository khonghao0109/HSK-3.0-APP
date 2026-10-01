-- Truthful lifecycle telemetry for cleanup and processing backlog age.
-- Forward-only: all previously applied media migrations remain immutable.

-- Hold DML-conflicting locks in application write order from preflight through
-- constraint/trigger install. Media lifecycle transactions mutate ingestion
-- before appending AuditLog; locking both prevents either fact from changing
-- between audit validation and the one-time backfill.
LOCK TABLE "MediaIngestion" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "AuditLog" IN SHARE ROW EXCLUSIVE MODE;

-- processingStartedAt was application-writable before this migration. Refuse to
-- turn an unverifiable active timestamp into authoritative stuck-work telemetry;
-- operators must quiesce/drain processing rows before deployment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "MediaIngestion"
    WHERE status = 'processing'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Media lifecycle telemetry migration requires zero active processing rows.';
  END IF;
END
$$;

-- Refuse legacy rows whose status/code pair would make the cleanup lifecycle
-- ambiguous. Operators must reconcile them before retrying this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "MediaIngestion"
    WHERE (
      status = 'cleanup_required'
      AND (
        "failureCode" IS NULL
        OR "failureCode" NOT IN (
          'OBJECT_WRITE_OUTCOME_UNKNOWN',
          'OBJECT_CLEANUP_REQUIRED',
          'OBJECT_CLEANUP_SETTLING'
        )
      )
    ) OR (
      "failureCode" IN (
        'OBJECT_WRITE_OUTCOME_UNKNOWN',
        'OBJECT_CLEANUP_REQUIRED',
        'OBJECT_CLEANUP_SETTLING'
      )
      AND status <> 'cleanup_required'
    ) OR (
      "failureCode" = 'OBJECT_CLEANED'
      AND status <> 'failed'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Media lifecycle telemetry migration found an incoherent cleanup status/code pair.';
  END IF;
END
$$;

-- Reject malformed immutable cleanup facts globally, including rows that have
-- since reached another terminal state. Treating a malformed audit as if no
-- cleanup lifecycle existed would silently produce false-clean telemetry.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AuditLog" AS audit
    JOIN "MediaIngestion" AS ingestion
      ON audit."targetId" = ingestion.id::text
    WHERE audit."targetType" = 'media_ingestion'
      AND audit.action IN (
        'media.ingestion_failed',
        'media.ingestion_cleanup_failed',
        'media.ingestion_cleanup_settling'
      )
      AND audit."afterSummary" ->> 'status' = 'cleanup_required'
      AND (
        audit."afterSummary" ->> 'ingestionId' IS DISTINCT FROM ingestion.id::text
        OR audit."afterSummary" ->> 'failureCode' IS NULL
        OR audit."afterSummary" ->> 'failureCode' NOT IN (
          'OBJECT_WRITE_OUTCOME_UNKNOWN',
          'OBJECT_CLEANUP_REQUIRED',
          'OBJECT_CLEANUP_SETTLING'
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Media lifecycle telemetry migration found a malformed immutable cleanup audit.';
  END IF;
END
$$;

-- A cleanup audit is an immutable first-transition fact. Refuse histories that
-- later left the cleanup lifecycle through a state the new timestamp contract
-- cannot represent; silently discarding that fact would make backlog telemetry
-- false-clean.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "MediaIngestion" AS ingestion
    WHERE NOT (
      ingestion.status = 'cleanup_required'
      OR (
        ingestion.status = 'failed'
        AND ingestion."failureCode" = 'OBJECT_CLEANED'
      )
    )
    AND EXISTS (
      SELECT 1
      FROM "AuditLog" AS audit
      WHERE audit."targetType" = 'media_ingestion'
        AND audit."targetId" = ingestion.id::text
        AND audit.action IN (
          'media.ingestion_failed',
          'media.ingestion_cleanup_failed',
          'media.ingestion_cleanup_settling'
        )
        AND audit."afterSummary" ->> 'ingestionId' = ingestion.id::text
        AND audit."afterSummary" ->> 'status' = 'cleanup_required'
        AND audit."afterSummary" ->> 'failureCode' IN (
          'OBJECT_WRITE_OUTCOME_UNKNOWN',
          'OBJECT_CLEANUP_REQUIRED',
          'OBJECT_CLEANUP_SETTLING'
        )
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Media lifecycle telemetry migration found cleanup history outside a representable lifecycle state.';
  END IF;
END
$$;

-- Existing cleanup lifecycle rows can only be backfilled from immutable audit
-- history. Refuse to guess from updatedAt because retries rewrite that value.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "MediaIngestion" AS ingestion
    WHERE (
      ingestion.status = 'cleanup_required'
      OR (
        ingestion.status = 'processing'
        AND ingestion."failureCode" = 'OBJECT_CLEANUP_IN_PROGRESS'
      )
      OR (
        ingestion.status = 'failed'
        AND ingestion."failureCode" = 'OBJECT_CLEANED'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "AuditLog" AS audit
      WHERE audit."targetType" = 'media_ingestion'
        AND audit."targetId" = ingestion.id::text
        AND audit.action IN (
          'media.ingestion_failed',
          'media.ingestion_cleanup_failed',
          'media.ingestion_cleanup_settling'
        )
        AND audit."afterSummary" ->> 'ingestionId' = ingestion.id::text
        AND audit."afterSummary" ->> 'status' = 'cleanup_required'
        AND audit."afterSummary" ->> 'failureCode' IN (
          'OBJECT_WRITE_OUTCOME_UNKNOWN',
          'OBJECT_CLEANUP_REQUIRED',
          'OBJECT_CLEANUP_SETTLING'
        )
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Media cleanup lifecycle requires an immutable cleanup_required audit timestamp before migration.';
  END IF;
END
$$;

ALTER TABLE "MediaIngestion"
  ADD COLUMN "cleanupRequiredAt" TIMESTAMP(3);

-- Migration 17 makes terminal cleanup history immutable. This lock-scoped,
-- owner-controlled backfill is the only exception; update only rows whose
-- current state owns the cleanup lifecycle timestamp, then restore the guard
-- before installing the stricter replacement below.
ALTER TABLE "MediaIngestion"
  DISABLE TRIGGER "MediaIngestion_lifecycle_guard";

UPDATE "MediaIngestion" AS ingestion
SET "cleanupRequiredAt" = lifecycle."cleanupRequiredAt"
FROM (
  SELECT
    audit."targetId" AS id,
    MIN(audit."createdAt") AS "cleanupRequiredAt"
  FROM "AuditLog" AS audit
  WHERE audit."targetType" = 'media_ingestion'
    AND audit.action IN (
      'media.ingestion_failed',
      'media.ingestion_cleanup_failed',
      'media.ingestion_cleanup_settling'
    )
    AND audit."afterSummary" ->> 'ingestionId' = audit."targetId"
    AND audit."afterSummary" ->> 'status' = 'cleanup_required'
    AND audit."afterSummary" ->> 'failureCode' IN (
      'OBJECT_WRITE_OUTCOME_UNKNOWN',
      'OBJECT_CLEANUP_REQUIRED',
      'OBJECT_CLEANUP_SETTLING'
    )
  GROUP BY audit."targetId"
) AS lifecycle
WHERE ingestion.id::text = lifecycle.id
  AND (
    ingestion.status = 'cleanup_required'
    OR (
      ingestion.status = 'failed'
      AND ingestion."failureCode" = 'OBJECT_CLEANED'
    )
  );

ALTER TABLE "MediaIngestion"
  ENABLE TRIGGER "MediaIngestion_lifecycle_guard";

ALTER TABLE "MediaIngestion"
  ADD CONSTRAINT "MediaIngestion_cleanup_required_timestamp_check" CHECK (
    (
      "cleanupRequiredAt" IS NOT NULL
    ) = (
      status = 'cleanup_required'
      OR (
        status = 'processing'
        AND "failureCode" IS NOT DISTINCT FROM 'OBJECT_CLEANUP_IN_PROGRESS'
      )
      OR (
        status = 'failed'
        AND "failureCode" IS NOT DISTINCT FROM 'OBJECT_CLEANED'
      )
    )
    AND (
      "failureCode" IS DISTINCT FROM 'OBJECT_CLEANUP_IN_PROGRESS'
      OR (
        status = 'processing'
        AND "cleanupRequiredAt" IS NOT NULL
      )
    )
    AND (
      "failureCode" IS DISTINCT FROM 'OBJECT_CLEANED'
      OR (
        status = 'failed'
        AND "cleanupRequiredAt" IS NOT NULL
      )
    )
    AND (
      "failureCode" IS NULL
      OR "failureCode" NOT IN (
        'OBJECT_WRITE_OUTCOME_UNKNOWN',
        'OBJECT_CLEANUP_REQUIRED',
        'OBJECT_CLEANUP_SETTLING'
      )
      OR status = 'cleanup_required'
    )
    AND (
      status <> 'cleanup_required'
      OR (
        "failureCode" IS NOT NULL
        AND "failureCode" IN (
          'OBJECT_WRITE_OUTCOME_UNKNOWN',
          'OBJECT_CLEANUP_REQUIRED',
          'OBJECT_CLEANUP_SETTLING'
        )
      )
    )
    AND ("cleanupRequiredAt" IS NULL OR "storageKey" IS NOT NULL)
    AND ("cleanupRequiredAt" IS NULL OR "cleanupRequiredAt" >= "startedAt")
  );

CREATE INDEX "MediaIngestion_status_cleanupRequiredAt_idx"
  ON "MediaIngestion"(status, "cleanupRequiredAt");
CREATE INDEX "MediaIngestion_status_processingStartedAt_idx"
  ON "MediaIngestion"(status, "processingStartedAt");

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

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'processing' THEN
      NEW."processingStartedAt" := CURRENT_TIMESTAMP;
    END IF;
    IF NEW.status = 'cleanup_required' THEN
      IF NEW."cleanupRequiredAt" IS NOT NULL THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'MediaIngestion_lifecycle_guard',
          MESSAGE = 'MediaIngestion cleanup lifecycle timestamp is database-owned.';
      END IF;
      NEW."cleanupRequiredAt" := CURRENT_TIMESTAMP;
    ELSIF NEW."cleanupRequiredAt" IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'MediaIngestion_lifecycle_guard',
        MESSAGE = 'MediaIngestion cleanup lifecycle timestamp is invalid.';
    END IF;
    IF (
      NEW."failureCode" IS NOT DISTINCT FROM 'OBJECT_CLEANUP_IN_PROGRESS'
      AND NOT (
        NEW.status = 'processing'
        AND NEW."cleanupRequiredAt" IS NOT NULL
      )
    ) OR (
      NEW."failureCode" IS NOT DISTINCT FROM 'OBJECT_CLEANED'
      AND NOT (
        NEW.status = 'failed'
        AND NEW."cleanupRequiredAt" IS NOT NULL
      )
    ) OR (
      NEW."failureCode" IN (
        'OBJECT_WRITE_OUTCOME_UNKNOWN',
        'OBJECT_CLEANUP_REQUIRED',
        'OBJECT_CLEANUP_SETTLING'
      )
      AND NEW.status <> 'cleanup_required'
    ) OR (
      NEW.status = 'cleanup_required'
      AND (
        NEW."failureCode" IS NULL
        OR NEW."failureCode" NOT IN (
          'OBJECT_WRITE_OUTCOME_UNKNOWN',
          'OBJECT_CLEANUP_REQUIRED',
          'OBJECT_CLEANUP_SETTLING'
        )
      )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'MediaIngestion_lifecycle_guard',
        MESSAGE = 'MediaIngestion cleanup lifecycle code is invalid.';
    END IF;
    RETURN NEW;
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

  IF OLD.status <> 'processing' AND NEW.status = 'processing' THEN
    NEW."processingStartedAt" := CURRENT_TIMESTAMP;
  ELSIF OLD."processingStartedAt" IS DISTINCT FROM NEW."processingStartedAt" THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion processing lifecycle timestamp is invalid.';
  END IF;

  IF OLD."cleanupRequiredAt" IS NOT NULL
    AND OLD."cleanupRequiredAt" IS DISTINCT FROM NEW."cleanupRequiredAt"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion cleanup lifecycle timestamp is immutable.';
  ELSIF OLD."cleanupRequiredAt" IS NULL AND NEW.status = 'cleanup_required' THEN
    IF NEW."cleanupRequiredAt" IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'MediaIngestion_lifecycle_guard',
        MESSAGE = 'MediaIngestion cleanup lifecycle timestamp is database-owned.';
    END IF;
    NEW."cleanupRequiredAt" := CURRENT_TIMESTAMP;
  ELSIF OLD."cleanupRequiredAt" IS NULL AND NEW."cleanupRequiredAt" IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion cleanup lifecycle timestamp is invalid.';
  END IF;

  IF (
    NEW."cleanupRequiredAt" IS NOT NULL
    AND NOT (
      NEW.status = 'cleanup_required'
      OR (
        NEW.status = 'processing'
        AND NEW."failureCode" IS NOT DISTINCT FROM 'OBJECT_CLEANUP_IN_PROGRESS'
      )
      OR (
        NEW.status = 'failed'
        AND NEW."failureCode" IS NOT DISTINCT FROM 'OBJECT_CLEANED'
      )
    )
  ) OR (
    NEW."failureCode" IS NOT DISTINCT FROM 'OBJECT_CLEANUP_IN_PROGRESS'
    AND NOT (
      NEW.status = 'processing'
      AND NEW."cleanupRequiredAt" IS NOT NULL
    )
  ) OR (
    NEW."failureCode" IS NOT DISTINCT FROM 'OBJECT_CLEANED'
    AND NOT (
      NEW.status = 'failed'
      AND NEW."cleanupRequiredAt" IS NOT NULL
    )
  ) OR (
    NEW."failureCode" IN (
      'OBJECT_WRITE_OUTCOME_UNKNOWN',
      'OBJECT_CLEANUP_REQUIRED',
      'OBJECT_CLEANUP_SETTLING'
    )
    AND NEW.status <> 'cleanup_required'
  ) OR (
    NEW.status = 'cleanup_required'
    AND (
      NEW."failureCode" IS NULL
      OR NEW."failureCode" NOT IN (
        'OBJECT_WRITE_OUTCOME_UNKNOWN',
        'OBJECT_CLEANUP_REQUIRED',
        'OBJECT_CLEANUP_SETTLING'
      )
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion cleanup lifecycle state is invalid.';
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

DROP TRIGGER "MediaIngestion_lifecycle_guard" ON "MediaIngestion";
CREATE TRIGGER "MediaIngestion_lifecycle_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "MediaIngestion"
FOR EACH ROW EXECUTE FUNCTION hsk_guard_media_ingestion_lifecycle();

COMMENT ON COLUMN "MediaIngestion"."cleanupRequiredAt" IS
  'Immutable first transition into cleanup_required; preserved across cleanup retry claims and terminal reconciliation.';
