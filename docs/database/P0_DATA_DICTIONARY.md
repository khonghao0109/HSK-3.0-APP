# P0 Data Dictionary — HSK 3.0 APP

> Phiên bản: `2.1.0-p0-hardening`
> Ngày chốt: `2026-08-10`
> Nguồn kỹ thuật chuẩn: `backend/prisma/schema.prisma` và các migration trong `backend/prisma/migrations/`
> Phạm vi: Web MVP P0; mô tả 57 bảng tại migration 15 (2026-08-10). Schema hiện có 60 model sau migration 16–20 (`MediaIngestion`, `MediaUploadRateLimit`, `RateLimitCounter` và các cột provenance/telemetry của Media chưa được bổ sung vào tài liệu này; xem `backend/prisma/schema.prisma` và runbook migration mục 18).

## 1. Nguyên tắc mô hình dữ liệu

- PostgreSQL là nguồn dữ liệu chuẩn; Prisma schema là mô hình ứng dụng, còn migration SQL là lịch sử triển khai bất biến.
- Mọi thay đổi production phải đi qua migration đã review. Không dùng `prisma db push` trên shared/staging/production.
- HSK 3.0 dùng bảy nhóm học: `HSK1` đến `HSK6` và `HSK7_9`. Mọi target/awarded band phải thuộc `Level.minBand..maxBand` tương ứng; `HSK7_9` nhận 7–9.
- Email được canonicalize bằng `lower(btrim(email))` và unique không phân biệt hoa/thường ở database.
- Token xác thực, refresh session, reset password và verify email chỉ lưu hash; tuyệt đối không lưu raw token.
- Dữ liệu lịch sử quan trọng dùng snapshot và event append-only. Sửa nội dung sau khi người dùng làm bài không được làm thay đổi lịch sử chấm điểm.
- `ReviewCard` là source of truth của SRS. `UserWordProgress` chỉ giữ để tương thích runtime cũ và phải được loại bỏ bằng migration riêng sau khi chuyển đổi hoàn tất.
- `deletedAt` là soft-delete cho tài khoản/nội dung/media. Hard-delete User/Lesson/ReviewSession bị cấm ở MVP; account deletion dùng lifecycle/anonymization theo ADR-001.

## 2. Quy ước chung

| Quy ước | Ý nghĩa |
| --- | --- |
| `id Int` | Khóa chính tăng tự động cho bảng giao dịch/aggregate thông thường. |
| `id BigInt` | Khóa chính cho event/audit/error log có tốc độ tăng cao. |
| `createdAt`, `updatedAt` | Mốc tạo/cập nhật theo UTC; client tự hiển thị theo timezone hồ sơ. |
| `status` | Enum lifecycle; không suy luận trạng thái chỉ từ timestamp. |
| `version` | Phiên bản nội dung/answer dùng cho optimistic control hoặc snapshot. |
| `idempotencyKey` | Khóa retry an toàn, luôn unique trong đúng scope nghiệp vụ. |
| `dataSourceId` | Provenance của dữ liệu import/biên soạn; `NULL` chỉ dành cho nội dung chưa gắn nguồn hợp lệ. |
| `createdById`, `updatedById`, `publishedById` | Actor quản trị content mutable thường dùng `SET NULL`; actor của immutable revision/audit dùng `RESTRICT` và được anonymize tại User row. |
| `Json` | Chỉ dùng cho payload biến đổi; các thuộc tính cần lọc, join, unique hoặc CHECK phải là cột typed. |

## 3. Identity, onboarding và privacy — 12 bảng

