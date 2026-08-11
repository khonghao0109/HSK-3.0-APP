# ADR-002: Exercise authoring version, media và import atomicity

- Status: Accepted
- Date: 2026-08-11
- Scope: Web MVP P0 — Exercise Authoring & Import Validation V1
- Related migration: `20260811120000_exercise_authoring_import_validation_v1`
- Related ADR: `ADR-001-IMMUTABLE-EVENT-RETENTION-AND-ACCOUNT-DELETION.md`

## Context

`LessonExercise` vừa là nội dung CMS có vòng đời draft/review/publish/archive, vừa là nguồn chấm điểm cho learner activity. Nếu revision draft ghi đè content đang live, publish diễn ra đồng thời với submit, hoặc media/import chỉ được kiểm tra một phần, attempt có thể snapshot prompt/content/answer từ nhiều version khác nhau và kết quả lịch sử không còn tái lập được.

Schema cũ lưu `content`/`answer` JSON nhưng chưa có relational `mediaId`, provenance key, actor/publication metadata hoặc database backstop cho polymorphic `ContentRevision`. Import framework có `ImportJob`, nhưng chưa có contract Exercise xác định preview, validation, duplicate và atomicity.

V1 cần một contract đủ hẹp để author, review, publish và import Exercise an toàn mà không giả vờ đã hỗ trợ speaking engine, generic import/upsert hoặc media asset lifecycle hoàn chỉnh.

## Decision

### 1. Một shared authoring contract

Create, revision, import preview/commit và activity scorer dùng chung `lesson-exercise-authoring.validator.ts`.

- Human text và stable ID được chuẩn hóa Unicode NFKC.
- Top-level chỉ có `type`, `prompt`, `content`, `answer`, `explanation`, `mediaId`; từng subtype cũng dùng exact-key validation.
- Field lạ trong authoring/import/DTO dùng generic path `$.$unknown`; không phản chiếu property do client kiểm soát.
- Canonical payload tối đa 65.536 byte, depth 8, string 4.096 ký tự, array 100 phần tử. Stable ID tối đa 128 ký tự, không whitespace và chỉ dùng alphabet được chỉ định.
- Bốn type publishable: `mcq`, `listening_choice`, `fill_blank`, `arrange_sentence`.
- `speaking_repeat` chỉ được author/import dưới dạng draft có shape an toàn; publish trả `422` cho đến khi có pronunciation scoring engine.
- Client không được đặt score/correctness, live status/version, revision number, actor, audit hoặc publication metadata.

Contract version đầu tiên là `lesson-exercise-import-v1`; scoring version hiện hành là `lesson-activity-v1`.

### 2. Revision là history; `LessonExercise.version` là materialized revision

Create tạo `LessonExercise.status=draft`, `version=1` và `ContentRevision.revision=1` trong cùng transaction.

- Append revision trên Exercise draft materialize snapshot mới vào `LessonExercise` và đặt `version` bằng revision mới.
- Append revision trên Exercise đã published chỉ tạo history draft; live row và `version` đang phục vụ learner không đổi.
- Chỉ latest revision có latest `ContentReview.decision=approved` được publish.
- Publish kiểm tra canonical snapshot SHA-256, media readiness, rồi atomically copy snapshot vào live row, đặt `status=published`, `publishedAt`, actor và `version=revision.revision`.
- Retry revision với canonical payload giống latest revision và retry publish đúng live hash/version là idempotent, không tạo audit side effect lần hai.
- Stale revision, non-approved revision, archived Exercise hoặc hash/snapshot mismatch bị từ chối.
- Create/revision/review/publish yêu cầu Lesson/Topic parent live và coherent sau khi đã khóa hierarchy. Archive Exercise vẫn được phép khi parent đã archive để cleanup; database bắt buộc `status=archived` khi và chỉ khi `deletedAt` khác null.

`ContentRevision`/`ContentReview` là history append-only. `ContentRevision` với `entityType=lesson_exercise` bắt buộc nonblank `contentHash` và parent tồn tại; do relation polymorphic không biểu diễn được bằng Prisma FK, PostgreSQL trigger là backstop. `LessonExercise` là archive-only và mọi physical delete bị database từ chối để tránh mất revision/attempt history, kể cả race theo MVCC.

