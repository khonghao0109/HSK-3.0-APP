/*
  Warnings:

  - A unique constraint covering the columns `[hanzi,pinyin]` on the table `Word` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Word" ADD COLUMN     "isPure" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "traditional" TEXT;

-- AlterTable
ALTER TABLE "WordMeaning" ALTER COLUMN "meaningVi" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Word_hanzi_pinyin_key" ON "Word"("hanzi", "pinyin");

-- CreateIndex
CREATE INDEX "WordLevel_wordId_idx" ON "WordLevel"("wordId");

-- CreateIndex
CREATE INDEX "WordLevel_levelId_idx" ON "WordLevel"("levelId");
