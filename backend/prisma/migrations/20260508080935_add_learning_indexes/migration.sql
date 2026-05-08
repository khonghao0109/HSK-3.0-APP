-- CreateIndex
CREATE INDEX "Lesson_levelId_idx" ON "Lesson"("levelId");

-- CreateIndex
CREATE INDEX "Lesson_orderIndex_idx" ON "Lesson"("orderIndex");

-- CreateIndex
CREATE INDEX "Story_levelId_idx" ON "Story"("levelId");

-- CreateIndex
CREATE INDEX "Topic_lessonId_idx" ON "Topic"("lessonId");

-- CreateIndex
CREATE INDEX "Topic_orderIndex_idx" ON "Topic"("orderIndex");
