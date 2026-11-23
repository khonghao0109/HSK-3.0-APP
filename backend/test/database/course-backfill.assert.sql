-- ADR-009 C2: state after `content:course:backfill` on course-backfill.seed.sql.
DO $test$
DECLARE
  course RECORD;
  n INTEGER;
  enrolled_user INTEGER;
BEGIN
  SELECT * INTO course FROM "Course" WHERE code = 'HSK3_TOPIC';
  IF course.id IS NULL OR course.kind <> 'topic' OR course."curriculumVersion" <> 'HSK_3_0'
     OR course."orderIndex" <> 1 OR course.status <> 'published' OR course."publishedAt" IS NULL THEN
    RAISE EXCEPTION 'HSK3_TOPIC wrong: %', row_to_json(course);
  END IF;

  -- One unit per Level, copying orderIndex/name/status; HSK7_9 has no grade.
  SELECT count(*) INTO n FROM "CourseUnit" u JOIN "Level" l ON l.id = u."levelId"
  WHERE u."courseId" = course.id AND u."orderIndex" = l."orderIndex" AND u.title = l.name
    AND u.status = l.status AND u.volume IS NULL
    AND u."gradeNumber" IS NOT DISTINCT FROM (CASE WHEN l."minBand" = l."maxBand" THEN l."minBand" END);
  IF n <> 7 THEN RAISE EXCEPTION 'expected 7 matching units, got %', n; END IF;
  PERFORM 1 FROM "CourseUnit" u JOIN "Level" l ON l.id = u."levelId"
  WHERE l.code = 'HSK7_9' AND u."gradeNumber" IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'HSK7_9 unit must have null gradeNumber'; END IF;
  RAISE NOTICE 'ok - 7 units mirror the Levels';

  -- Every lesson, soft-deleted included, is in the unit of its own Level.
  SELECT count(*) INTO n FROM "Lesson" WHERE "courseUnitId" IS NULL;
  IF n <> 0 THEN RAISE EXCEPTION '% lessons without unit', n; END IF;
  SELECT count(*) INTO n FROM "Lesson" s JOIN "CourseUnit" u ON u.id = s."courseUnitId"
  WHERE u."levelId" = s."levelId";
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 lessons in their Level unit, got %', n; END IF;
  RAISE NOTICE 'ok - 3 lessons assigned (deleted one included)';

  -- Enrollments: goal-only and progress-only users; not nothing/anonymized/pending.
  SELECT count(*) INTO n FROM "CourseEnrollment" e JOIN "User" u ON u.id = e."userId"
  WHERE e."courseId" = course.id AND e.status = 'active' AND e."isCurrent"
    AND u.email IN ('c2-goal@example.invalid', 'c2-progress@example.invalid');
  IF n <> 2 THEN RAISE EXCEPTION 'expected 2 new enrollments, got %', n; END IF;
  SELECT count(*) INTO n FROM "CourseEnrollment" e JOIN "User" u ON u.id = e."userId"
  WHERE u.email IN ('c2-nothing@example.invalid', 'c2-anonymized@example.invalid', 'c2-pending@example.invalid');
  IF n <> 0 THEN RAISE EXCEPTION 'nothing/anonymized/pending users got % enrollments', n; END IF;
  RAISE NOTICE 'ok - enrollments only for live users with goal or progress';

  -- The pre-enrolled learner keeps exactly their own row.
  SELECT id INTO enrolled_user FROM "User" WHERE email = 'c2-enrolled@example.invalid';
  SELECT count(*) INTO n FROM "CourseEnrollment" e JOIN "Course" c ON c.id = e."courseId"
  WHERE e."userId" = enrolled_user AND c.code = 'SPEC_TRADE' AND e."isCurrent"
    AND e."enrolledAt" = TIMESTAMP '2026-11-01 00:00:00';
  IF n <> 1 OR (SELECT count(*) FROM "CourseEnrollment" WHERE "userId" = enrolled_user) <> 1 THEN
    RAISE EXCEPTION 'pre-enrolled user was changed';
  END IF;
  RAISE NOTICE 'ok - pre-enrolled user untouched';

  SELECT count(*) INTO n FROM (
    SELECT "userId" FROM "CourseEnrollment" WHERE "isCurrent" AND status = 'active'
    GROUP BY "userId" HAVING count(*) > 1) d;
  IF n <> 0 THEN RAISE EXCEPTION 'users with two current enrollments: %', n; END IF;
  RAISE NOTICE 'ok - at most one current enrollment per user';
END
$test$;
