``-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "groupId" INTEGER;

-- CreateTable
CREATE TABLE "TestSection" (
    "id" SERIAL NOT NULL,
    "testId" INTEGER NOT NULL,
    "skill" "Skill" NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "duration" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionGroup" (
    "id" SERIAL NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "title" TEXT,
    "instruction" TEXT,
    "content" JSONB,
    "audioId" INTEGER,
    "imageId" INTEGER,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestSection_testId_idx" ON "TestSection"("testId");

-- CreateIndex
CREATE INDEX "TestSection_skill_idx" ON "TestSection"("skill");

-- CreateIndex
CREATE UNIQUE INDEX "TestSection_testId_orderIndex_key" ON "TestSection"("testId", "orderIndex");

-- CreateIndex
CREATE INDEX "QuestionGroup_sectionId_idx" ON "QuestionGroup"("sectionId");

-- CreateIndex
CREATE INDEX "QuestionGroup_sectionId_orderIndex_idx" ON "QuestionGroup"("sectionId", "orderIndex");

-- CreateIndex
CREATE INDEX "QuestionGroup_audioId_idx" ON "QuestionGroup"("audioId");

-- CreateIndex
CREATE INDEX "QuestionGroup_imageId_idx" ON "QuestionGroup"("imageId");

-- CreateIndex
CREATE INDEX "Question_groupId_idx" ON "Question"("groupId");

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "QuestionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSection" ADD CONSTRAINT "TestSection_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionGroup" ADD CONSTRAINT "QuestionGroup_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "TestSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionGroup" ADD CONSTRAINT "QuestionGroup_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionGroup" ADD CONSTRAINT "QuestionGroup_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
