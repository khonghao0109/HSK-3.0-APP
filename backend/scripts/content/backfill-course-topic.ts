import { Prisma, PrismaClient } from '@prisma/client';

/**
 * ADR-009 C2: idempotent backfill of the HSK 3.0 topic course.
 *
 *   DATABASE_URL=... npm run content:course:backfill [-- --dry-run]
 *
 * One transaction: creates course HSK3_TOPIC if missing, one unit per Level
 * (matched on (courseId, levelId)), puts every Lesson without a unit into the
 * unit of its Level (soft-deleted lessons too), and enrolls live learners with a
 * UserGoal or Progress who have no enrollment yet. Existing rows are never
 * overwritten and nothing is deleted. Re-run after each content import until C3.
 * Prints counts only (no PII). Exits 1 if any lesson is still without a unit.
 */
export const COURSE_CODE = 'HSK3_TOPIC';

export interface BackfillCounts {
  courses: number;
  units: number;
  lessonsWithoutUnit: number;
  enrollments: number;
}

export interface BackfillSummary {
  mode: 'dry-run' | 'apply';
  before: BackfillCounts;
  after: BackfillCounts;
}

class DryRunRollback extends Error {}

async function counts(tx: Prisma.TransactionClient): Promise<BackfillCounts> {
  const [row] = await tx.$queryRaw<
    Array<{
      courses: bigint;
      units: bigint;
      lessonsWithoutUnit: bigint;
      enrollments: bigint;
    }>
  >(Prisma.sql`
    SELECT
      (SELECT count(*) FROM "Course" WHERE code = ${COURSE_CODE}) AS courses,
      (SELECT count(*) FROM "CourseUnit" u JOIN "Course" c ON c.id = u."courseId"
        WHERE c.code = ${COURSE_CODE}) AS units,
      (SELECT count(*) FROM "Lesson" WHERE "courseUnitId" IS NULL) AS "lessonsWithoutUnit",
      (SELECT count(*) FROM "CourseEnrollment" e JOIN "Course" c ON c.id = e."courseId"
        WHERE c.code = ${COURSE_CODE}) AS enrollments
  `);
  return {
    courses: Number(row.courses),
    units: Number(row.units),
    lessonsWithoutUnit: Number(row.lessonsWithoutUnit),
    enrollments: Number(row.enrollments),
  };
}

async function apply(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "Course" (code, kind, "curriculumVersion", title, "orderIndex", status, "publishedAt", "updatedAt")
    VALUES (${COURSE_CODE}, 'topic', 'HSK_3_0', 'Chủ đề HSK 3.0', 1, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (code) DO NOTHING
  `);
  // A unit-orderIndex clash with a hand-made unit raises a unique violation and
  // aborts the whole transaction instead of guessing.
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "CourseUnit" ("courseId", "orderIndex", "gradeNumber", title, "levelId", status, "updatedAt")
    SELECT c.id, l."orderIndex",
           CASE WHEN l."minBand" = l."maxBand" THEN l."minBand" END,
           l.name, l.id, l.status, CURRENT_TIMESTAMP
    FROM "Level" l CROSS JOIN "Course" c
    WHERE c.code = ${COURSE_CODE}
      AND NOT EXISTS (
        SELECT 1 FROM "CourseUnit" u WHERE u."courseId" = c.id AND u."levelId" = l.id)
  `);
  // (levelId, orderIndex) is unique and a unit holds one Level, so
  // (courseUnitId, orderIndex) cannot collide.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "Lesson" s SET "courseUnitId" = u.id
    FROM "CourseUnit" u JOIN "Course" c ON c.id = u."courseId"
    WHERE c.code = ${COURSE_CODE} AND u."levelId" = s."levelId" AND s."courseUnitId" IS NULL
  `);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "CourseEnrollment" ("userId", "courseId", status, "isCurrent")
    SELECT u.id, c.id, 'active', true
    FROM "User" u CROSS JOIN "Course" c
    WHERE c.code = ${COURSE_CODE}
      AND u.status NOT IN ('deletion_pending', 'anonymized')
      AND u."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "CourseEnrollment" e WHERE e."userId" = u.id)
      AND (EXISTS (SELECT 1 FROM "UserGoal" g WHERE g."userId" = u.id)
        OR EXISTS (SELECT 1 FROM "Progress" p WHERE p."userId" = u.id))
  `);
}

export async function backfillCourseTopic(
  prisma: PrismaClient,
  dryRun: boolean,
): Promise<BackfillSummary> {
  let summary: BackfillSummary | undefined;
  try {
    await prisma.$transaction(async (tx) => {
      const before = await counts(tx);
      await apply(tx);
      summary = {
        mode: dryRun ? 'dry-run' : 'apply',
        before,
        after: await counts(tx),
      };
      if (dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  if (!summary) throw new Error('backfill produced no summary');
  return summary;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--dry-run');
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(' ')}`);
    console.error('Usage: npm run content:course:backfill [-- --dry-run]');
    process.exitCode = 2;
    return;
  }
  const prisma = new PrismaClient();
  try {
    const summary = await backfillCourseTopic(
      prisma,
      args.includes('--dry-run'),
    );
    for (const key of Object.keys(summary.before) as Array<
      keyof BackfillCounts
    >) {
      console.log(`${key}: ${summary.before[key]} -> ${summary.after[key]}`);
    }
    console.log(`SUMMARY ${JSON.stringify(summary)}`);
    if (summary.after.lessonsWithoutUnit > 0) {
      console.error(
        `${summary.after.lessonsWithoutUnit} lesson(s) still have no unit`,
      );
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
