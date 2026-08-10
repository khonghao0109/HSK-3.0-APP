# Lộ trình hoàn thiện Database Schema — HSK System

> Phiên bản: 2.1 — P0 integrity hardening
>
> Ngày cập nhật: 10/08/2026
>
> Trạng thái: P0-00 đến P0-04 và forward migration `p0_integrity_hardening` đã được triển khai/rehearsal. P1/P2 vẫn deferred.

## 0. Baseline P0 đã triển khai

Chuỗi migration hiện có 11 migration, trong đó 6 migration P0 theo capability:

| Thứ tự | Migration | Kết quả |
|---:|---|---|
| 1 | `p0_schema_foundation_level` | `Level.code`, band 1–9, curriculum version, HSK7_9 và constraint |
| 2 | `p0_identity_onboarding_privacy` | Account lifecycle, profile, session/token hash, onboarding, consent và privacy request |
| 3 | `p0_cms_provenance_import_audit` | CMS revision/review, provenance, import/audit, media metadata và dictionary localization |
| 4 | `p0_learning_progress_srs` | Activity snapshot, progress chi tiết, learning event và SRS source of truth |
| 5 | `p0_exam_attempt_snapshot` | Placement đúng theo test, attempt/autosave/snapshot/scoring và result uniqueness |
| 6 | `p0_integrity_hardening` | Band theo Level, SRS ownership, immutable retention FK và public prefix indexes |

Schema P0 hardening có 57 business tables, 138 foreign keys, 72 CHECK constraints và 24 trigger nghiệp vụ trên PostgreSQL rehearsal. ERD và data dictionary versioned nằm tại [database/P0_ERD.md](./database/P0_ERD.md) và [database/P0_DATA_DICTIONARY.md](./database/P0_DATA_DICTIONARY.md). Chính sách retention/xóa tài khoản nằm tại [ADR-001](./adr/ADR-001-IMMUTABLE-EVENT-RETENTION-AND-ACCOUNT-DELETION.md).

Các model P0 hiện là **data contract**; runtime API cho session, onboarding, CMS, SRS và exam vẫn phải được triển khai theo vertical slice. Không mô tả schema-ready là feature runtime hoàn chỉnh.

## 1. Mục tiêu và phạm vi

Tài liệu này xác định trình tự để schema PostgreSQL đáp ứng **toàn bộ module P0, P1 và P2** trong [FUNCTIONAL_HIERARCHY.md](./FUNCTIONAL_HIERARCHY.md).

Trong tài liệu này, “schema hoàn thiện 100%” nghĩa là:

- Mọi luồng đã được chấp thuận trong functional hierarchy đều có data model, ràng buộc, index và ownership rõ ràng.
- Có thể tạo database mới từ đầu bằng migrations, seed dữ liệu và chạy backend mà không cần thao tác SQL thủ công.
- Dữ liệu lịch sử quan trọng (exam, revision, audit, payment) không bị mất hoặc bị thay đổi khi content hiện tại được chỉnh sửa.
- Core product, AI/RAG và object storage có boundary dữ liệu rõ ràng.
- Schema, ERD, API contract, seed và test luôn đồng bộ.

Đây không có nghĩa hệ thống sẽ không bao giờ thêm feature mới; mọi feature ngoài phạm vi P0/P1/P2 sẽ đi qua một vòng thiết kế migration mới.

## 2. Baseline hiện tại

### 2.1 Đã có

Baseline trước P0 có 27 business tables và 5 migrations. Sau P0, schema nguồn và migration chain hỗ trợ thêm:

- Auth email/password cơ bản với role `user`/`admin`.
- Level, lesson, topic, story, từ vựng, nghĩa, câu mẫu và media liên quan.
- Lesson exercise, attempt và pronunciation attempt cơ bản.
- Question bank, test, section, question group, result và score theo skill.
- Progress lesson, saved words và trạng thái học từ.

### 2.2 Khoảng trống cần được xử lý

- Runtime chưa triển khai onboarding, placement, learning plan, session rotation và privacy jobs dù schema đã sẵn sàng.
- Runtime exam chưa triển khai start/autosave/submit dù attempt/answer/snapshot đã có schema.
- Runtime CMS/import chưa có; schema đã có revision/review/audit/import/provenance.
- Dictionary vẫn chưa có dữ liệu nghĩa Việt; schema đã có localized/normalized fields và provenance nhưng không tự dịch dữ liệu.
- Chưa có interactive reader progress, Hanzi/stroke/OCR, support, subscription/entitlement.
- AI/RAG chưa có database/service implementation riêng.

