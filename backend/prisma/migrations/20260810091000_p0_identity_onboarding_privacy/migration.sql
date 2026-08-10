-- P0-01: identity lifecycle, onboarding, sessions and privacy requests.
CREATE TYPE "AccountStatus" AS ENUM ('active', 'suspended', 'deletion_pending', 'anonymized');
CREATE TYPE "PlacementAttemptStatus" AS ENUM ('in_progress', 'completed', 'abandoned');
CREATE TYPE "LearningPlanStatus" AS ENUM ('active', 'completed', 'cancelled');
CREATE TYPE "LearningPlanItemStatus" AS ENUM ('planned', 'in_progress', 'completed', 'skipped');
CREATE TYPE "ConsentType" AS ENUM ('terms', 'privacy', 'analytics', 'marketing');
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('requested', 'processing', 'completed', 'failed', 'cancelled');

ALTER TABLE "User"
  ADD COLUMN "status" "AccountStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Verify canonical-email uniqueness before changing any stored address.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'P0-01 found users whose emails differ only by case or surrounding whitespace';
  END IF;
END
$$;

UPDATE "User"
SET "email" = lower(btrim("email"))
WHERE "email" <> lower(btrim("email"));

CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));
CREATE INDEX "User_status_deletedAt_idx" ON "User"("status", "deletedAt");

CREATE TABLE "UserProfile" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "displayName" TEXT,
  "avatarUrl" TEXT,
  "locale" TEXT NOT NULL DEFAULT 'vi-VN',
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSession" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "deviceId" TEXT,
  "userAgent" TEXT,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserSession_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "UserSession_revocation_check" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt")
);

CREATE TABLE "PasswordResetToken" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordResetToken_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "PasswordResetToken_usedAt_check" CHECK ("usedAt" IS NULL OR "usedAt" >= "createdAt")
);

CREATE TABLE "EmailVerificationToken" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailVerificationToken_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "EmailVerificationToken_usedAt_check" CHECK ("usedAt" IS NULL OR "usedAt" >= "createdAt")
);

CREATE TABLE "UserGoal" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "targetLevelId" INTEGER NOT NULL,
  "targetBand" INTEGER,
  "dailyMinutes" INTEGER NOT NULL,
  "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
  "reminderTime" TIME(0),
  "startDate" DATE NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserGoal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserGoal_targetBand_check" CHECK ("targetBand" IS NULL OR "targetBand" BETWEEN 1 AND 9),
  CONSTRAINT "UserGoal_dailyMinutes_check" CHECK ("dailyMinutes" BETWEEN 1 AND 1440),
  CONSTRAINT "UserGoal_reminder_check" CHECK (NOT "reminderEnabled" OR "reminderTime" IS NOT NULL)
);

CREATE TABLE "PlacementAttempt" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "status" "PlacementAttemptStatus" NOT NULL DEFAULT 'in_progress',
  "score" INTEGER,
  "detailSnapshot" JSONB,
  "recommendedLevelId" INTEGER,
  "recommendedBand" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlacementAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlacementAttempt_score_check" CHECK ("score" IS NULL OR "score" >= 0),
  CONSTRAINT "PlacementAttempt_band_check" CHECK ("recommendedBand" IS NULL OR "recommendedBand" BETWEEN 1 AND 9),
  CONSTRAINT "PlacementAttempt_completedAt_check" CHECK (
    ("status" = 'completed' AND "completedAt" IS NOT NULL) OR
    ("status" <> 'completed' AND "completedAt" IS NULL)
  )
);

CREATE TABLE "LearningPlan" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "targetLevelId" INTEGER NOT NULL,
  "targetBand" INTEGER,
  "generatedFromPlacementId" INTEGER,
  "status" "LearningPlanStatus" NOT NULL DEFAULT 'active',
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningPlan_targetBand_check" CHECK ("targetBand" IS NULL OR "targetBand" BETWEEN 1 AND 9),
  CONSTRAINT "LearningPlan_date_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate")
);

CREATE TABLE "LearningPlanItem" (
  "id" SERIAL NOT NULL,
  "learningPlanId" INTEGER NOT NULL,
  "lessonId" INTEGER NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "scheduledDate" DATE,
  "status" "LearningPlanItemStatus" NOT NULL DEFAULT 'planned',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningPlanItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LearningPlanItem_order_check" CHECK ("orderIndex" > 0),
  CONSTRAINT "LearningPlanItem_completedAt_check" CHECK (
    ("status" = 'completed' AND "completedAt" IS NOT NULL) OR
    ("status" <> 'completed' AND "completedAt" IS NULL)
  )
);

