/*
  Warnings:

  - You are about to drop the column `meaning` on the `Word` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Word" DROP COLUMN "meaning";

-- CreateTable
CREATE TABLE "WordMeaning" (
    "id" SERIAL NOT NULL,
    "wordId" INTEGER NOT NULL,
    "meaningEn" TEXT NOT NULL,
    "meaningVi" TEXT NOT NULL,

    CONSTRAINT "WordMeaning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WordMeaning_wordId_idx" ON "WordMeaning"("wordId");

-- AddForeignKey
ALTER TABLE "WordMeaning" ADD CONSTRAINT "WordMeaning_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