| Bảng | Mục đích | Trường nghiệp vụ chính | Khóa và bất biến |
| --- | --- | --- | --- |
| `User` | Tài khoản và vòng đời đăng nhập. | `email`, `password` (hash), `role`, `status`, `failedLoginAttempts`, `lockUntil`, `emailVerifiedAt`, `lastLoginAt`, `deletedAt`. | PK `id`; unique email Prisma và unique functional `lower(btrim(email))`; số lần lỗi không âm; user bị khóa/suspend không được login. |
| `UserProfile` | Hồ sơ hiển thị và locale. | `displayName`, `avatarUrl`, `locale`, `timezone`. | `userId` unique, FK cascade; quan hệ 1–1 với `User`. |
| `UserSession` | Refresh/device session có thể thu hồi. | `tokenHash`, `deviceId`, `userAgent`, `ipAddress`, `lastSeenAt`, `expiresAt`, `revokedAt`, `revocationReason`. | `tokenHash` unique; index active session theo `userId`; chỉ lưu hash. |
| `PasswordResetToken` | Một lần reset mật khẩu. | `tokenHash`, `expiresAt`, `usedAt`. | `tokenHash` unique; FK user cascade; chỉ lưu hash. |
| `EmailVerificationToken` | Một lần xác minh email. | `tokenHash`, `expiresAt`, `usedAt`. | `tokenHash` unique; FK user cascade; chỉ lưu hash. |
| `UserGoal` | Mục tiêu học chủ động. | `targetLevelId`, `targetBand`, `dailyMinutes`, reminder, `startDate`, `isActive`. | Band phải thuộc khoảng level; phút/ngày dương; level `RESTRICT`. |
| `PlacementAttempt` | Kết quả kiểm tra đầu vào. | `status`, `score`, `detailSnapshot`, `recommendedLevelId`, `recommendedBand`, timestamps. | Trạng thái và timestamp hoàn thành phải nhất quán; recommended band phải thuộc level. |
| `LearningPlan` | Lộ trình học được sinh cho user. | `targetLevelId`, `targetBand`, `generatedFromPlacementId`, `status`, `startDate`, `endDate`. | Ngày kết thúc không trước ngày bắt đầu; target band hợp lệ. |
| `LearningPlanItem` | Bài học theo thứ tự trong lộ trình. | `lessonId`, `orderIndex`, `scheduledDate`, `status`, timestamps. | Unique `(learningPlanId, orderIndex)` và `(learningPlanId, lessonId)`. |
| `Consent` | Bằng chứng đồng ý chính sách. | `type`, `consentVersion`, `policyVersion`, `grantedAt`, `revokedAt`. | Unique `(userId, type, consentVersion)`; revoke không trước grant. |
| `DataExportJob` | Yêu cầu xuất dữ liệu cá nhân. | `status`, `outputStorageKey`, `outputExpiresAt`, timestamps, error fields. | Lifecycle timestamp hợp lệ; index queue theo status. |
| `AccountDeletionRequest` | Yêu cầu đóng/xóa tài khoản có kiểm soát. | `status`, `reason`, `verifiedAt`, `scheduledAt`, `completedAt`, `cancelledAt`, error fields. | FK `User` dùng `RESTRICT`; chưa cho xóa vật lý trực tiếp. |

## 4. Provenance và media — 2 bảng

| Bảng | Mục đích | Trường nghiệp vụ chính | Khóa và bất biến |
| --- | --- | --- | --- |
| `DataSource` | Registry nguồn, phiên bản, license và checksum. | `code`, `name`, `version`, URL, `license`, `attribution`, `receivedAt`, `importedAt`, `contentHash`, `notes`. | `code` unique; `(name, version)` unique; nguồn HSK thiếu license phải được xác minh trước production. |
| `Media` | Asset metadata độc lập storage provider. | `url`, `type`, MIME, size/duration, provider/key, filename, checksum, `processingStatus`, `metadata`, provenance, soft-delete. | `url` unique; `(storageProvider, storageKey)` unique; size/duration không âm; chỉ media `ready` nên được publish. |

## 5. Curriculum, dictionary và lesson content — 14 bảng

