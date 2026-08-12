# P0 Schema Migration Runbook — HSK 3.0 APP

> Phiên bản runbook: `1.5.0`
> Áp dụng cho chuỗi migration P0 đến ngày `2026-08-11`.
> Mục tiêu: deploy có kiểm chứng, bảo toàn ID và dữ liệu hiện hữu, dừng an toàn khi phát hiện dữ liệu mơ hồ.

## 1. Chuỗi migration bắt buộc

| Thứ tự | Migration | Capability |
| --- | --- | --- |
| P0-00 | `20260810090000_p0_schema_foundation_level` | Level code/band/curriculum version, dữ liệu HSK7_9, awarded band. |
| P0-01 | `20260810091000_p0_identity_onboarding_privacy` | Account lifecycle, session/token hash, profile, goal, placement, plan, consent/privacy. |
| P0-02 | `20260810092000_p0_cms_provenance_import_audit` | CMS ownership/publish, provenance, media metadata, revision/review, audit và import. |
| P0-03 | `20260810093000_p0_learning_progress_srs` | Progress/activity, attempt snapshot, SRS và cross-level/lesson invariants. |
| P0-04 | `20260810094000_p0_exam_attempt_snapshot` | Question placement đúng context, attempt/autosave/snapshot/result integrity. |
| P0-H | `20260810113000_p0_integrity_hardening` | Band integrity, SRS ownership, immutable retention FK và public dictionary prefix indexes. |
| P0-C | `20260810143000_p0_integrity_concurrency_serialization` | Serialize band/ownership invariant, owner immutable và `ON UPDATE RESTRICT` cho history FK. |
| CMS-R | `20260810170000_content_review_immutability` | Chặn UPDATE/DELETE `ContentReview` bằng immutable trigger dùng chung. |
| ACT-I | `20260810210000_lesson_activity_integrity` | Submitted attempt immutable, LearningEvent coherence và bảo vệ parent location của activity history. |
| EX-A | `20260811120000_exercise_authoring_import_validation_v1` | Exercise provenance/media/actor fields, revision parent/hash, publish readiness và archive-only lifecycle. |

Không đổi nội dung một migration đã được áp ở bất kỳ environment dùng chung nào. Sửa lỗi bằng migration mới theo hướng forward-fix.
Toàn project hiện có 15 migration, trong đó chuỗi P0/runtime reliability gồm 10 migration P0-00..P0-04, P0-H, P0-C, CMS-R, ACT-I và EX-A.

## 2. Điều kiện trước khi chạy

- PostgreSQL và extension mặc định của project hoạt động; user deploy có quyền tạo table/index/constraint/function/trigger.
- Node/npm dependencies của `backend` đã cài đúng lockfile.
- `DATABASE_URL` trỏ đúng database đích; tuyệt đối không dùng tên database suy diễn từ biến rỗng.
- Có backup đã kiểm tra đọc được và biết RPO/RTO của environment.
- Không có migration lỗi/đang chạy và không có schema drift chưa giải thích.
- Dừng job import, CMS publish và các worker ghi dữ liệu trong maintenance window.
- Với production, đã xác minh license/attribution của nguồn HSK. Migration có thể lưu metadata nguồn nhưng không thay thế legal approval.

## 3. Cổng kiểm tra source và lịch sử migration

Từ thư mục `backend`:

```bash
npx prisma format
npx prisma validate
npx prisma generate
npx prisma migrate status
shasum -a 256 prisma/migrations/20260611041059_add_exam_sections_groups/migration.sql
shasum -a 256 prisma/migrations/20260811120000_exercise_authoring_import_validation_v1/migration.sql
```

Checksum migration lịch sử `20260611041059_add_exam_sections_groups` phải khớp `_prisma_migrations.checksum`. File lịch sử từng có ký tự fence Markdown thừa ở đầu và đã được phục hồi đúng source; không sửa lại migration này.

Checksum EX-A của artifact frozen đã verify trên fresh disposable database ngày `2026-08-11` là `74944a7d95fabc02a0e84fe39b91543ac41a63e4714cfcaf389e81fe432d9f7c`. Trước deploy, source checksum phải khớp change record và, nếu environment đã apply, `_prisma_migrations.checksum`; nếu khác phải dừng, không sửa migration đã áp.

Kiểm tra migration-history → datamodel bằng shadow database rỗng riêng, rồi kiểm tra database đích → datamodel; không chạy `db push`:

```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --exit-code

npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

Ở database chưa nhận P0, diff đương nhiên liệt kê thay đổi P0. Mọi khác biệt ngoài mười migration P0/runtime reliability đã review phải được dừng và điều tra.

## 4. Kiểm tra dữ liệu trước migration

Chạy read-only SQL sau và lưu kết quả vào change record:

```sql
SELECT COUNT(*) AS users FROM "User";
SELECT COUNT(*) AS levels FROM "Level";
SELECT COUNT(*) AS words FROM "Word";
SELECT COUNT(*) AS meanings FROM "WordMeaning";
SELECT COUNT(*) AS word_levels FROM "WordLevel";
SELECT COUNT(*) AS tests FROM "Test";
SELECT COUNT(*) AS test_questions FROM "TestQuestion";
SELECT COUNT(*) AS results FROM "Result";

SELECT lower(btrim(email)) AS canonical_email, COUNT(*)
FROM "User"
GROUP BY lower(btrim(email))
HAVING COUNT(*) > 1;

