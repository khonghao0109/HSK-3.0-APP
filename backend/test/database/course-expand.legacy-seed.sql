-- ADR-009 C1: legacy content written before the course_expand migration.
-- The runner applies this between the pre-C1 migrations and course_expand.
INSERT INTO "Level" (name, code, "orderIndex", "minBand", "maxBand", status, "updatedAt")
VALUES ('C1 legacy HSK1', 'HSK1', 1, 1, 1, 'published', CURRENT_TIMESTAMP);
INSERT INTO "Lesson" ("levelId", title, "orderIndex", slug, status, "updatedAt")
SELECT id, 'C1 legacy lesson', 1, 'c1-legacy-lesson', 'published', CURRENT_TIMESTAMP
FROM "Level" WHERE code = 'HSK1';
