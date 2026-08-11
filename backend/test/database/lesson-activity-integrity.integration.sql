BEGIN;

DO $test$
DECLARE
  user_1_id INTEGER;
  user_2_id INTEGER;
  level_id INTEGER;
  lesson_1_id INTEGER;
  lesson_2_id INTEGER;
  topic_1_id INTEGER;
  topic_2_id INTEGER;
  exercise_1_id INTEGER;
  exercise_2_id INTEGER;
  standalone_exercise_id INTEGER;
  attempt_1_id INTEGER;
  attempt_2_id INTEGER;
  standalone_attempt_id INTEGER;
  rejected BOOLEAN;
BEGIN
  INSERT INTO "User" (email, password, "updatedAt")
  VALUES ('activity-integrity-1@example.com', '$argon2id$integration-hash', CURRENT_TIMESTAMP)
  RETURNING id INTO user_1_id;
  INSERT INTO "User" (email, password, "updatedAt")
  VALUES ('activity-integrity-2@example.com', '$argon2id$integration-hash', CURRENT_TIMESTAMP)
  RETURNING id INTO user_2_id;

  INSERT INTO "Level" (name, code, "orderIndex", "minBand", "maxBand", status, "publishedAt", "updatedAt")
  VALUES ('HSK1', 'HSK1', 1, 1, 1, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING id INTO level_id;
  INSERT INTO "Lesson" ("levelId", title, "orderIndex", slug, status, "publishedAt", "updatedAt")
  VALUES (level_id, 'Activity lesson 1', 1, 'activity-integrity-1', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING id INTO lesson_1_id;
  INSERT INTO "Lesson" ("levelId", title, "orderIndex", slug, status, "publishedAt", "updatedAt")
  VALUES (level_id, 'Activity lesson 2', 2, 'activity-integrity-2', 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING id INTO lesson_2_id;

  INSERT INTO "Topic" ("lessonId", title, content, "orderIndex", status, "publishedAt", "updatedAt")
  VALUES (lesson_1_id, 'Activity topic 1', '{}'::jsonb, 1, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING id INTO topic_1_id;
  INSERT INTO "Topic" ("lessonId", title, content, "orderIndex", status, "publishedAt", "updatedAt")
  VALUES (lesson_1_id, 'Activity topic 2', '{}'::jsonb, 2, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING id INTO topic_2_id;

  INSERT INTO "LessonExercise" (
    "lessonId", "topicId", type, prompt, content, answer, version, "orderIndex", status, "publishedAt", "updatedAt"
  ) VALUES (
    lesson_1_id, topic_1_id, 'mcq', 'Choose A',
    '{"options":[{"id":"a","text":"A"},{"id":"b","text":"B"}]}'::jsonb,
    '{"optionId":"a"}'::jsonb, 1, 1, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO exercise_1_id;
  INSERT INTO "LessonExercise" (
    "lessonId", "topicId", type, prompt, content, answer, version, "orderIndex", status, "publishedAt", "updatedAt"
  ) VALUES (
    lesson_1_id, topic_1_id, 'mcq', 'Choose B',
    '{"options":[{"id":"a","text":"A"},{"id":"b","text":"B"}]}'::jsonb,
    '{"optionId":"b"}'::jsonb, 1, 2, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO exercise_2_id;
  INSERT INTO "LessonExercise" (
    "lessonId", "topicId", type, prompt, content, answer, version, "orderIndex", status, "publishedAt", "updatedAt"
  ) VALUES (
    lesson_1_id, NULL, 'fill_blank', 'Fill', '{}'::jsonb,
    '{"acceptedTexts":["你好"],"caseSensitive":false}'::jsonb, 1, 3, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO standalone_exercise_id;

  INSERT INTO "LessonExerciseAttempt" (
    "userId", "exerciseId", "attemptNumber", answer, "contentSnapshot", "exerciseVersion",
    "isCorrect", score, "feedbackVersion", "idempotencyKey", "submittedAt", "updatedAt"
  ) VALUES (
    user_1_id, exercise_1_id, 1, '{"optionId":"a"}'::jsonb,
    jsonb_build_object('exerciseId', exercise_1_id, 'lessonId', lesson_1_id, 'topicId', topic_1_id),
    1, true, 100, 'lesson-activity-v1', 'immutable-update', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO attempt_1_id;
  INSERT INTO "LessonExerciseAttempt" (
    "userId", "exerciseId", "attemptNumber", answer, "contentSnapshot", "exerciseVersion",
    "isCorrect", score, "feedbackVersion", "idempotencyKey", "submittedAt", "updatedAt"
  ) VALUES (
    user_1_id, exercise_2_id, 1, '{"optionId":"b"}'::jsonb,
    jsonb_build_object('exerciseId', exercise_2_id, 'lessonId', lesson_1_id, 'topicId', topic_1_id),
    1, true, 100, 'lesson-activity-v1', 'immutable-delete', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO attempt_2_id;

  rejected := false;
  BEGIN
    UPDATE "LessonExerciseAttempt" SET score = 0 WHERE id = attempt_1_id;
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'submitted LessonExerciseAttempt UPDATE was accepted';
  END IF;

  rejected := false;
  BEGIN
    DELETE FROM "LessonExerciseAttempt" WHERE id = attempt_2_id;
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'submitted LessonExerciseAttempt DELETE was accepted';
  END IF;

  INSERT INTO "LearningEvent" (
    "userId", type, "lessonId", "topicId", "exerciseId", "attemptId", "idempotencyKey"
  ) VALUES (
    user_1_id, 'exercise_submitted', lesson_1_id, topic_1_id, exercise_1_id, attempt_1_id, 'valid-exercise-event'
  );

  rejected := false;
  BEGIN
    INSERT INTO "LearningEvent" (
      "userId", type, "lessonId", "topicId", "exerciseId", "attemptId", "idempotencyKey"
    ) VALUES (
      user_2_id, 'exercise_submitted', lesson_1_id, topic_1_id, exercise_1_id, attempt_1_id, 'wrong-event-user'
    );
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'LearningEvent accepted attempt owned by another user'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LearningEvent" (
      "userId", type, "lessonId", "topicId", "exerciseId", "attemptId", "idempotencyKey"
    ) VALUES (
      user_1_id, 'exercise_submitted', lesson_1_id, topic_1_id, exercise_2_id, attempt_1_id, 'wrong-event-exercise'
    );
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'LearningEvent accepted mismatched attempt/exercise'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LearningEvent" (
      "userId", type, "lessonId", "topicId", "exerciseId", "attemptId", "idempotencyKey"
    ) VALUES (
      user_1_id, 'exercise_submitted', lesson_2_id, topic_1_id, exercise_1_id, attempt_1_id, 'wrong-event-lesson'
    );
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'LearningEvent accepted mismatched exercise/lesson'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LearningEvent" (
      "userId", type, "lessonId", "topicId", "exerciseId", "attemptId", "idempotencyKey"
    ) VALUES (
      user_1_id, 'exercise_submitted', lesson_1_id, topic_2_id, exercise_1_id, attempt_1_id, 'wrong-event-topic'
    );
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'LearningEvent accepted mismatched exercise/topic'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LearningEvent" (
      "userId", type, "lessonId", "attemptId", "idempotencyKey"
    ) VALUES (
      user_1_id, 'lesson_started', lesson_1_id, attempt_1_id, 'wrong-event-shape'
    );
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'lesson_started accepted an attemptId'; END IF;

  INSERT INTO "LessonExerciseAttempt" (
    "userId", "exerciseId", "attemptNumber", answer, "contentSnapshot", "exerciseVersion",
    "isCorrect", score, "feedbackVersion", "idempotencyKey", "submittedAt", "updatedAt"
  ) VALUES (
    user_1_id, standalone_exercise_id, 1, '{"text":"你好"}'::jsonb,
    jsonb_build_object('exerciseId', standalone_exercise_id, 'lessonId', lesson_1_id, 'topicId', NULL),
    1, true, 100, 'lesson-activity-v1', 'parent-update-attempt', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO standalone_attempt_id;
  INSERT INTO "LearningEvent" (
    "userId", type, "lessonId", "exerciseId", "attemptId", "idempotencyKey"
  ) VALUES (
    user_1_id, 'exercise_submitted', lesson_1_id, standalone_exercise_id, standalone_attempt_id, 'parent-update-event'
  );

  rejected := false;
  BEGIN
    UPDATE "LessonExercise" SET "lessonId" = lesson_2_id WHERE id = standalone_exercise_id;
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'LessonExercise parent update invalidated attempt/event coherence'; END IF;

  INSERT INTO "LearningEvent" ("userId", type, "lessonId", "topicId", "idempotencyKey")
  VALUES (user_1_id, 'topic_started', lesson_1_id, topic_2_id, 'topic-parent-event');
  rejected := false;
  BEGIN
    UPDATE "Topic" SET "lessonId" = lesson_2_id WHERE id = topic_2_id;
  EXCEPTION WHEN raise_exception THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Topic parent update invalidated LearningEvent coherence'; END IF;
END
$test$;

ROLLBACK;

SELECT 'Lesson Activity integrity tests passed' AS result;
