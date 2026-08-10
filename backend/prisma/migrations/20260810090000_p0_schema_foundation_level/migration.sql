-- P0-00: stable HSK 3.0 curriculum identity and band semantics.
-- Expand first so existing Level identifiers and relations remain unchanged.
ALTER TABLE "Level"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "minBand" INTEGER,
  ADD COLUMN "maxBand" INTEGER,
  ADD COLUMN "curriculumVersion" TEXT NOT NULL DEFAULT 'HSK_3_0';

UPDATE "Level"
SET
  "code" = CASE regexp_replace(upper(btrim("name")), '[^A-Z0-9]', '', 'g')
    WHEN 'HSK1' THEN 'HSK1'
    WHEN 'HSK2' THEN 'HSK2'
    WHEN 'HSK3' THEN 'HSK3'
    WHEN 'HSK4' THEN 'HSK4'
    WHEN 'HSK5' THEN 'HSK5'
    WHEN 'HSK6' THEN 'HSK6'
    WHEN 'HSK79' THEN 'HSK7_9'
  END,
  "minBand" = CASE regexp_replace(upper(btrim("name")), '[^A-Z0-9]', '', 'g')
    WHEN 'HSK1' THEN 1
    WHEN 'HSK2' THEN 2
    WHEN 'HSK3' THEN 3
    WHEN 'HSK4' THEN 4
    WHEN 'HSK5' THEN 5
    WHEN 'HSK6' THEN 6
    WHEN 'HSK79' THEN 7
  END,
  "maxBand" = CASE regexp_replace(upper(btrim("name")), '[^A-Z0-9]', '', 'g')
    WHEN 'HSK1' THEN 1
    WHEN 'HSK2' THEN 2
    WHEN 'HSK3' THEN 3
    WHEN 'HSK4' THEN 4
    WHEN 'HSK5' THEN 5
    WHEN 'HSK6' THEN 6
    WHEN 'HSK79' THEN 9
  END;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Level"
    WHERE "code" IS NULL OR "minBand" IS NULL OR "maxBand" IS NULL
  ) THEN
    RAISE EXCEPTION 'P0-00 cannot map one or more existing Level rows to HSK1..HSK6/HSK7_9';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Level" GROUP BY "code" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'P0-00 found duplicate curriculum level codes after normalization';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Level" GROUP BY "orderIndex" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'P0-00 found duplicate Level.orderIndex values';
  END IF;
END
$$;

ALTER TABLE "Level"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "minBand" SET NOT NULL,
  ALTER COLUMN "maxBand" SET NOT NULL;

DROP INDEX "Level_orderIndex_idx";
CREATE UNIQUE INDEX "Level_code_key" ON "Level"("code");
CREATE UNIQUE INDEX "Level_orderIndex_key" ON "Level"("orderIndex");

ALTER TABLE "Level"
  ADD CONSTRAINT "Level_band_positive_check"
    CHECK ("minBand" > 0 AND "maxBand" > 0),
  ADD CONSTRAINT "Level_band_order_check"
    CHECK ("minBand" <= "maxBand"),
  ADD CONSTRAINT "Level_code_band_check"
    CHECK (
      ("code" = 'HSK1' AND "minBand" = 1 AND "maxBand" = 1) OR
      ("code" = 'HSK2' AND "minBand" = 2 AND "maxBand" = 2) OR
      ("code" = 'HSK3' AND "minBand" = 3 AND "maxBand" = 3) OR
      ("code" = 'HSK4' AND "minBand" = 4 AND "maxBand" = 4) OR
      ("code" = 'HSK5' AND "minBand" = 5 AND "maxBand" = 5) OR
      ("code" = 'HSK6' AND "minBand" = 6 AND "maxBand" = 6) OR
      ("code" = 'HSK7_9' AND "minBand" = 7 AND "maxBand" = 9)
    );

ALTER TABLE "Result" ADD COLUMN "awardedBand" INTEGER;
ALTER TABLE "Result"
  ADD CONSTRAINT "Result_awardedBand_check"
    CHECK ("awardedBand" IS NULL OR "awardedBand" BETWEEN 7 AND 9);
