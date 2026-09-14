-- H.4b: PostgreSQL storage for the global throttler, shared by every backend
-- replica (ADR-008 §2). Forward-only and additive: no backfill, no lock on
-- existing tables, no explicit BEGIN/COMMIT. Rows are purgeable counters, not
-- history; an expired row is equivalent to a missing one.

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "key" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "expireAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "RateLimitCounter_points_check" CHECK ("points" >= 1)
);

-- CreateIndex
CREATE INDEX "RateLimitCounter_expireAt_idx" ON "RateLimitCounter"("expireAt");
