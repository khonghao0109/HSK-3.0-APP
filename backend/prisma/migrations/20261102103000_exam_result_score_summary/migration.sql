-- M4.3 / TL-161 + Q152: score summary on the published Result row.
--
-- `maxScore` and `passed` are nullable so the migration is additive for legacy
-- Result rows that predate exam scoring (no backfill, no data rewrite). When
-- `maxScore` is present, the CHECK keeps the published score inside the exam's
-- own maximum; `passed` is left unconstrained because `passScore = null` maps
-- to an unknown pass state (Q152).
ALTER TABLE "Result"
  ADD COLUMN "maxScore" INTEGER,
  ADD COLUMN "passed" BOOLEAN;

ALTER TABLE "Result"
  ADD CONSTRAINT "Result_maxScore_check"
  CHECK ("maxScore" IS NULL OR ("maxScore" > 0 AND "score" >= 0 AND "score" <= "maxScore"));
