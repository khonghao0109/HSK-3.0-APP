-- M3.2 / Q251: saved words own a review card scheduled by `sm2-v1`.
--
-- 1. New cards default to the M3.1 scheduler version.
ALTER TABLE "ReviewCard" ALTER COLUMN "schedulerVersion" SET DEFAULT 'sm2-v1';

-- 2. Backfill: every saved word without a card gets a `new` card due now.
-- Existing cards are not touched (ON CONFLICT DO NOTHING on (userId, wordId)).
INSERT INTO "ReviewCard" ("userId", "wordId", "state", "dueAt", "schedulerVersion", "updatedAt")
SELECT uw."userId", uw."wordId", 'new', now(), 'sm2-v1', now()
FROM "UserWord" uw
ON CONFLICT ("userId", "wordId") DO NOTHING;
