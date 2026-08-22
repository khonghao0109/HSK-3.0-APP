\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  actor_id INTEGER;
  source_id INTEGER;
  ingestion_id INTEGER;
  paired_ingestion_id INTEGER;
  failed_ingestion_id INTEGER;
  cleanup_required_at TIMESTAMP(3);
  paired_cleanup_required_at TIMESTAMP(3);
  candidate RECORD;
  rejected BOOLEAN;
  rejected_constraint TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND event_object_table = 'AuditLog'
      AND trigger_name = 'AuditLog_media_cleanup_integrity'
  ) THEN
    RAISE EXCEPTION 'Media cleanup audit integrity trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'AuditLog'
      AND indexdef LIKE '%("targetType", "targetId", "createdAt")%'
  ) THEN
    RAISE EXCEPTION 'Authoritative audit lookup index is missing';
  END IF;

  INSERT INTO "User" (
    email, password, role, status, "createdAt", "updatedAt"
  ) VALUES (
    'media-cleanup-audit-integrity@example.test',
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
    'MEDIA_CLEANUP_AUDIT_INTEGRITY',
    'Synthetic cleanup audit integrity source',
    '2026.08',
    'https://example.test/media-cleanup-audit-integrity',
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
    'audit-integrity.png',
    'image/png',
    8,
    'memory-test',
    'media/2026/08/c18f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
    'f0000000-0000-4000-8000-00000000000f',
    1,
    CURRENT_TIMESTAMP - INTERVAL '1 hour',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO ingestion_id;

  UPDATE "MediaIngestion"
  SET status = 'cleanup_required',
      "failureCode" = 'OBJECT_CLEANUP_REQUIRED'
  WHERE id = ingestion_id
  RETURNING "cleanupRequiredAt" INTO cleanup_required_at;

  FOR candidate IN
    SELECT *
    FROM (
      VALUES
        (
          'missing targetId',
          'media.ingestion_failed',
          'media_ingestion',
          NULL::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          cleanup_required_at
        ),
        (
          'unknown targetId',
          'media.ingestion_failed',
          'media_ingestion',
          (ingestion_id + 1000)::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id + 1000,
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          cleanup_required_at
        ),
        (
          'wrong targetType',
          'media.ingestion_failed',
          'media',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          cleanup_required_at
        ),
        (
          'missing ingestionId',
          'media.ingestion_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          cleanup_required_at
        ),
        (
          'mismatched ingestionId',
          'media.ingestion_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id + 1,
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          cleanup_required_at
        ),
        (
          'string ingestionId',
          'media.ingestion_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id::TEXT,
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          cleanup_required_at
        ),
        (
          'missing status',
          'media.ingestion_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          cleanup_required_at
        ),
        (
          'wrong status',
          'media.ingestion_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'status', 'completed',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          cleanup_required_at
        ),
        (
          'missing failureCode',
          'media.ingestion_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'status', 'cleanup_required'
          ),
          cleanup_required_at
        ),
        (
          'forged failureCode',
          'media.ingestion_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'status', 'cleanup_required',
            'failureCode', 'FORGED_CLEANUP_CODE'
          ),
          cleanup_required_at
        ),
        (
          'future timestamp',
          'media.ingestion_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          CURRENT_TIMESTAMP + INTERVAL '1 hour'
        ),
        (
          'timestamp before lifecycle start',
          'media.ingestion_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          CURRENT_TIMESTAMP - INTERVAL '2 hours'
        ),
        (
          'forged lifecycle-start timestamp',
          'media.ingestion_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          cleanup_required_at - INTERVAL '1 hour'
        ),
        (
          'cleanup_failed wrong code',
          'media.ingestion_cleanup_failed',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_SETTLING'
          ),
          CURRENT_TIMESTAMP
        ),
        (
          'cleanup_settling wrong code',
          'media.ingestion_cleanup_settling',
          'media_ingestion',
          ingestion_id::TEXT,
          jsonb_build_object(
            'ingestionId', ingestion_id,
            'status', 'cleanup_required',
            'failureCode', 'OBJECT_CLEANUP_REQUIRED'
          ),
          CURRENT_TIMESTAMP
        )
    ) AS malformed(
      label,
      action,
      target_type,
      target_id,
      after_summary,
      created_at
    )
  LOOP
    rejected := FALSE;
    rejected_constraint := NULL;
    BEGIN
      INSERT INTO "AuditLog" (
        "actorId", action, "targetType", "targetId", "afterSummary", "createdAt"
      ) VALUES (
        actor_id,
        candidate.action,
        candidate.target_type,
        candidate.target_id,
        candidate.after_summary,
        candidate.created_at
      );
    EXCEPTION
      WHEN check_violation THEN
        GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
        IF rejected_constraint <> 'AuditLog_media_cleanup_integrity' THEN
          RAISE;
        END IF;
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION 'Malformed cleanup audit was accepted: %', candidate.label;
    END IF;
  END LOOP;

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
    cleanup_required_at
  );

  -- Historical cleanup facts remain valid across retry states, but every new
  -- cleanup audit must exactly describe the current row state and code.
  UPDATE "MediaIngestion"
  SET "failureCode" = 'OBJECT_CLEANUP_SETTLING'
  WHERE id = ingestion_id;
  rejected := FALSE;
  BEGIN
    INSERT INTO "AuditLog" (
      "actorId", action, "targetType", "targetId", "afterSummary"
    ) VALUES (
      actor_id,
      'media.ingestion_cleanup_failed',
      'media_ingestion',
      ingestion_id::text,
      jsonb_build_object(
        'ingestionId', ingestion_id,
        'status', 'cleanup_required',
        'failureCode', 'OBJECT_CLEANUP_REQUIRED'
      )
    );
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'AuditLog_media_cleanup_integrity' THEN
        RAISE;
      END IF;
      rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Cross-code cleanup audit was accepted';
  END IF;

  UPDATE "MediaIngestion"
  SET status = 'processing',
      "processingToken" = 'f9000000-0000-4000-8000-00000000009f',
      "failureCode" = 'OBJECT_CLEANUP_IN_PROGRESS'
  WHERE id = ingestion_id;
  rejected := FALSE;
  BEGIN
    INSERT INTO "AuditLog" (
      "actorId", action, "targetType", "targetId", "afterSummary"
    ) VALUES (
      actor_id,
      'media.ingestion_cleanup_settling',
      'media_ingestion',
      ingestion_id::text,
      jsonb_build_object(
        'ingestionId', ingestion_id,
        'status', 'cleanup_required',
        'failureCode', 'OBJECT_CLEANUP_SETTLING'
      )
    );
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'AuditLog_media_cleanup_integrity' THEN
        RAISE;
      END IF;
      rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Cleanup audit was accepted for an in-progress row';
  END IF;

  -- A historical generic failure may coexist with a later cleanup lifecycle,
  -- but a new generic failed audit cannot be appended after the row moved on.
  rejected := FALSE;
  rejected_constraint := NULL;
  BEGIN
    INSERT INTO "AuditLog" (
      "actorId", action, "targetType", "targetId", "afterSummary"
    ) VALUES (
      actor_id,
      'media.ingestion_failed',
      'media_ingestion',
      ingestion_id::text,
      jsonb_build_object(
        'ingestionId', ingestion_id,
        'status', 'failed',
        'failureCode', 'STORAGE_WRITE_FAILED'
      )
    );
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'AuditLog_media_cleanup_integrity' THEN
        RAISE;
      END IF;
      rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Generic failed audit was accepted for a cleanup row';
  END IF;

  INSERT INTO "MediaIngestion" (
    "actorId", "dataSourceId", "idempotencyKeyHash", "requestFingerprint",
    status, "originalFilename", "declaredMimeType", size, "storageProvider",
    "storageKey", "processingToken", "attemptCount", "startedAt", "updatedAt"
  ) VALUES (
    actor_id,
    source_id,
    repeat('4', 64),
    repeat('5', 64),
    'processing',
    'audit-pairing.png',
    'image/png',
    8,
    'memory-test',
    'media/2026/08/d18f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png',
    'f1000000-0000-4000-8000-00000000001f',
    1,
    CURRENT_TIMESTAMP - INTERVAL '1 hour',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO paired_ingestion_id;

  rejected := FALSE;
  rejected_constraint := NULL;
  BEGIN
    UPDATE "MediaIngestion"
    SET status = 'cleanup_required',
        "failureCode" = 'OBJECT_CLEANUP_REQUIRED'
    WHERE id = paired_ingestion_id;
    SET CONSTRAINTS "MediaIngestion_cleanup_audit_required" IMMEDIATE;
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
      IF rejected_constraint <> 'MediaIngestion_cleanup_audit_required' THEN
        RAISE;
      END IF;
      rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Cleanup lifecycle without an audit was accepted';
  END IF;

  SET CONSTRAINTS "MediaIngestion_cleanup_audit_required" DEFERRED;
  -- Timestamp binding is between timestamp-without-time-zone values owned by
  -- the same transaction and must not depend on the deploy session timezone.
  SET LOCAL TIME ZONE 'Asia/Ho_Chi_Minh';
  UPDATE "MediaIngestion"
  SET status = 'cleanup_required',
      "failureCode" = 'OBJECT_CLEANUP_REQUIRED'
  WHERE id = paired_ingestion_id
  RETURNING "cleanupRequiredAt" INTO paired_cleanup_required_at;
  INSERT INTO "AuditLog" (
    "actorId", action, "targetType", "targetId", "afterSummary", "createdAt"
  ) VALUES (
    actor_id,
    'media.ingestion_failed',
    'media_ingestion',
    paired_ingestion_id::text,
    jsonb_build_object(
      'ingestionId', paired_ingestion_id,
      'status', 'cleanup_required',
      'failureCode', 'OBJECT_CLEANUP_REQUIRED'
    ),
    paired_cleanup_required_at
  );
  IF NOT EXISTS (
    SELECT 1
    FROM "AuditLog"
    WHERE "targetType" = 'media_ingestion'
      AND "targetId" = paired_ingestion_id::text
      AND "createdAt" = paired_cleanup_required_at
  ) THEN
    RAISE EXCEPTION 'Paired cleanup audit timestamp was not database-bound';
  END IF;
  SET CONSTRAINTS "MediaIngestion_cleanup_audit_required" IMMEDIATE;

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
    'generic-failed-audit.png',
    'image/png',
    8,
    'memory-test',
    'f3000000-0000-4000-8000-00000000003f',
    1,
    'STORAGE_WRITE_FAILED',
    CURRENT_TIMESTAMP - INTERVAL '1 hour',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO failed_ingestion_id;

  INSERT INTO "AuditLog" (
    "actorId", action, "targetType", "targetId", "afterSummary"
  ) VALUES (
    actor_id,
    'media.ingestion_failed',
    'media_ingestion',
    failed_ingestion_id::text,
    jsonb_build_object(
      'ingestionId', failed_ingestion_id,
      'status', 'failed',
      'failureCode', 'STORAGE_WRITE_FAILED'
    )
  );
END
$$;

ROLLBACK;
