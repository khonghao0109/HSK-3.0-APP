BEGIN;

DO $test$
DECLARE
  author_id INTEGER;
  level_id INTEGER;
  lesson_id INTEGER;
  archived_lesson_id INTEGER;
  publish_guard_lesson_id INTEGER;
  publish_guard_exercise_id INTEGER;
  topic_id INTEGER;
  source_1_id INTEGER;
  source_2_id INTEGER;
  ready_audio_id INTEGER;
  pending_audio_id INTEGER;
  failed_audio_id INTEGER;
  quarantined_audio_id INTEGER;
  deleted_audio_id INTEGER;
  image_media_id INTEGER;
  speaking_exercise_id INTEGER;
  revision_parent_exercise_id INTEGER;
  revision_parent_revision_id INTEGER;
  listening_exercise_id INTEGER;
  listening_revision_1_id INTEGER;
  listening_revision_2_id INTEGER;
  listening_attempt_id INTEGER;
  imported_exercise_id INTEGER;
  rejected BOOLEAN;
  persisted_version INTEGER;
  persisted_prompt TEXT;
  persisted_media JSONB;
  persisted_snapshot JSONB;
BEGIN
  IF (
    SELECT COUNT(DISTINCT column_name)
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'LessonExercise'
      AND column_name = ANY (ARRAY[
        'mediaId',
        'dataSourceId',
        'sourceKey',
        'createdById',
        'updatedById',
        'publishedById',
        'publishedAt'
      ])
  ) <> 7 THEN
    RAISE EXCEPTION 'LessonExercise authoring/provenance columns are incomplete';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LessonExercise_mediaId_fkey'
      AND conrelid = '"LessonExercise"'::regclass
      AND confrelid = '"Media"'::regclass
      AND confdeltype = 'r'
      AND confupdtype = 'r'
  ) THEN
    RAISE EXCEPTION 'LessonExercise media FK must use RESTRICT/RESTRICT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LessonExercise_dataSourceId_fkey'
      AND conrelid = '"LessonExercise"'::regclass
      AND confrelid = '"DataSource"'::regclass
      AND confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'LessonExercise provenance FK must restrict DataSource deletion';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_constraint
    WHERE conname = ANY (ARRAY[
      'LessonExercise_lessonId_fkey',
      'LessonExercise_topicId_fkey'
    ])
      AND conrelid = '"LessonExercise"'::regclass
      AND confdeltype = 'r'
      AND confupdtype = 'r'
  ) <> 2 THEN
    RAISE EXCEPTION 'LessonExercise curriculum parent FKs must use RESTRICT/RESTRICT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ContentRevision_lesson_exercise_hash_check'
      AND conrelid = '"ContentRevision"'::regclass
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'LessonExercise revisions must require a content hash';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'LessonExercise_publish_readiness'
      AND tgrelid = '"LessonExercise"'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'LessonExercise publish-readiness trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'ContentRevision_lesson_exercise_parent'
      AND tgrelid = '"ContentRevision"'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'LessonExercise revision-parent trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'LessonExercise_revision_parent_restrict'
      AND tgrelid = '"LessonExercise"'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'LessonExercise archive-only trigger is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LessonExercise_archive_state_check'
      AND conrelid = '"LessonExercise"'::regclass
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'LessonExercise archive status/deletedAt coupling is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'LessonExercise_media_type_scope_check'
      AND conrelid = '"LessonExercise"'::regclass
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'LessonExercise media type scope constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Media_url_nonblank_check'
      AND conrelid = '"Media"'::regclass
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'Media URL nonblank constraint is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'LessonExercise_live_parent'
      AND tgrelid = '"LessonExercise"'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'LessonExercise live-parent trigger is missing';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "Media" (url, type, "processingStatus", "updatedAt")
    VALUES ('   ', 'audio', 'ready', CURRENT_TIMESTAMP);
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Blank Media URL must be rejected';
  END IF;

  INSERT INTO "User" (email, password, role, status, "updatedAt")
  VALUES (
    'exercise-authoring-integrity@example.com',
    '$argon2id$integration-hash',
    'admin',
    'active',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO author_id;

  INSERT INTO "Level" (
    name, code, "orderIndex", "minBand", "maxBand", status, "publishedAt", "updatedAt"
  ) VALUES (
    'HSK1', 'HSK1', 1, 1, 1, 'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) RETURNING id INTO level_id;

  INSERT INTO "Lesson" (
    "levelId", title, "orderIndex", slug, status, "publishedAt", "updatedAt"
  ) VALUES (
    level_id,
    'Exercise authoring integrity',
    1,
    'exercise-authoring-integrity',
    'published',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO lesson_id;

  INSERT INTO "Topic" (
    "lessonId", title, content, "orderIndex", status, "publishedAt", "updatedAt"
  ) VALUES (
    lesson_id,
    'Exercise authoring integrity topic',
    '{}'::jsonb,
    1,
    'published',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO topic_id;

  INSERT INTO "Lesson" (
    "levelId", title, "orderIndex", slug, status, "deletedAt", "updatedAt"
  ) VALUES (
    level_id,
    'Archived exercise import parent',
    2,
    'archived-exercise-import-parent',
    'archived',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO archived_lesson_id;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", type, prompt, content, answer, "orderIndex", status, "updatedAt"
    ) VALUES (
      archived_lesson_id,
      'fill_blank',
      'Must reject archived parent',
      '{}'::jsonb,
      '{"acceptedTexts":["你好"]}'::jsonb,
      1,
      'draft',
      CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'LessonExercise was inserted under an archived Lesson';
  END IF;

  INSERT INTO "Lesson" (
    "levelId", title, "orderIndex", slug, status, "updatedAt"
  ) VALUES (
    level_id,
    'Exercise parent publish guard',
    3,
    'exercise-parent-publish-guard',
    'draft',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO publish_guard_lesson_id;

  INSERT INTO "LessonExercise" (
    "lessonId", type, prompt, content, answer, "orderIndex", status, "updatedAt"
  ) VALUES (
    publish_guard_lesson_id,
    'fill_blank',
    'Cannot publish after parent archive',
    '{}'::jsonb,
    '{"acceptedTexts":["你好"]}'::jsonb,
    1,
    'draft',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO publish_guard_exercise_id;

  UPDATE "Lesson"
  SET status = 'archived', "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = publish_guard_lesson_id;

  rejected := false;
  BEGIN
    UPDATE "LessonExercise"
    SET status = 'published', "publishedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = publish_guard_exercise_id;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'LessonExercise published after its parent Lesson was archived';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", type, prompt, content, answer, "orderIndex", status,
      "deletedAt", "updatedAt"
    ) VALUES (
      lesson_id,
      topic_id,
      'fill_blank',
      'Must couple archive state',
      '{}'::jsonb,
      '{"acceptedTexts":["你好"]}'::jsonb,
      99,
      'draft',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'LessonExercise accepted deletedAt without archived status';
  END IF;

  INSERT INTO "DataSource" (
    code, name, version, "contentHash", "createdById", "updatedAt"
  ) VALUES (
    'EXERCISE_AUTHORING_TEST_SOURCE_1',
    'Exercise authoring test source',
    'v1',
    'sha256:exercise-authoring-test-source-1',
    author_id,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO source_1_id;

  INSERT INTO "DataSource" (
    code, name, version, "contentHash", "createdById", "updatedAt"
  ) VALUES (
    'EXERCISE_AUTHORING_TEST_SOURCE_2',
    'Exercise authoring test source',
    'v2',
    'sha256:exercise-authoring-test-source-2',
    author_id,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO source_2_id;

  INSERT INTO "Media" (
    url, type, "mimeType", duration, "processingStatus", "storageProvider", "storageKey",
    checksum, metadata, "updatedAt"
  ) VALUES (
    'https://cdn.example.test/exercise-ready.mp3',
    'audio',
    'audio/mpeg',
    12,
    'ready',
    'exercise-authoring-test',
    'ready-audio',
    'sha256:ready-audio-internal',
    '{"privateTranscodeId":"must-not-leak"}'::jsonb,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO ready_audio_id;

  INSERT INTO "Media" (url, type, "processingStatus", "updatedAt")
  VALUES (
    'https://cdn.example.test/exercise-pending.mp3',
    'audio',
    'pending',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO pending_audio_id;

  INSERT INTO "Media" (url, type, "processingStatus", "updatedAt")
  VALUES (
    'https://cdn.example.test/exercise-failed.mp3',
    'audio',
    'failed',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO failed_audio_id;

  INSERT INTO "Media" (url, type, "processingStatus", "updatedAt")
  VALUES (
    'https://cdn.example.test/exercise-quarantined.mp3',
    'audio',
    'quarantined',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO quarantined_audio_id;

  INSERT INTO "Media" (url, type, "processingStatus", "deletedAt", "updatedAt")
  VALUES (
    'https://cdn.example.test/exercise-deleted.mp3',
    'audio',
    'ready',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO deleted_audio_id;

  INSERT INTO "Media" (url, type, "processingStatus", "updatedAt")
  VALUES (
    'https://cdn.example.test/exercise-image.png',
    'image',
    'ready',
    CURRENT_TIMESTAMP
  ) RETURNING id INTO image_media_id;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", "mediaId", type, prompt, content, answer,
      "orderIndex", status, "updatedAt"
    ) VALUES (
      lesson_id,
      topic_id,
      ready_audio_id,
      'mcq',
      'Non-listening media must be rejected',
      '{"options":[{"id":"a","text":"A"},{"id":"b","text":"B"}]}'::jsonb,
      '{"optionId":"a"}'::jsonb,
      98,
      'draft',
      CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Non-listening LessonExercise accepted mediaId';
  END IF;

  -- speaking_repeat remains authorable as a draft but is outside V1 publishing.
  INSERT INTO "LessonExercise" (
    "lessonId", "topicId", type, prompt, content, answer, "orderIndex", status,
    "createdById", "updatedById", "updatedAt"
  ) VALUES (
    lesson_id,
    topic_id,
    'speaking_repeat',
    'Repeat 你好',
    '{"text":"你好"}'::jsonb,
    '{}'::jsonb,
    1,
    'draft',
    author_id,
    author_id,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO speaking_exercise_id;

  rejected := false;
  BEGIN
    UPDATE "LessonExercise"
    SET status = 'published',
        "publishedAt" = CURRENT_TIMESTAMP,
        "publishedById" = author_id,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = speaking_exercise_id;
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'speaking_repeat was published';
  END IF;

  rejected := false;
  BEGIN
    DELETE FROM "LessonExercise" WHERE id = speaking_exercise_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'draft LessonExercise was hard-deleted instead of archived';
  END IF;

  -- A published row always carries publication metadata.
  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", type, prompt, content, answer, "orderIndex", status,
      "createdById", "updatedById", "publishedById", "updatedAt"
    ) VALUES (
      lesson_id,
      topic_id,
      'mcq',
      'Missing publishedAt',
      '{"options":[{"optionId":"a","text":"A"}]}'::jsonb,
      '{"optionId":"a"}'::jsonb,
      2,
      'published',
      author_id,
      author_id,
      author_id,
      CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'published LessonExercise without publishedAt was accepted';
  END IF;

  -- Listening publish rejects every unsafe relational-media state.
  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", type, prompt, content, answer, "orderIndex", status,
      "publishedAt", "publishedById", "createdById", "updatedById", "updatedAt"
    ) VALUES (
      lesson_id,
      topic_id,
      'listening_choice',
      'Missing media',
      '{"options":[{"optionId":"a","text":"A"}]}'::jsonb,
      '{"optionId":"a"}'::jsonb,
      3,
      'published',
      CURRENT_TIMESTAMP,
      author_id,
      author_id,
      author_id,
      CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'listening_choice without media was published';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", "mediaId", type, prompt, content, answer, "orderIndex", status,
      "publishedAt", "publishedById", "createdById", "updatedById", "updatedAt"
    ) VALUES (
      lesson_id, topic_id, 2147483647, 'listening_choice', 'Missing media row',
      '{"options":[{"optionId":"a","text":"A"}]}'::jsonb,
      '{"optionId":"a"}'::jsonb, 4, 'published', CURRENT_TIMESTAMP,
      author_id, author_id, author_id, CURRENT_TIMESTAMP
    );
  EXCEPTION
    WHEN check_violation OR foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'listening_choice accepted a missing Media row'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", "mediaId", type, prompt, content, answer, "orderIndex", status,
      "publishedAt", "publishedById", "createdById", "updatedById", "updatedAt"
    ) VALUES (
      lesson_id, topic_id, image_media_id, 'listening_choice', 'Image media',
      '{"options":[{"optionId":"a","text":"A"}]}'::jsonb,
      '{"optionId":"a"}'::jsonb, 5, 'published', CURRENT_TIMESTAMP,
      author_id, author_id, author_id, CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'listening_choice accepted non-audio media'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", "mediaId", type, prompt, content, answer, "orderIndex", status,
      "publishedAt", "publishedById", "createdById", "updatedById", "updatedAt"
    ) VALUES (
      lesson_id, topic_id, pending_audio_id, 'listening_choice', 'Pending media',
      '{"options":[{"optionId":"a","text":"A"}]}'::jsonb,
      '{"optionId":"a"}'::jsonb, 6, 'published', CURRENT_TIMESTAMP,
      author_id, author_id, author_id, CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'listening_choice accepted pending audio'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", "mediaId", type, prompt, content, answer, "orderIndex", status,
      "publishedAt", "publishedById", "createdById", "updatedById", "updatedAt"
    ) VALUES (
      lesson_id, topic_id, failed_audio_id, 'listening_choice', 'Failed media',
      '{"options":[{"optionId":"a","text":"A"}]}'::jsonb,
      '{"optionId":"a"}'::jsonb, 7, 'published', CURRENT_TIMESTAMP,
      author_id, author_id, author_id, CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'listening_choice accepted failed audio'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", "mediaId", type, prompt, content, answer, "orderIndex", status,
      "publishedAt", "publishedById", "createdById", "updatedById", "updatedAt"
    ) VALUES (
      lesson_id, topic_id, quarantined_audio_id, 'listening_choice', 'Quarantined media',
      '{"options":[{"optionId":"a","text":"A"}]}'::jsonb,
      '{"optionId":"a"}'::jsonb, 8, 'published', CURRENT_TIMESTAMP,
      author_id, author_id, author_id, CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'listening_choice accepted quarantined audio'; END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", "mediaId", type, prompt, content, answer, "orderIndex", status,
      "publishedAt", "publishedById", "createdById", "updatedById", "updatedAt"
    ) VALUES (
      lesson_id, topic_id, deleted_audio_id, 'listening_choice', 'Deleted media',
      '{"options":[{"optionId":"a","text":"A"}]}'::jsonb,
      '{"optionId":"a"}'::jsonb, 9, 'published', CURRENT_TIMESTAMP,
      author_id, author_id, author_id, CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'listening_choice accepted soft-deleted audio'; END IF;

  -- Ready, non-deleted audio is the only publishable listening relation.
  INSERT INTO "LessonExercise" (
    "lessonId", "topicId", "mediaId", type, prompt, content, answer, version, "orderIndex", status,
    "publishedAt", "publishedById", "createdById", "updatedById", "updatedAt"
  ) VALUES (
    lesson_id,
    topic_id,
    ready_audio_id,
    'listening_choice',
    'Choose the greeting',
    '{"options":[{"optionId":"hello","text":"你好"},{"optionId":"bye","text":"再见"}]}'::jsonb,
    '{"optionId":"hello"}'::jsonb,
    1,
    10,
    'published',
    CURRENT_TIMESTAMP,
    author_id,
    author_id,
    author_id,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO listening_exercise_id;

  -- A hard delete cannot invalidate the current relational media reference.
  rejected := false;
  BEGIN
    DELETE FROM "Media" WHERE id = ready_audio_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'referenced listening Media was hard-deleted';
  END IF;

  -- Polymorphic revisions require both a real exercise parent and a hash.
  rejected := false;
  BEGIN
    INSERT INTO "ContentRevision" (
      "entityType", "entityId", revision, snapshot, "contentHash", "authorId"
    ) VALUES (
      'lesson_exercise',
      2147483647,
      1,
      '{"prompt":"dangling"}'::jsonb,
      'sha256:dangling',
      author_id
    );
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'dangling lesson_exercise ContentRevision was accepted';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "ContentRevision" (
      "entityType", "entityId", revision, snapshot, "authorId"
    ) VALUES (
      'lesson_exercise',
      listening_exercise_id,
      1,
      '{"prompt":"missing hash"}'::jsonb,
      author_id
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'hashless lesson_exercise ContentRevision was accepted';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "ContentRevision" (
      "entityType", "entityId", revision, snapshot, "contentHash", "authorId"
    ) VALUES (
      'lesson_exercise',
      listening_exercise_id,
      1,
      '{"prompt":"blank hash"}'::jsonb,
      '   ',
      author_id
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'blank lesson_exercise ContentRevision hash was accepted';
  END IF;

  INSERT INTO "ContentRevision" (
    "entityType", "entityId", revision, snapshot, "contentHash", "authorId"
  ) VALUES (
    'lesson_exercise',
    listening_exercise_id,
    1,
    jsonb_build_object(
      'type', 'listening_choice',
      'prompt', 'Choose the greeting',
      'content', '{"options":[{"optionId":"hello","text":"你好"},{"optionId":"bye","text":"再见"}]}'::jsonb,
      'answer', '{"optionId":"hello"}'::jsonb,
      'mediaId', ready_audio_id
    ),
    'sha256:listening-revision-1',
    author_id
  ) RETURNING id INTO listening_revision_1_id;

  INSERT INTO "ContentReview" ("revisionId", "reviewerId", decision, note)
  VALUES (listening_revision_1_id, author_id, 'approved', 'Approved revision one');

  -- A revision makes an exercise archive-only even before learner history exists.
  INSERT INTO "LessonExercise" (
    "lessonId", "topicId", type, prompt, content, answer, "orderIndex", status,
    "createdById", "updatedById", "updatedAt"
  ) VALUES (
    lesson_id,
    topic_id,
    'mcq',
    'Revision parent',
    '{"options":[{"optionId":"a","text":"A"}]}'::jsonb,
    '{"optionId":"a"}'::jsonb,
    11,
    'draft',
    author_id,
    author_id,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO revision_parent_exercise_id;

  INSERT INTO "ContentRevision" (
    "entityType", "entityId", revision, snapshot, "contentHash", "authorId"
  ) VALUES (
    'lesson_exercise',
    revision_parent_exercise_id,
    1,
    '{"prompt":"Revision parent"}'::jsonb,
    'sha256:revision-parent',
    author_id
  ) RETURNING id INTO revision_parent_revision_id;

  rejected := false;
  BEGIN
    DELETE FROM "LessonExercise" WHERE id = revision_parent_exercise_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'authored LessonExercise with revision was hard-deleted';
  END IF;

  UPDATE "LessonExercise"
  SET status = 'archived', "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = revision_parent_exercise_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'authored LessonExercise archive update did not persist';
  END IF;

  -- Imported stable keys are unique only inside one DataSource version.
  INSERT INTO "LessonExercise" (
    "lessonId", "topicId", type, prompt, content, answer, "orderIndex", status,
    "dataSourceId", "sourceKey", "createdById", "updatedById", "updatedAt"
  ) VALUES (
    lesson_id,
    topic_id,
    'fill_blank',
    'Imported row one',
    '{}'::jsonb,
    '{"acceptedTexts":["你好"]}'::jsonb,
    12,
    'draft',
    source_1_id,
    'row-001',
    author_id,
    author_id,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO imported_exercise_id;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", type, prompt, content, answer, "orderIndex", status,
      "dataSourceId", "sourceKey", "createdById", "updatedById", "updatedAt"
    ) VALUES (
      lesson_id,
      topic_id,
      'fill_blank',
      'Duplicate source row',
      '{}'::jsonb,
      '{"acceptedTexts":["您好"]}'::jsonb,
      13,
      'draft',
      source_1_id,
      'row-001',
      author_id,
      author_id,
      CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN unique_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'duplicate DataSource/sourceKey LessonExercise was accepted';
  END IF;

  INSERT INTO "LessonExercise" (
    "lessonId", "topicId", type, prompt, content, answer, "orderIndex", status,
    "dataSourceId", "sourceKey", "createdById", "updatedById", "updatedAt"
  ) VALUES (
    lesson_id,
    topic_id,
    'fill_blank',
    'Same key, different source version',
    '{}'::jsonb,
    '{"acceptedTexts":["你好"]}'::jsonb,
    13,
    'draft',
    source_2_id,
    'row-001',
    author_id,
    author_id,
    CURRENT_TIMESTAMP
  );

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", type, prompt, content, answer, "orderIndex", status,
      "dataSourceId", "sourceKey", "createdById", "updatedById", "updatedAt"
    ) VALUES (
      lesson_id,
      topic_id,
      'fill_blank',
      'Ambiguous source key',
      '{}'::jsonb,
      '{"acceptedTexts":["你好"]}'::jsonb,
      14,
      'draft',
      source_1_id,
      ' row with spaces ',
      author_id,
      author_id,
      CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'ambiguous whitespace sourceKey was accepted';
  END IF;

  rejected := false;
  BEGIN
    INSERT INTO "LessonExercise" (
      "lessonId", "topicId", type, prompt, content, answer, "orderIndex", status,
      "sourceKey", "createdById", "updatedById", "updatedAt"
    ) VALUES (
      lesson_id,
      topic_id,
      'fill_blank',
      'Source key without provenance',
      '{}'::jsonb,
      '{"acceptedTexts":["你好"]}'::jsonb,
      15,
      'draft',
      'orphan-source-key',
      author_id,
      author_id,
      CURRENT_TIMESTAMP
    );
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'sourceKey without DataSource provenance was accepted';
  END IF;

  rejected := false;
  BEGIN
    DELETE FROM "DataSource" WHERE id = source_1_id;
  EXCEPTION WHEN foreign_key_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'DataSource referenced by LessonExercise was hard-deleted';
  END IF;

  -- An attempt snapshots the published V1 projection and survives later publish/archive.
  INSERT INTO "LessonExerciseAttempt" (
    "userId", "exerciseId", "attemptNumber", answer, "contentSnapshot", "exerciseVersion",
    "isCorrect", score, "feedbackVersion", "idempotencyKey", "submittedAt", "updatedAt"
  ) VALUES (
    author_id,
    listening_exercise_id,
    1,
    '{"optionId":"hello"}'::jsonb,
    jsonb_build_object(
      'exerciseId', listening_exercise_id,
      'lessonId', lesson_id,
      'topicId', topic_id,
      'version', 1,
      'type', 'listening_choice',
      'prompt', 'Choose the greeting',
      'content', '{"options":[{"optionId":"hello","text":"你好"},{"optionId":"bye","text":"再见"}]}'::jsonb,
      'answer', '{"optionId":"hello"}'::jsonb,
      'media', jsonb_build_object(
        'id', ready_audio_id,
        'url', 'https://cdn.example.test/exercise-ready.mp3',
        'type', 'audio',
        'mimeType', 'audio/mpeg',
        'duration', 12
      )
    ),
    1,
    true,
    100,
    'lesson-activity-v1',
    'exercise-authoring-history-1',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ) RETURNING id INTO listening_attempt_id;

  INSERT INTO "ContentRevision" (
    "entityType", "entityId", revision, snapshot, "contentHash", "authorId"
  ) VALUES (
    'lesson_exercise',
    listening_exercise_id,
    2,
    jsonb_build_object(
      'type', 'listening_choice',
      'prompt', 'Choose the greeting v2',
      'content', '{"options":[{"optionId":"hello","text":"您好"},{"optionId":"bye","text":"再见"}]}'::jsonb,
      'answer', '{"optionId":"bye"}'::jsonb,
      'mediaId', ready_audio_id
    ),
    'sha256:listening-revision-2',
    author_id
  ) RETURNING id INTO listening_revision_2_id;

  INSERT INTO "ContentReview" ("revisionId", "reviewerId", decision, note)
  VALUES (listening_revision_2_id, author_id, 'approved', 'Approved revision two');

  UPDATE "LessonExercise"
  SET prompt = 'Choose the greeting v2',
      content = '{"options":[{"optionId":"hello","text":"您好"},{"optionId":"bye","text":"再见"}]}'::jsonb,
      answer = '{"optionId":"bye"}'::jsonb,
      version = 2,
      "publishedAt" = CURRENT_TIMESTAMP,
      "publishedById" = author_id,
      "updatedById" = author_id,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = listening_exercise_id;

  -- Safety invalidation is allowed while the exercise row is still published.
  -- Public reads hide it immediately; the immutable attempt remains replayable.
  UPDATE "Media"
  SET "processingStatus" = 'quarantined',
      "deletedAt" = CURRENT_TIMESTAMP,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = ready_audio_id;

  IF NOT EXISTS (
    SELECT 1
    FROM "LessonExercise"
    WHERE id = listening_exercise_id
      AND status = 'published'
      AND "deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'media safety invalidation rewrote the published exercise row';
  END IF;

  UPDATE "LessonExercise"
  SET status = 'archived', "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
  WHERE id = listening_exercise_id;

  SELECT
    "exerciseVersion",
    "contentSnapshot"->>'prompt',
    "contentSnapshot"->'media',
    "contentSnapshot"
  INTO persisted_version, persisted_prompt, persisted_media, persisted_snapshot
  FROM "LessonExerciseAttempt"
  WHERE id = listening_attempt_id;

  IF persisted_version <> 1 OR persisted_prompt <> 'Choose the greeting' THEN
    RAISE EXCEPTION 'later revision/archive rewrote historical attempt version or prompt';
  END IF;
  IF persisted_media->>'url' <> 'https://cdn.example.test/exercise-ready.mp3'
    OR persisted_media ? 'storageProvider'
    OR persisted_media ? 'storageKey'
    OR persisted_media ? 'checksum'
    OR persisted_media ? 'metadata'
  THEN
    RAISE EXCEPTION 'historical media projection is missing or exposes internal metadata';
  END IF;
  IF persisted_snapshot->'answer' <> '{"optionId":"hello"}'::jsonb THEN
    RAISE EXCEPTION 'later publish rewrote the authoritative answer in attempt snapshot';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "LessonExercise"
    WHERE id = listening_exercise_id
      AND status = 'archived'
      AND "deletedAt" IS NOT NULL
      AND version = 2
  ) THEN
    RAISE EXCEPTION 'LessonExercise archive/version final state is invalid';
  END IF;

  IF (
    SELECT COUNT(*) FROM "ContentRevision"
    WHERE id IN (listening_revision_1_id, listening_revision_2_id)
  ) <> 2 OR NOT EXISTS (
    SELECT 1 FROM "LessonExercise" WHERE id = imported_exercise_id
  ) OR NOT EXISTS (
    SELECT 1 FROM "ContentRevision" WHERE id = revision_parent_revision_id
  ) THEN
    RAISE EXCEPTION 'exercise authoring history/provenance disappeared';
  END IF;
END
$test$;

ROLLBACK;

SELECT 'Exercise Authoring integrity tests passed' AS result;
