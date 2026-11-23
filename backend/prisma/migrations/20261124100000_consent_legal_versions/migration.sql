-- M1.7b2 Consent API (Q192, Q197). Forward-only; no existing column changes.

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('signup', 'reconsent', 'settings');

-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('terms', 'privacy');

-- AlterTable: rows written before this migration (none through any API) are
-- backfilled as `signup`; the default is dropped so new rows must name a channel.
ALTER TABLE "Consent" ADD COLUMN "channel" "ConsentChannel" NOT NULL DEFAULT 'signup',
ADD COLUMN "documentSha256" CHAR(64);
ALTER TABLE "Consent" ALTER COLUMN "channel" DROP DEFAULT;

ALTER TABLE "Consent" ADD CONSTRAINT "Consent_documentSha256_check"
  CHECK ("documentSha256" IS NULL OR "documentSha256" ~ '^[0-9a-f]{64}$');
-- Optional consents (analytics, marketing) have no document to hash.
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_optional_no_document_check"
  CHECK ("type" IN ('terms', 'privacy') OR "documentSha256" IS NULL);

-- CreateTable
CREATE TABLE "LegalDocumentVersion" (
    "id" SERIAL NOT NULL,
    "type" "LegalDocumentType" NOT NULL,
    "version" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocumentVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LegalDocumentVersion_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "LegalDocumentVersion_version_check" CHECK ("version" ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$')
);

-- CreateIndex
CREATE INDEX "LegalDocumentVersion_type_effectiveAt_idx" ON "LegalDocumentVersion"("type", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocumentVersion_type_version_key" ON "LegalDocumentVersion"("type", "version");
