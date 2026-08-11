# P0 Schema Migration Runbook — HSK 3.0 APP

> Phiên bản runbook: `1.4.0`
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

Không đổi nội dung một migration đã được áp ở bất kỳ environment dùng chung nào. Sửa lỗi bằng migration mới theo hướng forward-fix.
Toàn project hiện có 14 migration, trong đó chuỗi P0/runtime reliability gồm 9 migration P0-00..P0-04, P0-H, P0-C, CMS-R và ACT-I.

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
```

Checksum migration lịch sử `20260611041059_add_exam_sections_groups` phải khớp `_prisma_migrations.checksum`. File lịch sử từng có ký tự fence Markdown thừa ở đầu và đã được phục hồi đúng source; không sửa lại migration này.

Kiểm tra drift trước deploy bằng một shadow/disposable database cùng baseline, không chạy `db push`:

```bash
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

Ở database chưa nhận P0, diff đương nhiên liệt kê thay đổi P0. Mọi khác biệt ngoài chín migration P0/runtime reliability đã review phải được dừng và điều tra.

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

## 5. Backup và rehearsal

Tạo backup theo chuẩn hạ tầng. Ví dụ logical backup có định danh rõ ràng:

```bash
pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL" \
  --file="hsk_before_p0_YYYYMMDD_HHMM.dump"
pg_restore --list "hsk_before_p0_YYYYMMDD_HHMM.dump" >/dev/null
```

Trước production, restore backup vào database rehearsal tách biệt, áp đúng chín migration P0/runtime reliability và chạy toàn bộ mục 7–9. Không rehearsal trực tiếp trên database local/production đang dùng.

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

`migrate deploy` phải báo cả chín migration P0/runtime reliability thành công. Không chạy lại bằng tay từng đoạn SQL sau khi Prisma đã ghi migration thành công.

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
- Production activity write lock active `User FOR UPDATE` trước, rồi existing `Progress` và `UserTopicProgress` theo thứ tự cố định. Unique idempotency/attempt-number chỉ là backstop.
- `test:db:activity-integrity` chạy SQL acceptance trong transaction rollback. `test:db:activity-concurrency` gọi trực tiếp public method của `LessonActivityService`, quan sát B ở PostgreSQL Lock và kiểm tra final state của năm scenario gồm retry sau timeout.

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

Baseline sau ACT-I: 57 business tables, 138 foreign keys, 72 CHECK constraints và 29 custom triggers. ACT-I thêm bốn trigger cho submitted-attempt immutability, event coherence và parent protection; không thêm table, FK hay CHECK constraint.

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

```bash
export NODE_ENV=test
export TEST_DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/hsk_system_test"
export DATABASE_URL="${TEST_DATABASE_URL}?schema=public"
npm run test:db:p0
npm run test:db:concurrency
npm run test:db:cms-concurrency
npm run test:db:activity-integrity
npm run test:db:activity-concurrency
```

Không chạy ba command database test này hoặc E2E trên `hsk_system`, staging hay production. Runner dùng `spawnSync('psql', args)` không qua shell interpolation, bật `ON_ERROR_STOP=1` và forward exit code của `psql`.

`test:db:concurrency` chỉ chạy một lần trên database fresh migration-only. Trước fixture INSERT đầu tiên, runner yêu cầu `User`, `Level`, `Test`, `Result`, `ReviewCard` và `ReviewEvent` đều rỗng. Nếu bất kỳ table nào có dữ liệu, runner dừng với thông báo `Concurrency test requires a fresh migration-only disposable database.`; runner không truncate, delete, reset hoặc tự dọn dữ liệu. Muốn chạy lại phải drop database disposable cũ, tạo database disposable mới và chạy đủ `prisma migrate deploy`.

`test:db:cms-concurrency` cũng chỉ chạy một lần trên **database disposable fresh migration-only riêng**. Runner yêu cầu `User`, `Level`, `Lesson`, `Topic`, `ContentRevision` và `ContentReview` đều rỗng trước INSERT đầu tiên. Không chạy sau E2E/seed hoặc dùng chung database với runner concurrency khác; muốn chạy lại phải tạo database disposable mới và deploy đủ migration. Runner không truncate/delete/reset fixture.

`test:db:activity-concurrency` chỉ chạy một lần trên **database disposable fresh migration-only riêng** và kiểm tra `User`, `Level`, `Lesson`, `Topic`, `LessonExercise`, `LessonExerciseAttempt`, `Progress`, `UserTopicProgress`, `LearningEvent` đều rỗng trước INSERT đầu tiên. Runner không truncate/delete/reset. `test:db:activity-integrity` dùng transaction rollback nhưng vẫn phải chạy trên disposable database; không chạy bất kỳ activity integration/E2E nào trên `hsk_system`, staging hoặc production.

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
3. Tạo/publish content revision qua CMS và có AuditLog đã redact.
4. Start lesson, submit activity retry cùng idempotency key, progress không nhân đôi.
5. Lấy due review, submit grade retry, chỉ có một ReviewEvent.
6. Start exam tạo snapshot; autosave retry; submit retry; chỉ có một Result.
7. Sửa question/test sau submit; lịch sử attempt/result vẫn render/chấm theo snapshot.

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
- Khi cần contract/drop legacy (`UserWordProgress`, field Result cũ), tạo release riêng sau khi log chứng minh không còn read/write.

## 13. Rủi ro còn mở và owner cần chốt

| Rủi ro | Trạng thái/biện pháp |
| --- | --- |
| License bảy raw list HSK | Chưa production-cleared; Legal/Product phải xác minh trước publish thương mại. |
| Nghĩa tiếng Việt | Nullable có chủ đích; cần nguồn hợp lệ hoặc editorial workflow, không machine-copy từ EN. |
| Xóa tài khoản | Immutable/historical FK đã được harden bằng `RESTRICT`; endpoint hard-delete bị cấm. Vẫn cần triển khai privacy job idempotent theo ADR-001 trước khi bật cho beta. |
| JSON contract | DB chỉ bảo vệ `jsonb`; API phải dùng DTO/schema versioned và size limit. |
| Immutable trigger | Prisma không biểu đạt; integration SQL là cổng bắt buộc. |
| P1/P2 | Payment/social/gamification/offline/AI nâng cao chưa nằm trong cam kết P0. |

## 14. Change record tối thiểu

Mỗi lần deploy phải lưu: commit SHA, checksum migration, người phê duyệt, database/environment, thời gian bắt đầu/kết thúc, backup identifier, pre/post row counts, migrate status, drift output, integration/smoke-test result, dashboard/log link, sự cố và quyết định rollback/forward-fix.
