\set ON_ERROR_STOP on

-- Synthetic fixture for a two-session AuditLog/MediaIngestion serialization
-- rehearsal. Apply only after the forward cleanup-audit integrity migration.
DO $$
DECLARE
  actor_id INTEGER;
  source_id INTEGER;
BEGIN
  INSERT INTO "User" (
    email, password, role, status, "createdAt", "updatedAt"
  ) VALUES (
    'media-cleanup-audit-race@example.test',
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
    'MEDIA_CLEANUP_AUDIT_RACE',
    'Synthetic cleanup audit race source',
    '2026.08',
    'https://example.test/media-cleanup-audit-race',
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
    "processingToken", "attemptCount", "failureCode", "startedAt", "updatedAt"
  ) VALUES (
    actor_id,
    source_id,
    repeat('9', 64),
    repeat('a', 64),
    'failed',
    'audit-race.png',
    'image/png',
    8,
    'memory-test',
    'f4000000-0000-4000-8000-00000000004f',
    1,
    'STORAGE_WRITE_FAILED',
    CURRENT_TIMESTAMP - INTERVAL '1 hour',
    CURRENT_TIMESTAMP
  );

  INSERT INTO "MediaIngestion" (
    "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint",
    status, "originalFilename", "declaredMimeType", size, "storageProvider",
    "processingToken", "attemptCount", "failureCode", "startedAt", "updatedAt"
  ) VALUES (
    actor_id,
    source_id,
    repeat('6', 64),
    repeat('7', 64),
    'failed',
    'lifecycle-first-race.png',
    'image/png',
    8,
    'memory-test',
    'f6000000-0000-4000-8000-00000000006f',
    1,
    'STORAGE_WRITE_FAILED',
    CURRENT_TIMESTAMP - INTERVAL '1 hour',
    CURRENT_TIMESTAMP
  );
END
$$;
