-- ADR-009 C2: pre-backfill data on top of course-expand.legacy-seed.sql
-- (HSK1 published + lesson "c1-legacy-lesson" orderIndex 1).
INSERT INTO "Level" (name, code, "orderIndex", "minBand", "maxBand", status, "updatedAt") VALUES
  ('HSK 2', 'HSK2', 2, 2, 2, 'published', CURRENT_TIMESTAMP),
  ('HSK 3', 'HSK3', 3, 3, 3, 'draft', CURRENT_TIMESTAMP),
  ('HSK 4', 'HSK4', 4, 4, 4, 'draft', CURRENT_TIMESTAMP),
  ('HSK 5', 'HSK5', 5, 5, 5, 'draft', CURRENT_TIMESTAMP),
  ('HSK 6', 'HSK6', 6, 6, 6, 'draft', CURRENT_TIMESTAMP),
  ('HSK 7-9', 'HSK7_9', 7, 7, 9, 'draft', CURRENT_TIMESTAMP);

-- HSK1: legacy lesson + a soft-deleted one; HSK2: one lesson; HSK3..7_9: none.
INSERT INTO "Lesson" ("levelId", title, "orderIndex", slug, status, "deletedAt", "updatedAt")
SELECT id, 'C2 deleted', 2, 'c2-deleted', 'archived', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "Level" WHERE code = 'HSK1';
INSERT INTO "Lesson" ("levelId", title, "orderIndex", slug, status, "updatedAt")
SELECT id, 'C2 hsk2 lesson', 1, 'c2-hsk2-l1', 'published', CURRENT_TIMESTAMP FROM "Level" WHERE code = 'HSK2';

INSERT INTO "User" (email, password, status, "deletedAt", "updatedAt") VALUES
  ('c2-goal@example.invalid', 'x', 'active', NULL, CURRENT_TIMESTAMP),
  ('c2-progress@example.invalid', 'x', 'active', NULL, CURRENT_TIMESTAMP),
  ('c2-nothing@example.invalid', 'x', 'active', NULL, CURRENT_TIMESTAMP),
  ('c2-anonymized@example.invalid', 'x', 'anonymized', NULL, CURRENT_TIMESTAMP),
  ('c2-pending@example.invalid', 'x', 'deletion_pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('c2-enrolled@example.invalid', 'x', 'active', NULL, CURRENT_TIMESTAMP);

INSERT INTO "UserGoal" ("userId", "targetLevelId", "dailyMinutes", "startDate", "updatedAt")
SELECT u.id, l.id, 15, CURRENT_DATE, CURRENT_TIMESTAMP
FROM "User" u, "Level" l
WHERE l.code = 'HSK1' AND u.email IN ('c2-goal@example.invalid', 'c2-anonymized@example.invalid', 'c2-enrolled@example.invalid');

INSERT INTO "Progress" ("userId", "lessonId", "updatedAt")
SELECT u.id, s.id, CURRENT_TIMESTAMP
FROM "User" u, "Lesson" s
WHERE s.slug = 'c1-legacy-lesson' AND u.email IN ('c2-progress@example.invalid', 'c2-pending@example.invalid');

-- A learner who already chose another course: backfill must not touch them.
INSERT INTO "Course" (code, kind, title, "orderIndex", "updatedAt")
VALUES ('SPEC_TRADE', 'specialty', 'Thương mại', 2, CURRENT_TIMESTAMP);
INSERT INTO "CourseEnrollment" ("userId", "courseId", status, "isCurrent", "enrolledAt")
SELECT u.id, c.id, 'active', true, TIMESTAMP '2026-11-01 00:00:00'
FROM "User" u, "Course" c
WHERE u.email = 'c2-enrolled@example.invalid' AND c.code = 'SPEC_TRADE';
