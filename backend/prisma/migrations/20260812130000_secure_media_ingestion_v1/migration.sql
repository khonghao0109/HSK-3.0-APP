-- Secure Media Ingestion V1 coordination and idempotency state.
-- Forward-only: no historical migration is modified.

CREATE TYPE "MediaIngestionStatus" AS ENUM (
  'pending',
  'processing',
  'completed',
  'rejected',
  'failed',
  'cleanup_required'
);

CREATE TABLE "MediaIngestion" (
  id SERIAL NOT NULL,
  "actorId" INTEGER NOT NULL,
  "dataSourceId" INTEGER NOT NULL,
  "idempotencyKeyHash" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  status "MediaIngestionStatus" NOT NULL DEFAULT 'pending',
  "originalFilename" TEXT NOT NULL,
  "declaredMimeType" TEXT NOT NULL,
  "validatedMimeType" TEXT,
  size INTEGER NOT NULL,
  checksum TEXT,
  "storageProvider" TEXT NOT NULL,
  "storageKey" TEXT,
  "mediaId" INTEGER,
  "failureCode" TEXT,
  "processingStartedAt" TIMESTAMP(3),
  "processingToken" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "cleanupAttempts" INTEGER NOT NULL DEFAULT 0,
  "cleanupLastAttemptAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MediaIngestion_pkey" PRIMARY KEY (id),
  CONSTRAINT "MediaIngestion_size_check" CHECK (size BETWEEN 1 AND 10485760),
  CONSTRAINT "MediaIngestion_originalFilename_check" CHECK (
    char_length("originalFilename") BETWEEN 1 AND 160
    AND "originalFilename" !~ '[[:cntrl:]/\\]'
    AND "originalFilename" !~* '(\.\.|%2f|%5c|%252f|%255c|^[A-Za-z]:)'
    AND "originalFilename" IS NFKC NORMALIZED
  ),
  CONSTRAINT "MediaIngestion_declaredMimeType_check" CHECK (
    char_length("declaredMimeType") BETWEEN 1 AND 100
    AND "declaredMimeType" !~ '[[:cntrl:][:space:]]'
  ),
  CONSTRAINT "MediaIngestion_validatedMimeType_check" CHECK (
    "validatedMimeType" IS NULL
    OR "validatedMimeType" IN ('image/jpeg', 'image/png', 'audio/mpeg', 'audio/wav')
  ),
  CONSTRAINT "MediaIngestion_checksum_check" CHECK (
    checksum IS NULL OR checksum ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "MediaIngestion_idempotency_hash_check" CHECK (
    "idempotencyKeyHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "MediaIngestion_request_fingerprint_check" CHECK (
    "requestFingerprint" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "MediaIngestion_processingToken_check" CHECK (
    "processingToken" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  ),
  CONSTRAINT "MediaIngestion_storageKey_check" CHECK (
    "storageKey" IS NULL
    OR "storageKey" ~ '^media/[0-9]{4}/[0-9]{2}/[A-Za-z0-9-]{16,64}[.](jpg|png|mp3|wav)$'
  ),
  CONSTRAINT "MediaIngestion_lifecycle_check" CHECK (
    (status = 'completed' AND "mediaId" IS NOT NULL AND checksum IS NOT NULL AND "validatedMimeType" IS NOT NULL AND "storageKey" IS NOT NULL AND "completedAt" IS NOT NULL AND "failureCode" IS NULL)
    OR
    (status <> 'completed' AND "mediaId" IS NULL AND "completedAt" IS NULL)
  ),
  CONSTRAINT "MediaIngestion_cleanup_check" CHECK (
    "cleanupAttempts" >= 0
    AND ("cleanupAttempts" = 0 OR "cleanupLastAttemptAt" IS NOT NULL)
    AND (status <> 'cleanup_required' OR ("storageKey" IS NOT NULL AND "failureCode" IS NOT NULL))
    AND (status NOT IN ('failed', 'rejected') OR "failureCode" IS NOT NULL)
  ),
  CONSTRAINT "MediaIngestion_attempt_check" CHECK (
    "attemptCount" >= 0
    AND (status <> 'processing' OR ("attemptCount" > 0 AND "processingStartedAt" IS NOT NULL))
  )
);

CREATE UNIQUE INDEX "MediaIngestion_actorId_idempotencyKeyHash_key"
  ON "MediaIngestion"("actorId", "idempotencyKeyHash");
CREATE UNIQUE INDEX "MediaIngestion_storageKey_key"
  ON "MediaIngestion"("storageKey");
CREATE UNIQUE INDEX "MediaIngestion_mediaId_key"
  ON "MediaIngestion"("mediaId");
CREATE INDEX "MediaIngestion_actorId_startedAt_idx"
  ON "MediaIngestion"("actorId", "startedAt");
CREATE INDEX "MediaIngestion_dataSourceId_startedAt_idx"
  ON "MediaIngestion"("dataSourceId", "startedAt");
CREATE INDEX "MediaIngestion_status_updatedAt_idx"
  ON "MediaIngestion"(status, "updatedAt");
CREATE INDEX "MediaIngestion_checksum_idx"
  ON "MediaIngestion"(checksum);

ALTER TABLE "MediaIngestion"
  ADD CONSTRAINT "MediaIngestion_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "MediaIngestion_dataSourceId_fkey"
    FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "MediaIngestion_mediaId_fkey"
    FOREIGN KEY ("mediaId") REFERENCES "Media"(id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "MediaUploadRateLimit" (
  "actorId" INTEGER NOT NULL,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MediaUploadRateLimit_pkey" PRIMARY KEY ("actorId"),
  CONSTRAINT "MediaUploadRateLimit_requestCount_check"
    CHECK ("requestCount" >= 0)
);

ALTER TABLE "MediaUploadRateLimit"
  ADD CONSTRAINT "MediaUploadRateLimit_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"(id)
    ON DELETE CASCADE ON UPDATE RESTRICT;

CREATE FUNCTION hsk_guard_media_ingestion_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion history cannot be deleted.';
  END IF;

  IF OLD."actorId" IS DISTINCT FROM NEW."actorId"
    OR OLD."dataSourceId" IS DISTINCT FROM NEW."dataSourceId"
    OR OLD."idempotencyKeyHash" IS DISTINCT FROM NEW."idempotencyKeyHash"
    OR OLD."requestFingerprint" IS DISTINCT FROM NEW."requestFingerprint"
    OR OLD."originalFilename" IS DISTINCT FROM NEW."originalFilename"
    OR OLD."declaredMimeType" IS DISTINCT FROM NEW."declaredMimeType"
    OR OLD."storageProvider" IS DISTINCT FROM NEW."storageProvider"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion identity is immutable.';
  END IF;

  IF OLD.status IN ('completed', 'rejected') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'Terminal MediaIngestion history is immutable.';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status
    AND NOT (
      (OLD.status = 'pending' AND NEW.status IN ('processing', 'rejected', 'failed'))
      OR
      (OLD.status = 'processing' AND NEW.status IN ('completed', 'rejected', 'failed', 'cleanup_required'))
      OR
      (OLD.status = 'failed' AND NEW.status = 'processing')
      OR
      (OLD.status = 'cleanup_required' AND NEW.status IN ('processing', 'failed'))
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion state transition is invalid.';
  END IF;

  IF OLD."processingToken" IS DISTINCT FROM NEW."processingToken"
    AND NOT (
      OLD.status = 'failed' AND NEW.status = 'processing'
      OR
      OLD.status = 'cleanup_required' AND NEW.status = 'processing'
    )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion fencing identity change is invalid.';
  END IF;

  IF OLD."storageKey" IS NOT NULL
    AND OLD."storageKey" IS DISTINCT FROM NEW."storageKey"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_lifecycle_guard',
      MESSAGE = 'MediaIngestion object identity is immutable.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "MediaIngestion_lifecycle_guard"
BEFORE UPDATE OR DELETE ON "MediaIngestion"
FOR EACH ROW EXECUTE FUNCTION hsk_guard_media_ingestion_lifecycle();

CREATE FUNCTION hsk_check_completed_media_ingestion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "Media" AS media
    JOIN "DataSource" AS source ON source.id = NEW."dataSourceId"
    WHERE media.id = NEW."mediaId"
      AND media."uploadedById" = NEW."actorId"
      AND media."dataSourceId" = NEW."dataSourceId"
      AND media."storageProvider" = NEW."storageProvider"
      AND media."storageKey" = NEW."storageKey"
      AND media.checksum = NEW.checksum
      AND media."mimeType" = NEW."validatedMimeType"
      AND media.size = NEW.size
      AND media."processingStatus" = 'ready'
      AND media."deletedAt" IS NULL
      AND NULLIF(btrim(source.license), '') IS NOT NULL
      AND (
        (NEW."validatedMimeType" IN ('image/jpeg', 'image/png') AND media.type = 'image')
        OR
        (NEW."validatedMimeType" IN ('audio/mpeg', 'audio/wav') AND media.type = 'audio')
      )
      AND media.url = '/api/v1/media/' || media.id || '/access'
    FOR SHARE
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'MediaIngestion_completed_media_coherence',
      MESSAGE = 'Completed MediaIngestion does not match a ready private Media asset.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "MediaIngestion_completed_media_coherence"
BEFORE INSERT OR UPDATE OF
  status, "mediaId", "actorId", "dataSourceId", "storageProvider",
  "storageKey", checksum, "validatedMimeType", size
ON "MediaIngestion"
FOR EACH ROW EXECUTE FUNCTION hsk_check_completed_media_ingestion();

CREATE FUNCTION hsk_guard_ingested_media_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "MediaIngestion"
    WHERE "mediaId" = OLD.id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'Media_ingested_identity_guard',
      MESSAGE = 'Completed ingestion Media identity is immutable.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Media_ingested_identity_guard"
BEFORE UPDATE OF
  url, type, "mimeType", size, duration, "storageProvider", "storageKey",
  "originalFilename", checksum, metadata, "dataSourceId", "uploadedById"
ON "Media"
FOR EACH ROW
WHEN (
  OLD.url IS DISTINCT FROM NEW.url
  OR OLD.type IS DISTINCT FROM NEW.type
  OR OLD."mimeType" IS DISTINCT FROM NEW."mimeType"
  OR OLD.size IS DISTINCT FROM NEW.size
  OR OLD.duration IS DISTINCT FROM NEW.duration
  OR OLD."storageProvider" IS DISTINCT FROM NEW."storageProvider"
  OR OLD."storageKey" IS DISTINCT FROM NEW."storageKey"
  OR OLD."originalFilename" IS DISTINCT FROM NEW."originalFilename"
  OR OLD.checksum IS DISTINCT FROM NEW.checksum
  OR OLD.metadata IS DISTINCT FROM NEW.metadata
  OR OLD."dataSourceId" IS DISTINCT FROM NEW."dataSourceId"
  OR OLD."uploadedById" IS DISTINCT FROM NEW."uploadedById"
)
EXECUTE FUNCTION hsk_guard_ingested_media_identity();
