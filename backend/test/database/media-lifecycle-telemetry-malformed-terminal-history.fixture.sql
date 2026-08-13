\set ON_ERROR_STOP on

-- Negative migration fixture. The terminal row would otherwise be ignored by
-- lifecycle backfill, but its immutable cleanup_required audit is malformed.
DO $$
DECLARE
  actor_id INTEGER;
  source_id INTEGER;
  ingestion_id INTEGER;
BEGIN
  INSERT INTO "User" (
    email, password, role, status, "createdAt", "updatedAt"
  ) VALUES (
    'media-telemetry-malformed-history@example.test',
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
    'MEDIA_TELEMETRY_MALFORMED_HISTORY',
    'Synthetic malformed cleanup history source',
    '2026.08',
    'https://example.test/media-telemetry-malformed-history',
    'Synthetic test fixture',
    'Synthetic attribution',
    repeat('a', 64),
    actor_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO source_id;

  INSERT INTO "MediaIngestion" (
    "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint",
    status, "originalFilename", "declaredMimeType", size, "storageProvider",
    "processingStartedAt", "processingToken", "attemptCount", "failureCode",
    "startedAt", "updatedAt"
  ) VALUES (
    actor_id,
    source_id,
    repeat('b', 64),
    repeat('c', 64),
    'failed',
    'malformed-history.png',
    'image/png',
    8,
    'memory-test',
    CURRENT_TIMESTAMP - INTERVAL '3 hours',
    'c0000000-0000-4000-8000-00000000000c',
    1,
    'STORAGE_WRITE_FAILED',
    CURRENT_TIMESTAMP - INTERVAL '3 hours',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO ingestion_id;

  INSERT INTO "AuditLog" (
    "actorId", action, "targetType", "targetId", "afterSummary", "createdAt"
  ) VALUES (
    actor_id,
    'media.ingestion_failed',
    'media_ingestion',
    ingestion_id::text,
    jsonb_build_object(
      'status', 'cleanup_required',
      'failureCode', 'OBJECT_CLEANUP_REQUIRED'
    ),
    CURRENT_TIMESTAMP - INTERVAL '2 hours'
  );
END
$$;
