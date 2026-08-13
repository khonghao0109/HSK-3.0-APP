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
  first_cleanup_required_at TIMESTAMP(3);
  rejected BOOLEAN;
  mutation RECORD;
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

  IF (
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MediaIngestion'
      AND column_name IN (
        'sourceCodeSnapshot', 'sourceVersionSnapshot', 'sourceLicenseSnapshot',
        'sourceAttributionSnapshot', 'sourceReferenceUrlSnapshot',
        'sourceContentHashSnapshot', 'cleanupAbsentObservedAt',
        'cleanupRequiredAt'
      )
  ) <> 8 THEN
    RAISE EXCEPTION 'MediaIngestion provenance/reconciliation columns are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'DataSource'
      AND trigger_name = 'DataSource_media_provenance_guard'
  ) THEN
    RAISE EXCEPTION 'DataSource media provenance guard is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'MediaIngestion'
      AND trigger_name = 'MediaIngestion_00_provenance_snapshot'
  ) THEN
    RAISE EXCEPTION 'MediaIngestion provenance snapshot trigger is missing';
  END IF;

  INSERT INTO "User" (email, password, role, status, "createdAt", "updatedAt")
  VALUES ('media-integrity@example.test', 'not-a-real-password', 'admin', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING id INTO actor_id;

  INSERT INTO "DataSource" (
    code, name, version, "referenceUrl", license, attribution, "contentHash",
    "createdById", "createdAt", "updatedAt"
  ) VALUES (
    'MEDIA_INTEGRITY', 'Synthetic media integrity source', '2026.08',
    'https://example.test/media-integrity', 'Synthetic test fixture',
    'Synthetic attribution', repeat('7', 64), actor_id,
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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

  FOR mutation IN
    SELECT * FROM (VALUES
      ('code', NULL::TEXT), ('code', ''), ('code', 'MEDIA_CHANGED'),
      ('version', NULL::TEXT), ('version', ''), ('version', '2026.09'),
      ('license', NULL::TEXT), ('license', ''), ('license', 'Changed license'),
      ('referenceUrl', NULL::TEXT), ('referenceUrl', ''), ('referenceUrl', 'https://changed.example.test'),
      ('attribution', NULL::TEXT), ('attribution', ''), ('attribution', 'Changed attribution'),
      ('contentHash', NULL::TEXT), ('contentHash', ''), ('contentHash', repeat('8', 64))
    ) AS changes(field_name, new_value)
  LOOP
    rejected := FALSE;
    BEGIN
      EXECUTE format(
        'UPDATE "DataSource" SET %I = %L WHERE id = $1',
        mutation.field_name,
        mutation.new_value
      ) USING source_id;
    EXCEPTION WHEN check_violation THEN
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION 'Referenced DataSource mutation was accepted: %=%',
        mutation.field_name, mutation.new_value;
    END IF;
  END LOOP;

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
    CURRENT_TIMESTAMP - INTERVAL '1 hour', '30000000-0000-4000-8000-000000000003', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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
    UPDATE "MediaIngestion"
    SET "processingStartedAt" = CURRENT_TIMESTAMP - INTERVAL '1 hour'
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Active processing lifecycle timestamp mutation was accepted';
  END IF;

  IF (SELECT "processingStartedAt" FROM "MediaIngestion" WHERE id = transition_ingestion_id)
    < CURRENT_TIMESTAMP - INTERVAL '1 minute'
  THEN
    RAISE EXCEPTION 'Processing lifecycle timestamp was not assigned by the database';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion"
    SET "failureCode" = 'OBJECT_CLEANUP_IN_PROGRESS'
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Cleanup-in-progress code without prior cleanup lifecycle was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion"
    SET status = 'failed', "failureCode" = 'OBJECT_CLEANED'
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Object-cleaned terminal state without prior cleanup lifecycle was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion"
    SET status = 'failed', "failureCode" = 'OBJECT_WRITE_OUTCOME_UNKNOWN'
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Unknown object-write outcome outside cleanup_required was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion"
    SET
      "storageKey" = 'media/2026/08/218f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
      "failureCode" = 'OBJECT_CLEANUP_REQUIRED',
      status = 'cleanup_required',
      "cleanupRequiredAt" = CURRENT_TIMESTAMP - INTERVAL '1 minute'
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Forged first cleanup lifecycle timestamp was accepted';
  END IF;

  UPDATE "MediaIngestion"
  SET
    "storageKey" = 'media/2026/08/218f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
    "failureCode" = 'OBJECT_CLEANUP_REQUIRED',
    status = 'cleanup_required'
  WHERE id = transition_ingestion_id
  RETURNING "cleanupRequiredAt" INTO first_cleanup_required_at;

  IF first_cleanup_required_at IS NULL THEN
    RAISE EXCEPTION 'cleanup_required transition did not receive its lifecycle timestamp';
  END IF;

  UPDATE "MediaIngestion"
  SET "failureCode" = 'OBJECT_CLEANUP_SETTLING'
  WHERE id = transition_ingestion_id;

  UPDATE "MediaIngestion"
  SET "failureCode" = 'OBJECT_WRITE_OUTCOME_UNKNOWN'
  WHERE id = transition_ingestion_id;

  UPDATE "MediaIngestion"
  SET "failureCode" = 'OBJECT_CLEANUP_REQUIRED'
  WHERE id = transition_ingestion_id;

  IF (SELECT "cleanupRequiredAt" FROM "MediaIngestion" WHERE id = transition_ingestion_id)
    IS DISTINCT FROM first_cleanup_required_at
  THEN
    RAISE EXCEPTION 'Valid cleanup-required codes changed the first lifecycle timestamp';
  END IF;

  UPDATE "MediaIngestion"
  SET
    status = 'processing',
    "processingToken" = '70000000-0000-4000-8000-000000000007',
    "processingStartedAt" = CURRENT_TIMESTAMP,
    "failureCode" = 'OBJECT_CLEANUP_IN_PROGRESS',
    "updatedAt" = CURRENT_TIMESTAMP + INTERVAL '1 hour'
  WHERE id = transition_ingestion_id;

  IF (SELECT "cleanupRequiredAt" FROM "MediaIngestion" WHERE id = transition_ingestion_id)
    IS DISTINCT FROM first_cleanup_required_at
  THEN
    RAISE EXCEPTION 'Cleanup claim did not preserve the first cleanup lifecycle timestamp';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion"
    SET "cleanupRequiredAt" = NULL
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Active cleanup lifecycle timestamp was cleared';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion"
    SET "failureCode" = NULL
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Active cleanup lifecycle code was cleared';
  END IF;

  UPDATE "MediaIngestion"
  SET
    status = 'cleanup_required',
    "failureCode" = 'OBJECT_CLEANUP_REQUIRED',
    "cleanupAttempts" = 1,
    "cleanupLastAttemptAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP + INTERVAL '2 hours'
  WHERE id = transition_ingestion_id;

  IF (SELECT "cleanupRequiredAt" FROM "MediaIngestion" WHERE id = transition_ingestion_id)
    IS DISTINCT FROM first_cleanup_required_at
  THEN
    RAISE EXCEPTION 'Cleanup retry made the cleanup backlog age younger';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion"
    SET "failureCode" = NULL
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Cleanup-required lifecycle with a null code was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion"
    SET "failureCode" = 'FORGED_CLEANUP_CODE'
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Cleanup-required lifecycle with a forged code was accepted';
  END IF;

  rejected := FALSE;
  BEGIN
    UPDATE "MediaIngestion"
    SET "cleanupRequiredAt" = first_cleanup_required_at + INTERVAL '1 second'
    WHERE id = transition_ingestion_id;
  EXCEPTION WHEN check_violation THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Immutable cleanup lifecycle timestamp mutation was accepted';
  END IF;

  UPDATE "MediaIngestion"
  SET
    status = 'processing',
    "processingToken" = '80000000-0000-4000-8000-000000000008',
    "failureCode" = 'OBJECT_CLEANUP_IN_PROGRESS',
    "updatedAt" = CURRENT_TIMESTAMP + INTERVAL '3 hours'
  WHERE id = transition_ingestion_id;

  UPDATE "MediaIngestion"
  SET
    status = 'failed',
    "failureCode" = 'OBJECT_CLEANED',
    "cleanupAttempts" = 2,
    "cleanupLastAttemptAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP + INTERVAL '4 hours'
  WHERE id = transition_ingestion_id;

  IF (SELECT "cleanupRequiredAt" FROM "MediaIngestion" WHERE id = transition_ingestion_id)
    IS DISTINCT FROM first_cleanup_required_at
  THEN
    RAISE EXCEPTION 'Completed cleanup did not preserve the first cleanup lifecycle timestamp';
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