SELECT id, name, "orderIndex" FROM "Level" ORDER BY "orderIndex", id;
```

Kỳ vọng:

- Query canonical email không trả dòng. Nếu có, dừng để merge/đổi tài khoản bằng quyết định nghiệp vụ; migration không tự đoán.
- Level hiện hữu phải map rõ sang HSK1..6 hoặc HSK7-9/HSK7_9.
- Ghi lại row count để so sánh sau migration.

Nếu có dữ liệu exam legacy, kiểm tra ambiguity trước P0-04:

```sql
SELECT q.id AS question_id, q."groupId", tq."testId", qg."testId" AS group_test_id
FROM "Question" q
JOIN "TestQuestion" tq ON tq."questionId" = q.id
JOIN "QuestionGroup" qg ON qg.id = q."groupId"
WHERE q."groupId" IS NOT NULL
  AND qg."testId" <> tq."testId";
```

Không được có dòng. Migration sẽ dừng khi gặp placement mơ hồ/cross-test.

Trước EX-A, audit Exercise legacy bằng truy vấn chỉ đọc:

```sql
SELECT id, "lessonId", "topicId", type, version, status, "deletedAt"
FROM "LessonExercise"
WHERE status = 'published'
ORDER BY id;

SELECT id, status, "deletedAt"
FROM "LessonExercise"
WHERE (status = 'archived') <> ("deletedAt" IS NOT NULL)
ORDER BY id;

SELECT exercise.id, exercise."lessonId", exercise."topicId",
       lesson.status AS lesson_status, lesson."deletedAt" AS lesson_deleted_at,
       topic."lessonId" AS topic_lesson_id, topic.status AS topic_status,
       topic."deletedAt" AS topic_deleted_at
FROM "LessonExercise" exercise
JOIN "Lesson" lesson ON lesson.id = exercise."lessonId"
LEFT JOIN "Topic" topic ON topic.id = exercise."topicId"
WHERE lesson.status = 'archived'
   OR lesson."deletedAt" IS NOT NULL
   OR (
     exercise."topicId" IS NOT NULL
     AND (
       topic.id IS NULL
       OR topic."lessonId" <> exercise."lessonId"
       OR topic.status = 'archived'
       OR topic."deletedAt" IS NOT NULL
     )
   )
ORDER BY exercise.id;

SELECT revision.id, revision."entityId", revision.revision,
       revision."contentHash", exercise.id AS exercise_id
FROM "ContentRevision" revision
LEFT JOIN "LessonExercise" exercise ON exercise.id = revision."entityId"
WHERE revision."entityType" = 'lesson_exercise'
  AND (
    exercise.id IS NULL
    OR NULLIF(btrim(revision."contentHash"), '') IS NULL
  )
ORDER BY revision."entityId", revision.revision, revision.id;

SELECT id, url
FROM "Media"
WHERE char_length(url) = 0
   OR url ~ '[[:space:]]'
ORDER BY id;
```

Cả năm query phải rỗng. EX-A cố ý fail trước DDL nếu có Exercise legacy đang `published`, archive status/`deletedAt` mâu thuẫn, parent Lesson/Topic archived hoặc incoherent, revision `lesson_exercise` dangling/null/blank hash, hay `Media.url` rỗng hoặc chứa bất kỳ whitespace nào. Không đổi status, parent, tạo hash, đoán `mediaId` hay tự sửa asset URL: content owner phải audit JSON/answer/media provenance, đưa dữ liệu về trạng thái rõ ràng bằng change riêng rồi mới deploy lại. Transaction migration phải rollback toàn bộ khi preflight fail.

## 5. Backup và rehearsal

Tạo backup theo chuẩn hạ tầng. Ví dụ logical backup có định danh rõ ràng:

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" \
  --file="hsk_before_p0_YYYYMMDD_HHMM.dump"
pg_restore --list "hsk_before_p0_YYYYMMDD_HHMM.dump" >/dev/null
```

Trước production, restore backup vào database rehearsal tách biệt, áp đúng mười migration P0/runtime reliability và chạy toàn bộ mục 7–9. Không rehearsal trực tiếp trên database local/production đang dùng.

Kết quả rehearsal tham chiếu ngày `2026-08-10` trên bản sao local:

| Dữ liệu | Trước/sau P0 |
| --- | ---: |
| Level | 7 / 7 |
| Word | 121,856 / 121,856 |
| WordMeaning | 200,156 / 200,156 |
| WordLevel | 11,086 / 11,086 |
| Word có `pinyinNormalized` | 121,856 |
| Meaning có `meaningOrder` | 200,156 |
| Meaning được gắn provenance | 200,156 |

Các con số production có thể khác; tiêu chí là bảo toàn row và đạt invariant, không phải khớp số tham chiếu.

## 6. Deploy migration

Trong maintenance window, từ `backend`:

```bash
npx prisma migrate deploy
npx prisma migrate status
```

`migrate deploy` phải báo cả mười migration P0/runtime reliability thành công. Không chạy lại bằng tay từng đoạn SQL sau khi Prisma đã ghi migration thành công.

### 6.1. Concurrency policy của P0-C

- `UserGoal`, `PlacementAttempt` và `LearningPlan` lấy shared row lock trên `Level` khi xác minh band.
- `Result` luôn khóa theo thứ tự `Test → Level`; trigger cập nhật `Test` cũng tuân theo thứ tự này.
- Trigger cập nhật `Level` không khóa ngược lại `Test`; row lock của chính `Level` serialize child validation và tránh vòng khóa `Level → Test`.
- `ReviewEvent` khóa theo thứ tự `ReviewCard → ReviewSession`. `ReviewCard.userId` và `ReviewSession.userId` là immutable sau khi tạo.
- Shared lock giữa các child write tương thích với nhau. Thay đổi curriculum/ownership hiếm có thể phải chờ child transaction đang chạy.

### 6.2. CMS lifecycle concurrency và immutable review

