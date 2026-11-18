-- Q356 (PO 18/11/2026): khung chuẩn HSK 3.0 theo GF0025-2021
-- 《国际中文教育中文水平等级标准》.
--
-- Chỉ thêm mới, không đổi hay xoá cột cũ:
-- - Character + CharacterLevel: 汉字表 theo cấp, cờ `handwriting` = 手写汉字表.
-- - GrammarPoint: 语法等级大纲 theo cấp, `code` ổn định ("HSK1-G001").
-- - Word.hanViet, WordMeasureWord (lượng từ), WordRelation (đồng/trái nghĩa).
-- - WordExample.grammarPointId: câu ví dụ minh hoạ điểm ngữ pháp nào.
-- - QuestionWord, QuestionGrammarPoint: target_words / grammar_ids của câu hỏi,
--   metadata ngoài revision giống LessonWord (Q179).
-- Dữ liệu chưa nạp: chờ file nguồn của chuẩn (xem docs/database/P0_DATA_DICTIONARY.md §5).

-- CreateEnum
CREATE TYPE "WordRelationType" AS ENUM ('synonym', 'antonym');

-- AlterTable
ALTER TABLE "Word" ADD COLUMN     "hanViet" TEXT;

-- AlterTable
ALTER TABLE "WordExample" ADD COLUMN     "grammarPointId" INTEGER;