## 3. Nguyên tắc thiết kế và an toàn migration

1. **Không sửa migration đã chạy trên môi trường dùng chung.** Nếu migration cũ có vấn đề, tạo kế hoạch remediation/baseline riêng trước khi thêm feature migration.
2. **Không dùng `prisma db push` cho staging hoặc production.** Chỉ dùng Prisma migrations được review.
3. **Mỗi migration chỉ phục vụ một capability rõ ràng**; tách schema change, backfill dữ liệu và xoá field cũ thành các bước riêng.
4. **JSON chỉ dùng cho payload linh hoạt hoặc snapshot bất biến.** Những dữ liệu cần lọc, index, audit hoặc thống kê phải có column/model quan hệ rõ ràng.
5. **Soft delete, publish state và audit phải nhất quán** cho mọi content do admin quản lý.
6. **Không dùng foreign key xuyên service.** AI/RAG có database riêng và chỉ trao đổi qua API/event với backend.
7. **Mọi bảng theo user hoặc event lớn phải có index theo user/time** và chính sách retention.
8. **Mỗi migration cập nhật cùng lúc:** Prisma schema, ERD, seed/backfill, API DTO, docs API và test.

## 4. Thứ tự triển khai schema

### Giai đoạn 0 — Xác thực baseline và chốt quyết định dữ liệu

#### Mục tiêu

Đảm bảo migrations tái lập được và không đưa các giả định sản phẩm chưa chốt vào schema.

#### Việc cần làm

1. Tạo database PostgreSQL rỗng tạm thời và chạy `prisma migrate deploy` để kiểm tra bootstrap từ đầu.
2. Kiểm tra source của migration `20260611041059_add_exam_sections_groups`: file hiện có ký tự backtick ở đầu SQL; phải có phương án remediation trước khi CI/staging tạo database mới.
3. Chốt các quyết định sản phẩm:

   - **Đã chốt:** dùng 7 nhóm curriculum; `HSK7_9` đại diện band 7–9.
   - Các role hệ thống: chỉ `user/admin`, hay thêm `teacher`, `editor`, `reviewer`, `support`.
   - Có OAuth Google/Apple/Facebook hay chỉ email/password.
   - Có subscription/premium trong release P2 hay không.
   - AI chat history thuộc core database hay chỉ thuộc AI service; khuyến nghị chat/RAG thuộc AI service.

4. Dữ liệu `Level` giữ nguyên ID và được backfill thành `HSK1`…`HSK6`, `HSK7_9`; không tách HSK7/8/9 ở P0.
5. Viết schema convention: enum naming, trạng thái lifecycle, timezone UTC, naming index và data retention.

#### Exit criteria

- Database rỗng bootstrap thành công trong CI/local.
- Mọi quyết định trên được ghi trong ADR hoặc docs.
- ERD phản ánh chính xác baseline.

### Giai đoạn 1 — Identity, hồ sơ, onboarding và privacy [P0]

#### Thay đổi model

| Model / thay đổi | Mục đích |
|---|---|
| Mở rộng `User` | `status`, `emailVerifiedAt`, `lastLoginAt`, avatar và thông tin lifecycle cần thiết |
| `UserProfile` | locale, timezone, avatar, display name và preference ổn định |
| `AuthIdentity` | liên kết OAuth provider với user; unique theo provider/providerAccountId |
| `UserSession` | quản lý thiết bị, refresh token hash, revoke, lastSeenAt, hết hạn |
| `PasswordResetToken` | reset password một lần, có expiry/usedAt |
| `EmailVerificationToken` | xác thực email một lần, có expiry/usedAt |
| `UserGoal` | mục tiêu HSK, phút học/ngày, giờ nhắc, ngày bắt đầu |
| `PlacementAttempt` | câu trả lời, điểm theo skill, level đề xuất, completedAt |
| `LearningPlan` / `LearningPlanItem` | lộ trình được tạo từ placement/goal, lesson plan theo ngày hoặc tuần |
| `Consent` | consent version, loại consent, granted/revoked timestamp |
| `DataExportJob` / `AccountDeletionRequest` | phục vụ UI export/xóa account và audit lifecycle |