- CMS luôn khóa theo thứ tự `Lesson → Topic`; mọi Topic create/revision/review/publish/archive phải khóa parent Lesson trước Topic.
- `CmsService` phát checkpoint qua `CmsTransactionCoordinator` trước/sau chính production lock. Provider mặc định là no-op; concurrency harness inject coordinator riêng để lấy backend PID và giữ barrier nhưng vẫn gọi public production methods, không copy lock/mutation logic.
- Publish Lesson cạnh tranh với archive Topic, archive Lesson cạnh tranh với publish Topic, hai review cạnh tranh và publish cạnh tranh với create revision đều phải serialize qua hierarchy này.
- `ContentReview` là fact append-only. Migration CMS-R gắn `BEFORE UPDATE OR DELETE` trigger bằng hàm `hsk_reject_immutable_mutation()` đã có; INSERT review mới và anonymization PII của reviewer vẫn được phép.
- Runner concurrency chỉ GREEN khi quan sát transaction B ở `wait_event_type=Lock`, A commit, B commit hoặc reject theo đúng domain của scenario và public/final state đúng. Timeout, deadlock, connection error hoặc B settle trước release A đều là RED.

### 6.3. Lesson Activity integrity và serialization

- Migration ACT-I có preflight fail-safe: nếu event lịch sử thuộc `lesson_started/completed`, `topic_started/completed` hoặc `exercise_submitted` không coherent với lesson/topic/exercise/attempt/user thì migration dừng, không tự sửa dữ liệu mơ hồ.
- Submitted `LessonExerciseAttempt` là immutable fact; database chặn UPDATE/DELETE. `LearningEvent_coherence` xác minh shape và cross-reference khi INSERT. LessonExercise `lessonId/topicId` và Topic `lessonId` không được đổi nếu làm sai history.
- Production activity write lock active `User FOR UPDATE` trước; content-targeted write tiếp tục shared lock `Lesson → Topic → LessonExercise`, rồi existing `Progress → UserTopicProgress` theo thứ tự cố định. Unique idempotency/attempt-number chỉ là backstop.
- `test:db:activity-integrity` chạy SQL acceptance trong transaction rollback. `test:db:activity-concurrency` gọi trực tiếp public method của `LessonActivityService`, quan sát B ở PostgreSQL Lock và kiểm tra final state của năm scenario gồm retry sau timeout.

### 6.4. Exercise Authoring, media và import atomicity

- EX-A là migration forward-only, bọc `BEGIN/COMMIT`; preflight ở mục 4 chạy trước mọi `ALTER TABLE`. Không chỉnh migration lịch sử để xử lý legacy Exercise.
- `LessonExercise` thêm `mediaId`, `dataSourceId`, `sourceKey`, `createdById`, `updatedById`, `publishedById`, `publishedAt`. Lesson/Topic/Media/DataSource dùng `ON DELETE RESTRICT`; Lesson/Topic/Media/DataSource còn dùng `ON UPDATE RESTRICT`. Actor FK dùng `SET NULL` khi xóa user để giữ content history.
- Unique `(dataSourceId, sourceKey)` và CHECK source key/provenance ngăn duplicate/ambiguous source identity. `Media_url_nonblank_check` bắt buộc URL có ít nhất một ký tự và không chứa whitespace. Published Exercise bắt buộc có `publishedAt`; `status=archived` phải tương đương `deletedAt IS NOT NULL`; chỉ listening được có `mediaId`; revision `entityType=lesson_exercise` bắt buộc nonblank `contentHash`.
- Trigger `LessonExercise_publish_readiness` từ chối `speaking_repeat` publish và chỉ cho listening publish khi media là audio `ready`, chưa soft-delete, URL nonempty/no-whitespace. Service khóa Media readiness bằng `FOR SHARE` trước publish. Trigger `LessonExercise_live_parent` chặn insert/move/publish dưới Lesson/Topic archived hoặc incoherent nhưng cho phép chuyển Exercise sang archived để cleanup. Trigger `ContentRevision_lesson_exercise_parent` chặn polymorphic revision dangling. Trigger `LessonExercise_revision_parent_restrict` từ chối mọi hard-delete Exercise.
- Exercise create khóa `active admin actor User FOR SHARE → Lesson FOR UPDATE → Topic FOR UPDATE (nếu có)` rồi insert; mutation trên Exercise hiện hữu khóa tiếp `LessonExercise FOR UPDATE`. Publish listening khóa `Media FOR SHARE` sau Exercise. Actor phải đồng thời có `role=admin`, `status=active` và `deletedAt IS NULL`. Safety `Media UPDATE` chờ publish nhả SHARE lock rồi mới có thể quarantine/soft-archive; public query ẩn Exercise sau đó. Revision/review/publish recheck parent live sau lock, còn archive vẫn được phép để cleanup. Activity submit dùng `active User FOR UPDATE → Lesson/Topic/LessonExercise FOR SHARE → Progress/UserTopicProgress FOR UPDATE`. Nhờ cùng content hierarchy, publish và submit không tạo snapshot trộn hai version, kể cả khi admin actor và learner là cùng một User.
- `npm run seed:learning` upsert hai Topic seed theo stable `(lessonId, orderIndex)` và cập nhật tại chỗ; không còn delete/recreate Topic, nên chạy lại không vi phạm FK `RESTRICT` hoặc làm đổi Topic ID đang được Exercise tham chiếu.
- Exercise version là revision đang materialize: draft revision cập nhật row; revision mới trên content đã published chưa đổi live row; publish latest-approved atomically copy snapshot và đặt `version = revision.revision`.
- Public query chỉ trả bốn type publishable; listening mất media readiness bị ẩn ngay. Sau publish vẫn được phép quarantine/soft-archive Media vì lý do an toàn; public read không còn trả Exercise đó, còn immutable attempt snapshot cũ vẫn giữ safe media projection để replay. Exercise có `topicId` chỉ visible khi Topic đó cũng `published` và chưa soft-delete.
- Import preview không ghi database và chỉ nhận 1–100 row. Commit xác minh `previewHash`, khóa theo `active admin actor User FOR SHARE → DataSource FOR UPDATE → Lesson IDs FOR UPDATE tăng dần → Topic IDs FOR UPDATE tăng dần`, kiểm tra idempotency/revalidate toàn bộ và ghi `ImportJob` + tất cả draft Exercise/revision + AuditLog trong một transaction all-or-nothing. Replay chỉ thành công sau khi current rows revalidate hợp lệ và job `completed` coherent: có started/completed timestamps, zero errors, exact counts, canonical sourceKey array khớp chính xác cả giá trị/thứ tự, đủ Exercise + revision 1 và đúng một completion audit; matching job `pending`/`failed`/incomplete trả safe `409` manual review. Interactive transaction đặt `maxWait=5.000 ms` (5 giây) và `timeout=30.000 ms` (30 giây). Invalid row, duplicate source key hoặc changed preview đều không được để lại partial write.
- Import là transaction boundary riêng; không gọi ngược từ authoring transaction đang giữ content hierarchy sang import. Workflow tương lai cần kết hợp hai boundary phải có ADR/lock-order test mới trước khi release.