-- CreateTable
CREATE TABLE "Character" (
    "id" SERIAL NOT NULL,
    "hanzi" TEXT NOT NULL,
    "traditional" TEXT,
    "pinyin" TEXT,
    "hanViet" TEXT,
    "strokeCount" INTEGER,
    "strokeData" JSONB,
    "dataSourceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterLevel" (
    "id" SERIAL NOT NULL,
    "characterId" INTEGER NOT NULL,
    "levelId" INTEGER NOT NULL,
    "handwriting" BOOLEAN NOT NULL DEFAULT false,
    "dataSourceId" INTEGER,

    CONSTRAINT "CharacterLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarPoint" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "levelId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "category" TEXT,
    "title" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "descriptionVi" TEXT,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "dataSourceId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrammarPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordMeasureWord" (
    "id" SERIAL NOT NULL,
    "wordId" INTEGER NOT NULL,
    "measureWordId" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "dataSourceId" INTEGER,

    CONSTRAINT "WordMeasureWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordRelation" (
    "id" SERIAL NOT NULL,
    "wordId" INTEGER NOT NULL,
    "relatedWordId" INTEGER NOT NULL,
    "type" "WordRelationType" NOT NULL,
    "dataSourceId" INTEGER,

    CONSTRAINT "WordRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionWord" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "wordId" INTEGER NOT NULL,

    CONSTRAINT "QuestionWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionGrammarPoint" (
    "id" SERIAL NOT NULL,
    "questionId" INTEGER NOT NULL,
    "grammarPointId" INTEGER NOT NULL,

    CONSTRAINT "QuestionGrammarPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Character_hanzi_key" ON "Character"("hanzi");

-- CreateIndex
CREATE INDEX "Character_dataSourceId_idx" ON "Character"("dataSourceId");

-- CreateIndex
CREATE INDEX "CharacterLevel_levelId_handwriting_idx" ON "CharacterLevel"("levelId", "handwriting");

-- CreateIndex
CREATE INDEX "CharacterLevel_dataSourceId_idx" ON "CharacterLevel"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterLevel_characterId_levelId_key" ON "CharacterLevel"("characterId", "levelId");

-- CreateIndex
CREATE UNIQUE INDEX "GrammarPoint_code_key" ON "GrammarPoint"("code");

-- CreateIndex
CREATE INDEX "GrammarPoint_dataSourceId_idx" ON "GrammarPoint"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "GrammarPoint_levelId_orderIndex_key" ON "GrammarPoint"("levelId", "orderIndex");

-- CreateIndex
CREATE INDEX "WordMeasureWord_measureWordId_idx" ON "WordMeasureWord"("measureWordId");

-- CreateIndex
CREATE INDEX "WordMeasureWord_dataSourceId_idx" ON "WordMeasureWord"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WordMeasureWord_wordId_measureWordId_key" ON "WordMeasureWord"("wordId", "measureWordId");

-- CreateIndex
CREATE INDEX "WordRelation_relatedWordId_idx" ON "WordRelation"("relatedWordId");

-- CreateIndex
CREATE INDEX "WordRelation_dataSourceId_idx" ON "WordRelation"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WordRelation_wordId_relatedWordId_type_key" ON "WordRelation"("wordId", "relatedWordId", "type");

-- CreateIndex
CREATE INDEX "QuestionWord_wordId_idx" ON "QuestionWord"("wordId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionWord_questionId_wordId_key" ON "QuestionWord"("questionId", "wordId");

-- CreateIndex
CREATE INDEX "QuestionGrammarPoint_grammarPointId_idx" ON "QuestionGrammarPoint"("grammarPointId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionGrammarPoint_questionId_grammarPointId_key" ON "QuestionGrammarPoint"("questionId", "grammarPointId");

-- CreateIndex
CREATE INDEX "WordExample_grammarPointId_idx" ON "WordExample"("grammarPointId");

-- AddForeignKey
ALTER TABLE "WordExample" ADD CONSTRAINT "WordExample_grammarPointId_fkey" FOREIGN KEY ("grammarPointId") REFERENCES "GrammarPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterLevel" ADD CONSTRAINT "CharacterLevel_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterLevel" ADD CONSTRAINT "CharacterLevel_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterLevel" ADD CONSTRAINT "CharacterLevel_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarPoint" ADD CONSTRAINT "GrammarPoint_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarPoint" ADD CONSTRAINT "GrammarPoint_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordMeasureWord" ADD CONSTRAINT "WordMeasureWord_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordMeasureWord" ADD CONSTRAINT "WordMeasureWord_measureWordId_fkey" FOREIGN KEY ("measureWordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordMeasureWord" ADD CONSTRAINT "WordMeasureWord_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordRelation" ADD CONSTRAINT "WordRelation_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordRelation" ADD CONSTRAINT "WordRelation_relatedWordId_fkey" FOREIGN KEY ("relatedWordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordRelation" ADD CONSTRAINT "WordRelation_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionWord" ADD CONSTRAINT "QuestionWord_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionWord" ADD CONSTRAINT "QuestionWord_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionGrammarPoint" ADD CONSTRAINT "QuestionGrammarPoint_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionGrammarPoint" ADD CONSTRAINT "QuestionGrammarPoint_grammarPointId_fkey" FOREIGN KEY ("grammarPointId") REFERENCES "GrammarPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- SQL-only invariants (Prisma không mô tả CHECK).
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_hanzi_single_char_check" CHECK (char_length("hanzi") = 1),
  ADD CONSTRAINT "Character_traditional_single_char_check" CHECK ("traditional" IS NULL OR char_length("traditional") = 1),
  ADD CONSTRAINT "Character_strokeCount_positive_check" CHECK ("strokeCount" IS NULL OR "strokeCount" > 0);

ALTER TABLE "GrammarPoint"
  ADD CONSTRAINT "GrammarPoint_code_format_check" CHECK ("code" ~ '^HSK[1-9](_9)?-G[0-9]{3}$'),
  ADD CONSTRAINT "GrammarPoint_title_nonblank_check" CHECK (btrim("title") <> ''),
  ADD CONSTRAINT "GrammarPoint_pattern_nonblank_check" CHECK (btrim("pattern") <> ''),
  ADD CONSTRAINT "GrammarPoint_orderIndex_nonnegative_check" CHECK ("orderIndex" >= 0);

ALTER TABLE "Word"
  ADD CONSTRAINT "Word_hanViet_nonblank_check" CHECK ("hanViet" IS NULL OR btrim("hanViet") <> '');

ALTER TABLE "WordMeasureWord"
  ADD CONSTRAINT "WordMeasureWord_not_self_check" CHECK ("wordId" <> "measureWordId"),
  ADD CONSTRAINT "WordMeasureWord_orderIndex_nonnegative_check" CHECK ("orderIndex" >= 0);

ALTER TABLE "WordRelation"
  ADD CONSTRAINT "WordRelation_not_self_check" CHECK ("wordId" <> "relatedWordId");
