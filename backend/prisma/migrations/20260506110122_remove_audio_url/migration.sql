/*
  Warnings:

  - You are about to drop the column `audioUrl` on the `Question` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('audio', 'image');

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "coverImageId" INTEGER;

-- AlterTable
ALTER TABLE "Question" DROP COLUMN "audioUrl",
ADD COLUMN     "audioId" INTEGER,
ADD COLUMN     "imageId" INTEGER;

-- AlterTable
ALTER TABLE "Word" ADD COLUMN     "audioId" INTEGER;

-- CreateTable
CREATE TABLE "Media" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "type" "MediaType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Word_audioId_idx" ON "Word"("audioId");

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Word" ADD CONSTRAINT "Word_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
