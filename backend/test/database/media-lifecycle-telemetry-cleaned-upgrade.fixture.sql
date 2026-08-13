\set ON_ERROR_STOP on

-- Positive upgrade fixture for migration
-- 20260813163000_media_lifecycle_telemetry_truthfulness. Apply this only to a
-- disposable database after migrations through
-- 20260813120000_media_provenance_provider_hardening, then run migrate deploy.
-- The migration must backfill cleanupRequiredAt from the immutable audit even
-- though migration 17 already made failed/OBJECT_CLEANED history terminal.
DO $$
DECLARE
  actor_id INTEGER;
  source_id INTEGER;
  ingestion_id INTEGER;
BEGIN
  INSERT INTO "User" (
    email, password, role, status, "createdAt", "updatedAt"
  ) VALUES (
    'media-telemetry-cleaned-upgrade@example.test',
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
    'MEDIA_TELEMETRY_CLEANED_UPGRADE',
    'Synthetic cleaned migration upgrade source',
    '2026.08',
    'https://example.test/media-telemetry-cleaned-upgrade',
    'Synthetic test fixture',
    'Synthetic attribution',
    repeat('8', 64),
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
    repeat('5', 64),
    repeat('6', 64),
    'failed',
    'cleaned-upgrade.png',
    'image/png',
    8,
    'memory-test',
    'media/2026/08/518f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
    CURRENT_TIMESTAMP - INTERVAL '3 hours',
    'a0000000-0000-4000-8000-00000000000a',
    1,
    1,
    CURRENT_TIMESTAMP - INTERVAL '2 hours',
    'OBJECT_CLEANED',
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
