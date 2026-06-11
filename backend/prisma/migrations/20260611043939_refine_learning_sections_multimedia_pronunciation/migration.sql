-- CreateEnum
CREATE TYPE "TopicType" AS ENUM ('vocabulary', 'grammar', 'key_text', 'quiz', 'ai_speaking');

-- AlterTable
ALTER TABLE "LessonExercise" ADD COLUMN     "topicId" INTEGER;

-- AlterTable
ALTER TABLE "LessonWord" ADD COLUMN     "topicId" INTEGER;

-- AlterTable
ALTER TABLE "PronunciationPractice" ADD COLUMN     "sentenceId" INTEGER,
ADD COLUMN     "topicId" INTEGER,
ADD COLUMN     "wordId" INTEGER;

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subtitle" TEXT,
ADD COLUMN     "type" "TopicType" NOT NULL DEFAULT 'vocabulary';

-- AlterTable
ALTER TABLE "Word" ADD COLUMN     "imageId" INTEGER,
ADD COLUMN     "strokeAnimationId" INTEGER;

-- CreateTable
CREATE TABLE "LessonWordExample" (
    "id" SERIAL NOT NULL,
    "lessonWordId" INTEGER NOT NULL,
    "sentenceId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonWordExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LessonWordExample_lessonWordId_idx" ON "LessonWordExample"("lessonWordId");

-- CreateIndex
CREATE INDEX "LessonWordExample_sentenceId_idx" ON "LessonWordExample"("sentenceId");

-- CreateIndex
CREATE INDEX "LessonWordExample_lessonWordId_orderIndex_idx" ON "LessonWordExample"("lessonWordId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "LessonWordExample_lessonWordId_sentenceId_key" ON "LessonWordExample"("lessonWordId", "sentenceId");

-- CreateIndex
CREATE INDEX "LessonExercise_topicId_idx" ON "LessonExercise"("topicId");

-- CreateIndex
CREATE INDEX "LessonWord_topicId_idx" ON "LessonWord"("topicId");

-- CreateIndex
CREATE INDEX "PronunciationPractice_topicId_idx" ON "PronunciationPractice"("topicId");

-- CreateIndex
CREATE INDEX "PronunciationPractice_wordId_idx" ON "PronunciationPractice"("wordId");

-- CreateIndex
CREATE INDEX "PronunciationPractice_sentenceId_idx" ON "PronunciationPractice"("sentenceId");

-- CreateIndex
CREATE INDEX "Topic_type_idx" ON "Topic"("type");

-- CreateIndex
CREATE INDEX "Word_imageId_idx" ON "Word"("imageId");

-- CreateIndex
CREATE INDEX "Word_strokeAnimationId_idx" ON "Word"("strokeAnimationId");

-- AddForeignKey
ALTER TABLE "Word" ADD CONSTRAINT "Word_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Word" ADD CONSTRAINT "Word_strokeAnimationId_fkey" FOREIGN KEY ("strokeAnimationId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonWord" ADD CONSTRAINT "LessonWord_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonWordExample" ADD CONSTRAINT "LessonWordExample_lessonWordId_fkey" FOREIGN KEY ("lessonWordId") REFERENCES "LessonWord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonWordExample" ADD CONSTRAINT "LessonWordExample_sentenceId_fkey" FOREIGN KEY ("sentenceId") REFERENCES "Sentence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonExercise" ADD CONSTRAINT "LessonExercise_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationPractice" ADD CONSTRAINT "PronunciationPractice_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationPractice" ADD CONSTRAINT "PronunciationPractice_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PronunciationPractice" ADD CONSTRAINT "PronunciationPractice_sentenceId_fkey" FOREIGN KEY ("sentenceId") REFERENCES "Sentence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