| Bảng | Mục đích | Trường nghiệp vụ chính | Khóa và bất biến |
| --- | --- | --- | --- |
| `Level` | Nhóm cấp độ HSK ổn định. | `name`, `code`, `orderIndex`, `minBand`, `maxBand`, `curriculumVersion`, publish/ownership/provenance. | `name`, `code`, `orderIndex` unique; chỉ `HSK1..HSK6, HSK7_9`; band bao phủ 1..9 không chồng. |
| `Lesson` | Đơn vị học theo level. | `levelId`, `title`, `description`, `orderIndex`, `slug`, cover, publish/ownership. | `slug` unique; `(levelId, orderIndex)` unique. |
| `Topic` | Phần nội dung trong lesson. | `lessonId`, `type`, `content`, `orderIndex`, premium/lock, publish/ownership. | `(lessonId, orderIndex)` unique; JSON `content` phải được DTO/schema runtime validate. |
| `Story` | Bài đọc/câu chuyện theo level, tùy chọn gắn lesson. | `levelId`, `lessonId`, `title`, `content`, `slug`, `orderIndex`, publish/ownership. | `slug` unique; trigger deferred bảo đảm story và lesson cùng level. |
| `Word` | Headword từ điển. | `hanzi`, `traditional`, `pinyin`, `pinyinNormalized`, tone, example, media, `isPure`, publish/ownership. | Unique `(hanzi, pinyin)`; pinyin normalized bắt buộc; public prefix search dùng partial `text_pattern_ops` index; soft-delete. |
| `WordSource` | Quan hệ nhiều nguồn cho một headword. | `dataSourceId`, `sourceKey`, `isPrimary`. | Unique `(wordId, dataSourceId)`; FK nguồn `RESTRICT`. |
| `WordMeaning` | Nghĩa có thứ tự và ngôn ngữ độc lập. | `meaningOrder`, EN/VI và bản normalized, POS, usage, note, provenance. | Unique `(wordId, meaningOrder)`; ít nhất một trong EN/VI có giá trị; không tự dịch EN thành VI. |
| `WordLevel` | Headword thuộc nhóm HSK nào và theo nguồn nào. | `wordId`, `levelId`, `dataSourceId`. | Unique `(wordId, levelId)`; provenance cho membership. |
| `LessonWord` | Từ được dạy trong lesson/topic. | `lessonId`, `topicId`, `wordId`, `orderIndex`. | Unique `(lessonId, wordId)`; trigger deferred bảo đảm topic thuộc chính lesson. |
| `Sentence` | Câu ví dụ tái sử dụng. | Hanzi, pinyin, nghĩa EN/VI, audio, publish/ownership/provenance. | Index tìm kiếm hanzi/pinyin; ít nhất nội dung Hanzi không rỗng. |
| `LessonWordExample` | Câu ví dụ của một từ trong lesson. | `lessonWordId`, `sentenceId`, `orderIndex`. | Unique `(lessonWordId, sentenceId)`. |
| `LessonSentence` | Câu xuất hiện độc lập trong lesson. | `lessonId`, `sentenceId`, `orderIndex`. | Unique `(lessonId, sentenceId)`. |
| `LessonExercise` | Bài tập tương tác thuộc lesson/topic. | `type`, `prompt`, `content`, `answer`, `explanation`, `version`, order, publish. | Trigger deferred bảo đảm topic cùng lesson; JSON được validate theo `ExerciseType`; version dương. |
| `PronunciationPractice` | Mục luyện phát âm theo word hoặc sentence. | `lessonId`, `topicId`, `wordId`/`sentenceId`, `targetType`, text/pinyin/audio, order, publish. | CHECK yêu cầu đúng một target tương ứng type; trigger bảo đảm topic cùng lesson. |

## 6. Learning, progress và SRS — 10 bảng

