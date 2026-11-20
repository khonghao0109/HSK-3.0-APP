-- M2.x-lesson Pha E: additive ExerciseType value for the matching (ghép cặp)
-- exercise. PostgreSQL 12+ allows ADD VALUE inside Prisma's migration
-- transaction as long as the new value is not used in that same transaction,
-- so this migration holds nothing else (no backfill, default or CHECK).
-- PostgreSQL has no DROP VALUE: rollback is forward-fix only (runbook mục 32).
ALTER TYPE "ExerciseType" ADD VALUE 'matching';
