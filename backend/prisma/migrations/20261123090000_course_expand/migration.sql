-- ADR-009 C1 expand: Course, CourseUnit, CourseEnrollment and the nullable
-- Lesson.courseUnitId. Additive only: no backfill (C2), Lesson.levelId keeps
-- NOT NULL and every existing unique/index (C3). An old app ignores the new
-- tables and column; rollback is the previous app release, never a DROP.
-- Content rows are archive-only (ADR-001), so content FKs RESTRICT deletes;
-- CourseEnrollment.userId follows Progress/UserGoal (ON DELETE CASCADE).
-- Prisma owns the migration transaction: no explicit BEGIN/COMMIT (H.11a).

-- CreateEnum
CREATE TYPE "CourseKind" AS ENUM ('topic', 'textbook', 'specialty');

-- CreateEnum
CREATE TYPE "CourseVolume" AS ENUM ('upper', 'lower');

-- CreateEnum
CREATE TYPE "CourseEnrollmentStatus" AS ENUM ('active', 'left');

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "courseUnitId" INTEGER;

-- CreateTable
CREATE TABLE "Course" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "CourseKind" NOT NULL,
    "curriculumVersion" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "keyTextVisible" BOOLEAN NOT NULL DEFAULT true,
    "dataSourceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseUnit" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "gradeNumber" INTEGER,
    "volume" "CourseVolume",
    "title" TEXT NOT NULL,
    "levelId" INTEGER,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseEnrollment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "status" "CourseEnrollmentStatus" NOT NULL DEFAULT 'active',
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "CourseEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Course_code_key" ON "Course"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Course_orderIndex_key" ON "Course"("orderIndex");

-- CreateIndex
CREATE INDEX "Course_status_deletedAt_orderIndex_idx" ON "Course"("status", "deletedAt", "orderIndex");

-- CreateIndex
CREATE INDEX "Course_dataSourceId_idx" ON "Course"("dataSourceId");

-- CreateIndex
CREATE INDEX "CourseUnit_courseId_status_deletedAt_orderIndex_idx" ON "CourseUnit"("courseId", "status", "deletedAt", "orderIndex");

-- CreateIndex
CREATE INDEX "CourseUnit_levelId_idx" ON "CourseUnit"("levelId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseUnit_courseId_orderIndex_key" ON "CourseUnit"("courseId", "orderIndex");

-- CreateIndex
CREATE INDEX "CourseEnrollment_courseId_idx" ON "CourseEnrollment"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseEnrollment_userId_courseId_key" ON "CourseEnrollment"("userId", "courseId");

-- CreateIndex
CREATE INDEX "Lesson_courseUnitId_status_deletedAt_orderIndex_idx" ON "Lesson"("courseUnitId", "status", "deletedAt", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_courseUnitId_orderIndex_key" ON "Lesson"("courseUnitId", "orderIndex");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_courseUnitId_fkey" FOREIGN KEY ("courseUnitId") REFERENCES "CourseUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseUnit" ADD CONSTRAINT "CourseUnit_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseUnit" ADD CONSTRAINT "CourseUnit_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- SQL-only checks (not expressible in Prisma), named like Level_code_band_check.
ALTER TABLE "Course"
  ADD CONSTRAINT "Course_code_format_check"
    CHECK ("code" ~ '^[A-Z0-9_]{3,40}$'),
  ADD CONSTRAINT "Course_curriculumVersion_check"
    CHECK ("curriculumVersion" IS NULL OR "curriculumVersion" IN ('HSK_2_0', 'HSK_3_0')),
  -- Same 1-based order as lessons (CMS @Min(1)) and LessonExercise_order_check.
  ADD CONSTRAINT "Course_orderIndex_check" CHECK ("orderIndex" > 0);

ALTER TABLE "CourseUnit"
  ADD CONSTRAINT "CourseUnit_gradeNumber_check"
    CHECK ("gradeNumber" IS NULL OR "gradeNumber" BETWEEN 1 AND 9),
  ADD CONSTRAINT "CourseUnit_volume_grade_check"
    CHECK ("volume" IS NULL OR "gradeNumber" IS NOT NULL),
  ADD CONSTRAINT "CourseUnit_orderIndex_check" CHECK ("orderIndex" > 0);

ALTER TABLE "CourseEnrollment"
  ADD CONSTRAINT "CourseEnrollment_left_check"
    CHECK (("status" = 'left') = ("leftAt" IS NOT NULL)),
  ADD CONSTRAINT "CourseEnrollment_left_not_current_check"
    CHECK ("status" <> 'left' OR NOT "isCurrent");

-- At most one active current course per learner. The table is new and empty,
-- so no preflight is needed before building the index.
CREATE UNIQUE INDEX "CourseEnrollment_one_current_per_user_key"
  ON "CourseEnrollment"("userId")
  WHERE "isCurrent" AND "status" = 'active';