#### Ràng buộc/index quan trọng

- Unique `AuthIdentity(provider, providerAccountId)`.
- Index `UserSession(userId, expiresAt)`, `PlacementAttempt(userId, createdAt)`, `LearningPlan(userId, status)`.
- Token chỉ lưu hash; không lưu refresh/reset token raw.
- Xóa user cần lifecycle `requested → verified → scheduled → completed`, không xoá trực tiếp trong request web.

#### Exit criteria

- UI auth, onboarding, placement, profile, export/delete account có API/data model rõ ràng.
- Nếu OAuth chưa chốt, các nút OAuth phải bị feature-flag/ẩn khỏi UI P0.

### Giai đoạn 2 — CMS, workflow, import và quản trị dữ liệu [P0]

#### Thay đổi model

| Model / thay đổi | Mục đích |
|---|---|
| Mở rộng content (`Level`, `Lesson`, `Topic`, `Story`, `Question`, `Test`) | `createdById`, `updatedById`, `publishedAt`, metadata cần truy vết |
| `ContentRevision` | snapshot/version content khi chỉnh sửa; entity type + entity id + revision + payload + author |
| `ContentReview` | reviewer, action approve/request-change/reject, note, thời điểm duyệt |
| `AuditLog` | action quản trị, actor, target, before/after summary, requestId/IP phù hợp policy |
| `ImportJob` | file import, loại dữ liệu, mapping, trạng thái, tổng số record |
| `ImportRowError` | lỗi theo từng dòng import để preview/sửa/nhập lại |
| `DataSource` | nguồn dữ liệu, license, version, importedAt và provenance |
| Mở rộng `Media` | storage key/provider, originalName, checksum, uploadedById, processingStatus, transcript/caption metadata |
| `Material` / `MaterialItem` | tài liệu học có title, level, type, publish state, media và quyền truy cập |

#### Quy tắc triển khai

- Mỗi CRUD content tạo `AuditLog`; revision chỉ tạo cho field nghiệp vụ, không snapshot upload URL tạm thời.
- Content được public chỉ khi `status=published`, `publishedAt <= now()` và review hợp lệ nếu workflow bật.
- Không cho import trực tiếp vào bảng production data; import phải qua staging/validation trong `ImportJob`.

#### Exit criteria

- Admin CMS Lite có thể import, xem lỗi, publish, archive và truy vết người sửa.
- Media và Material có ownership, source và lifecycle rõ ràng.

### Giai đoạn 3 — Learning progress, activity engine và access control [P0]

#### Thay đổi model

| Model / thay đổi | Mục đích |
|---|---|
| Mở rộng `Progress` hoặc đổi thành `UserLessonProgress` | `startedAt`, `completedAt`, `lastActivityAt`, `completionPercent`, `currentTopicId`, `timeSpentSeconds` |
| `UserTopicProgress` | theo dõi hoàn thành từng topic, phù hợp UI lesson detail |
| Mở rộng `LessonExerciseAttempt` | attempt number, duration, submittedAt, client context và feedback version |
| `LearningEvent` | event nghiệp vụ có giá trị: lesson started/completed, exercise submitted, word saved; dùng cho analytics/recommendation |
| `ContentAccess` hoặc `Entitlement` tạm thời | giải quyết `isPremium`/`isLocked` theo user trước khi module payment hoàn chỉnh |

#### Quy tắc triển khai

- `LearningEvent` không thay thế progress summary; nó phục vụ audit/analytics.
- Bất kỳ update progress nào phải idempotent theo user + resource + action key.
- Không chỉ dựa vào `Topic.isLocked`; quyền mở nội dung phải được quyết định phía server.

#### Exit criteria

- Có thể mở lesson, học topic, làm bài luyện, tiếp tục từ vị trí trước và thấy progress chính xác.

### Giai đoạn 4 — Dictionary quality và SRS/Review Center [P0]

#### Thay đổi model