### 3. Media là relational publish dependency và snapshot chỉ giữ projection an toàn

`LessonExercise.mediaId` là FK `RESTRICT/RESTRICT` tới `Media`; CHECK chỉ cho phép `mediaId` trên `listening_choice`. `Media_url_nonblank_check` yêu cầu URL có ít nhất một ký tự và không chứa whitespace.

- Chỉ `listening_choice` được dùng `mediaId` trong V1.
- Publish listening khóa Media bằng `FOR SHARE`, sau đó bắt buộc media tồn tại, `type=audio`, `processingStatus=ready`, `deletedAt IS NULL` và URL nonempty/no-whitespace.
- Service trả domain `422`; database publish-readiness trigger chặn write ngoài service.
- Public read và attempt snapshot chỉ project `id`, `url`, `type`, `mimeType`, `duration`.
- Public query chỉ trả bốn type publishable; Exercise có `topicId` chỉ visible khi Topic đó cũng `published` và chưa soft-delete.
- Không project `storageProvider`, `storageKey`, `originalFilename`, checksum hoặc processing metadata.
- Attempt snapshot nội bộ giữ safe media projection và authoritative answer để retry/replay/scoring; response không trả raw snapshot hay authoritative answer.
- Safety `Media UPDATE` phải chờ SHARE lock của publish kết thúc rồi vẫn được quarantine/soft-archive Media. Public query/serializer ẩn Exercise ngay khi readiness mất, nhưng không rewrite immutable attempt cũ; snapshot vẫn giữ safe projection đã chốt để replay.

Object-storage retention và URL longevity là trách nhiệm hạ tầng riêng; relational FK chỉ bảo vệ database row.

### 4. Import là preview no-write + hash-bound all-or-nothing commit

Exercise import có hai route admin:

- `POST /api/v1/admin/cms/exercise-imports/preview`
- `POST /api/v1/admin/cms/exercise-imports`

Preview dùng cùng structural/domain validator và read-only lookup cho DataSource, Lesson, Topic, Media và existing source key. Mỗi request bắt buộc có 1–100 row. Preview không tạo `ImportJob`, Exercise, revision, error row hay audit. Response trả safe errors được sort ổn định và `previewHash` SHA-256 trên canonical contract version, DataSource, normalized file name, ordered normalized rows và structural errors. Relational state không được đóng băng vào hash, vì vậy commit luôn lookup/revalidate lại trong transaction.

Commit bắt buộc gửi lại payload cùng `previewHash` và header `Idempotency-Key`:

1. Tính lại hash trước transaction; changed payload/hash trả `409`.
2. Trong transaction, khóa actor bằng `User FOR SHARE` với đồng thời `role=admin`, `status=active`, `deletedAt IS NULL`, rồi khóa `DataSource FOR UPDATE`.
3. Kiểm tra existing `ImportJob` theo global idempotency key; exact retry có thể trả ngay sau hai lock trên.
4. Với request mới, normalize row rồi khóa tất cả Lesson ID tăng dần, sau đó Topic ID tăng dần.
5. Revalidate toàn bộ structural và relational state.
6. Nếu có bất kỳ row lỗi, trả `422 IMPORT_VALIDATION_FAILED` và rollback tất cả.
7. Nếu hợp lệ, ghi một `ImportJob.completed`, tất cả draft Exercise + revision 1 và một redacted `AuditLog`; commit cùng nhau.

Interactive transaction dùng `maxWait=5.000 ms` (5 giây) và `timeout=30.000 ms` (30 giây). Timeout được phân loại thành safe `503`, không được coi là concurrency success.

