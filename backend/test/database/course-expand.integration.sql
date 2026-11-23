-- ADR-009 C1: Course, CourseUnit, CourseEnrollment and Lesson.courseUnitId (BEGIN/ROLLBACK).
-- Expects the legacy rows of course-expand.legacy-seed.sql to exist.
BEGIN;

DO $test$
DECLARE
  level_id INTEGER;
  legacy_lesson RECORD;
  user_id INTEGER;
  other_user_id INTEGER;
  course_id INTEGER;
  other_course_id INTEGER;
  third_course_id INTEGER;
  unit_id INTEGER;
  rejected BOOLEAN;
BEGIN
  -- Legacy lesson untouched by the migration.
  SELECT id, "levelId", "courseUnitId", "orderIndex" INTO legacy_lesson
  FROM "Lesson" WHERE slug = 'c1-legacy-lesson';
  IF legacy_lesson.id IS NULL THEN RAISE EXCEPTION 'legacy lesson missing'; END IF;
  IF legacy_lesson."courseUnitId" IS NOT NULL THEN
    RAISE EXCEPTION 'legacy lesson got courseUnitId %', legacy_lesson."courseUnitId";
  END IF;
  SELECT id INTO level_id FROM "Level" WHERE code = 'HSK1';
  IF legacy_lesson."levelId" IS DISTINCT FROM level_id THEN
    RAISE EXCEPTION 'legacy lesson levelId changed';
  END IF;
  RAISE NOTICE 'ok - legacy lesson keeps levelId, courseUnitId is null';

  -- Lesson.levelId stays NOT NULL.
  rejected := false;
  BEGIN
    INSERT INTO "Lesson" ("levelId", title, "orderIndex", slug, "updatedAt")
    VALUES (NULL, 'no level', 2, 'c1-no-level', CURRENT_TIMESTAMP);
  EXCEPTION WHEN not_null_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Lesson.levelId accepted NULL'; END IF;
  RAISE NOTICE 'ok - Lesson.levelId NOT NULL kept';

  -- Old unique (levelId, orderIndex) still holds.
  rejected := false;
  BEGIN
    INSERT INTO "Lesson" ("levelId", title, "orderIndex", slug, "updatedAt")
    VALUES (level_id, 'dup order', legacy_lesson."orderIndex", 'c1-dup-order', CURRENT_TIMESTAMP);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate (levelId, orderIndex) accepted'; END IF;
  RAISE NOTICE 'ok - Lesson (levelId, orderIndex) unique kept';

  -- Course.code format.
  INSERT INTO "Course" (code, kind, "curriculumVersion", title, "orderIndex", "updatedAt")
  VALUES ('HSK3_TOPIC', 'topic', 'HSK_3_0', 'Chủ đề HSK 3.0', 1, CURRENT_TIMESTAMP)
  RETURNING id INTO course_id;
  INSERT INTO "Course" (code, kind, title, "orderIndex", "updatedAt")
  VALUES ('SPEC_TRADE', 'specialty', 'Thương mại', 2, CURRENT_TIMESTAMP)
  RETURNING id INTO other_course_id;
  PERFORM 1 FROM "Course" WHERE id = course_id AND "keyTextVisible" AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'Course defaults wrong (keyTextVisible true, status draft)'; END IF;
  DECLARE bad_code TEXT;
  BEGIN
    FOREACH bad_code IN ARRAY ARRAY['hsk3_topic', 'AB', 'HSK-3', repeat('A', 41), 'HSK 3'] LOOP
      rejected := false;
      BEGIN
        INSERT INTO "Course" (code, kind, title, "orderIndex", "updatedAt")
        VALUES (bad_code, 'topic', 'bad', 99, CURRENT_TIMESTAMP);
      EXCEPTION WHEN check_violation THEN rejected := true;
      END;
      IF NOT rejected THEN RAISE EXCEPTION 'Course.code % accepted', bad_code; END IF;
    END LOOP;
  END;
  INSERT INTO "Course" (code, kind, title, "orderIndex", "updatedAt")
  VALUES (repeat('A', 40), 'topic', 'max len', 3, CURRENT_TIMESTAMP)
  RETURNING id INTO third_course_id;
  RAISE NOTICE 'ok - Course.code format check';

  -- Course.curriculumVersion values.
  rejected := false;
  BEGIN
    INSERT INTO "Course" (code, kind, "curriculumVersion", title, "orderIndex", "updatedAt")
    VALUES ('BAD_VERSION', 'textbook', 'HSK_4_0', 'bad', 98, CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Course.curriculumVersion HSK_4_0 accepted'; END IF;
  INSERT INTO "Course" (code, kind, "curriculumVersion", title, "orderIndex", "updatedAt")
  VALUES ('HSK2_TEXTBOOK', 'textbook', 'HSK_2_0', 'Giáo trình HSK 2.0', 4, CURRENT_TIMESTAMP);
  RAISE NOTICE 'ok - Course.curriculumVersion check';

  -- Course.code and Course.orderIndex unique; orderIndex >= 1.
  rejected := false;
  BEGIN
    INSERT INTO "Course" (code, kind, title, "orderIndex", "updatedAt")
    VALUES ('HSK3_TOPIC', 'topic', 'dup', 97, CURRENT_TIMESTAMP);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate Course.code accepted'; END IF;
  rejected := false;
  BEGIN
    INSERT INTO "Course" (code, kind, title, "orderIndex", "updatedAt")
    VALUES ('DUP_ORDER', 'topic', 'dup', 1, CURRENT_TIMESTAMP);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate Course.orderIndex accepted'; END IF;
  rejected := false;
  BEGIN
    INSERT INTO "Course" (code, kind, title, "orderIndex", "updatedAt")
    VALUES ('ZERO_ORDER', 'topic', 'zero', 0, CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Course.orderIndex 0 accepted'; END IF;
  RAISE NOTICE 'ok - Course code/orderIndex unique, orderIndex >= 1';

  -- CourseUnit.gradeNumber in 1..9 or null.
  DECLARE bad_grade INTEGER;
  BEGIN
    FOREACH bad_grade IN ARRAY ARRAY[0, 10, -1] LOOP
      rejected := false;
      BEGIN
        INSERT INTO "CourseUnit" ("courseId", "orderIndex", "gradeNumber", title, "updatedAt")
        VALUES (course_id, 50, bad_grade, 'bad grade', CURRENT_TIMESTAMP);
      EXCEPTION WHEN check_violation THEN rejected := true;
      END;
      IF NOT rejected THEN RAISE EXCEPTION 'CourseUnit.gradeNumber % accepted', bad_grade; END IF;
    END LOOP;
  END;
  INSERT INTO "CourseUnit" ("courseId", "orderIndex", "gradeNumber", title, "levelId", "updatedAt")
  VALUES (course_id, 1, 1, 'HSK1', level_id, CURRENT_TIMESTAMP)
  RETURNING id INTO unit_id;
  INSERT INTO "CourseUnit" ("courseId", "orderIndex", "gradeNumber", title, "updatedAt")
  VALUES (course_id, 2, 9, 'Cấp 9', CURRENT_TIMESTAMP);
  INSERT INTO "CourseUnit" ("courseId", "orderIndex", title, "updatedAt")
  VALUES (other_course_id, 1, 'Thương mại cơ bản', CURRENT_TIMESTAMP);
  PERFORM 1 FROM "CourseUnit" WHERE id = unit_id AND status = 'draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'CourseUnit default status is not draft'; END IF;
  RAISE NOTICE 'ok - CourseUnit.gradeNumber check';

  -- volume only with gradeNumber.
  rejected := false;
  BEGIN
    INSERT INTO "CourseUnit" ("courseId", "orderIndex", volume, title, "updatedAt")
    VALUES (other_course_id, 2, 'upper', 'no grade', CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'volume without gradeNumber accepted'; END IF;
  INSERT INTO "CourseUnit" ("courseId", "orderIndex", "gradeNumber", volume, title, "updatedAt")
  VALUES (third_course_id, 1, 4, 'upper', 'Cấp 4 · 上', CURRENT_TIMESTAMP);
  INSERT INTO "CourseUnit" ("courseId", "orderIndex", "gradeNumber", volume, title, "updatedAt")
  VALUES (third_course_id, 2, 4, 'lower', 'Cấp 4 · 下', CURRENT_TIMESTAMP);
  RAISE NOTICE 'ok - CourseUnit volume requires gradeNumber';

  -- CourseUnit.orderIndex >= 1 and unique per course.
  rejected := false;
  BEGIN
    INSERT INTO "CourseUnit" ("courseId", "orderIndex", title, "updatedAt")
    VALUES (other_course_id, 0, 'zero', CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'CourseUnit.orderIndex 0 accepted'; END IF;
  rejected := false;
  BEGIN
    INSERT INTO "CourseUnit" ("courseId", "orderIndex", title, "updatedAt")
    VALUES (course_id, 1, 'dup', CURRENT_TIMESTAMP);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate (courseId, orderIndex) accepted'; END IF;
  -- Same orderIndex in another course is fine (already inserted above).
  RAISE NOTICE 'ok - CourseUnit (courseId, orderIndex) unique, orderIndex >= 1';

  -- Lesson (courseUnitId, orderIndex) unique.
  INSERT INTO "Lesson" ("levelId", "courseUnitId", title, "orderIndex", slug, "updatedAt")
  VALUES (level_id, unit_id, 'unit lesson', 2, 'c1-unit-lesson-2', CURRENT_TIMESTAMP);
  UPDATE "Lesson" SET "courseUnitId" = unit_id WHERE id = legacy_lesson.id;
  rejected := false;
  BEGIN
    INSERT INTO "Lesson" ("levelId", "courseUnitId", title, "orderIndex", slug, "updatedAt")
    VALUES (level_id, unit_id, 'dup unit order', 2, 'c1-unit-dup', CURRENT_TIMESTAMP);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate (courseUnitId, orderIndex) accepted'; END IF;
  rejected := false;
  BEGIN
    INSERT INTO "Lesson" ("levelId", "courseUnitId", title, "orderIndex", slug, "updatedAt")
    VALUES (level_id, 999999, 'missing unit', 3, 'c1-missing-unit', CURRENT_TIMESTAMP);
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Lesson.courseUnitId accepted a missing unit'; END IF;
  RAISE NOTICE 'ok - Lesson (courseUnitId, orderIndex) unique and FK';

  -- Restrict: Course with units, CourseUnit with lessons.
  rejected := false;
  BEGIN
    DELETE FROM "Course" WHERE id = course_id;
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Course with units was deleted'; END IF;
  rejected := false;
  BEGIN
    DELETE FROM "CourseUnit" WHERE id = unit_id;
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'CourseUnit with lessons was deleted'; END IF;
  rejected := false;
  BEGIN
    DELETE FROM "Level" WHERE id = level_id;
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Level referenced by CourseUnit/Lesson was deleted'; END IF;
  -- A Level referenced only by a CourseUnit proves CourseUnit_levelId_fkey itself restricts.
  DECLARE unit_only_level INTEGER;
  BEGIN
    INSERT INTO "Level" (name, code, "orderIndex", "minBand", "maxBand", "updatedAt")
    VALUES ('C1 unit-only HSK2', 'HSK2', 2, 2, 2, CURRENT_TIMESTAMP) RETURNING id INTO unit_only_level;
    INSERT INTO "CourseUnit" ("courseId", "orderIndex", "gradeNumber", title, "levelId", "updatedAt")
    VALUES (course_id, 3, 2, 'HSK2', unit_only_level, CURRENT_TIMESTAMP);
    rejected := false;
    BEGIN
      DELETE FROM "Level" WHERE id = unit_only_level;
    EXCEPTION WHEN foreign_key_violation THEN rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'Level referenced only by a CourseUnit was deleted'; END IF;
  END;
  RAISE NOTICE 'ok - Course/CourseUnit delete restricted';

  -- CourseEnrollment.
  INSERT INTO "User" (email, password, "updatedAt")
  VALUES ('c1-learner@example.invalid', 'x', CURRENT_TIMESTAMP) RETURNING id INTO user_id;
  INSERT INTO "User" (email, password, "updatedAt")
  VALUES ('c1-other@example.invalid', 'x', CURRENT_TIMESTAMP) RETURNING id INTO other_user_id;

  INSERT INTO "CourseEnrollment" ("userId", "courseId", status, "isCurrent")
  VALUES (user_id, course_id, 'active', true);
  PERFORM 1 FROM "CourseEnrollment"
  WHERE "userId" = user_id AND "enrolledAt" IS NOT NULL AND "leftAt" IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'CourseEnrollment.enrolledAt default missing'; END IF;

  -- (userId, courseId) unique.
  rejected := false;
  BEGIN
    INSERT INTO "CourseEnrollment" ("userId", "courseId") VALUES (user_id, course_id);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate (userId, courseId) accepted'; END IF;
  RAISE NOTICE 'ok - CourseEnrollment (userId, courseId) unique';

  -- At most one active current enrollment per user.
  rejected := false;
  BEGIN
    INSERT INTO "CourseEnrollment" ("userId", "courseId", status, "isCurrent")
    VALUES (user_id, other_course_id, 'active', true);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'second active current enrollment accepted'; END IF;
  INSERT INTO "CourseEnrollment" ("userId", "courseId", status, "isCurrent", "leftAt")
  VALUES (user_id, other_course_id, 'left', false, CURRENT_TIMESTAMP);
  INSERT INTO "CourseEnrollment" ("userId", "courseId", status, "isCurrent")
  VALUES (user_id, third_course_id, 'active', false);
  INSERT INTO "CourseEnrollment" ("userId", "courseId", status, "isCurrent")
  VALUES (other_user_id, course_id, 'active', true);
  RAISE NOTICE 'ok - one active current enrollment per user';

  -- status = left <=> leftAt is not null.
  rejected := false;
  BEGIN
    INSERT INTO "CourseEnrollment" ("userId", "courseId", status)
    VALUES (other_user_id, other_course_id, 'left');
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'left enrollment without leftAt accepted'; END IF;
  rejected := false;
  BEGIN
    INSERT INTO "CourseEnrollment" ("userId", "courseId", status, "leftAt")
    VALUES (other_user_id, other_course_id, 'active', CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'active enrollment with leftAt accepted'; END IF;
  RAISE NOTICE 'ok - status left <=> leftAt';

  -- status = left => isCurrent = false.
  rejected := false;
  BEGIN
    INSERT INTO "CourseEnrollment" ("userId", "courseId", status, "isCurrent", "leftAt")
    VALUES (other_user_id, other_course_id, 'left', true, CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'left current enrollment accepted'; END IF;
  RAISE NOTICE 'ok - left enrollment is never current';

  -- Course with enrollments cannot be deleted; deleting a User follows Progress (CASCADE).
  rejected := false;
  BEGIN
    DELETE FROM "Course" WHERE id = third_course_id;
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Course with enrollments was deleted'; END IF;
  DELETE FROM "User" WHERE id = other_user_id;
  PERFORM 1 FROM "CourseEnrollment" WHERE "userId" = other_user_id;
  IF FOUND THEN RAISE EXCEPTION 'CourseEnrollment did not follow User delete like Progress'; END IF;
  RAISE NOTICE 'ok - CourseEnrollment FK behaviour';
END
$test$;

ROLLBACK;