| Model / thay đổi | Mục đích |
|---|---|
| Mở rộng `WordMeaning` hoặc thêm `WordSense` | từ loại, thứ tự nghĩa, usage/register, note, source và language rõ ràng |
| `WordExample` | nhiều ví dụ có audio, dịch, nguồn; thay cho `Word.example` đơn lẻ khi cần |
| `WordRelation` | synonym, antonym, related word, component relation |
| `WordSource` / liên kết `DataSource` | truy vết CC-CEDICT/nguồn HSK và version dữ liệu |
| `ReviewCard` | `userId`, `wordId`, `state`, `dueAt`, `intervalDays`, `easeFactor`, `repetitions`, `lapses`, `lastReviewedAt` |
| `ReviewEvent` | grade (again/hard/good/easy), card state trước/sau, duration, reviewedAt |
| `ReviewSession` | số card, started/completed, chế độ ôn để hiển thị dashboard |

#### Index và data migration

- Giữ index hiện có cho `Word.hanzi` và `Word.pinyin`.
- Thêm search strategy cho `meaningVi`/`meaningEn`: PostgreSQL full-text hoặc `pg_trgm` GIN index sau khi chốt kiểu truy vấn.
- Backfill `meaningVi`, từ loại, nguồn và HSK mapping theo batch, idempotent, có báo cáo record lỗi.
- Đảm bảo HSK 1–9 mapping được version hóa; không sửa trực tiếp raw source file.

#### Exit criteria

- Dictionary UI tìm được theo Hán tự, Pinyin, Việt/Anh và trả detail đúng.
- SRS tạo được card từ word saved/học, có due queue hằng ngày và lịch sử review.

### Giai đoạn 5 — Interactive reader, pronunciation và Hanzi [P1/P2]

#### Thay đổi model

| Model / thay đổi | Mục đích |
|---|---|
| `StorySegment` hoặc quan hệ Story–Sentence | segment theo thứ tự, Hanzi/Pinyin/dịch/audio để tap-to-lookup và sync audio |
| `ReadingProgress` | percent, current segment, lastReadAt, completedAt |
| `StoryBookmark` | đánh dấu vị trí/câu/từ trong reader |
| Mở rộng `PronunciationAttempt` | transcript, engine/version, rubric score, duration và feedback có cấu trúc |
| `Character` | Hanzi, traditional, pinyin, radical, stroke count, structure, source |
| `CharacterComponent` | quan hệ component/radical của Hanzi |
| `CharacterStroke` | thứ tự/path hoặc asset stroke animation |
| `CharacterPracticeAttempt` / `OcrLookup` | lịch sử luyện viết và OCR khi P2 được bật |

#### Exit criteria

- Reader lưu được vị trí đọc, tap-to-lookup và audio sync.
- Pronunciation feedback truy vết được engine/version và có thể audit.
- Hanzi/OCR chỉ được mở khi có data source và asset hợp lệ.

### Giai đoạn 6 — Exam delivery, snapshot và analytics theo skill [P0]

#### Thay đổi model

| Model / thay đổi | Mục đích |
|---|---|
| Mở rộng `Question` | difficulty, tags, objective, author/reviewer, version metadata |
| `QuestionTag` / `Tag` | lọc question bank theo topic, skill, độ khó, nguồn |
| Mở rộng `Test` | slug, instruction, availability window, attempt limit, pass policy, version |
| `QuestionRevision` / `TestRevision` | lịch sử thay đổi để admin audit và build đề ổn định |
| `ExamAttempt` | user/test, status, startedAt, expiresAt, submittedAt, remainingSeconds, score, snapshot version |
| `ExamAnswer` | attempt/question, answer payload, isFlagged, answeredAt, lastSavedAt, score/detail |
| `ExamAttemptSnapshot` | câu hỏi, đáp án, media, explanation và scoring rule bất biến khi bắt đầu thi |
| `ExamAttemptEvent` (tùy chọn) | autosave/resume/audit cho event quan trọng, không log mỗi click |
| Mở rộng `Result` / `ResultSkillScore` | liên kết attempt, score per skill, publishedAt, revision source |

#### Quy tắc triển khai

- Tạo snapshot lúc bắt đầu attempt; không dùng câu hỏi live để chấm bài cũ.
- `ExamAnswer` upsert theo `(attemptId, questionId)` để autosave idempotent.
- Chỉ tạo Result final khi submit/timeout hoàn tất; attempt `in_progress` không được coi là result.
- Lưu điểm section theo quy tắc HSK đã chốt; tránh UI “đề Nghe” nhưng hiển thị tổng điểm ba kỹ năng.

