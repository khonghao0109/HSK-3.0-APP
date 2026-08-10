\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  user_id INTEGER;
  user_2_id INTEGER;
  history_user_id INTEGER;
  level_1_id INTEGER;
  level_2_id INTEGER;
  level_7_9_id INTEGER;
  lesson_1_id INTEGER;
  lesson_2_id INTEGER;
  history_lesson_id INTEGER;
  topic_1_id INTEGER;
  topic_2_id INTEGER;
  word_id INTEGER;
  word_2_id INTEGER;
  card_id INTEGER;
  card_2_id INTEGER;
  review_session_1_id INTEGER;
  review_session_2_id INTEGER;
  section_1_id INTEGER;
  section_2_id INTEGER;
  group_1_id INTEGER;
  group_2_id INTEGER;
  question_id INTEGER;
  test_1_id INTEGER;
  test_2_id INTEGER;
  test_7_9_id INTEGER;
  test_question_1_id INTEGER;
  test_question_2_id INTEGER;
  attempt_id INTEGER;
  attempt_2_id INTEGER;
  attempt_7_9_id INTEGER;
  rejected BOOLEAN;
  snapshot_title TEXT;
BEGIN
  INSERT INTO "User" ("email", "password", "updatedAt")
  VALUES ('schema@example.com', '$argon2id$integration-hash', CURRENT_TIMESTAMP)
  RETURNING "id" INTO user_id;

  INSERT INTO "User" ("email", "password", "updatedAt")
  VALUES ('schema-2@example.com', '$argon2id$integration-hash', CURRENT_TIMESTAMP)
  RETURNING "id" INTO user_2_id;

  INSERT INTO "User" ("email", "password", "updatedAt")
  VALUES ('schema-history@example.com', '$argon2id$integration-hash', CURRENT_TIMESTAMP)
  RETURNING "id" INTO history_user_id;

  rejected := false;
  BEGIN
    INSERT INTO "User" ("email", "password", "updatedAt")
    VALUES ('SCHEMA@EXAMPLE.COM', '$argon2id$integration-hash', CURRENT_TIMESTAMP);
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'case-insensitive email uniqueness was not enforced';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('UserSession', 'PasswordResetToken', 'EmailVerificationToken')
      AND lower(column_name) IN ('token', 'rawtoken', 'refreshtoken')
  ) THEN
    RAISE EXCEPTION 'an identity token table exposes a raw-token column';
  END IF;

  INSERT INTO "PasswordResetToken" ("userId", "tokenHash", "expiresAt")
  VALUES (user_id, 'sha256:reset-token-hash', CURRENT_TIMESTAMP + interval '1 hour');
  INSERT INTO "EmailVerificationToken" ("userId", "tokenHash", "expiresAt")
  VALUES (user_id, 'sha256:verification-token-hash', CURRENT_TIMESTAMP + interval '1 hour');
  INSERT INTO "UserSession" ("userId", "tokenHash", "expiresAt")
  VALUES (user_id, 'sha256:refresh-token-hash', CURRENT_TIMESTAMP + interval '1 hour');

  INSERT INTO "Level" (
    "name", "code", "orderIndex", "minBand", "maxBand", "curriculumVersion", "status", "publishedAt", "updatedAt"
  ) VALUES
    ('HSK1', 'HSK1', 1, 1, 1, 'HSK_3_0', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO level_1_id;
  INSERT INTO "Level" (
    "name", "code", "orderIndex", "minBand", "maxBand", "curriculumVersion", "status", "publishedAt", "updatedAt"
  ) VALUES
    ('HSK2', 'HSK2', 2, 2, 2, 'HSK_3_0', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO level_2_id;
  INSERT INTO "Level" (
    "name", "code", "orderIndex", "minBand", "maxBand", "curriculumVersion", "status", "publishedAt", "updatedAt"
  ) VALUES
    ('HSK7-9', 'HSK7_9', 7, 7, 9, 'HSK_3_0', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO level_7_9_id;

  rejected := false;
  BEGIN
    INSERT INTO "UserGoal" (
      "userId", "targetLevelId", "targetBand", "dailyMinutes", "startDate", "updatedAt"
    ) VALUES (user_id, level_1_id, 9, 30, CURRENT_DATE, CURRENT_TIMESTAMP);
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'UserGoal accepted a targetBand outside its Level range';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "PlacementAttempt" (
      "userId", "recommendedLevelId", "recommendedBand", "updatedAt"
    ) VALUES (user_id, level_1_id, 9, CURRENT_TIMESTAMP);
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'PlacementAttempt accepted a recommendedBand outside its Level range';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LearningPlan" (
      "userId", "targetLevelId", "targetBand", "startDate", "updatedAt"
    ) VALUES (user_id, level_1_id, 9, CURRENT_DATE, CURRENT_TIMESTAMP);
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'LearningPlan accepted a targetBand outside its Level range';
  END IF;

  INSERT INTO "Lesson" ("levelId", "title", "orderIndex", "slug", "status", "publishedAt", "updatedAt")
  VALUES (level_1_id, 'Lesson 1', 1, 'p0-schema-lesson-1', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO lesson_1_id;
  INSERT INTO "Lesson" ("levelId", "title", "orderIndex", "slug", "status", "publishedAt", "updatedAt")
  VALUES (level_2_id, 'Lesson 2', 1, 'p0-schema-lesson-2', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO lesson_2_id;
  INSERT INTO "Lesson" ("levelId", "title", "orderIndex", "slug", "status", "publishedAt", "updatedAt")
  VALUES (level_1_id, 'Historical Lesson', 99, 'p0-schema-history-lesson', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO history_lesson_id;

  INSERT INTO "Topic" ("lessonId", "title", "content", "orderIndex", "status", "publishedAt", "updatedAt")
  VALUES (lesson_1_id, 'Topic 1', '{}'::jsonb, 2, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO topic_1_id;
  INSERT INTO "Topic" ("lessonId", "title", "content", "orderIndex", "status", "publishedAt", "updatedAt")
  VALUES (lesson_2_id, 'Topic 2', '{}'::jsonb, 1, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO topic_2_id;

  INSERT INTO "Word" (
    "hanzi", "pinyin", "pinyinNormalized", "status", "publishedAt", "updatedAt"
  ) VALUES ('测', 'ce', 'ce', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO word_id;
  INSERT INTO "Word" (
    "hanzi", "pinyin", "pinyinNormalized", "status", "publishedAt", "updatedAt"
  ) VALUES ('验', 'yan', 'yan', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO word_2_id;

  INSERT INTO "UserWord" ("userId", "wordId") VALUES (user_id, word_id);
  INSERT INTO "ReviewCard" ("userId", "wordId", "updatedAt")
  VALUES (user_id, word_id, CURRENT_TIMESTAMP)
  ON CONFLICT ("userId", "wordId") DO UPDATE SET "updatedAt" = EXCLUDED."updatedAt"
  RETURNING "id" INTO card_id;
  INSERT INTO "ReviewCard" ("userId", "wordId", "updatedAt")
  VALUES (user_id, word_2_id, CURRENT_TIMESTAMP)
  RETURNING "id" INTO card_2_id;

  INSERT INTO "ReviewSession" ("userId", "mode", "plannedCount", "updatedAt")
  VALUES (user_id, 'due', 10, CURRENT_TIMESTAMP)
  RETURNING "id" INTO review_session_1_id;
  INSERT INTO "ReviewSession" ("userId", "mode", "plannedCount", "updatedAt")
  VALUES (user_2_id, 'due', 10, CURRENT_TIMESTAMP)
  RETURNING "id" INTO review_session_2_id;

  rejected := false;
  BEGIN
    INSERT INTO "ReviewCard" ("userId", "wordId", "updatedAt")
    VALUES (user_id, word_id, CURRENT_TIMESTAMP);
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ReviewCard uniqueness was not enforced';
  END IF;

  INSERT INTO "ReviewEvent" (
    "cardId", "sessionId", "grade", "previousState", "nextState", "previousDueAt", "nextDueAt",
    "previousIntervalDays", "nextIntervalDays", "previousEaseFactor", "nextEaseFactor", "idempotencyKey"
  ) VALUES (
    card_id, review_session_1_id, 'good', 'new', 'review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 day',
    0, 1, 2.5, 2.5, 'review-event-1'
  );
  rejected := false;
  BEGIN
    INSERT INTO "ReviewEvent" (
      "cardId", "sessionId", "grade", "previousState", "nextState", "previousDueAt", "nextDueAt",
      "previousIntervalDays", "nextIntervalDays", "previousEaseFactor", "nextEaseFactor", "idempotencyKey"
    ) VALUES (
      card_id, review_session_1_id, 'good', 'new', 'review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 day',
      0, 1, 2.5, 2.5, 'review-event-1'
    );
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ReviewEvent idempotency was not enforced';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "ReviewEvent" (
      "cardId", "sessionId", "grade", "previousState", "nextState", "previousDueAt", "nextDueAt",
      "previousIntervalDays", "nextIntervalDays", "previousEaseFactor", "nextEaseFactor", "idempotencyKey"
    ) VALUES (
      card_id, review_session_2_id, 'good', 'new', 'review', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + interval '1 day',
      0, 1, 2.5, 2.5, 'review-event-wrong-owner'
    );
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ReviewEvent accepted a ReviewSession owned by another user';
  END IF;

  rejected := false;
  BEGIN
    UPDATE "ReviewCard" SET "userId" = user_2_id WHERE "id" = card_2_id;
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ReviewCard ownership was mutable without any ReviewEvent';
  END IF;

  rejected := false;
  BEGIN
    UPDATE "ReviewSession" SET "userId" = user_id WHERE "id" = review_session_2_id;
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ReviewSession ownership was mutable without any ReviewEvent';
  END IF;

  IF to_regclass('"ReviewCard_userId_state_dueAt_idx"') IS NULL THEN
    RAISE EXCEPTION 'due queue index is missing';
  END IF;
  PERFORM 1 FROM "ReviewCard"
  WHERE "userId" = user_id AND "state" IN ('new', 'learning', 'review') AND "dueAt" <= CURRENT_TIMESTAMP
  ORDER BY "dueAt" LIMIT 20;

  INSERT INTO "LearningEvent" (
    "userId", "type", "lessonId", "idempotencyKey"
  ) VALUES (
    history_user_id, 'lesson_started', history_lesson_id, 'immutable-lifecycle-1'
  );

  rejected := false;
  BEGIN
    DELETE FROM "User" WHERE "id" = history_user_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'hard-delete User with immutable LearningEvent was not restricted';
  END IF;

  rejected := false;
  BEGIN
    DELETE FROM "Lesson" WHERE "id" = history_lesson_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'hard-delete Lesson with immutable LearningEvent was not restricted';
  END IF;

  rejected := false;
  BEGIN
    DELETE FROM "ReviewSession" WHERE "id" = review_session_1_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'hard-delete ReviewSession with immutable ReviewEvent was not restricted';
  END IF;

  rejected := false;
  BEGIN
    UPDATE "User" SET "id" = "id" + 1000000 WHERE "id" = history_user_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'User primary-key update with immutable history was not rejected by an FK';
  END IF;

  rejected := false;
  BEGIN
    UPDATE "Lesson" SET "id" = "id" + 1000000 WHERE "id" = history_lesson_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Lesson primary-key update with immutable history was not rejected by an FK';
  END IF;

  rejected := false;
  BEGIN
    UPDATE "ReviewSession" SET "id" = "id" + 1000000 WHERE "id" = review_session_1_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ReviewSession primary-key update with immutable history was not rejected by an FK';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_constraint
    WHERE conname = ANY (ARRAY[
      'PlacementAttempt_recommendedLevelId_fkey',
      'LearningEvent_userId_fkey',
      'LearningEvent_lessonId_fkey',
      'LearningEvent_topicId_fkey',
      'LearningEvent_exerciseId_fkey',
      'LearningEvent_attemptId_fkey',
      'ReviewEvent_sessionId_fkey',
      'ExamAttemptSnapshot_attemptId_fkey',
      'ExamAttemptEvent_attemptId_fkey',
      'ContentRevision_authorId_fkey',
      'AuditLog_actorId_fkey',
      'ReviewCard_userId_fkey',
      'ReviewSession_userId_fkey',
      'LessonExerciseAttempt_userId_fkey',
      'PronunciationAttempt_userId_fkey',
      'Result_userId_fkey'
    ])
      AND confdeltype = 'r'
      AND confupdtype = 'r'
  ) <> 16 THEN
    RAISE EXCEPTION 'immutable/history FK actions are not DELETE RESTRICT / UPDATE RESTRICT';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "Story" ("levelId", "lessonId", "title", "content", "slug", "updatedAt")
    VALUES (level_2_id, lesson_1_id, 'Invalid story', '{}'::jsonb, 'invalid-story', CURRENT_TIMESTAMP);
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Story/Lesson level mismatch was accepted';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LessonWord" ("lessonId", "topicId", "wordId", "orderIndex")
    VALUES (lesson_1_id, topic_2_id, word_id, 1);
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'LessonWord/Topic lesson mismatch was accepted';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", "type", "prompt", "content", "answer", "orderIndex", "updatedAt"
    ) VALUES (lesson_1_id, topic_2_id, 'mcq', 'Invalid', '{}'::jsonb, '{}'::jsonb, 1, CURRENT_TIMESTAMP);
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'LessonExercise/Topic lesson mismatch was accepted';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "PronunciationPractice" (
      "lessonId", "targetType", "targetText", "orderIndex", "updatedAt"
    ) VALUES (lesson_1_id, 'word', 'Invalid target', 1, CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'PronunciationPractice target invariant was not enforced';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "PronunciationPractice" (
      "lessonId", "topicId", "wordId", "targetType", "targetText", "orderIndex", "updatedAt"
    ) VALUES (lesson_1_id, topic_2_id, word_id, 'word', '测', 1, CURRENT_TIMESTAMP);
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'PronunciationPractice/Topic lesson mismatch was accepted';
  END IF;

  INSERT INTO "LessonWord" ("lessonId", "topicId", "wordId", "orderIndex")
  VALUES (lesson_1_id, topic_1_id, word_id, 1);
  rejected := false;
  BEGIN
    UPDATE "Topic" SET "lessonId" = lesson_2_id WHERE "id" = topic_1_id;
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Topic parent update invalidated LessonWord integrity';
  END IF;

  INSERT INTO "Test" ("levelId", "title", "slug", "duration", "status", "publishedAt", "updatedAt")
  VALUES (level_1_id, 'Immutable test', 'immutable-test-1', 600, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO test_1_id;
  INSERT INTO "Test" ("levelId", "title", "slug", "duration", "status", "publishedAt", "updatedAt")
  VALUES (level_1_id, 'Reusable question test', 'immutable-test-2', 600, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO test_2_id;
  INSERT INTO "Test" ("levelId", "title", "slug", "duration", "status", "publishedAt", "updatedAt")
  VALUES (level_7_9_id, 'HSK7-9 awarded band test', 'hsk-7-9-awarded-band', 600, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING "id" INTO test_7_9_id;

  INSERT INTO "TestSection" ("testId", "skill", "title", "orderIndex", "updatedAt")
  VALUES (test_1_id, 'reading', 'Reading', 1, CURRENT_TIMESTAMP)
  RETURNING "id" INTO section_1_id;
  INSERT INTO "TestSection" ("testId", "skill", "title", "orderIndex", "updatedAt")
  VALUES (test_2_id, 'reading', 'Reading', 1, CURRENT_TIMESTAMP)
  RETURNING "id" INTO section_2_id;

  INSERT INTO "QuestionGroup" ("testId", "sectionId", "title", "orderIndex", "updatedAt")
  VALUES (test_1_id, section_1_id, 'Group 1', 1, CURRENT_TIMESTAMP)
  RETURNING "id" INTO group_1_id;
  INSERT INTO "QuestionGroup" ("testId", "sectionId", "title", "orderIndex", "updatedAt")
  VALUES (test_2_id, section_2_id, 'Group 2', 1, CURRENT_TIMESTAMP)
  RETURNING "id" INTO group_2_id;

  INSERT INTO "Question" (
    "content", "type", "skill", "answers", "correctAnswer", "levelId", "status", "publishedAt", "updatedAt"
  ) VALUES (
    'Original question', 'mcq', 'reading', '["A", "B"]'::jsonb, '"A"'::jsonb,
    level_1_id, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING "id" INTO question_id;

  INSERT INTO "TestQuestion" ("testId", "questionId", "orderIndex")
  VALUES (test_1_id, question_id, 1)
  RETURNING "id" INTO test_question_1_id;
  INSERT INTO "TestQuestionPlacement" ("testQuestionId", "testId", "sectionId", "groupId", "orderIndex")
  VALUES (test_question_1_id, test_1_id, section_1_id, group_1_id, 1);

  INSERT INTO "TestQuestion" ("testId", "questionId", "orderIndex")
  VALUES (test_2_id, question_id, 1)
  RETURNING "id" INTO test_question_2_id;
  INSERT INTO "TestQuestionPlacement" ("testQuestionId", "testId", "sectionId", "groupId", "orderIndex")
  VALUES (test_question_2_id, test_2_id, section_2_id, group_2_id, 1);

  rejected := false;
  BEGIN
    UPDATE "TestQuestionPlacement" SET "groupId" = group_2_id WHERE "testQuestionId" = test_question_1_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'cross-test placement was accepted';
  END IF;

  INSERT INTO "ExamAttempt" (
    "userId", "testId", "expiresAt", "remainingSeconds", "scoringVersion", "idempotencyKey", "updatedAt"
  ) VALUES (
    user_id, test_1_id, CURRENT_TIMESTAMP + interval '10 minutes', 600, 'hsk-p0-v1', 'attempt-1', CURRENT_TIMESTAMP
  ) RETURNING "id" INTO attempt_id;

  INSERT INTO "ExamAttemptSnapshot" (
    "attemptId", "testVersion", "snapshotVersion", "contentHash", "payload"
  ) VALUES (
    attempt_id, 1, 1, 'sha256:snapshot-1',
    jsonb_build_object('testTitle', 'Immutable test', 'questionContent', 'Original question', 'correctAnswer', 'A')
  );

  INSERT INTO "ExamAnswer" (
    "attemptId", "snapshotQuestionKey", "questionId", "answer", "saveIdempotencyKey", "updatedAt"
  ) VALUES (attempt_id, 'question-1-v1', question_id, '"A"'::jsonb, 'save-1', CURRENT_TIMESTAMP);

  rejected := false;
  BEGIN
    INSERT INTO "ExamAnswer" (
      "attemptId", "snapshotQuestionKey", "questionId", "answer", "saveIdempotencyKey", "updatedAt"
    ) VALUES (attempt_id, 'question-1-v1', question_id, '"A"'::jsonb, 'save-1-retry', CURRENT_TIMESTAMP);
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'duplicate autosave answer was accepted';
  END IF;

  UPDATE "Question" SET "content" = 'Changed live question' WHERE "id" = question_id;
  UPDATE "Test" SET "title" = 'Changed live test' WHERE "id" = test_1_id;
  SELECT "payload"->>'testTitle' INTO snapshot_title FROM "ExamAttemptSnapshot" WHERE "attemptId" = attempt_id;
  IF snapshot_title <> 'Immutable test' THEN
    RAISE EXCEPTION 'snapshot changed after live content update';
  END IF;

  rejected := false;
  BEGIN
    UPDATE "ExamAttemptSnapshot" SET "payload" = '{}'::jsonb WHERE "attemptId" = attempt_id;
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ExamAttemptSnapshot mutation was accepted';
  END IF;

  UPDATE "ExamAttempt"
  SET "status" = 'submitted', "submittedAt" = CURRENT_TIMESTAMP, "remainingSeconds" = 300, "score" = 1, "maxScore" = 1
  WHERE "id" = attempt_id;

  rejected := false;
  BEGIN
    INSERT INTO "Result" (
      "userId", "testId", "attemptId", "score", "awardedBand", "scoringVersion", "detailJson"
    ) VALUES (user_id, test_1_id, attempt_id, 1, 7, 'hsk-p0-v1', '{}'::jsonb);
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'HSK1 Result accepted awardedBand 7';
  END IF;

  INSERT INTO "Result" (
    "userId", "testId", "attemptId", "score", "awardedBand", "scoringVersion", "detailJson"
  ) VALUES (user_id, test_1_id, attempt_id, 1, 1, 'hsk-p0-v1', '{}'::jsonb);

  rejected := false;
  BEGIN
    INSERT INTO "Result" ("userId", "testId", "attemptId", "score", "scoringVersion", "detailJson")
    VALUES (user_id, test_1_id, attempt_id, 1, 'hsk-p0-v1', '{}'::jsonb);
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'double-submit Result uniqueness was not enforced';
  END IF;

  INSERT INTO "ExamAttempt" (
    "userId", "testId", "status", "startedAt", "expiresAt", "submittedAt", "remainingSeconds",
    "score", "maxScore", "scoringVersion", "idempotencyKey", "updatedAt"
  ) VALUES (
    user_id, test_7_9_id, 'submitted', CURRENT_TIMESTAMP - interval '10 minutes', CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP, 0, 1, 1, 'hsk-p0-v1', 'attempt-hsk-7-9', CURRENT_TIMESTAMP
  ) RETURNING "id" INTO attempt_7_9_id;

  INSERT INTO "Result" (
    "userId", "testId", "attemptId", "score", "awardedBand", "scoringVersion", "detailJson"
  ) VALUES (
    user_id, test_7_9_id, attempt_7_9_id, 1, 7, 'hsk-p0-v1', '{}'::jsonb
  );

  INSERT INTO "ExamAttempt" (
    "userId", "testId", "expiresAt", "remainingSeconds", "scoringVersion", "idempotencyKey", "updatedAt"
  ) VALUES (
    user_id, test_1_id, CURRENT_TIMESTAMP + interval '10 minutes', 600, 'hsk-p0-v1', 'attempt-2', CURRENT_TIMESTAMP
  ) RETURNING "id" INTO attempt_2_id;
  rejected := false;
  BEGIN
    INSERT INTO "Result" ("userId", "testId", "attemptId", "score", "scoringVersion", "detailJson")
    VALUES (user_id, test_1_id, attempt_2_id, 0, 'hsk-p0-v1', '{}'::jsonb);
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Result for in-progress ExamAttempt was accepted';
  END IF;
END
$test$;

ROLLBACK;

SELECT 'P0 schema integration tests passed' AS result;
