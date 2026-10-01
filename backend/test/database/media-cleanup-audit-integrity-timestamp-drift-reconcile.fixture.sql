\set ON_ERROR_STOP on

-- Forward-only operator rehearsal for the disposable timestamp-drift fixture.
-- Preserve the existing immutable audit and append the missing exact first fact.
DO $$
DECLARE
  inserted_rows INTEGER;
BEGIN
  INSERT INTO "AuditLog" (
    "actorId", action, "targetType", "targetId", "afterSummary", "createdAt"
  )
  SELECT
    ingestion."actorId",
    'media.ingestion_failed',
    'media_ingestion',
    ingestion.id::text,
    jsonb_build_object(
      'ingestionId', ingestion.id,
      'status', 'cleanup_required',
      'failureCode', 'OBJECT_CLEANUP_REQUIRED'
    ),
    ingestion."cleanupRequiredAt"
  FROM "MediaIngestion" AS ingestion
  WHERE ingestion."idempotencyKeyHash" = repeat('2', 64)
    AND ingestion.status = 'cleanup_required'
    AND ingestion."failureCode" = 'OBJECT_CLEANUP_REQUIRED'
    AND ingestion."cleanupRequiredAt" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "AuditLog" AS audit
      WHERE audit."targetType" = 'media_ingestion'
        AND audit."targetId" = ingestion.id::text
        AND audit."createdAt" = ingestion."cleanupRequiredAt"
        AND audit."afterSummary" ->> 'status' = 'cleanup_required'
    );

  GET DIAGNOSTICS inserted_rows = ROW_COUNT;
  IF inserted_rows <> 1 THEN
    RAISE EXCEPTION 'Timestamp-drift reconciliation inserted no authoritative fact.';
  END IF;
END
$$;
