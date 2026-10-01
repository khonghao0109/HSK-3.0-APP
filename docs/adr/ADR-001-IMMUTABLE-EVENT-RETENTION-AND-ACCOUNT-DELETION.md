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

## Thời gian chờ 7 ngày (Product Owner chốt 30/09/2026)

Theo quyết định sản phẩm ngày 30/09/2026, quy trình xóa tài khoản bổ sung thời gian chờ 7 ngày để người dùng có thể đổi ý:

1. **Yêu cầu xóa tài khoản (`POST /users/me/deletion-request`):**
   - Xác thực lại bằng mật khẩu hiện tại (ngoài transaction, hash Argon2id với pepper). Sai mật khẩu trả về HTTP 400 `INVALID_PASSWORD` (không trả 401 để tránh BFF hủy session).
   - Trong transaction:
     - Khóa dòng user `FOR UPDATE`. Chỉ tài khoản `active` và `deletedAt IS NULL` mới được yêu cầu (ngược lại trả 404).
     - Idempotent: nếu đã có request `status = 'requested'`, trả lại request đó mà không tạo thêm dòng mới.
     - Tạo `AccountDeletionRequest` với `status = 'requested'`, `verifiedAt = CURRENT_TIMESTAMP`, `scheduledAt = CURRENT_TIMESTAMP + INTERVAL '7 days'`.
     - Chuyển `User.status` sang `deletion_pending`, cập nhật `deletedAt = CURRENT_TIMESTAMP`.
     - Thu hồi toàn bộ `UserSession` (`revokedAt = CURRENT_TIMESTAMP`); xóa mọi `PasswordResetToken` và `EmailVerificationToken` chưa sử dụng.
     - Enqueue 2 job nền trong cùng transaction:
       - `privacy.anonymize-account` với payload `{ requestId }`, `startAfter` = `scheduledAt` (lấy từ `RETURNING scheduledAt`), `singletonKey = 'anonymize:' + requestId`.
       - `mail.account-deletion-scheduled` với payload `{ requestId }`, `singletonKey = 'deletion-mail:' + requestId`.
     - Ghi `AuditLog` với `action = 'account.deletion_requested'`, `actorId = userId`, `targetType = 'User'`, `targetId = String(userId)`, `afterSummary = { requestId, scheduledAt }` (tuyệt đối không chứa email, reason hay PII).

2. **Huỷ yêu cầu bằng đăng nhập:**
   - Trong 7 ngày (`scheduledAt > CURRENT_TIMESTAMP`), người dùng có thể hủy yêu cầu bằng cách đăng nhập lại với mật khẩu chính xác qua `POST /auth/login`.
   - Luồng guard H.7: chỉ tài khoản `deletion_pending` còn hạn mới được verify hash thật. Tài khoản `suspended`, `anonymized` hoặc `deletion_pending` đã quá hạn đều đi qua hash mồi (decoy) và trả về 401 chung để chống rò rỉ trạng thái tài khoản.
   - Khi đăng nhập thành công trong thời gian chờ:
     - Trong transaction: khóa `AccountDeletionRequest` `FOR UPDATE`, cập nhật `status = 'cancelled'`, `cancelledAt = CURRENT_TIMESTAMP`.
     - Cập nhật `User.status = 'active'`, `deletedAt = NULL`, `failedLoginAttempts = 0`, `lockUntil = NULL`.
     - Ghi `AuditLog` với `action = 'account.deletion_cancelled'`, `afterSummary = { requestId }`.
     - Tạo session mới và cấp token đăng nhập bình thường.

3. **Xử lý ẩn danh qua Worker (`privacy.anonymize-account`):**
   - Chạy với policy `standard` (retry 3 lần với exponential backoff).
   - Trong transaction:
     - Khóa request `FOR UPDATE`. Nếu request không còn `requested` (đã `cancelled` hoặc `completed`), worker hoàn thành an toàn (idempotent).
     - Nếu `scheduledAt > CURRENT_TIMESTAMP` (chưa hết 7 ngày), worker bỏ qua mà không thay đổi gì.
     - Nếu đã quá hạn (`scheduledAt <= CURRENT_TIMESTAMP`), tiến hành ẩn danh:
       - Đổi `User.email` thành alias duy nhất `deleted+<id>@anonymized.invalid`, xóa `name = NULL`, đổi password hash thành chuỗi ngẫu nhiên không thể đăng nhập, đặt `status = 'anonymized'`.
       - Xóa PII trong `UserProfile`: đặt `displayName = NULL`, `avatarUrl = NULL`; giữ nguyên `locale` và `timezone`.
       - Xóa sạch mọi `UserSession`, `PasswordResetToken`, `EmailVerificationToken` của user.
       - Cập nhật request `status = 'completed'`, `completedAt = CURRENT_TIMESTAMP`.
       - Ghi `AuditLog` `action = 'account.anonymized'` với `afterSummary = { requestId }`.
       - Toàn bộ fact lịch sử (`Consent`, `LearningEvent`, bài thi, kết quả, tiến độ) được giữ nguyên theo surrogate `User.id`.

