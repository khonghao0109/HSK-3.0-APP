-- Forward-only correction for cleanup audit authority and lifecycle timestamps.
-- Migration 18 remains immutable; this migration validates every relevant
-- immutable audit before installing the same policy for future writes.

BEGIN;

-- Match application write order and freeze both sources of the invariant while
-- validating historical rows and installing the future-write guards.
LOCK TABLE "MediaIngestion" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "AuditLog" IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION hsk_is_valid_media_cleanup_audit(
  audit_action TEXT,
  audit_target_type TEXT,
  audit_target_id TEXT,
  audit_after_summary JSONB,
  audit_created_at TIMESTAMP(3)
)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "MediaIngestion" AS ingestion
    WHERE audit_action IN (
        'media.ingestion_failed',
        'media.ingestion_cleanup_failed',
        'media.ingestion_cleanup_settling'
      )
      AND audit_target_type = 'media_ingestion'
      AND ingestion.id = CASE
        WHEN audit_target_id ~ '^[1-9][0-9]{0,9}$'
          AND audit_target_id::numeric <= 2147483647
        THEN audit_target_id::integer
        ELSE NULL
      END
      AND audit_target_id = ingestion.id::text
      AND jsonb_typeof(audit_after_summary) = 'object'
      AND jsonb_typeof(audit_after_summary -> 'ingestionId') = 'number'
      AND audit_after_summary ->> 'ingestionId' = ingestion.id::text
      AND jsonb_typeof(audit_after_summary -> 'status') = 'string'
      AND jsonb_typeof(audit_after_summary -> 'failureCode') = 'string'
      AND length(audit_after_summary ->> 'failureCode') > 0
      AND audit_created_at >= ingestion."startedAt"
      -- Use wall-clock time here rather than the migration transaction start.
      -- The migration may wait for the two table locks; a valid audit committed
      -- during that wait must not be misclassified as a future timestamp.
      AND audit_created_at <= clock_timestamp()::timestamp(3)
      AND (
        (
          audit_action = 'media.ingestion_failed'
          AND (
            (
              audit_after_summary ->> 'status' = 'cleanup_required'
              AND audit_after_summary ->> 'failureCode' IN (
                'OBJECT_WRITE_OUTCOME_UNKNOWN',
                'OBJECT_CLEANUP_REQUIRED',
                'OBJECT_CLEANUP_SETTLING'
              )
              AND ingestion."cleanupRequiredAt" IS NOT NULL
              AND audit_created_at = ingestion."cleanupRequiredAt"
              AND (
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
            )
            OR (
              audit_after_summary ->> 'status' = 'failed'
              AND audit_after_summary ->> 'failureCode' NOT IN (
                'OBJECT_WRITE_OUTCOME_UNKNOWN',
                'OBJECT_CLEANUP_REQUIRED',
                'OBJECT_CLEANUP_SETTLING',
                'OBJECT_CLEANUP_IN_PROGRESS',
                'OBJECT_CLEANED'
              )
            )
          )
        )
        OR (
          audit_action = 'media.ingestion_cleanup_failed'
          AND audit_after_summary ->> 'status' = 'cleanup_required'
          AND audit_after_summary ->> 'failureCode' = 'OBJECT_CLEANUP_REQUIRED'
          AND ingestion."cleanupRequiredAt" IS NOT NULL
          AND audit_created_at >= ingestion."cleanupRequiredAt"
          AND (
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
        )
        OR (
          audit_action = 'media.ingestion_cleanup_settling'
          AND audit_after_summary ->> 'status' = 'cleanup_required'
          AND audit_after_summary ->> 'failureCode' = 'OBJECT_CLEANUP_SETTLING'
          AND ingestion."cleanupRequiredAt" IS NOT NULL
          AND audit_created_at >= ingestion."cleanupRequiredAt"
          AND (
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
        )
      )
  );
$$;

-- Historical generic failures can legitimately precede a later retry and
-- cleanup lifecycle. New writes, however, must describe the row state they are
-- committing; otherwise an unrelated audit could be appended to immutable
-- history after the lifecycle already moved on.
CREATE FUNCTION hsk_is_valid_current_media_cleanup_audit(
  audit_action TEXT,
  audit_target_type TEXT,
  audit_target_id TEXT,
  audit_after_summary JSONB,
  audit_created_at TIMESTAMP(3)
)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
AS $$
  SELECT hsk_is_valid_media_cleanup_audit(
    audit_action,
    audit_target_type,
    audit_target_id,
    audit_after_summary,
    audit_created_at
  )
  AND EXISTS (
    SELECT 1
    FROM "MediaIngestion" AS ingestion
    WHERE ingestion.id = CASE
        WHEN audit_target_id ~ '^[1-9][0-9]{0,9}$'
          AND audit_target_id::numeric <= 2147483647
        THEN audit_target_id::integer
        ELSE NULL
      END
      AND (
        (
          audit_after_summary ->> 'status' = 'failed'
          AND
          ingestion.status = 'failed'
          AND ingestion."failureCode" = audit_after_summary ->> 'failureCode'
        )
        OR (
          audit_after_summary ->> 'status' = 'cleanup_required'
          AND ingestion.status = 'cleanup_required'
          AND ingestion."failureCode" = audit_after_summary ->> 'failureCode'
        )
      )
  );
$$;

-- Validate every audit carrying a cleanup-related action. A later valid row
-- cannot hide an earlier malformed row because the predicate is per-row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AuditLog" AS audit
    WHERE audit.action IN (
      'media.ingestion_failed',
      'media.ingestion_cleanup_failed',
      'media.ingestion_cleanup_settling'
    )
    AND NOT hsk_is_valid_media_cleanup_audit(
      audit.action,
      audit."targetType",
      audit."targetId",
      audit."afterSummary",
      audit."createdAt"
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Media cleanup audit integrity migration found a malformed immutable audit.';
  END IF;
END
$$;

-- cleanupRequiredAt is authoritative only when an exact immutable first fact
-- exists. Refuse future timestamps, timestamp drift, or invented history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "MediaIngestion" AS ingestion
    WHERE ingestion."cleanupRequiredAt" IS NOT NULL
      AND (
        ingestion."cleanupRequiredAt" > clock_timestamp()::timestamp(3)
        OR NOT EXISTS (
          SELECT 1
          FROM "AuditLog" AS audit
          WHERE audit."targetType" = 'media_ingestion'
            AND audit."createdAt" = ingestion."cleanupRequiredAt"
            AND audit."afterSummary" ->> 'status' = 'cleanup_required'
            AND hsk_is_valid_media_cleanup_audit(
              audit.action,
              audit."targetType",
              audit."targetId",
              audit."afterSummary",
              audit."createdAt"
            )
            AND audit."targetId" = ingestion.id::text
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Media cleanup lifecycle lacks an exact authoritative audit timestamp.';
  END IF;
END
$$;

CREATE FUNCTION hsk_guard_media_cleanup_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ingestion_id INTEGER;
BEGIN
  IF NEW.action NOT IN (
    'media.ingestion_failed',
    'media.ingestion_cleanup_failed',
    'media.ingestion_cleanup_settling'
  ) THEN
    RETURN NEW;
  END IF;

  ingestion_id := CASE
    WHEN NEW."targetId" ~ '^[1-9][0-9]{0,9}$'
      AND NEW."targetId"::numeric <= 2147483647
    THEN NEW."targetId"::integer
    ELSE NULL
  END;

  -- Audit targetId is text and has no FK, so an ordinary SELECT would leave a
  -- TOCTOU window. Serialize every relevant audit against lifecycle writes on
  -- the same parent row. Application transactions already update/lock the
  -- ingestion before appending its audit, so this preserves the global lock
  -- order (MediaIngestion -> AuditLog) without adding a reverse dependency.
  IF ingestion_id IS NOT NULL THEN
    PERFORM 1
    FROM "MediaIngestion"
    WHERE id = ingestion_id
    FOR UPDATE;
  END IF;

  IF NOT hsk_is_valid_current_media_cleanup_audit(
    NEW.action,
    NEW."targetType",
    NEW."targetId",
    NEW."afterSummary",
    NEW."createdAt"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'AuditLog_media_cleanup_integrity',
      MESSAGE = 'Media cleanup audit is malformed or temporally incoherent.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AuditLog_media_cleanup_integrity"
BEFORE INSERT ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION hsk_guard_media_cleanup_audit();

CREATE FUNCTION hsk_require_media_cleanup_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ingestion "MediaIngestion"%ROWTYPE;
BEGIN
  SELECT * INTO ingestion
  FROM "MediaIngestion"
  WHERE id = NEW.id;

  IF ingestion."cleanupRequiredAt" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "AuditLog" AS audit
      WHERE audit."targetType" = 'media_ingestion'
        AND audit."targetId" = ingestion.id::text
        AND audit."createdAt" = ingestion."cleanupRequiredAt"
        AND audit."afterSummary" ->> 'status' = 'cleanup_required'
        AND hsk_is_valid_media_cleanup_audit(
          audit.action,
          audit."targetType",
          audit."targetId",
          audit."afterSummary",
          audit."createdAt"
        )
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_cleanup_audit_required',
      MESSAGE = 'Media cleanup lifecycle requires an exact immutable audit.';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "MediaIngestion_cleanup_audit_required"
AFTER INSERT OR UPDATE OF status, "failureCode", "cleanupRequiredAt"
ON "MediaIngestion"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION hsk_require_media_cleanup_audit();

COMMIT;