Chi tiết quyết định: `docs/adr/ADR-002-EXERCISE-AUTHORING-VERSION-MEDIA-IMPORT-ATOMICITY.md`.

Nếu deploy hoặc test gặp `lock_timeout`/deadlock:

1. Không tăng timeout và chạy lặp mù quáng.
2. Lưu `pg_stat_activity`, `pg_locks`, log SQLSTATE và migration status.
3. Xác minh mọi code path giữ đúng lock order nêu trên và không còn writer ngoài maintenance window.
4. Với test, hủy database disposable rồi bootstrap lại; không tái sử dụng database có transaction lỗi.
5. Với deploy, để transaction migration rollback, điều tra blocker và chạy lại trong maintenance window; không sửa file migration đã áp ở environment khác.

Nếu migration dừng:

1. Giữ nguyên log lỗi và trạng thái `_prisma_migrations`.
2. Không sửa file migration đã được environment khác áp.
3. Xác định migration có transaction rollback toàn bộ hay để lại thao tác ngoài transaction.
4. Khôi phục backup nếu dữ liệu/availability bị ảnh hưởng và change owner quyết định rollback.
5. Tạo migration forward-fix mới sau khi tái hiện trên disposable database.

## 7. Xác minh schema sau deploy

```bash
npx prisma migrate status
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script \
  --exit-code
```

Diff phải rỗng và exit code 0. Lưu ý Prisma không mô hình hóa đầy đủ functional index, deferred constraint trigger và append-only trigger; vì vậy cần kiểm tra SQL bổ sung:

```sql
SELECT COUNT(*) AS business_tables
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name <> '_prisma_migrations';

SELECT COUNT(*) AS foreign_keys
FROM information_schema.table_constraints
WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY';

SELECT COUNT(*) AS check_constraints
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public' AND c.contype = 'c';

SELECT event_object_table, trigger_name,
       string_agg(event_manipulation, ',' ORDER BY event_manipulation) AS events
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name NOT LIKE 'RI_ConstraintTrigger%'
GROUP BY event_object_table, trigger_name
ORDER BY event_object_table, trigger_name;
```

Baseline sau EX-A trên fresh disposable database: **57 business tables, 143 foreign keys, 78 CHECK constraints, 33 custom triggers và 15 migration đã hoàn tất**. So với ACT-I, EX-A không thêm table; migration thay hai FK parent và thêm năm FK mới (net +5), thêm sáu CHECK và bốn trigger. Đây là object inventory của schema mới, không thay thế drift check hoặc acceptance test.

## 8. Xác minh dữ liệu/backfill sau deploy

```sql
SELECT id, name, code, "orderIndex", "minBand", "maxBand", "curriculumVersion"
FROM "Level"
ORDER BY "orderIndex";

SELECT
  COUNT(*) AS words,
  COUNT(*) FILTER (WHERE "pinyinNormalized" IS NOT NULL AND btrim("pinyinNormalized") <> '') AS normalized,
  COUNT(*) FILTER (WHERE status = 'published') AS published
FROM "Word";

SELECT
  COUNT(*) AS meanings,
  COUNT(*) FILTER (WHERE "meaningOrder" IS NOT NULL) AS ordered,
  COUNT(*) FILTER (WHERE "dataSourceId" IS NOT NULL) AS sourced
FROM "WordMeaning";

SELECT
  COUNT(*) AS memberships,
  COUNT(*) FILTER (WHERE "dataSourceId" IS NOT NULL) AS sourced
FROM "WordLevel";

SELECT code, version, license, "contentHash", notes
FROM "DataSource"
ORDER BY code;
```

Điều kiện đạt:

- Đúng 7 level code và band: 1, 2, 3, 4, 5, 6, 7–9; không tạo ID level mới khi chỉ backfill.
- Tất cả word hiện hữu có pinyin normalized; tất cả meaning có order.
- Không mất row Word/Meaning/WordLevel.
- CC-CEDICT có version/hash/license/attribution đã ghi. Raw list HSK thiếu license vẫn phải hiện cảnh báo, không tự điền license suy đoán.
- Không tự sinh `meaningVi` từ `meaningEn`.