Retry cùng key chỉ idempotent khi actor, DataSource, file name, preview hash và entity type đều khớp, current rows revalidate hợp lệ, đồng thời job `completed` có started/completed timestamps, zero errors, exact counts, canonical sourceKey array khớp chính xác cả giá trị/thứ tự, đủ Exercise + revision 1 và đúng một completion audit. Khi coherent, service trả lại đúng job/exercises đã commit. Matching job `pending`/`failed`/incomplete hoặc provenance không coherent trả safe `409` yêu cầu manual review; service không tự resume, mutate hay tạo job khác. Dùng cùng key cho request khác cũng trả `409`.

`sourceKey` được NFKC-normalize, bounded và không whitespace. Duplicate trong batch hoặc đã tồn tại trong cùng `(dataSourceId, sourceKey)` bị reject; cùng key ở DataSource/version khác được phép. V1 không upsert/merge ngầm và không persist partial error rows.

### 5. Lock order và transaction boundary

Exercise create khóa actor/parent rồi insert. Mutation trên Exercise hiện hữu khóa thêm chính Exercise:

```text
active admin actor User FOR SHARE → Lesson FOR UPDATE → Topic FOR UPDATE (nếu có) → LessonExercise FOR UPDATE
```

Publish `listening_choice` khóa tiếp `Media FOR SHARE` sau LessonExercise; không lấy Media lock trước content hierarchy.

Activity submit luôn bắt đầu bằng active `User`, sau đó lấy shared content lock theo cùng thứ tự và cuối cùng mới khóa progress rows:

```text
active User FOR UPDATE → Lesson/Topic/LessonExercise FOR SHARE → Progress/UserTopicProgress FOR UPDATE
```

Nhờ vậy publish và submit serialize tại content hierarchy; attempt nhìn thấy trọn version cũ hoặc trọn version mới. Import là boundary riêng:

```text
active admin actor User FOR SHARE → DataSource FOR UPDATE → Lesson IDs FOR UPDATE tăng dần → Topic IDs FOR UPDATE tăng dần
```

Không được gọi ngược từ transaction đang giữ content hierarchy sang import. Workflow tương lai cần kết hợp hai boundary phải có lock-order design/test mới.

Concurrency runner chỉ GREEN khi transaction A commit, transaction B được quan sát ở PostgreSQL `wait_event_type=Lock` trước khi release A, outcome B đúng domain/response contract và final database invariant đúng. Timeout, deadlock, connection error, unexpected constraint hoặc B settle sớm đều RED.

### 6. Database enforcement và migration preflight

EX-A là forward-only transaction. Trước DDL, migration dừng nếu:

- Có bất kỳ legacy `LessonExercise.status=published`; hoặc
- Có archive status/`deletedAt` mâu thuẫn; hoặc
- Có Exercise dưới Lesson/Topic archived hay Topic không thuộc đúng Lesson; hoặc
- Có `ContentRevision.entityType=lesson_exercise` dangling hay `contentHash` null/blank; hoặc
- Có `Media.url` rỗng hoặc chứa whitespace.

Migration không đoán JSON/media provenance, tự tạo hash hay đổi status. Khi preflight fail, toàn transaction rollback; content owner phải audit và xử lý bằng change/migration riêng.

Database thêm:

- Lesson/Topic/Media/DataSource FK `RESTRICT`; actor FK `SET NULL` để giữ content khi account được anonymize/xóa theo lifecycle.
- Unique `(dataSourceId, sourceKey)` và CHECK source key/provenance.
- CHECK Media URL nonempty/no-whitespace, published row có `publishedAt`, archive state khớp `deletedAt`, media chỉ nằm trên listening và LessonExercise revision có nonblank hash.
- Trigger publish readiness, live/coherent parent khi insert/move/publish, polymorphic revision parent và archive-only hard-delete rejection. Chuyển Exercise sang archived được miễn live-parent check để cleanup child sau khi parent đã archive.

Prisma phản ánh field/relation/index có thể biểu diễn; trigger và cross-table rule tiếp tục được kiểm tra bằng SQL acceptance.

## Error and privacy contract