4. **Gửi thông báo lịch xoá (`mail.account-deletion-scheduled`):**
   - Chạy với policy `short`.
   - Nếu request không còn `requested`, bỏ qua.
   - Gửi email tiếng Việt tới địa chỉ email của người dùng thông báo thời điểm tài khoản sẽ bị xoá vĩnh viễn (được format theo `UserProfile.timezone`, mặc định `Asia/Ho_Chi_Minh`, locale `vi-VN`) cùng hướng dẫn đăng nhập lại tại `${APP_PUBLIC_URL}/login` trước thời điểm đó để hủy. Email tuyệt đối không chứa `reason` hay PII.

## Export dữ liệu (Product Owner duyệt 30/09/2026)

- **Định dạng và lưu trữ:** Dữ liệu cá nhân xuất ra dưới dạng MỘT file JSON duy nhất (`schemaVersion: 1`), lưu trữ tại private bucket qua `ObjectStoragePort` với khóa lưu trữ dạng `privacy-exports/<userId>/<exportId>-<hex>.json`.
- **Thời hạn khả dụng và lưu trữ:**
  - Người dùng có thể tải file trong vòng **24 giờ** kể từ khi worker hoàn tất (`outputExpiresAt = completedAt + 24 hours`).
  - File vật lý trong bucket private được dọn dẹp và xóa sau **7 ngày** kể từ khi xuất thành công (`completedAt < CURRENT_TIMESTAMP - INTERVAL '7 days'`) bởi cron job định kỳ `privacy.purge-expired-exports`.
- **Giới hạn tần suất (Rate limit):**
  - Tối đa 1 yêu cầu export trong vòng 24 giờ cho mỗi người dùng (dựa trên đồng hồ DB `CURRENT_TIMESTAMP`).
  - Chỉ tính các yêu cầu có trạng thái `requested`, `processing`, hoặc `completed`. Yêu cầu `failed` không bị tính vào giới hạn này.
- **Phương thức tải an toàn:**
  - Không sử dụng presigned URL để tránh rò rỉ token truy cập ra ngoài URL hoặc lịch sử duyệt web.
  - Tải trực tiếp qua endpoint có xác thực `GET /users/me/data-exports/:id/download` (`JwtAuthGuard`). Endpoint kiểm tra quyền sở hữu, trạng thái hoàn tất, hạn khả dụng và kiểm tra mã checksum SHA-256 đối soát từ storage trước khi trả về với các header an toàn (`Content-Type`, `Content-Disposition`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`).
- **Xử lý nền và tính toàn vẹn (Worker `privacy.data-export`):**
  - Chạy bất đồng bộ qua queue `privacy.data-export` với retry policy `standard` (tối đa 3 lần).
  - Đọc dữ liệu trong transaction cô lập `RepeatableRead` để bảo đảm tính nhất quán của snapshot.
  - Áp dụng nguyên tắc `EXPORT_COVERAGE`: toàn bộ model liên kết với `User` phải được phân loại rõ ràng thành `included` hoặc `excluded` (với lý do cụ thể). Không bao giờ xuất credentials, secret tokens (`password`, `tokenHash`, `failedLoginAttempts`, `lockUntil`).
  - Giới hạn dung lượng: Đọc dữ liệu theo lô (như `LearningEvent` theo lô 1.000 dòng). Nếu kích thước vượt quá giới hạn an toàn 10 MB (`MAX_PRIVATE_MEDIA_OBJECT_BYTES`), job dừng sớm, đánh dấu `status = 'failed'` với `errorCode = 'EXPORT_TOO_LARGE'` mà không ném lỗi (không retry vô ích).
