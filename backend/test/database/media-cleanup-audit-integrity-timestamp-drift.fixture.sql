\set ON_ERROR_STOP on

-- Apply only to a fresh disposable database after migration 18. The immutable
-- cleanup audit is structurally and temporally valid, but it deliberately does
-- not bind the exact DB-owned first cleanup timestamp. Migration 19 must pass
-- its malformed-audit block and abort in the authoritative timestamp block.
DO $$
DECLARE
  actor_id INTEGER;
  source_id INTEGER;
  ingestion_id INTEGER;
  cleanup_required_at TIMESTAMP(3);
BEGIN
  INSERT INTO "User" (
    email, password, role, status, "createdAt", "updatedAt"
  ) VALUES (
    'media-cleanup-timestamp-drift@example.test',
    'synthetic-not-a-real-password',
    'admin',
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO actor_id;

  INSERT INTO "DataSource" (
    code, name, version, "referenceUrl", license, attribution, "contentHash",
    "createdById", "createdAt", "updatedAt"
  ) VALUES (
    'MEDIA_CLEANUP_TIMESTAMP_DRIFT',
    'Synthetic cleanup timestamp drift source',
    '2026.08',
    'https://example.test/media-cleanup-timestamp-drift',
    'Synthetic test fixture',
    'Synthetic attribution',
    repeat('1', 64),
    actor_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO source_id;

  INSERT INTO "MediaIngestion" (
    "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint",
    status, "originalFilename", "declaredMimeType", size, "storageProvider",
    "storageKey", "processingToken", "attemptCount", "startedAt", "updatedAt"
  ) VALUES (
    actor_id,
    source_id,
    repeat('2', 64),
    repeat('3', 64),
    'processing',
    'timestamp-drift.png',
    'image/png',
    8,
    'memory-test',
    'media/2026/08/c18f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
    'f3000000-0000-4000-8000-00000000003f',
    1,
    CURRENT_TIMESTAMP - INTERVAL '1 hour',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO ingestion_id;

  UPDATE "MediaIngestion"
  SET status = 'cleanup_required',
      "failureCode" = 'OBJECT_CLEANUP_REQUIRED'
  WHERE id = ingestion_id
  RETURNING "cleanupRequiredAt" INTO cleanup_required_at;

  -- CURRENT_TIMESTAMP is transaction-stable. Wait until the deliberately
  -- shifted millisecond is in the past relative to clock_timestamp().
  PERFORM pg_sleep(0.010);

  INSERT INTO "AuditLog" (
    "actorId", action, "targetType", "targetId", "afterSummary", "createdAt"
  ) VALUES (
    actor_id,
    'media.ingestion_cleanup_failed',
    'media_ingestion',
    ingestion_id::text,
    jsonb_build_object(
      'ingestionId', ingestion_id,
      'status', 'cleanup_required',
      'failureCode', 'OBJECT_CLEANUP_REQUIRED'
    ),
    cleanup_required_at + INTERVAL '1 millisecond'
  );
END
$$;