#### Exit criteria

- User có thể bắt đầu, autosave, resume, flag/review, submit và xem kết quả không thay đổi theo content mới.
- Admin truy vết được version câu hỏi/đề đã dùng trong mọi kết quả.

### Giai đoạn 7 — Engagement, notification, support và analytics [P1]

#### Thay đổi model

| Model / thay đổi | Mục đích |
|---|---|
| `XpTransaction` | sổ cái XP bất biến; không chỉ lưu tổng XP trên User |
| `Achievement` / `UserAchievement` | định nghĩa và cấp thành tích |
| `UserStreak` | chuỗi ngày học, timezone, lastQualifiedDate |
| `NotificationPreference` | push/email/in-app, quiet hours, loại thông báo |
| `DeviceToken` | token thiết bị, platform, revokedAt |
| `Notification` | payload, schedule, sent/read state, idempotency key |
| `SupportTicket` / `SupportMessage` | workflow hỗ trợ, assignee, status, priority |
| `ContentReport` / `AiFeedback` | báo lỗi content, đánh giá câu trả lời AI |
| `AnalyticsDailyAggregate` (tùy chọn) | aggregate có kiểm soát cho dashboard khi raw events lớn |

#### Exit criteria

- Dashboard có metric nguồn rõ ràng.
- Nhắc ôn và quiet hours hoạt động theo timezone user.
- Feedback/report từ UI đi vào workflow admin có trạng thái xử lý.

### Giai đoạn 8 — Subscription, premium access và payment [P2]

#### Thay đổi model

| Model / thay đổi | Mục đích |
|---|---|
| `Product` / `Plan` | định nghĩa gói, kỳ hạn, feature allowance |
| `Subscription` | trạng thái thuê bao, provider, external id, start/end/cancel |
| `Entitlement` | quyền thực thi phía server theo user/feature/resource |
| `PaymentEvent` | webhook idempotent, payload audit, trạng thái xử lý |
| `Coupon` / `Redemption` (nếu cần) | khuyến mãi có giới hạn và audit |

#### Quy tắc triển khai

- Không dùng `Topic.isPremium` đơn lẻ để cấp quyền; backend kiểm tra `Entitlement`.
- Payment webhook phải idempotent và lưu external event id unique.
- Không lưu dữ liệu thẻ thanh toán trong core database.

#### Exit criteria

- Premium content, quota AI và feature gate được kiểm tra từ server.
- Hủy/gia hạn/refund đồng bộ chính xác qua payment event.

### Giai đoạn 9 — AI/RAG database độc lập [P2]

#### Ownership

AI service trong `ai/` sở hữu database riêng; khuyến nghị PostgreSQL + pgvector hoặc vector database phù hợp. Core backend không lưu embedding/chunk.

#### Model thuộc AI service

| Model | Mục đích |
|---|---|
| `KnowledgeDocument` | tài liệu nguồn, loại, hash, version, quyền truy cập |
| `DocumentChunk` | text chunk, metadata, source location, content hash |
| `Embedding` | vector, model/version, chunk id |
| `IngestionJob` | trạng thái ingest, lỗi, retry, thống kê |
| `ChatSession` / `ChatMessage` | lịch sử chat, external user id, retention policy |
| `RagRun` / `Citation` | truy vết retrieval, source citation, model/prompt version |
| `AiEvaluation` / `AiFeedback` | dataset đánh giá, feedback user/admin, quality score |

#### Boundary với core backend

- Core gửi `userId`, role, levelId/lessonId và permission context qua API.
- AI không có foreign key trực tiếp sang core database.
- Xóa user từ core phát event/API sang AI để xoá/anonymize chat theo policy.

#### Exit criteria

- Mỗi câu trả lời AI có citation, run trace, prompt/model version và feedback path.
- Ingest có idempotency theo content hash/version.

### Giai đoạn 10 — Performance, retention và production hardening [P1/P2]

#### Việc cần làm

