\set ON_ERROR_STOP on

-- Apply only to a fresh disposable database after migration 18 and before the
-- forward cleanup-audit integrity migration. A future audit timestamp must not
-- be accepted as an authoritative lifecycle timestamp with a clamped age of 0.
DO $$
DECLARE
  actor_id INTEGER;
  source_id INTEGER;
  ingestion_id INTEGER;
BEGIN
  INSERT INTO "User" (
    email, password, role, status, "createdAt", "updatedAt"
  ) VALUES (
    'media-cleanup-audit-future@example.test',
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
    'MEDIA_CLEANUP_AUDIT_FUTURE',
    'Synthetic future cleanup audit source',
    '2026.08',
    'https://example.test/media-cleanup-audit-future',
    'Synthetic test fixture',
    'Synthetic attribution',
    repeat('d', 64),
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
    repeat('e', 64),
    repeat('f', 64),
    'processing',
    'future-audit.png',
    'image/png',
    8,
    'memory-test',
    'media/2026/08/b18f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
    'e0000000-0000-4000-8000-00000000000e',
    1,
    CURRENT_TIMESTAMP - INTERVAL '1 hour',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO ingestion_id;

  UPDATE "MediaIngestion"
  SET status = 'cleanup_required',
      "failureCode" = 'OBJECT_CLEANUP_REQUIRED'
  WHERE id = ingestion_id;

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
    CURRENT_TIMESTAMP + INTERVAL '1 hour'
  );
END
$$;
