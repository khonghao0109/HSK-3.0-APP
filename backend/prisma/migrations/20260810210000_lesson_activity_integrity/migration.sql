-- Lesson Activity V1 integrity: submitted attempts are immutable facts and
-- LearningEvent references must describe one coherent domain event.

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "LearningEvent" event
    WHERE
      (
        event.type IN ('lesson_started', 'lesson_completed')
        AND (
          event."lessonId" IS NULL OR event."topicId" IS NOT NULL
          OR event."exerciseId" IS NOT NULL OR event."attemptId" IS NOT NULL
        )
      )
      OR (
        event.type IN ('topic_started', 'topic_completed')
        AND (
          event."lessonId" IS NULL OR event."topicId" IS NULL
          OR event."exerciseId" IS NOT NULL OR event."attemptId" IS NOT NULL
          OR NOT EXISTS (
            SELECT 1 FROM "Topic" topic
            WHERE topic.id = event."topicId"
              AND topic."lessonId" = event."lessonId"
          )
        )
      )
      OR (
        event.type = 'exercise_submitted'
        AND (
          event."lessonId" IS NULL OR event."exerciseId" IS NULL
          OR event."attemptId" IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM "LessonExerciseAttempt" attempt
            JOIN "LessonExercise" exercise ON exercise.id = attempt."exerciseId"
            WHERE attempt.id = event."attemptId"
              AND attempt."submittedAt" IS NOT NULL
              AND attempt."userId" = event."userId"
              AND attempt."exerciseId" = event."exerciseId"
              AND exercise."lessonId" = event."lessonId"
              AND exercise."topicId" IS NOT DISTINCT FROM event."topicId"
          )
        )
      )
      OR (
        event.type <> 'exercise_submitted'
        AND event."attemptId" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Lesson Activity migration aborted: existing LearningEvent coherence violation';
  END IF;
END
$preflight$;

CREATE FUNCTION "hsk_reject_submitted_lesson_attempt_mutation"() RETURNS trigger AS $$
BEGIN
  IF OLD."submittedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'submitted LessonExerciseAttempt rows are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LessonExerciseAttempt_submitted_immutable"
BEFORE UPDATE OR DELETE ON "LessonExerciseAttempt"
FOR EACH ROW EXECUTE FUNCTION "hsk_reject_submitted_lesson_attempt_mutation"();

CREATE FUNCTION "hsk_check_learning_event_coherence"() RETURNS trigger AS $$
DECLARE
  exercise_lesson_id INTEGER;
  exercise_topic_id INTEGER;
  attempt_user_id INTEGER;
  attempt_exercise_id INTEGER;
  attempt_submitted_at TIMESTAMP(3);
BEGIN
  IF NEW.type IN ('lesson_started', 'lesson_completed') THEN
    IF NEW."lessonId" IS NULL OR NEW."topicId" IS NOT NULL
      OR NEW."exerciseId" IS NOT NULL OR NEW."attemptId" IS NOT NULL
    THEN
      RAISE EXCEPTION '% requires lessonId only', NEW.type;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.type IN ('topic_started', 'topic_completed') THEN
    IF NEW."lessonId" IS NULL OR NEW."topicId" IS NULL
      OR NEW."exerciseId" IS NOT NULL OR NEW."attemptId" IS NOT NULL
    THEN
      RAISE EXCEPTION '% requires coherent lessonId/topicId only', NEW.type;
    END IF;
    PERFORM 1 FROM "Topic" topic
    WHERE topic.id = NEW."topicId" AND topic."lessonId" = NEW."lessonId"
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '% Topic must belong to LearningEvent Lesson', NEW.type;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.type = 'exercise_submitted' THEN
    IF NEW."lessonId" IS NULL OR NEW."exerciseId" IS NULL OR NEW."attemptId" IS NULL THEN
      RAISE EXCEPTION 'exercise_submitted requires lessonId, exerciseId and attemptId';
    END IF;

    SELECT exercise."lessonId", exercise."topicId"
    INTO exercise_lesson_id, exercise_topic_id
    FROM "LessonExercise" exercise
    WHERE exercise.id = NEW."exerciseId"
    FOR KEY SHARE;
    IF NOT FOUND OR exercise_lesson_id <> NEW."lessonId"
      OR exercise_topic_id IS DISTINCT FROM NEW."topicId"
    THEN
      RAISE EXCEPTION 'exercise_submitted Exercise location is incoherent';
    END IF;

    SELECT attempt."userId", attempt."exerciseId", attempt."submittedAt"
    INTO attempt_user_id, attempt_exercise_id, attempt_submitted_at
    FROM "LessonExerciseAttempt" attempt
    WHERE attempt.id = NEW."attemptId"
    FOR KEY SHARE;
    IF NOT FOUND OR attempt_submitted_at IS NULL
      OR attempt_user_id <> NEW."userId"
      OR attempt_exercise_id <> NEW."exerciseId"
    THEN
      RAISE EXCEPTION 'exercise_submitted Attempt ownership/exercise is incoherent';
    END IF;

    IF NEW."topicId" IS NOT NULL THEN
      PERFORM 1 FROM "Topic" topic
      WHERE topic.id = NEW."topicId" AND topic."lessonId" = NEW."lessonId"
      FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'exercise_submitted Topic is incoherent';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."attemptId" IS NOT NULL THEN
    RAISE EXCEPTION 'attemptId is only valid for exercise_submitted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LearningEvent_coherence"
BEFORE INSERT ON "LearningEvent"
FOR EACH ROW EXECUTE FUNCTION "hsk_check_learning_event_coherence"();

CREATE FUNCTION "hsk_protect_lesson_exercise_activity_parent"() RETURNS trigger AS $$
BEGIN
  IF (
    OLD."lessonId" IS DISTINCT FROM NEW."lessonId"
    OR OLD."topicId" IS DISTINCT FROM NEW."topicId"
  )
    AND (
      EXISTS (
        SELECT 1 FROM "LessonExerciseAttempt" attempt
        WHERE attempt."exerciseId" = OLD.id AND attempt."submittedAt" IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM "LearningEvent" event WHERE event."exerciseId" = OLD.id
      )
    )
  THEN
    RAISE EXCEPTION 'LessonExercise location is immutable after submitted activity';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "hsk_protect_topic_activity_parent"() RETURNS trigger AS $$
BEGIN
  IF OLD."lessonId" IS DISTINCT FROM NEW."lessonId"
    AND EXISTS (
      SELECT 1 FROM "LearningEvent" event WHERE event."topicId" = OLD.id
    )
  THEN
    RAISE EXCEPTION 'Topic lessonId is immutable after learning activity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LessonExercise_activity_parent_immutable"
BEFORE UPDATE OF "lessonId", "topicId" ON "LessonExercise"
FOR EACH ROW EXECUTE FUNCTION "hsk_protect_lesson_exercise_activity_parent"();

CREATE TRIGGER "Topic_activity_parent_immutable"
BEFORE UPDATE OF "lessonId" ON "Topic"
FOR EACH ROW EXECUTE FUNCTION "hsk_protect_topic_activity_parent"();