## 9. Integration test bắt buộc

Mọi test có write dùng chung safety guard. Guard yêu cầu `NODE_ENV=test`, cả `DATABASE_URL` và `TEST_DATABASE_URL` cùng trỏ tới một host/port/database, và database kết thúc bằng segment `_test`, `-e2e`, `_verify`, `_disposable` hoặc `_hardening` (có thể thêm suffix số/timestamp). Substring như `hsk_latest`, `contest_prod` hoặc `production_test_backup_prod` bị từ chối trước khi kết nối.

Project chỉ hỗ trợ effective schema `public` cho write test:

- `DATABASE_URL` được phép không có `schema` hoặc có đúng một `schema=public`.
- `DATABASE_URL` có schema rỗng, schema khác `public` hoặc nhiều `schema` parameter sẽ bị từ chối.
- `TEST_DATABASE_URL` tuyệt đối không có `schema` parameter vì runner truyền nguyên URL này cho `psql`.
- Sau khi bỏ query parameter hợp lệ, host/port/database của hai URL phải giống nhau. Credentials không được đưa vào error/log.

Các script khả dụng dưới đây là **danh mục**, không phải một chuỗi được chạy trên cùng database; quy tắc tách database nằm ngay sau block:

```bash
export NODE_ENV=test
export TEST_DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/hsk_system_test"
export DATABASE_URL="${TEST_DATABASE_URL}?schema=public"
npm run test:db:p0
npm run test:db:concurrency
npm run test:db:cms-concurrency
npm run test:db:activity-integrity
npm run test:db:activity-concurrency
npm run test:db:exercise-integrity
npm run test:db:exercise-concurrency
```

Không chạy bất kỳ database write test hoặc E2E nào trên `hsk_system`, staging hay production. SQL runner dùng `spawnSync('psql', args)` không qua shell interpolation, bật `ON_ERROR_STOP=1` và forward exit code của `psql`.

Không chạy tuần tự tất cả concurrency runner trên cùng database: mỗi runner tạo fixture và cố ý không cleanup. Ví dụ bootstrap riêng cho Exercise; `test:db:exercise-integrity` rollback nên có thể chạy ngay trước concurrency trên cùng database còn migration-only:

```bash
createdb hsk_exercise_authoring_disposable_test
export NODE_ENV=test
export TEST_DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/hsk_exercise_authoring_disposable_test"
export DATABASE_URL="${TEST_DATABASE_URL}?schema=public"
npx prisma migrate deploy
npx prisma migrate status
npm run test:db:exercise-integrity
npm run test:db:exercise-concurrency
```

Muốn chạy lại concurrency phải drop/recreate đúng database disposable hoặc tạo database disposable mới, rồi `migrate deploy` đủ **15 migration**. Không truncate, delete fixture, `db push` hay `migrate reset`. E2E dùng database disposable khác và chỉ deploy migration, không seed.

`test:db:concurrency` chỉ chạy một lần trên database fresh migration-only. Trước fixture INSERT đầu tiên, runner yêu cầu `User`, `Level`, `Test`, `Result`, `ReviewCard` và `ReviewEvent` đều rỗng. Nếu bất kỳ table nào có dữ liệu, runner dừng với thông báo `Concurrency test requires a fresh migration-only disposable database.`; runner không truncate, delete, reset hoặc tự dọn dữ liệu. Muốn chạy lại phải drop database disposable cũ, tạo database disposable mới và chạy đủ `prisma migrate deploy`.

`test:db:cms-concurrency` cũng chỉ chạy một lần trên **database disposable fresh migration-only riêng**. Runner yêu cầu `User`, `Level`, `Lesson`, `Topic`, `ContentRevision` và `ContentReview` đều rỗng trước INSERT đầu tiên. Không chạy sau E2E/seed hoặc dùng chung database với runner concurrency khác; muốn chạy lại phải tạo database disposable mới và deploy đủ migration. Runner không truncate/delete/reset fixture.

`test:db:activity-concurrency` chỉ chạy một lần trên **database disposable fresh migration-only riêng** và kiểm tra `User`, `Level`, `Lesson`, `Topic`, `LessonExercise`, `LessonExerciseAttempt`, `Progress`, `UserTopicProgress`, `LearningEvent` đều rỗng trước INSERT đầu tiên. Runner không truncate/delete/reset. `test:db:activity-integrity` dùng transaction rollback nhưng vẫn phải chạy trên disposable database; không chạy bất kỳ activity integration/E2E nào trên `hsk_system`, staging hoặc production.

`test:db:exercise-concurrency` chỉ chạy một lần trên **database disposable fresh migration-only riêng**. Trước INSERT đầu tiên, runner yêu cầu `User`, `Level`, `Lesson`, `Topic`, `LessonExercise`, `LessonExerciseAttempt`, `LearningEvent`, `Progress`, `ContentRevision`, `ContentReview`, `Media`, `ImportJob`, `ImportRowError` và `AuditLog` đều rỗng. `DataSource` không nằm trong danh sách rỗng vì baseline migration đã tạo provenance source cần cho fixture import. Khi không fresh, runner dừng với `Exercise Authoring concurrency test requires a fresh migration-only disposable database.` và không cleanup/reset.

Script `test/database/p0-schema.integration.sql` chạy trong transaction rollback và kiểm tra:

- email unique không phân biệt hoa/thường và token chỉ có hash;
- due queue/index/idempotency của SRS;
- integrity lesson/topic/story/pronunciation;
- question reuse nhưng placement không cross-test;
- attempt autosave, snapshot/event append-only, sửa content không làm đổi lịch sử;
- một result cho một final attempt và đúng user/test.
- band phải thuộc Level, ReviewEvent card/session phải cùng user và hard-delete parent có fact phải bị FK `RESTRICT` rõ ràng.
- owner của ReviewCard/ReviewSession không được thay đổi, kể cả khi chưa có event; cập nhật primary key parent có history phải trả `foreign_key_violation`, không phải immutable-trigger exception.
- `ContentReview` không thể UPDATE/DELETE, nhưng INSERT decision mới vẫn hoạt động và anonymization reviewer không làm mất lịch sử review.
- test concurrency dùng ba scenario với hai Prisma connection độc lập, `statement_timeout`, `lock_timeout`, barrier và kiểm tra trạng thái cuối trực tiếp; không dùng sleep dài hoặc timing ngẫu nhiên.
- mỗi scenario chỉ GREEN khi transaction A commit, transaction B đã được quan sát ở `wait_event_type = Lock` trước khi release A, B bị từ chối bởi đúng domain invariant và query trạng thái cuối vẫn hợp lệ. Lock/statement timeout, deadlock, Prisma transaction timeout, connection error, constraint sai domain hoặc B settled sớm đều là RED.
- CMS service-level concurrency dùng bốn scenario độc lập để kiểm tra publish Lesson/archive Topic, archive Lesson/publish Topic, hai review và publish/create revision. Cả A/B phải gọi `CmsService`, B phải được quan sát block trước khi release A, actual HTTP domain exception phải khớp và final public visibility phải đúng. Architecture contract test cấm runner định nghĩa lock helper, tự mở transaction hoặc trực tiếp mutate lifecycle table.
- Lesson Activity integration kiểm tra submitted attempt UPDATE/DELETE, event user/exercise/lesson/topic/type coherence và parent location. Production-path concurrency kiểm tra same-key one fact, different-key numbering 1/2, submit/topic-complete, final-attempt/lesson-complete, retry sau lock timeout và classifier không false-green timeout/deadlock/connection/constraint.
- Exercise integrity kiểm tra đủ bảy field mới, FK actions, Media URL nonblank, archive-state/media-scope CHECK, live-parent/publish/revision/delete trigger, publish sau parent archive, speaking draft-only, mọi trạng thái listening media, ready audio publish, hide-on-safety-invalidation, safe immutable media snapshot, revision parent/hash, archive-only delete và duplicate provenance key.
- Exercise production-path concurrency runner định nghĩa bảy race: concurrent revisions `1,2,3` nhưng giữ live V1; concurrent publish chỉ một audit; publish/archive; publish/submit với admin actor và learner khác User; publish/submit khi actor và learner là cùng User; archive/submit; và concurrent import idempotency retry chỉ một job/exercise/revision. Mỗi scenario chỉ GREEN khi A commit, B đã được quan sát `wait_event_type=Lock` trước release A, B đúng response/domain contract và final database invariant đúng. B settle sớm, lock/statement/Prisma timeout, deadlock, connection error hoặc constraint ngoài scenario luôn RED.

### 9.1. Error classification và hành động vận hành

| Signal/classification | HTTP runtime | Runner concurrency | Hành động |
| --- | ---: | --- | --- |
| Authoring shape/exact key/bounds; speaking publish; media không ready; import row/source key validation | `422` | Chỉ hợp lệ khi scenario kỳ vọng đúng domain; còn lại RED | Sửa payload/content, preview lại |
| Preview hash thay đổi; stale revision; idempotency key dùng cho request khác; persistence FK/unique/CHECK backstop (`P2003`/`23503`/`P2004`/`23514`) hoặc concurrent conflict | `409` | RED nếu không phải exact expected scenario | Reload state hoặc dùng request/key đúng; không retry mù |
| `55P03`, `57014`, Prisma `P2028` | `503` | Luôn RED | Retry đúng idempotency key sau khi điều tra lock/timeout |
| `40001`, `40P01`, Prisma `P2034` | `409` retryable conflict | Luôn RED | Điều tra lock order; retry có giới hạn |
| Prisma connection code hoặc SQLSTATE class `08` | `503` | Luôn RED | Kiểm tra DB/connectivity; retry cùng key |
| Unknown persistence error | `500` generic | RED | Giữ correlation ID/log nội bộ; không lộ URL/credential/SQL |

Public error chỉ chứa safe status/code/path/message; import row errors không chứa raw payload/answer. Log/harness classifier chỉ dùng SQLSTATE, Prisma code, constraint identifier hoặc HTTP status đã sanitize, không in `DATABASE_URL`/password.
Field lạ trong authoring/import/DTO dùng generic path `$.$unknown`; response không phản chiếu tên property do client kiểm soát.

### 9.2. Evidence artifact frozen và final gate

Evidence feature-specific ghi nhận ngày `2026-08-11`:

