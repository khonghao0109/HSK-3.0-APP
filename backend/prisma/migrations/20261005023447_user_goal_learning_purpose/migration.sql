-- CreateEnum
CREATE TYPE "LearningPurpose" AS ENUM ('communication', 'study_abroad', 'hsk_exam', 'work');

-- AlterTable
ALTER TABLE "UserGoal" ADD COLUMN     "learningPurpose" "LearningPurpose";