| Bảng | Mục đích | Trường nghiệp vụ chính | Khóa và bất biến |
| --- | --- | --- | --- |
| `LessonExerciseAttempt` | Lần nộp bài tập có snapshot. | `attemptNumber`, `answer`, `contentSnapshot`, `exerciseVersion`, score/correct, duration, feedback, `idempotencyKey`, `submittedAt`. | Unique `(userId, exerciseId, attemptNumber)` và `(userId, idempotencyKey)`; snapshot không phụ thuộc nội dung hiện tại. |
| `Progress` | Tổng hợp tiến độ user–lesson. | `status`, score, `completionPercent`, current topic/exercise, time, activity timestamps. | Unique `(userId, lessonId)`; percent 0..100, time không âm; current child được trigger kiểm tra thuộc lesson. |
| `UserTopicProgress` | Tiến độ chi tiết user–topic. | `status`, `completionPercent`, time và activity timestamps. | Unique `(userId, topicId)`; percent 0..100. |
| `LearningEvent` | Event học tập append-only để idempotent và analytics. | `type`, resource FKs, `idempotencyKey`, `metadata`, `occurredAt`. | Unique `(userId, idempotencyKey)`; trigger chặn UPDATE/DELETE. |
| `UserWord` | Danh sách từ user lưu. | `userId`, `wordId`, `createdAt`. | Unique `(userId, wordId)`. |
| `UserWordProgress` | Summary legacy tạm thời. | `status`, timestamps. | Unique `(userId, wordId)`; không phải source of truth SRS. |
| `ReviewCard` | Trạng thái scheduler của một user–word. | `state`, `dueAt`, interval, ease, repetitions, lapses, `lastReviewedAt`, `schedulerVersion`. | Unique `(userId, wordId)`; index due queue `(userId, state, dueAt)`; giá trị scheduler không âm/hợp lệ. |
| `ReviewSession` | Một phiên ôn tập. | `status`, `mode`, planned/reviewed count, `idempotencyKey`, `summary`, timestamps. | Unique `(userId, idempotencyKey)`; counters không âm và reviewed không vượt planned khi planned > 0. |
| `ReviewEvent` | Biến đổi SRS append-only. | Grade; state, due, interval, ease trước/sau; duration; idempotency; reviewed time. | Unique `(cardId, idempotencyKey)`; card/session phải cùng user; trigger chặn UPDATE/DELETE. |
| `PronunciationAttempt` | Lần luyện nói và kết quả chấm. | `practiceId`, audio, score, detail. | Score 0..100 khi có; index lịch sử theo user. |

## 7. CMS workflow, import và audit — 5 bảng

| Bảng | Mục đích | Trường nghiệp vụ chính | Khóa và bất biến |
| --- | --- | --- | --- |
| `ContentRevision` | Snapshot version của entity CMS. | `entityType`, `entityId`, `revision`, `snapshot`, `contentHash`, author. | Unique `(entityType, entityId, revision)`; append-only bằng trigger. |
| `ContentReview` | Quyết định review một revision. | reviewer, `decision`, `note`, timestamp. | Revision cascade; reviewer `SET NULL`; quyết định là enum. |
| `AuditLog` | Nhật ký thao tác quản trị/bảo mật. | actor, action, target, correlation, before/after summary, IP/UA. | Append-only bằng trigger; index actor, target và correlation. Không ghi secret/raw token. |
| `ImportJob` | Job validate/import file có thể retry. | provenance, entity type, status, `idempotencyKey`, filename/checksum, row counters, summary/timestamps. | Idempotency unique; counters không âm và không vượt total. |
| `ImportRowError` | Lỗi có địa chỉ theo dòng import. | `rowNumber`, `errorCode`, `message`, `normalizedPayload`. | Unique `(importJobId, rowNumber, errorCode)`; payload phải được loại secret/PII không cần thiết. |

## 8. Exam engine và result — 14 bảng

