-- M3.4a (Q289-Q299): WordExample, composite (meaningId, wordId) FK, pg_trgm search indexes
-- and the generated "Word"."pinyinCompact" search key.

-- pg_trgm is a trusted extension (PostgreSQL 13+): the database owner can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Search key without spaces, so "xuexi" and "xue xi" match the same row.
ALTER TABLE "Word" ADD COLUMN "pinyinCompact" TEXT
  GENERATED ALWAYS AS (replace("pinyinNormalized", ' ', '')) STORED;
-- CreateTable
CREATE TABLE "WordExample" (
    "id" SERIAL NOT NULL,
    "wordId" INTEGER NOT NULL,
    "meaningId" INTEGER,
    "orderIndex" INTEGER NOT NULL,
    "hanzi" TEXT NOT NULL,
    "pinyin" TEXT,
    "translationVi" TEXT,
    "translationEn" TEXT,
    "audioId" INTEGER,
    "dataSourceId" INTEGER,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WordExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WordExample_wordId_status_deletedAt_orderIndex_idx" ON "WordExample"("wordId", "status", "deletedAt", "orderIndex");

-- CreateIndex
CREATE INDEX "WordExample_meaningId_wordId_idx" ON "WordExample"("meaningId", "wordId");

-- CreateIndex
CREATE INDEX "WordExample_audioId_idx" ON "WordExample"("audioId");

-- CreateIndex
CREATE INDEX "WordExample_dataSourceId_idx" ON "WordExample"("dataSourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WordMeaning_id_wordId_key" ON "WordMeaning"("id", "wordId");

-- AddForeignKey
ALTER TABLE "WordExample" ADD CONSTRAINT "WordExample_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordExample" ADD CONSTRAINT "WordExample_meaningId_wordId_fkey" FOREIGN KEY ("meaningId", "wordId") REFERENCES "WordMeaning"("id", "wordId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordExample" ADD CONSTRAINT "WordExample_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordExample" ADD CONSTRAINT "WordExample_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One live example per (wordId, orderIndex); soft-deleted rows keep their slot history.
CREATE UNIQUE INDEX "WordExample_word_order_active_key" ON "WordExample" ("wordId", "orderIndex") WHERE "deletedAt" IS NULL;
ALTER TABLE "WordExample" ADD CONSTRAINT "WordExample_orderIndex_check" CHECK ("orderIndex" >= 0);
ALTER TABLE "WordExample" ADD CONSTRAINT "WordExample_hanzi_nonblank_check" CHECK (btrim("hanzi") <> '');
-- Q296: a published example keeps its attribution (CC BY-SA and other licensed sources).
ALTER TABLE "WordExample" ADD CONSTRAINT "WordExample_published_data_source_check" CHECK ("status" <> 'published' OR "dataSourceId" IS NOT NULL);

-- Public search indexes, same predicate as Word_public_*_prefix_idx (PUBLIC_WORD_SQL minus the meaning EXISTS).
CREATE INDEX "Word_public_pinyin_compact_prefix_idx" ON "Word" ("pinyinCompact" text_pattern_ops)
  WHERE "status" = 'published' AND "deletedAt" IS NULL AND "isPure" = true;
CREATE INDEX "Word_public_pinyin_compact_trgm_idx" ON "Word" USING gin ("pinyinCompact" gin_trgm_ops)
  WHERE "status" = 'published' AND "deletedAt" IS NULL AND "isPure" = true;
-- Partial so Prisma, which does not model partial indexes, keeps its own btree index on these columns.
-- Q292: show_trgm('学习') is non-empty on the verified database, so Hanzi is indexed too.
CREATE INDEX "Word_public_hanzi_trgm_idx" ON "Word" USING gin ("hanzi" gin_trgm_ops)
  WHERE "status" = 'published' AND "deletedAt" IS NULL AND "isPure" = true;
CREATE INDEX "WordMeaning_meaningViNormalized_trgm_idx" ON "WordMeaning" USING gin ("meaningViNormalized" gin_trgm_ops)
  WHERE "meaningViNormalized" IS NOT NULL;
CREATE INDEX "WordMeaning_meaningEnNormalized_trgm_idx" ON "WordMeaning" USING gin ("meaningEnNormalized" gin_trgm_ops)
  WHERE "meaningEnNormalized" IS NOT NULL;
