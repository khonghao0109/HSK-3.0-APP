-- M1.7d / Q203: record who initiated an account deletion request.
--
-- `initiatedBy` defaults to `user` so every row written by the M1.7c
-- self-service flow (and every pre-existing row) keeps its original meaning.
-- `actorId` is the admin `User.id` that acted; deliberately no foreign key or
-- relation: the audit trail must outlive admin lifecycle changes and the
-- column never owns the actor row.
-- Prisma owns the migration transaction: no explicit BEGIN/COMMIT (H.11a).

CREATE TYPE "AccountDeletionInitiator" AS ENUM ('user', 'admin');

-- ACCESS EXCLUSIVE lock is held until commit, so no writer can insert a second
-- `requested` row between the preflight count below and the index build.
ALTER TABLE "AccountDeletionRequest"
  ADD COLUMN "initiatedBy" "AccountDeletionInitiator" NOT NULL DEFAULT 'user',
  ADD COLUMN "actorId" INTEGER;

DO $$
DECLARE
  duplicate_users INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_users
  FROM (
    SELECT "userId"
    FROM "AccountDeletionRequest"
    WHERE "status" = 'requested'
    GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_users > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'Requested AccountDeletionRequest uniqueness preflight failed: %s user(s) with more than one requested row.',
        duplicate_users
      ),
      HINT = 'Cancel the older requests through a reviewed data repair before deploying.';
  END IF;
END
$$;

-- Database backstop for every writer (service, SQL operations, scripts);
-- AdminUsersService lock ordering is the application-level serialization.
CREATE UNIQUE INDEX "AccountDeletionRequest_one_requested_per_user"
  ON "AccountDeletionRequest" ("userId")
  WHERE "status" = 'requested';
