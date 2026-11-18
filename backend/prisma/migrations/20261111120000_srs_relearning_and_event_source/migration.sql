-- M3.1 / R3: Add `relearning` state to ReviewCardState and `source` to ReviewEvent.
--
-- 1. Add 'relearning' value to enum ReviewCardState.
-- In PostgreSQL 12+, ALTER TYPE ... ADD VALUE can run inside Prisma's migration
-- transaction as long as the new value is not used for data in the same transaction.
ALTER TYPE "ReviewCardState" ADD VALUE 'relearning';

-- 2. Create ReviewEventSource enum with initial 'flashcard' value.
CREATE TYPE "ReviewEventSource" AS ENUM ('flashcard');

-- 3. Add column 'source' to ReviewEvent, defaulting to 'flashcard' so existing rows
-- keep valid historical provenance.
ALTER TABLE "ReviewEvent"
  ADD COLUMN "source" "ReviewEventSource" NOT NULL DEFAULT 'flashcard';
