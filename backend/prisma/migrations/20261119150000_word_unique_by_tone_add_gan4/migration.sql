-- Q358 (PO 19/11/2026): bổ sung 干 gàn ("làm", 幹) cấp HSK1 theo GF0025-2021 (L1-0113).
--
-- `Word` trước đây unique theo (hanzi, pinyin bỏ dấu), nên 干 gān (L1-0111, "khô")
-- và 干 gàn (L1-0113, "làm") không thể cùng tồn tại; seed gộp mọi mục 干 của
-- CC-CEDICT vào một dòng gan1. Khoá unique nay gồm cả `pinyinTone`
-- (NULLS NOT DISTINCT: dòng chưa có thanh vẫn không được trùng). Trong HSK1 chỉ có
-- 干 bị trùng kiểu này. Dữ liệu chỉ đổi khi DB đã seed từ điển (có dòng 干 gan1).

DROP INDEX "Word_hanzi_pinyin_key";
CREATE UNIQUE INDEX "Word_hanzi_pinyin_pinyinTone_key"
  ON "Word" ("hanzi", "pinyin", "pinyinTone") NULLS NOT DISTINCT;

-- Dòng 干 gan1 là chữ 乾 (khô), không phải 乹 (dị thể cổ).
UPDATE "Word" SET "traditional" = '乾', "updatedAt" = CURRENT_TIMESTAMP
WHERE "hanzi" = '干' AND "pinyin" = 'gan' AND "pinyinTone" = 'gan1' AND "traditional" = '乹';

INSERT INTO "Word" (
  "hanzi", "traditional", "pinyin", "pinyinNormalized", "pinyinTone",
  "isPure", "status", "publishedAt", "createdAt", "updatedAt"
)
SELECT '干', '幹', 'gan', 'gan', 'gan4', true, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM "Word" WHERE "hanzi" = '干' AND "pinyin" = 'gan' AND "pinyinTone" = 'gan1'
)
ON CONFLICT ("hanzi", "pinyin", "pinyinTone") DO NOTHING;

-- Cấp HSK1 (nguồn danh sách HSK1) và nguồn CC-CEDICT cho dòng mới.
INSERT INTO "WordLevel" ("wordId", "levelId", "dataSourceId")
SELECT w."id", l."id", ds."id"
FROM "Word" w
JOIN "Level" l ON l."code" = 'HSK1'
LEFT JOIN "DataSource" ds ON ds."code" = 'HSK_WORD_LIST_HSK1'
WHERE w."hanzi" = '干' AND w."pinyin" = 'gan' AND w."pinyinTone" = 'gan4'
ON CONFLICT ("wordId", "levelId") DO NOTHING;

INSERT INTO "WordSource" ("wordId", "dataSourceId", "sourceKey", "isPrimary")
SELECT w."id", ds."id", '干:gan:gan4', true
FROM "Word" w
JOIN "DataSource" ds ON ds."code" = 'CC_CEDICT_2026_05_04'
WHERE w."hanzi" = '干' AND w."pinyin" = 'gan' AND w."pinyinTone" = 'gan4'
ON CONFLICT ("wordId", "dataSourceId") DO NOTHING;

-- Nghĩa tiếng Anh theo mục CC-CEDICT `幹 干 [gan4]` (bỏ hai nghĩa thô tục/lóng).
INSERT INTO "WordMeaning" ("wordId", "meaningOrder", "meaningEn", "meaningEnNormalized", "dataSourceId", "createdAt", "updatedAt")
SELECT w."id", m.ord, m.en, lower(m.en), ds."id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Word" w
CROSS JOIN (VALUES
  (1, 'to do'), (2, 'to work'), (3, 'to manage'), (4, 'capable'),
  (5, 'tree trunk'), (6, 'main part of sth'), (7, 'cadre')
) AS m(ord, en)
LEFT JOIN "DataSource" ds ON ds."code" = 'CC_CEDICT_2026_05_04'
WHERE w."hanzi" = '干' AND w."pinyin" = 'gan' AND w."pinyinTone" = 'gan4'
ON CONFLICT ("wordId", "meaningOrder") DO NOTHING;

-- Dòng 干 gan1 bỏ các nghĩa đến từ mục 幹 [gan4] (seed cũ gộp nhầm), chỉ khi
-- nghĩa đó chưa có bản tiếng Việt và không có câu ví dụ nào tham chiếu.
DELETE FROM "WordMeaning" m
USING "Word" w
WHERE m."wordId" = w."id"
  AND w."hanzi" = '干' AND w."pinyin" = 'gan' AND w."pinyinTone" = 'gan1'
  AND m."meaningVi" IS NULL
  AND m."meaningEn" IN ('tree trunk', 'main part of sth', 'to manage', 'to work', 'to do',
    'capable', 'cadre', 'to kill (slang)', 'to fuck (vulgar)', '(coll.) pissed off', 'annoyed')
  AND NOT EXISTS (SELECT 1 FROM "WordExample" e WHERE e."meaningId" = m."id");