| Bảng | Mục đích | Trường nghiệp vụ chính | Khóa và bất biến |
| --- | --- | --- | --- |
| `Question` | Question bank tái sử dụng. | `type`, `skill`, media, `answers`, `correctAnswer`, explanation, level/difficulty/objective, version/hash, publish/ownership. | Không thuộc trực tiếp một group; question có thể được dùng trong nhiều test qua `TestQuestion`; difficulty 1..5. |
| `Tag` | Taxonomy câu hỏi. | `name`, `slug`. | Cả hai unique. |
| `QuestionTag` | Quan hệ question–tag. | `questionId`, `tagId`, timestamp. | Composite PK `(questionId, tagId)`. |
| `Test` | Đề thi có version và cửa sổ mở. | level, title/slug, instruction, duration, version/scoringVersion, attempt/pass limits, availability, publish/ownership. | Duration/version dương; availability hợp lệ; slug unique. |
| `TestSection` | Section theo skill trong test. | `skill`, title/instruction, `orderIndex`, duration. | Unique `(testId, orderIndex)` và `(id, testId)` để làm composite FK. |
| `QuestionGroup` | Stimulus/group nằm trong một section của đúng test. | `testId`, `sectionId`, content/media, `orderIndex`. | Composite FK `(sectionId, testId)`; unique `(id, sectionId, testId)`. |
| `TestQuestion` | Một question được chọn vào test. | `testId`, `questionId`, `orderIndex`. | Unique question và order trong mỗi test; question FK `RESTRICT`. |
| `TestQuestionPlacement` | Vị trí section/group đúng context của test. | `testQuestionId`, `testId`, `sectionId`, optional `groupId`, `orderIndex`. | Composite FK xuyên suốt test/section/group chặn cross-test placement; một placement mỗi `TestQuestion`. |
| `ExamAttempt` | Aggregate lần thi. | status, start/expiry/submit, remaining time, score/max, snapshot/scoring version, idempotency, invalidation. | Unique `(userId, idempotencyKey)`; user/test `RESTRICT`; lifecycle timestamp/score hợp lệ. |
| `ExamAttemptSnapshot` | Đề thi bất biến tại thời điểm start. | `testVersion`, `snapshotVersion`, `contentHash`, `payload`. | `attemptId` unique; trigger chặn UPDATE/DELETE. |
| `ExamAnswer` | Autosave answer theo key trong snapshot. | `snapshotQuestionKey`, optional live question FK, answer, flag, saved version, score/detail, save idempotency. | Unique `(attemptId, snapshotQuestionKey)` và `(attemptId, saveIdempotencyKey)`; history vẫn đúng khi question được sửa/xóa mềm. |
| `ExamAttemptEvent` | Timeline attempt append-only. | event type, `idempotencyKey`, payload, occurred time. | Unique `(attemptId, idempotencyKey)`; trigger chặn UPDATE/DELETE. |
| `Result` | Kết quả công bố, tương thích dữ liệu cũ và liên kết attempt mới. | user/test/attempt, score/max, passed, level/awardedBand, scoringVersion, detail, completion/publish. | `attemptId` unique; awardedBand phải thuộc Level của Test; trigger buộc cùng user/test và attempt đã final. |
| `ResultSkillScore` | Điểm thành phần theo skill. | `skill`, `score`, `maxScore`. | Unique `(resultId, skill)`; score 0..max. |

## 9. Hợp đồng JSON P0

Database chỉ kiểm tra được kiểu `jsonb`; API/service phải validate các contract sau trước khi ghi:

