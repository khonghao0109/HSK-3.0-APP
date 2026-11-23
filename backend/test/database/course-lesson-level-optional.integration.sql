-- ADR-009 C3b-1: Lesson.levelId is optional, Lesson_level_or_unit_check holds (BEGIN/ROLLBACK).
-- Self-contained: runs on a fresh and on an upgraded database.
BEGIN;

DO $test$
DECLARE
  course_id INTEGER;
  unit_id INTEGER;
  rejected BOOLEAN;
  lesson_id INTEGER;
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'Lesson' AND column_name = 'levelId') <> 'YES' THEN
    RAISE EXCEPTION 'Lesson.levelId is still NOT NULL';
  END IF;
  RAISE NOTICE 'ok - Lesson.levelId is nullable';

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'Lesson_level_or_unit_check' AND convalidated) THEN
    RAISE EXCEPTION 'Lesson_level_or_unit_check missing or not validated';
  END IF;
  RAISE NOTICE 'ok - Lesson_level_or_unit_check exists and is validated';

  IF EXISTS (SELECT 1 FROM "Lesson" WHERE "levelId" IS NULL AND "courseUnitId" IS NULL) THEN
    RAISE EXCEPTION 'existing lesson without Level or unit';
  END IF;
  RAISE NOTICE 'ok - every existing lesson has a Level or a unit';

  INSERT INTO "Course" (code, kind, title, "orderIndex", status, "updatedAt")
  VALUES ('C3B1_TB_VERIFY', 'textbook', 'C3b-1', 990001, 'published', CURRENT_TIMESTAMP)
  RETURNING id INTO course_id;
  INSERT INTO "CourseUnit" ("courseId", "orderIndex", title, status, "updatedAt")
  VALUES (course_id, 1, 'Unit', 'published', CURRENT_TIMESTAMP)
  RETURNING id INTO unit_id;

  rejected := false;
  BEGIN
    INSERT INTO "Lesson" ("levelId", "courseUnitId", title, "orderIndex", slug, "updatedAt")
    VALUES (NULL, NULL, 'orphan', 1, 'c3b1-orphan', CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'lesson without Level or unit accepted'; END IF;
  RAISE NOTICE 'ok - lesson without Level or unit refused';

  INSERT INTO "Lesson" ("levelId", "courseUnitId", title, "orderIndex", slug, "updatedAt")
  VALUES (NULL, unit_id, 'unit only', 1, 'c3b1-unit-only', CURRENT_TIMESTAMP)
  RETURNING id INTO lesson_id;
  INSERT INTO "Lesson" ("levelId", "courseUnitId", title, "orderIndex", slug, "updatedAt")
  VALUES (NULL, unit_id, 'unit only 2', 2, 'c3b1-unit-only-2', CURRENT_TIMESTAMP);
  RAISE NOTICE 'ok - lessons without Level but with a unit accepted (NULL levelId never collides)';

  rejected := false;
  BEGIN
    UPDATE "Lesson" SET "courseUnitId" = NULL WHERE id = lesson_id;
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'unit removed from a lesson without Level'; END IF;
  RAISE NOTICE 'ok - unit cannot be removed from a lesson without Level';
END
$test$;

ROLLBACK;
