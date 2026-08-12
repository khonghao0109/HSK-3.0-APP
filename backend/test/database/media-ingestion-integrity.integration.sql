\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  actor_id INTEGER;
  source_id INTEGER;
  media_id INTEGER;
  mismatch_media_id INTEGER;
  ingestion_id INTEGER;
  transition_ingestion_id INTEGER;
  rejected BOOLEAN;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaIngestionStatus')
    OR NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'MediaIngestion'
    )
    OR NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'MediaUploadRateLimit'
    )
  THEN
    RAISE EXCEPTION 'Secure media ingestion schema is incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'MediaIngestion'
      AND trigger_name = 'MediaIngestion_lifecycle_guard'
  ) THEN
    RAISE EXCEPTION 'MediaIngestion lifecycle trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'Media'
      AND trigger_name = 'Media_ingested_identity_guard'
  ) THEN
    RAISE EXCEPTION 'Ingested Media identity trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'MediaIngestion'
      AND trigger_name = 'MediaIngestion_completed_media_coherence'
  ) THEN
    RAISE EXCEPTION 'MediaIngestion completed-media coherence trigger is missing';
  END IF;

  INSERT INTO "User" (email, password, role, status, "createdAt", "updatedAt")
  VALUES ('media-integrity@example.test', 'not-a-real-password', 'admin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING id INTO actor_id;

  INSERT INTO "DataSource" (
    code, name, version, license, "createdById", "createdAt", "updatedAt"
  ) VALUES (
    'MEDIA_INTEGRITY', 'Synthetic media integrity source', '2026.08',
    'Synthetic test fixture', actor_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO source_id;

  INSERT INTO "Media" (
    url, type, "mimeType", size, "storageProvider", "storageKey",
    "originalFilename", checksum, "processingStatus", "uploadedById",
    "updatedById", "dataSourceId", "createdAt", "updatedAt"
  ) VALUES (
    '/api/v1/media/pending/access', 'image', 'image/png', 8,
    'memory-test', 'media/2026/08/018f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
    'lesson.png', repeat('a', 64), 'ready', actor_id, actor_id, source_id,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO media_id;

  UPDATE "Media"
  SET url = '/api/v1/media/' || media_id || '/access'
  WHERE id = media_id;

  INSERT INTO "MediaIngestion" (
    "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint", status,
    "originalFilename", "declaredMimeType", "validatedMimeType", size,
    checksum, "storageProvider", "storageKey", "mediaId", "attemptCount",
    "processingStartedAt", "processingToken", "completedAt", "startedAt", "updatedAt"
  ) VALUES (
    actor_id, source_id, repeat('b', 64), repeat('c', 64), 'completed',
    'lesson.png', 'image/png', 'image/png', 8, repeat('a', 64),
    'memory-test', 'media/2026/08/018f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
    media_id, 1, CURRENT_TIMESTAMP, '10000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO ingestion_id;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion" SET status = 'failed', "mediaId" = NULL,
      "completedAt" = NULL WHERE id = ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Completed MediaIngestion mutation was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    DELETE FROM "MediaIngestion" WHERE id = ingestion_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'MediaIngestion hard delete was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    DELETE FROM "Media" WHERE id = media_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Referenced Media hard delete was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "Media" SET checksum = repeat('9', 64) WHERE id = media_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Completed ingestion Media identity mutation was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    INSERT INTO "MediaIngestion" (
      "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint", status,
      "originalFilename", "declaredMimeType", size, "storageProvider",
      "attemptCount", "processingStartedAt", "processingToken", "startedAt", "updatedAt"
    ) VALUES (
      actor_id, source_id, repeat('d', 64), repeat('e', 64), 'processing',
      '../unsafe.png', 'image/png', 8, 'memory-test', 1,
      CURRENT_TIMESTAMP, '20000000-0000-4000-8000-000000000002', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Unsafe original filename was accepted';
  END IF;

  INSERT INTO "MediaIngestion" (
    "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint", status,
    "originalFilename", "declaredMimeType", size, "storageProvider",
    "attemptCount", "processingStartedAt", "processingToken", "startedAt", "updatedAt"
  ) VALUES (
    actor_id, source_id, repeat('3', 64), repeat('4', 64), 'processing',
    'transition.png', 'image/png', 8, 'memory-test', 1,
    CURRENT_TIMESTAMP, '30000000-0000-4000-8000-000000000003', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO transition_ingestion_id;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion" SET status = 'pending'
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Invalid processing-to-pending transition was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion"
    SET "processingToken" = '60000000-0000-4000-8000-000000000006'
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Processing fencing identity mutation was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    INSERT INTO "MediaIngestion" (
      "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint", status,
      "originalFilename", "declaredMimeType", size, "storageProvider",
      "attemptCount", "processingToken", "startedAt", "updatedAt"
    ) VALUES (
      actor_id, source_id, repeat('f', 64), repeat('0', 64), 'completed',
      'missing.png', 'image/png', 8, 'memory-test', 1,
      '40000000-0000-4000-8000-000000000004',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Incoherent completed ingestion was accepted';
  END IF;

  INSERT INTO "Media" (
    url, type, "mimeType", size, "storageProvider", "storageKey",
    "originalFilename", checksum, "processingStatus", "uploadedById",
    "updatedById", "dataSourceId", "createdAt", "updatedAt"
  ) VALUES (
    '/api/v1/media/mismatch/access', 'image', 'image/png', 8,
    'memory-test', 'media/2026/08/118f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
    'mismatch.png', repeat('8', 64), 'ready', actor_id, actor_id, source_id,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO mismatch_media_id;

  UPDATE "Media"
  SET url = '/api/v1/media/' || mismatch_media_id || '/access'
  WHERE id = mismatch_media_id;

  rejected := FALSE;
  BEGIN
    INSERT INTO "MediaIngestion" (
      "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint", status,
      "originalFilename", "declaredMimeType", "validatedMimeType", size,
      checksum, "storageProvider", "storageKey", "mediaId", "attemptCount",
      "processingStartedAt", "processingToken", "completedAt", "startedAt", "updatedAt"
    ) VALUES (
      actor_id, source_id, repeat('1', 64), repeat('2', 64), 'completed',
      'mismatch.png', 'image/png', 'image/png', 9, repeat('8', 64),
      'memory-test', 'media/2026/08/118f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
      mismatch_media_id, 1, CURRENT_TIMESTAMP, '50000000-0000-4000-8000-000000000005', CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Completed ingestion with mismatched Media was accepted';
  END IF;
END
$$;

ROLLBACK;
