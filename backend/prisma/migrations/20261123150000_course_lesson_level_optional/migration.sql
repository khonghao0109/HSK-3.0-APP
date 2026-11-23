-- ADR-009 C3b-1: a lesson of a course without a Level (HSK 2.0 textbook) has
-- no levelId. Every lesson keeps a parent: its Level, its course unit, or both.
-- Forward-only: putting NOT NULL back would fail once such a lesson exists.
-- The unique (levelId, orderIndex) index stays; PostgreSQL treats NULLs as
-- distinct, so lessons without a Level never collide on it.

ALTER TABLE "Lesson" ALTER COLUMN "levelId" DROP NOT NULL;

ALTER TABLE "Lesson"
  ADD CONSTRAINT "Lesson_level_or_unit_check"
  CHECK ("levelId" IS NOT NULL OR "courseUnitId" IS NOT NULL);
