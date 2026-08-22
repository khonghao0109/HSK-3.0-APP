\set ON_ERROR_STOP on

-- Positive upgrade fixture for migration
-- 20260813163000_media_lifecycle_telemetry_truthfulness. Apply this only to a
-- disposable database after migrations through
-- 20260813120000_media_provenance_provider_hardening. The migration must
-- preserve the immutable first cleanup_required audit timestamp exactly.
DO $$
DECLARE
  actor_id INTEGER;
  source_id INTEGER;
  ingestion_id INTEGER;
BEGIN
  INSERT INTO "User" (
    email, password, role, status, "createdAt", "updatedAt"
  ) VALUES (
    'media-telemetry-cleanup-upgrade@example.test',
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
    'MEDIA_TELEMETRY_CLEANUP_UPGRADE',
    'Synthetic cleanup migration upgrade source',
    '2026.08',
    'https://example.test/media-telemetry-cleanup-upgrade',
    'Synthetic test fixture',
    'Synthetic attribution',
    repeat('4', 64),
    actor_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO source_id;

  INSERT INTO "MediaIngestion" (
    "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint",
    status, "originalFilename", "declaredMimeType", size, "storageProvider",
    "storageKey", "processingStartedAt", "processingToken", "attemptCount",
    "cleanupAttempts", "cleanupLastAttemptAt", "failureCode", "startedAt",
    "updatedAt"
  ) VALUES (
    actor_id,
    source_id,
    repeat('2', 64),
    repeat('3', 64),
    'cleanup_required',
    'cleanup-upgrade.png',
    'image/png',
    8,
    'memory-test',
    'media/2026/08/418f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
    CURRENT_TIMESTAMP - INTERVAL '3 hours',
    'a1000000-0000-4000-8000-00000000001a',
    1,
    1,
    CURRENT_TIMESTAMP - INTERVAL '2 hours',
    'OBJECT_CLEANUP_REQUIRED',
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
      'ingestionId', ingestion_id,
      'status', 'cleanup_required',
      'failureCode', 'OBJECT_CLEANUP_REQUIRED'
    ),
    CURRENT_TIMESTAMP - INTERVAL '2 hours 1 minute'
  );
END
$$;