1. Review index bằng `EXPLAIN ANALYZE` trên query thật: dictionary search, lesson list, due review queue, active exam, dashboard.
2. Bổ sung composite indexes theo access pattern, không index mọi cột mặc định.
3. Partition hoặc archive các bảng event lớn (`LearningEvent`, `ReviewEvent`, `AuditLog`, `Notification`) khi volume yêu cầu.
4. Thiết lập retention cho audio attempt, chat history, raw event và log theo privacy policy.
5. Backup/restore drill định kỳ; xác nhận restore tạo được database dùng được.
6. Thiết lập migration gate trong CI: schema validate, migrate fresh DB, seed tối thiểu, integration tests.
7. Viết data deletion/anonymization job, kiểm thử với FK cascade và object storage.

#### Exit criteria

- Các query P95 mục tiêu có kế hoạch index được đo bằng dữ liệu thực tế.
- Có quy trình restore và kiểm thử migration trên database rỗng.
- Không có bảng user/event không có retention hoặc data-owner rõ ràng.

## 5. Quy trình bắt buộc cho mỗi migration

1. Cập nhật functional requirement và ERD trước.
2. Viết Prisma model, relation, constraint và index.
3. Tạo migration có tên nghiệp vụ rõ ràng bằng `npx prisma migrate dev --name <capability>` trong môi trường dev.
4. Review SQL sinh ra: lock, index, nullable field, default và khả năng rollback.
5. Nếu bảng đã có data lớn: deploy field nullable trước, backfill bằng job batch idempotent, validate, sau đó mới đặt `NOT NULL`/unique constraint.
6. Chạy `npx prisma generate`, unit test, integration test và test seed mới.
7. Chạy `npx prisma migrate deploy` trên staging database rỗng và staging database có dữ liệu đại diện.
8. Cập nhật [api.md](./api.md), [PROJECT_CONTEXT_FOR_AI.md](./PROJECT_CONTEXT_FOR_AI.md), seed script và tài liệu vận hành.
9. Chỉ deploy production sau khi backup, migration check và monitoring được xác nhận.

## 6. Checklist hoàn tất schema 100%

### Data model

- [x] Tất cả module schema P0 trong functional hierarchy có model, FK, lifecycle và index.
- [ ] Tất cả module P1 có schema hoặc quyết định explicit để defer.
- [ ] Tất cả module P2 có ownership và boundary rõ ràng; AI có database riêng.
- [x] HSK dùng 7 nhóm (`HSK1`…`HSK6`, `HSK7_9`) và role P0 chỉ `user/admin`.
- [x] Data source, version, hash và license field cho dictionary/content/media được lưu; license HSK legacy vẫn cần owner xác minh.

### Integrity và history

- [x] Exam attempt/answer/snapshot tách khỏi question/test live và snapshot bị chặn update/delete.
- [x] Content có revision, review và audit ở schema; runtime CMS còn phải triển khai.
- [x] SRS có due date, grade history, scheduler version và review metrics ở schema.
- [ ] Payment, notification, support và AI feedback có idempotency/audit phù hợp.

### Performance và vận hành

- [x] Dictionary có normalized/index cho Hanzi/Pinyin/Việt/Anh theo prefix-search P0; chưa thêm trigram/GIN khi chưa có query plan.
- [x] Due review và active exam có composite index theo user/time/status; notification deferred P1.
- [x] Migrations bootstrap thành công trên database PostgreSQL disposable.
- [ ] CI kiểm tra schema validate, migration deploy, seed và test.
- [ ] Backup/restore và retention đã được kiểm thử.

### Đồng bộ sản phẩm

- [ ] API, DTO, UI state, schema và seed không mâu thuẫn.
- [ ] Mockup UI có state loading/empty/error/permission và map đến data model thật.
- [ ] Không có UI feature (OAuth, teacher role, subscription, OCR, offline) chưa có owner/schema/feature flag.

## 7. Definition of Done

Schema được coi là hoàn thiện cho phạm vi hiện tại khi toàn bộ checklist trên hoàn tất, migrations có thể tái tạo database từ đầu, các luồng P0/P1/P2 đã chốt có integration test qua database thật, và mọi dữ liệu có owner/lifecycle/retention rõ ràng.

Không tự ý triển khai toàn bộ migration trong tài liệu này trong một lần. Mỗi giai đoạn phải được review, phê duyệt và phát hành theo capability để giảm rủi ro dữ liệu.
