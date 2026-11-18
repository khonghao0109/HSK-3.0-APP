-- Q357 (PO 19/11/2026): blueprint đề thi thành dữ liệu + bộ câu dùng chung tranh/đáp án,
-- để sinh đề tự động từ ngân hàng câu hỏi. Chỉ thêm mới.
-- - ExamBlueprint → Section → Part: mỗi phần chọn `questionCount` câu có tag `format`.
-- - QuestionSet + QuestionSetItem: phần `fromSet` lấy trọn một bộ.
-- - Test.blueprintId / generationSeed: đề sinh từ blueprint nào, seed nào (tái lập được).

-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "blueprintId" INTEGER,
ADD COLUMN     "generationSeed" TEXT;

-- CreateTable
CREATE TABLE "ExamBlueprint" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "levelId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT,
    "durationMinutes" INTEGER NOT NULL,
    "passScore" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "dataSourceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamBlueprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamBlueprintSection" (
    "id" SERIAL NOT NULL,
    "blueprintId" INTEGER NOT NULL,
    "skill" "Skill" NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamBlueprintSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamBlueprintPart" (
    "id" SERIAL NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instruction" TEXT,
    "orderIndex" INTEGER NOT NULL,
    "questionType" "QuestionType" NOT NULL,
    "format" TEXT NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "fromSet" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamBlueprintPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionSet" (
    "id" SERIAL NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "levelId" INTEGER NOT NULL,
    "skill" "Skill" NOT NULL,
    "format" TEXT NOT NULL,
    "title" TEXT,
    "instruction" TEXT,
    "audioId" INTEGER,
    "imageId" INTEGER,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "dataSourceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionSetItem" (
    "id" SERIAL NOT NULL,
    "setId" INTEGER NOT NULL,
    "questionId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "QuestionSetItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExamBlueprint_code_key" ON "ExamBlueprint"("code");

-- CreateIndex
CREATE INDEX "ExamBlueprint_levelId_status_idx" ON "ExamBlueprint"("levelId", "status");

-- CreateIndex
CREATE INDEX "ExamBlueprint_dataSourceId_idx" ON "ExamBlueprint"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamBlueprintSection_blueprintId_orderIndex_key" ON "ExamBlueprintSection"("blueprintId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ExamBlueprintPart_sectionId_orderIndex_key" ON "ExamBlueprintPart"("sectionId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ExamBlueprintPart_sectionId_key_key" ON "ExamBlueprintPart"("sectionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSet_sourceKey_key" ON "QuestionSet"("sourceKey");

-- CreateIndex
CREATE INDEX "QuestionSet_levelId_skill_format_status_idx" ON "QuestionSet"("levelId", "skill", "format", "status");

-- CreateIndex
CREATE INDEX "QuestionSet_audioId_idx" ON "QuestionSet"("audioId");

-- CreateIndex
CREATE INDEX "QuestionSet_imageId_idx" ON "QuestionSet"("imageId");

-- CreateIndex
CREATE INDEX "QuestionSet_dataSourceId_idx" ON "QuestionSet"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSetItem_questionId_key" ON "QuestionSetItem"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSetItem_setId_orderIndex_key" ON "QuestionSetItem"("setId", "orderIndex");

-- CreateIndex
CREATE INDEX "Test_blueprintId_idx" ON "Test"("blueprintId");

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "ExamBlueprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamBlueprint" ADD CONSTRAINT "ExamBlueprint_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamBlueprint" ADD CONSTRAINT "ExamBlueprint_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamBlueprintSection" ADD CONSTRAINT "ExamBlueprintSection_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "ExamBlueprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamBlueprintPart" ADD CONSTRAINT "ExamBlueprintPart_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ExamBlueprintSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSetItem" ADD CONSTRAINT "QuestionSetItem_setId_fkey" FOREIGN KEY ("setId") REFERENCES "QuestionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSetItem" ADD CONSTRAINT "QuestionSetItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- SQL-only invariants.
ALTER TABLE "ExamBlueprint"
  ADD CONSTRAINT "ExamBlueprint_code_format_check" CHECK ("code" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "ExamBlueprint_durationMinutes_positive_check" CHECK ("durationMinutes" > 0),
  ADD CONSTRAINT "ExamBlueprint_passScore_nonnegative_check" CHECK ("passScore" IS NULL OR "passScore" >= 0),
  ADD CONSTRAINT "ExamBlueprint_version_positive_check" CHECK ("version" > 0);

ALTER TABLE "ExamBlueprintSection"
  ADD CONSTRAINT "ExamBlueprintSection_orderIndex_nonnegative_check" CHECK ("orderIndex" >= 0);

ALTER TABLE "ExamBlueprintPart"
  ADD CONSTRAINT "ExamBlueprintPart_orderIndex_nonnegative_check" CHECK ("orderIndex" >= 0),
  ADD CONSTRAINT "ExamBlueprintPart_questionCount_range_check" CHECK ("questionCount" BETWEEN 1 AND 50),
  ADD CONSTRAINT "ExamBlueprintPart_format_nonblank_check" CHECK (btrim("format") <> ''),
  ADD CONSTRAINT "ExamBlueprintPart_key_nonblank_check" CHECK (btrim("key") <> '');

ALTER TABLE "QuestionSet"
  ADD CONSTRAINT "QuestionSet_format_nonblank_check" CHECK (btrim("format") <> ''),
  ADD CONSTRAINT "QuestionSet_sourceKey_nonblank_check" CHECK (btrim("sourceKey") <> '');

ALTER TABLE "QuestionSetItem"
  ADD CONSTRAINT "QuestionSetItem_orderIndex_nonnegative_check" CHECK ("orderIndex" >= 0);

ALTER TABLE "Test"
  ADD CONSTRAINT "Test_generationSeed_requires_blueprint_check" CHECK ("generationSeed" IS NULL OR "blueprintId" IS NOT NULL);