- Fresh disposable database deploy đủ 15 migration; `prisma migrate status` up-to-date, migration-history → datamodel và live database → datamodel đều không có drift.
- `test:db:exercise-integrity` pass và rollback; existing Lesson Activity SQL acceptance vẫn pass trên cùng database còn migration-only.
- Source/database checksum EX-A khớp `74944a7d95fabc02a0e84fe39b91543ac41a63e4714cfcaf389e81fe432d9f7c`; inventory là 57/143/78/33 cho table/FK/CHECK/custom trigger.
- Negative preflight rehearsal trên database disposable dừng trước EX-A với một `Media.url` chứa whitespace trả exit nonzero/P0001 và message asset audit; sau fail vẫn còn fixture nhưng `Media_url_nonblank_check`, bảy cột và bốn trigger EX-A đều chưa tồn tại, chứng minh rollback atomic.
- Exercise runner có bảy race, bổ sung publish/submit distinct-user và archive/submit đồng thời giữ riêng same-actor publish/submit; artifact frozen đã PASS `7/7` trên fresh migration-only disposable database. Mỗi race quan sát transaction B ở PostgreSQL `Lock` trước release A, đi qua production checkpoint, đúng response/domain contract và final-state invariant. Rerun cùng DB bị fresh-only preflight từ chối đúng kỳ vọng.
- Bốn nhánh EX-A preflight còn lại đã được rehearsal độc lập trên bốn database disposable chỉ có 14 migration trước EX-A: published legacy, archive mismatch, parent archived/incoherent và revision dangling/blank-hash đều dừng đúng với exit nonzero/P0001. Mỗi case giữ nguyên fixture, không tạo bảy cột/sáu CHECK/bốn trigger EX-A và giữ nguyên hai parent FK legacy ở `CASCADE`, chứng minh migration rollback atomic theo checksum hiện hành.
- `prisma format` và `prisma validate` đã pass trong vòng schema verification.

Final gate ngày `2026-08-11` dùng sáu database disposable riêng, mỗi DB deploy đủ 15 migration và `migrate status` up to date: P0/Activity/Exercise integrity `3/3` suite PASS + rollback sạch; P0 concurrency `3/3`; CMS `4/4`; Activity `5/5` + classifier; Exercise `7/7`; full E2E `8/8` suite, `118/118` test. Static gate gồm Prisma format/validate/generate, TypeScript build/spec, build, lint check, package Prettier check, `31/31` unit suite (`327/327` test) và diff checks đều GREEN.

Tiếp tục các cổng ứng dụng:

