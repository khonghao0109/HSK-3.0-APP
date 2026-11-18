-- M4.1a (TL-77): additive QuestionType values for the question bank's four
-- objective formats. Existing values are kept for historical rows and for
-- exam authoring (M4.1b); M4.1a DTO/validator rejects listening, reading,
-- writing and speaking. PostgreSQL owns the enum, so each value is its own
-- ALTER TYPE statement; PostgreSQL 12+ allows ADD VALUE inside Prisma's
-- migration transaction as long as the new value is not used in that same
-- transaction (no backfill here).
ALTER TYPE "QuestionType" ADD VALUE 'true_false';
ALTER TYPE "QuestionType" ADD VALUE 'fill_blank';
ALTER TYPE "QuestionType" ADD VALUE 'arrange_sentence';
