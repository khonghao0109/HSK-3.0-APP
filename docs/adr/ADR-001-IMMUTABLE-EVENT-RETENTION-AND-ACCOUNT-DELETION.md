# ADR-001: Immutable event retention & account deletion policy

- Status: Accepted
- Date: 2026-08-10
- Scope: Web MVP P0
- Related migrations: `20260810113000_p0_integrity_hardening`, `20260810143000_p0_integrity_concurrency_serialization`

## Context

`LearningEvent`, `ReviewEvent`, `ExamAttemptSnapshot`, `ExamAttemptEvent`, `ContentRevision` và `AuditLog` là các fact lịch sử append-only. Một số foreign key cũ dùng `CASCADE` hoặc `SET NULL`; khi parent bị hard-delete, PostgreSQL cố xóa/cập nhật fact và bị immutable trigger chặn bằng lỗi khó hiểu.

Sản phẩm đồng thời cần đáp ứng yêu cầu xóa tài khoản mà không phá lịch sử học, SRS, bài thi, audit hoặc khả năng tái lập kết quả.

## Decision

MVP không hard-delete `User`, `Lesson`, `ReviewSession` hoặc immutable/history fact. Xóa tài khoản là quy trình lifecycle + anonymization, không phải `DELETE FROM "User"`.

### Account deletion workflow

1. Tạo `AccountDeletionRequest`; xác minh người yêu cầu và chuyển request sang `processing`.
2. Chuyển `User.status` sang `deletion_pending`, đặt `deletedAt`, chặn login ngay.
3. Revoke toàn bộ `UserSession`; vô hiệu hóa/xóa `PasswordResetToken` và `EmailVerificationToken` còn hiệu lực.
4. Loại PII: thay email bằng alias không thể gửi thư và unique theo user ID, xóa `name`; xóa `displayName`, `avatarUrl` và metadata định danh trong `UserProfile`; thay password hash bằng giá trị ngẫu nhiên không thể đăng nhập.
5. Chuyển `User.status` sang `anonymized`; đánh dấu `AccountDeletionRequest.completedAt` và `status = completed`.
6. Giữ stable surrogate `User.id` để các fact lịch sử còn integrity, nhưng không còn email/tên/profile nhận diện người thật.

Implementation của bước 4 phải chạy trong transaction, idempotent theo deletion request và ghi audit đã privacy-minimize. API không được nhận raw email alias/password hash từ client.

### Dữ liệu bị xóa hoặc vô hiệu hóa

- Session/refresh-token hash, reset token và verification token còn hiệu lực.
- Tên, email có thể liên hệ, avatar và profile identity fields.
- Dữ liệu tạm/export object đã hết retention; private media theo policy object storage riêng.
- Derived/personal state không cần giữ có thể purge bằng privacy job riêng sau khi retention được duyệt; không xóa qua cascade từ `User`.

### Dữ liệu được ẩn danh nhưng giữ lại

- `User` giữ `id`, lifecycle timestamp và trạng thái `anonymized`; PII bị thay/xóa.
- Actor/owner reference trong event, attempt, result, revision và audit tiếp tục trỏ tới surrogate user đã ẩn danh.
- Metadata IP/user-agent phải được privacy-minimize ngay khi ghi và có retention ngắn; không ghi secret hoặc raw token vào AuditLog/event.

### Dữ liệu lịch sử được giữ nguyên

- `LearningEvent`, `ReviewEvent`, `ReviewSession` đã có event.
- `LessonExerciseAttempt`, `PronunciationAttempt`.
- `ExamAttempt`, `ExamAttemptSnapshot`, `ExamAnswer`, `ExamAttemptEvent`, `Result` và skill score.
- `ContentRevision`, `ContentReview`, `AuditLog`.
- Lesson/content đã được sử dụng trong lịch sử được archive/soft-delete bằng `status`/`deletedAt`, không hard-delete.

## Database enforcement

- FK từ immutable fact sang parent dùng `RESTRICT`, thay cho `CASCADE`/`SET NULL` có thể kích hoạt immutable trigger.
- Boundary FK đã harden dùng cả `ON DELETE RESTRICT` và `ON UPDATE RESTRICT`; primary key của parent không được cascade để viết lại identity trong history fact.
- `ReviewEvent.sessionId` dùng `RESTRICT`; ReviewEvent còn được kiểm tra card/session cùng user.
- `ReviewCard.userId` và `ReviewSession.userId` là ownership field immutable. Chuyển card/session sang tài khoản khác bị database từ chối ngay cả khi chưa có ReviewEvent.
- ReviewEvent khóa parent theo thứ tự `ReviewCard → ReviewSession`; curriculum result khóa theo `Test → Level` để bảo toàn invariant khi có concurrent write.
- `ReviewCard`, `ReviewSession`, historical attempt và Result dùng `User` FK `RESTRICT` tại các boundary lịch sử.
- API/service chịu trách nhiệm soft-delete/anonymization. Database không tự cascade một account deletion request thành mất lịch sử.
- Acceptance test yêu cầu hard-delete hoặc đổi primary key User/Lesson/ReviewSession đã có fact trả về `foreign_key_violation`, không phải lỗi immutable-trigger.

## Consequences

- Privacy job phức tạp hơn hard-delete, nhưng lịch sử chấm điểm/audit có thể tái lập và không bị orphan.
- `User.id` trở thành pseudonymous key sau anonymization; analytics/export phải tiếp tục áp dụng access control.
- Cần triển khai worker/API deletion idempotent trước khi mở chức năng xóa tài khoản cho beta.
- Mọi thay đổi retention tương lai phải dùng ADR và forward migration mới; không sửa migration P0 đã áp.
