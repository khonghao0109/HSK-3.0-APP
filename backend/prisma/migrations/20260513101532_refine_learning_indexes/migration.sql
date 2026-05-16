/*
  Warnings:

  - A unique constraint covering the columns `[levelId,orderIndex]` on the table `Lesson` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[url]` on the table `Media` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[lessonId,orderIndex]` on the table `Topic` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Lesson_orderIndex_idx";

-- DropIndex
DROP INDEX "Story_orderIndex_idx";

-- DropIndex
DROP INDEX "Topic_lessonId_orderIndex_idx";

-- DropIndex
DROP INDEX "Topic_orderIndex_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Lesson_levelId_orderIndex_key" ON "Lesson"("levelId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Media_url_key" ON "Media"("url");

-- CreateIndex
CREATE INDEX "Story_lessonId_orderIndex_idx" ON "Story"("lessonId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_lessonId_orderIndex_key" ON "Topic"("lessonId", "orderIndex");