CREATE TABLE "Consent" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "type" "ConsentType" NOT NULL,
  "consentVersion" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Consent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Consent_revokedAt_check" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "grantedAt")
);

CREATE TABLE "DataExportJob" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'requested',
  "outputStorageKey" TEXT,
  "outputExpiresAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataExportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountDeletionRequest" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'requested',
  "reason" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "scheduledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- Compatibility backfill: existing User.name remains authoritative for old APIs.
INSERT INTO "UserProfile" ("userId", "displayName", "createdAt", "updatedAt")
SELECT u."id", u."name", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "UserProfile" p WHERE p."userId" = u."id"
);

CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_userId_expiresAt_idx" ON "UserSession"("userId", "expiresAt");
CREATE INDEX "UserSession_userId_revokedAt_expiresAt_idx" ON "UserSession"("userId", "revokedAt", "expiresAt");
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_expiresAt_idx" ON "EmailVerificationToken"("userId", "expiresAt");
CREATE INDEX "UserGoal_userId_isActive_idx" ON "UserGoal"("userId", "isActive");
CREATE INDEX "UserGoal_targetLevelId_idx" ON "UserGoal"("targetLevelId");
CREATE INDEX "PlacementAttempt_userId_createdAt_idx" ON "PlacementAttempt"("userId", "createdAt");
CREATE INDEX "PlacementAttempt_status_createdAt_idx" ON "PlacementAttempt"("status", "createdAt");
CREATE INDEX "PlacementAttempt_recommendedLevelId_idx" ON "PlacementAttempt"("recommendedLevelId");
CREATE INDEX "LearningPlan_userId_status_idx" ON "LearningPlan"("userId", "status");
CREATE INDEX "LearningPlan_targetLevelId_idx" ON "LearningPlan"("targetLevelId");
CREATE INDEX "LearningPlan_generatedFromPlacementId_idx" ON "LearningPlan"("generatedFromPlacementId");
CREATE UNIQUE INDEX "LearningPlanItem_learningPlanId_orderIndex_key" ON "LearningPlanItem"("learningPlanId", "orderIndex");
CREATE UNIQUE INDEX "LearningPlanItem_learningPlanId_lessonId_key" ON "LearningPlanItem"("learningPlanId", "lessonId");
CREATE INDEX "LearningPlanItem_lessonId_idx" ON "LearningPlanItem"("lessonId");
CREATE INDEX "LearningPlanItem_learningPlanId_status_scheduledDate_idx" ON "LearningPlanItem"("learningPlanId", "status", "scheduledDate");
CREATE UNIQUE INDEX "Consent_userId_type_consentVersion_key" ON "Consent"("userId", "type", "consentVersion");
CREATE INDEX "Consent_userId_type_grantedAt_idx" ON "Consent"("userId", "type", "grantedAt");
CREATE INDEX "DataExportJob_userId_status_createdAt_idx" ON "DataExportJob"("userId", "status", "createdAt");
CREATE INDEX "DataExportJob_status_createdAt_idx" ON "DataExportJob"("status", "createdAt");
CREATE INDEX "AccountDeletionRequest_userId_status_createdAt_idx" ON "AccountDeletionRequest"("userId", "status", "createdAt");
CREATE INDEX "AccountDeletionRequest_status_scheduledAt_idx" ON "AccountDeletionRequest"("status", "scheduledAt");

ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserGoal" ADD CONSTRAINT "UserGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserGoal" ADD CONSTRAINT "UserGoal_targetLevelId_fkey" FOREIGN KEY ("targetLevelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlacementAttempt" ADD CONSTRAINT "PlacementAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlacementAttempt" ADD CONSTRAINT "PlacementAttempt_recommendedLevelId_fkey" FOREIGN KEY ("recommendedLevelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningPlan" ADD CONSTRAINT "LearningPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningPlan" ADD CONSTRAINT "LearningPlan_targetLevelId_fkey" FOREIGN KEY ("targetLevelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningPlan" ADD CONSTRAINT "LearningPlan_generatedFromPlacementId_fkey" FOREIGN KEY ("generatedFromPlacementId") REFERENCES "PlacementAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningPlanItem" ADD CONSTRAINT "LearningPlanItem_learningPlanId_fkey" FOREIGN KEY ("learningPlanId") REFERENCES "LearningPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningPlanItem" ADD CONSTRAINT "LearningPlanItem_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountDeletionRequest" ADD CONSTRAINT "AccountDeletionRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
