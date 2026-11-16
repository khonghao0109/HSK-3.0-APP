-- M3.4a: WordExample constraints and the generated "Word"."pinyinCompact" (BEGIN/ROLLBACK).
BEGIN;

DO $test$
DECLARE
  source_id INTEGER;
  word_id INTEGER;
  other_word_id INTEGER;
  meaning_id INTEGER;
  other_meaning_id INTEGER;
  example_id INTEGER;
  rejected BOOLEAN;
  compact TEXT;
BEGIN
  INSERT INTO "DataSource" (code, name, version, "updatedAt")
  VALUES ('M34A_EXAMPLE_TEST', 'M3.4a example test', '1', CURRENT_TIMESTAMP)
  RETURNING id INTO source_id;
  INSERT INTO "Word" (hanzi, pinyin, "pinyinNormalized", status, "updatedAt")
  VALUES ('学习', 'xue2 xi2 m34a', 'xue xi', 'published', CURRENT_TIMESTAMP)
  RETURNING id, "pinyinCompact" INTO word_id, compact;
  IF compact IS DISTINCT FROM 'xuexi' THEN
    RAISE EXCEPTION 'pinyinCompact should be xuexi, got %', compact;
  END IF;
  INSERT INTO "Word" (hanzi, pinyin, "pinyinNormalized", status, "updatedAt")
  VALUES ('学生', 'xue2 sheng5 m34a', 'xue sheng', 'published', CURRENT_TIMESTAMP)
  RETURNING id INTO other_word_id;
  INSERT INTO "WordMeaning" ("wordId", "meaningOrder", "meaningEn", "updatedAt")
  VALUES (word_id, 1, 'to study', CURRENT_TIMESTAMP) RETURNING id INTO meaning_id;
  INSERT INTO "WordMeaning" ("wordId", "meaningOrder", "meaningEn", "updatedAt")
  VALUES (other_word_id, 1, 'student', CURRENT_TIMESTAMP) RETURNING id INTO other_meaning_id;

  -- pinyinCompact is generated: a direct write is rejected.
  rejected := false;
  BEGIN
    UPDATE "Word" SET "pinyinCompact" = 'x' WHERE id = word_id;
  EXCEPTION WHEN generated_always THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'pinyinCompact accepted a direct write'; END IF;

  -- A draft example needs no data source.
  INSERT INTO "WordExample" ("wordId", "meaningId", "orderIndex", hanzi, "translationVi", "updatedAt")
  VALUES (word_id, meaning_id, 0, '我每天都学习中文。', 'Ngày nào tôi cũng học tiếng Trung.', CURRENT_TIMESTAMP)
  RETURNING id INTO example_id;

  -- Q296: publishing without a data source is rejected.
  rejected := false;
  BEGIN
    UPDATE "WordExample" SET status = 'published', "publishedAt" = CURRENT_TIMESTAMP WHERE id = example_id;
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'published example without dataSourceId was accepted'; END IF;
  UPDATE "WordExample" SET status = 'published', "publishedAt" = CURRENT_TIMESTAMP, "dataSourceId" = source_id
  WHERE id = example_id;

  -- Q290: the meaning must belong to the same word.
  rejected := false;
  BEGIN
    INSERT INTO "WordExample" ("wordId", "meaningId", "orderIndex", hanzi, "updatedAt")
    VALUES (word_id, other_meaning_id, 1, '他是学生。', CURRENT_TIMESTAMP);
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'example accepted a meaning of another word'; END IF;

  -- One live row per (wordId, orderIndex); a soft-deleted row frees the slot.
  rejected := false;
  BEGIN
    INSERT INTO "WordExample" ("wordId", "orderIndex", hanzi, "updatedAt")
    VALUES (word_id, 0, '学习很重要。', CURRENT_TIMESTAMP);
  EXCEPTION WHEN unique_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'duplicate live (wordId, orderIndex) was accepted'; END IF;
  UPDATE "WordExample" SET "deletedAt" = CURRENT_TIMESTAMP WHERE id = example_id;
  INSERT INTO "WordExample" ("wordId", "orderIndex", hanzi, "updatedAt")
  VALUES (word_id, 0, '学习很重要。', CURRENT_TIMESTAMP);

  rejected := false;
  BEGIN
    INSERT INTO "WordExample" ("wordId", "orderIndex", hanzi, "updatedAt")
    VALUES (word_id, -1, '学习。', CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'negative orderIndex was accepted'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "WordExample" ("wordId", "orderIndex", hanzi, "updatedAt")
    VALUES (word_id, 5, '   ', CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'blank hanzi was accepted'; END IF;

  -- Q299: a Word with examples cannot be hard-deleted.
  rejected := false;
  BEGIN
    DELETE FROM "Word" WHERE id = word_id;
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'hard delete of a Word with examples was accepted'; END IF;

  -- A data source still credited by an example cannot be deleted.
  rejected := false;
  BEGIN
    DELETE FROM "DataSource" WHERE id = source_id;
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'delete of a credited DataSource was accepted'; END IF;

  RAISE NOTICE 'word-example integrity: all checks passed';
END
$test$;

ROLLBACK;