| Trường | Contract tối thiểu |
| --- | --- |
| `Topic.content` | Object có `schemaVersion`, các block có `type`, `order`, payload tương ứng; từ chối key không biết ở phiên bản đang chạy. |
| `Story.content` | Object có `schemaVersion`, paragraphs/blocks theo thứ tự; media tham chiếu bằng ID/key, không nhúng secret URL có thời hạn. |
| `LessonExercise.content` | Prompt assets/options/interaction config phù hợp `ExerciseType`. |
| `LessonExercise.answer` | Đáp án chuẩn và rule chấm; không trả về endpoint learner trước submit. |
| `LessonExerciseAttempt.contentSnapshot` | Bản đầy đủ cần để render/chấm lại, gồm exercise ID/version/hash và đáp án đã đóng băng nếu chính sách cho phép. |
| `PlacementAttempt.detailSnapshot` | Phiên bản thuật toán, input question keys, điểm theo kỹ năng và mapping level/band. |
| `LearningEvent.metadata` | Chỉ metadata analytics đã allow-list; không chứa raw token hoặc audio binary. |
| `ReviewSession.summary` | Scheduler version, tổng grade/state, duration; có `schemaVersion`. |
| `ContentRevision.snapshot` | Full snapshot entity đã normalize, có schema/content version. |
| `AuditLog.beforeSummary/afterSummary` | Summary đã redact password, token, correct answer nhạy cảm và PII không cần thiết. |
| `ImportJob.summary` | Counts, warnings, manifest/version; không thay thế `ImportRowError`. |
| `ExamAttemptSnapshot.payload` | Test/section/group/question placement, content và scoring metadata đã đóng băng; có `schemaVersion`. |
| `ExamAnswer.answer` | Answer typed theo question type; DTO giới hạn kích thước và cấu trúc. |
| `Result.detail` | Breakdown có `schemaVersion`, scoringVersion và snapshot hash. |

## 10. Ownership, xóa và lưu trữ

| Loại dữ liệu | Chính sách P0 |
| --- | --- |
| Nội dung CMS | Soft-delete bằng `deletedAt`; revision/audit không xóa khi nội dung đổi trạng thái. |
| Event/audit/snapshot | Append-only; chỉ retention job được phê duyệt mới archive/purge. |
| Session/token | Thu hồi trước, purge bản hết hạn theo job; token trong DB luôn là hash. |
| User privacy | `AccountDeletionRequest` điều phối; chuyển `deletion_pending`, revoke token/session, loại PII rồi chuyển `anonymized`. Không gọi `DELETE User` trực tiếp; xem ADR-001. |
| Media | Soft-delete metadata, xóa object storage sau grace period và khi không còn reference. |
| Import file | Lưu checksum/manifest lâu dài; raw file theo retention và license của nguồn. |
| Exam attempt/result | Giữ snapshot/scoring version để audit; không chấm lại lịch sử bằng content hiện tại. |

## 11. Backfill đã thực hiện và dữ liệu chưa được suy diễn

- Bảo toàn toàn bộ ID level hiện có; bổ sung `code`, band range và curriculum version tại chỗ.
- Chuẩn hóa `HSK7-9`/`HSK7_9` thành code ổn định `HSK7_9`, không tách thành ba level.
- Backfill `Word.pinyinNormalized`, trạng thái publish, `WordMeaning.meaningOrder` và normalized meanings.
- Gắn provenance baseline CC-CEDICT cho word/meaning hiện hữu; gắn nguồn raw HSK tương ứng cho `WordLevel`.
- Không tự dịch nghĩa tiếng Việt từ nghĩa tiếng Anh. `meaningVi` tiếp tục nullable cho tới khi có nguồn/biên tập hợp lệ.
- License của bảy raw list HSK chưa đủ bằng chứng nên được ghi `NULL` với cảnh báo; không được coi là production-cleared.
- Backfill `ReviewCard` từ dữ liệu user-word legacy khi có. `UserWordProgress` vẫn được giữ cho giai đoạn chuyển runtime.
- Với exam legacy, migration chỉ chuyển placement khi quan hệ không mơ hồ; nếu group/test không khớp thì migration dừng thay vì đoán.
- Hardening preflight không phát hiện band/SRS ownership sai trên local; không cần suy diễn hoặc sửa row. Shared pinyin normalizer cũng khớp toàn bộ 121.856 search key hiện hữu.

## 12. Ngoài phạm vi P0

Các module P1/P2 chưa được coi là schema hoàn tất: subscription/payment, social/community, gamification nâng cao, notification đa kênh, offline sync, teacher/classroom, AI tutor memory/evaluation, data warehouse/experimentation và lifecycle object-storage hoàn chỉnh. Mỗi module phải có ADR, threat model và migration riêng trước khi kích hoạt runtime.
