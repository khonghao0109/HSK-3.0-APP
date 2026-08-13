\set ON_ERROR_STOP on

-- Negative upgrade fixture for migration
-- 20260813163000_media_lifecycle_telemetry_truthfulness. Apply this only to a
-- disposable database after migrations through
-- 20260813120000_media_provenance_provider_hardening, then run migrate deploy.
-- The next migration must abort with SQLSTATE P0001 before changing the schema.
DO $$
DECLARE
  actor_id INTEGER;
  source_id INTEGER;
BEGIN
  INSERT INTO "User" (
    email, password, role, status, "createdAt", "updatedAt"
  ) VALUES (
    'media-telemetry-preflight@example.test',
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
    'MEDIA_TELEMETRY_PREFLIGHT',
    'Synthetic migration preflight source',
    '2026.08',
    'https://example.test/media-telemetry-preflight',
    'Synthetic test fixture',
    'Synthetic attribution',
    repeat('7', 64),
    actor_id,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO source_id;

  INSERT INTO "MediaIngestion" (
    "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint",
    status, "originalFilename", "declaredMimeType", size, "storageProvider",
    "processingStartedAt", "processingToken", "attemptCount", "startedAt",
    "updatedAt"
  ) VALUES (
    actor_id,
    source_id,
    repeat('3', 64),
    repeat('4', 64),
    'processing',
    'migration-preflight.png',
    'image/png',
    8,
    'memory-test',
    CURRENT_TIMESTAMP - INTERVAL '1 hour',
    '90000000-0000-4000-8000-000000000009',
    1,
    CURRENT_TIMESTAMP - INTERVAL '1 hour',
    CURRENT_TIMESTAMP
  );

  IF NOT EXISTS (
    SELECT 1 FROM "MediaIngestion" WHERE status = 'processing'
  ) THEN
    RAISE EXCEPTION 'Negative migration fixture did not create an active processing row';
  END IF;
END
$$;