```bash
npm run lint:check
npm run format:check
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Không chạy E2E có write trên local/staging database chứa dữ liệu thật.

## 10. Smoke test sau deploy

Theo dõi tối thiểu các luồng:

1. Register/login với email có khoảng trắng/hoa thường; login thành công cập nhật `lastLoginAt` và reset lock.
2. Admin đọc dictionary detail có nghĩa nullable đúng locale và provenance.
3. Tạo/review/publish Lesson/Topic/Exercise revision qua CMS và có AuditLog đã redact; stale/non-approved publish bị từ chối.
4. Publish listening với ready audio; public response chỉ có safe media projection. Quarantine media làm ẩn content mới nhưng attempt cũ vẫn replay từ snapshot.
5. Preview Exercise import không tăng row count; commit cùng hash/key tạo một atomic job, retry trả cùng job; changed hash/duplicate source key không để lại partial row.
6. Start lesson, submit activity retry cùng idempotency key, progress không nhân đôi.
7. Lấy due review, submit grade retry, chỉ có một ReviewEvent.
8. Start exam tạo snapshot; autosave retry; submit retry; chỉ có một Result.
9. Sửa question/test sau submit; lịch sử attempt/result vẫn render/chấm theo snapshot.

Theo dõi error rate, DB locks, latency query due queue/autosave và connection saturation trong ít nhất một chu kỳ traffic đại diện.

## 11. Dictionary prefix benchmark

`EXPLAIN (ANALYZE, BUFFERS)` ngày `2026-08-10` trên rehearsal 121.856 Word cho thấy btree mặc định không phục vụ ổn định `LIKE 'prefix%'` và planner dùng sequential scan. Migration hardening thêm hai partial `text_pattern_ops` index chỉ cho Word public (`published`, chưa soft-delete, `isPure=true`).

| Query đại diện, `LIMIT 20` | Trước hardening | Sau hardening | Plan sau |
| --- | ---: | ---: | --- |
| `pinyinNormalized LIKE 'ni%'` | 16,107 ms | 0,825 ms | `Word_public_pinyin_prefix_idx` index scan |
| `hanzi LIKE '你%'` | 12,740 ms | 0,096 ms | `Word_public_hanzi_prefix_idx` index scan |

Đây là single-run local evidence, không thay thế load test staging. DictionaryService không ép `ORDER BY` trái với prefix index trước `LIMIT`; nếu contract cần ranking ổn định, phải benchmark ranking/index mới trước khi thêm.

## 12. Rollback và forward-fix

Các migration này có backfill và enforcement; không cung cấp down migration tự động vì đảo ngược có thể làm mất provenance/snapshot hoặc tái tạo ambiguity. Chiến lược:

- Trước khi mở traffic: nếu fail nghiêm trọng, restore backup đã verify và trỏ app về database phục hồi.
- Sau khi mở traffic: ưu tiên feature flag/rollback application tương thích ngược, sau đó migration forward-fix.
- Không drop cột/bảng P0 để “rollback nhanh”. Các runtime cũ dùng field legacy vẫn được giữ trong giai đoạn expand/contract.
- Với EX-A, rollback application phải tắt các route Exercise authoring/import nhưng vẫn giữ cột, revision, provenance và immutable snapshot đã ghi. Không hard-delete Exercise/Media/DataSource để đảo import; archive content và tạo forward correction/revision hoặc compensating import job theo quyết định nghiệp vụ.
- Nếu EX-A fail ở preflight thì transaction chưa đổi schema; xử lý dữ liệu legacy bằng migration/change record riêng rồi deploy lại nguyên checksum. Nếu EX-A đã được apply ở bất kỳ environment dùng chung nào, tuyệt đối không sửa file SQL đó.
- Khi cần contract/drop legacy (`UserWordProgress`, field Result cũ), tạo release riêng sau khi log chứng minh không còn read/write.

## 13. Rủi ro còn mở và owner cần chốt

| Rủi ro | Trạng thái/biện pháp |
| --- | --- |
| License bảy raw list HSK | Chưa production-cleared; Legal/Product phải xác minh trước publish thương mại. |
| Nghĩa tiếng Việt | Nullable có chủ đích; cần nguồn hợp lệ hoặc editorial workflow, không machine-copy từ EN. |
| Xóa tài khoản | Immutable/historical FK đã được harden bằng `RESTRICT`; endpoint hard-delete bị cấm. Vẫn cần triển khai privacy job idempotent theo ADR-001 trước khi bật cho beta. |
| JSON contract | DB chỉ bảo vệ `jsonb`; API phải dùng DTO/schema versioned và size limit. |
| Immutable trigger | Prisma không biểu đạt; integration SQL là cổng bắt buộc. |
| Media retention | Secure ingestion dùng private object identity + signed same-origin access; Infra/Product vẫn phải cấu hình bucket versioning/retention/lifecycle và backup restore rehearsal trước beta. |
| Import V1 | Chỉ hỗ trợ LessonExercise JSON rows, reject duplicate và all-or-nothing; generic CSV/import status/error-row UI/upsert không nằm trong V1. |
| Speaking | `speaking_repeat` chỉ author draft; publish/scoring chờ pronunciation engine. |
| P1/P2 | Payment/social/gamification/offline/AI nâng cao chưa nằm trong cam kết P0. |

## 14. Change record tối thiểu

Mỗi lần deploy phải lưu: commit SHA, checksum migration, người phê duyệt, database/environment, thời gian bắt đầu/kết thúc, backup identifier, pre/post row counts, migrate status, drift output, integration/smoke-test result, dashboard/log link, sự cố và quyết định rollback/forward-fix.

## 15. Secure Media Ingestion V1 — migration forward-only

Migration `20260812130000_secure_media_ingestion_v1` là migration thứ 16, tạo enum
`MediaIngestionStatus`, bảng `MediaIngestion`, bảng PostgreSQL-backed
`MediaUploadRateLimit`, FK/index/CHECK và ba trigger backstop: ingestion lifecycle,
completed↔ready Media coherence và immutable storage identity của ingested Media.
Không migration lịch sử nào được sửa và không dùng `db push`.

Fresh release gate phải dùng database `_test` mới, deploy đủ 16 migration rồi chạy:

```bash
npx prisma migrate deploy
npx prisma migrate status
npm run test:db:media-integrity
npm run test:e2e -- --runInBand test/media-ingestion.e2e-spec.ts
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL"
```

SQL acceptance chạy `BEGIN/ROLLBACK` và xác minh unsafe metadata, terminal/history
immutability, hard-delete restriction, completed record coherence và Media storage
identity. E2E yêu cầu disposable database guard, synthetic licensed source, test-only
storage/scanner adapters; không chạy write test trên `hsk_system`, staging hoặc
production. Migration rollback sau traffic là disable route + forward fix; không
drop history/Media hoặc sửa checksum migration đã apply.

Adapter gate phải giữ S3 actual-byte streaming cap 10 MiB kể cả khi provider khai
`ContentLength` nhỏ, và ClamAV exact one-NUL `OK`/`FOUND` parsing; mọi response thiếu,
thừa, quá lớn hoặc mơ hồ đều fail-closed.

`processingToken` UUID là fencing identity của attempt. Mọi reserve/terminal write,
finalize, compensation và cleanup phải match token hiện tại. Unknown object PUT
outcome không auto-delete do provider có thể commit muộn; tracked key phải ở
`cleanup_required` cho explicit reconciliation. Không tự takeover
`processing` theo timestamp. Với row bị kẹt, Incident Commander phải quiesce worker,
đối chiếu tracked key với private storage, rồi trong transaction có row lock chuyển
sang `cleanup_required` nếu object tồn tại/chưa chắc chắn hoặc `failed` nếu đã chứng
minh object không tồn tại; không đổi token/state khi worker cũ còn có thể chạy. Sau đó
mới dùng cleanup/retry lifecycle. Reverse proxy và access-log pipeline phải
xóa/redact query `signature` và full signed media URL;
signed content dùng `Cache-Control: private, no-store`, không được cache ở CDN/shared
proxy.

Claim/reject/finalize/cleanup dùng request-owned token và authoritative row reread để
reconcile lost transaction commit acknowledgement. Nếu authoritative read không khả
dụng, route trả safe `503`/manual reconciliation; không lặp object side effect hoặc
ghi audit giả/trùng.

Artifact closeout `2026-08-12`: migration SHA-256
`a5bb8bdd6f8408b3360fe987e8d4fb7bf15f22c94f84e3fdac03dc4e93ebfe2e` khớp
source và `_prisma_migrations`. Fresh disposable DB deploy đủ 16 migration; status
up to date; media SQL `BEGIN/DO/ROLLBACK`; fencing `10/10`; Media E2E `20/20`; full
backend E2E `11/11` suite, `155/155` test; live→datamodel và migration-history→
datamodel đều trả `-- This is an empty migration.`. No-DB gate `40/40` suite,
`393/393` test; targeted security/adapter contract `8/8` suite, `58/58` test; và
production dependency audit 0 vulnerability. Inventory quan sát
sau migration 16 là 60 table, 147 FK, 507 CHECK row trong
`information_schema.table_constraints` và 59 trigger row trong
`information_schema.triggers`; số CHECK/trigger này là raw catalog rows (một object
có thể xuất hiện nhiều event row), không so trực tiếp với custom-object count ở
baseline migration 15.

Live S3-compatible/ClamAV rehearsal chưa chạy trong closeout local. Code được phép
commit nhưng **chưa production-release-ready**; Infra/Release phải hoàn tất private
bucket/workload identity/encryption-retention, proxy log redaction và ClamAV
availability rehearsal trước beta deployment.