| Nhóm                                                                                                                   | Runtime | Quyết định                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ------: | --------------------------------------------------- |
| Invalid authoring/import row (gồm existing/duplicate source key), unsupported speaking publish, unsafe listening media |   `422` | Trả safe `code/path/message`; không partial write   |
| Stale state, changed preview, idempotency conflict, persistence FK/CHECK (`P2003`/`23503`/`P2004`/`23514`) hoặc race   |   `409` | Reload/preview lại hoặc sửa key/request             |
| Lock/statement/Prisma timeout, connection unavailable                                                                  |   `503` | Retry đúng idempotency key sau backoff/điều tra     |
| Unknown persistence failure                                                                                            |   `500` | Generic response; giữ chi tiết trong controlled log |

Audit/import errors không lưu hoặc trả raw answer, raw payload, SQL, credential hay connection URL.

## Consequences

### Positive

- Learner luôn làm một version coherent; lịch sử attempt có thể replay sau content/media lifecycle change.
- Author có thể chuẩn bị revision tiếp theo mà không làm thay đổi content live.
- Preview và commit dùng cùng deterministic contract; retry không nhân đôi job/exercise.
- Database bảo vệ các invariant cốt lõi khi có writer ngoài NestJS/Prisma.

### Trade-offs

- Published legacy Exercise phải được audit thủ công trước EX-A; không có convenience backfill.
- Hard-delete Exercise bị cấm, kể cả draft chưa có history; vận hành phải archive.
- Import V1 là JSON-row all-or-nothing và duplicate-reject; chưa có partial import, update/upsert, generic CSV mapping hoặc persisted preview errors.
- Media URL trong immutable snapshot cần object-storage retention policy ngoài database.
- `speaking_repeat` tồn tại ở draft để không mất authoring intent nhưng không thể public/score.

## Alternatives rejected

- **Ghi trực tiếp draft vào live published row:** làm learner thấy content chưa duyệt và phá version pinning.
- **Publish revision bất kỳ đã từng approved:** cho phép stale publish ghi đè revision mới hơn.
- **Nhúng raw media metadata vào JSON:** không có relational readiness và có nguy cơ lộ storage metadata.
- **Import từng row/partial success:** tạo dataset nửa vời, idempotency và rollback khó chứng minh.
- **Upsert theo source key:** có thể âm thầm ghi đè content đã review; V1 chọn duplicate-reject.
- **Hash chỉ file bytes:** không bind normalized semantic payload và relational validation result.

## Verification and rollout

- `test/database/exercise-authoring-integrity.integration.sql` kiểm tra schema/FK/CHECK/trigger/media/snapshot/provenance trong transaction rollback.
- `scripts/test/run-exercise-authoring-concurrency.ts` gọi production services cho bảy race: concurrent revisions, concurrent publish, publish/archive, publish/submit distinct-user, publish/submit same-actor, archive/submit và import idempotency retry.
- Mỗi concurrency runner chỉ chạy một lần trên database disposable fresh migration-only; muốn chạy lại phải tạo database mới và deploy đủ 15 migration. Không truncate/reset/seed.
- Evidence ngày 2026-08-11 cho artifact frozen gồm fresh deploy 15 migration, P0 + Lesson Activity + Exercise SQL acceptance/rollback, migrate status và cả migration-history shadow/live drift rỗng. Source/database checksum EX-A khớp `74944a7d95fabc02a0e84fe39b91543ac41a63e4714cfcaf389e81fe432d9f7c`; inventory là 57 table, 143 FK, 78 CHECK và 33 custom trigger. Negative preflight Media URL whitespace rollback atomic. P0/CMS/Activity/Exercise concurrency lần lượt PASS `3/3`, `4/4`, `5/5`, `7/7`; full E2E PASS `8/8` suite, `118/118` test; Prisma/TypeScript/build/lint/format/unit/diff gate đều GREEN.

## Rollback / forward-fix

Không có destructive down migration. Trước traffic, có thể restore backup đã verify. Sau traffic, rollback application bằng cách tắt routes nhưng giữ schema/history, archive content sai và tạo revision/forward migration hoặc compensating import theo quyết định nghiệp vụ. Không hard-delete Exercise/Media/DataSource và không sửa checksum EX-A sau khi migration đã áp ở bất kỳ environment dùng chung nào.
