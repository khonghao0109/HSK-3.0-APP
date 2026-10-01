# Vận hành Worker Process và Job Processing (pg-boss)

Tài liệu hướng dẫn vận hành tiến trình worker xử lý job nền cho backend HSK 3.0 APP (M1.7a).

## 1. Tổng quan kiến trúc

- Worker chạy như một process độc lập với Main API process (`backend/src/worker.ts`), dùng chung database PostgreSQL nhưng tách biệt vòng đời và tài nguyên.
- Main API chỉ enqueue job vào schema `pgboss` (với `supervise: false`).
- Worker process phụ trách giám sát queue, lập lịch cron và consume xử lý jobs (với `supervise: true`).
- Kiến trúc queue dựa trên `pg-boss` 12.35.0 (không dùng Redis theo ADR-008 §2).

## 2. Cách chạy và dừng

### Khởi động trong môi trường phát triển (development)
```bash
cd backend
npm run start:worker:dev
```

### Khởi động trong môi trường production
```bash
cd backend
npm run build
npm run start:worker
```
Lệnh thực thi trực tiếp: `node dist/src/worker.js`.

### Dừng tiến trình (Graceful Shutdown)
- Gửi tín hiệu `SIGTERM` hoặc `SIGINT` đến tiến trình worker (ví dụ khi container dừng hoặc quản lý tiến trình systemd/PM2 reload):
```bash
kill -SIGTERM <worker-pid>
```
- Cơ chế shutdown:
  1. Worker dừng nhận job mới (`boss.stop({ graceful: true, timeout: 30000 })`), đợi các job đang xử lý hoàn thành trong thời gian chờ.
  2. Đóng ứng dụng NestJS context (`app.close()`), qua đó hook `PgBossLifecycle` và `PrismaService.onModuleDestroy` ngắt kết nối an toàn.
  3. Thoát an toàn với exit code 0 (`Worker stopped`).
- Cơ chế đảm bảo idempotency: tiến trình có cờ `isStopping` chặn xử lý shutdown trùng lặp khi nhận nhiều tín hiệu liên tiếp.

## 3. Biến môi trường cần thiết

| Tên biến | Bắt buộc | Giá trị mẫu / Ghi chú |
| --- | --- | --- |
| `NODE_ENV` | Có | `production` / `development` / `test` |
| `DATABASE_URL` | Có | Chuỗi kết nối PostgreSQL (ví dụ `postgresql://user:pass@host:5432/hsk_system?schema=public`) |
| `JOB_QUEUE_PROVIDER` | Tuỳ chọn | Mặc định `pgboss`. Giá trị `memory` chỉ cho phép trong `NODE_ENV=test` |
| `MAIL_PROVIDER` | Tuỳ chọn | Mặc định `ses`. Giá trị `mailpit` cho development/test; `memory` chỉ cho `NODE_ENV=test` |
| `MAIL_FROM` | Có | Địa chỉ email người gửi hợp lệ (ví dụ `noreply@hsk.local` hoặc `auth@hsk.edu.vn`) |
| `MAIL_SES_REGION` | Khi `ses` | AWS Region của SES (ví dụ `ap-southeast-1`) |
| `MAIL_MAILPIT_URL` | Khi `mailpit` | URL dịch vụ Mailpit local (chỉ cho phép `127.0.0.1` hoặc `localhost`, ví dụ `http://127.0.0.1:8025`) |
| `APP_PUBLIC_URL` | Tuỳ chọn | URL công khai của web app (mặc định `http://localhost:3000`). Bắt buộc HTTPS ở production; không chứa path/query/hash. Dùng để tạo link xác thực trong email. |

> [!IMPORTANT]
> Payload job gửi mail chỉ chứa `userId`. Worker tự sinh raw token lúc xử lý job, chỉ lưu SHA-256 vào bảng token; raw token chỉ xuất hiện trong nội dung mail gửi đi, không bao giờ nằm trong `pgboss.job`, log hay `cause` của lỗi.

## 4. Quản lý kết nối Database Pool

- Worker process sử dụng Prisma và pg-boss.
- pg-boss cấu hình kết nối pool tối đa 4 kết nối (`max: 4`) để phục vụ các luồng polling và duy trì heartbeat, tránh chiếm dụng pool connection của API chính.

## 5. Danh sách Jobs và Lịch trình (Cron)

### `session.purge-expired` (Hằng số `JOB_NAMES.PURGE_EXPIRED_SESSIONS`)
- **Mục đích**: Tự động dọn dẹp các bản ghi phiên đăng nhập `UserSession` đã hết hạn quá 30 ngày (cả active lẫn revoked).
- **Lịch chạy**: Hàng ngày lúc 03:17 UTC (`17 3 * * *`).
- **Chính sách**:
  - `retryLimit: 3`, `retryBackoff: true`.
  - Giới hạn xử lý an toàn: Xoá theo lô tối đa 1.000 dòng mỗi vòng lặp, tối đa 1.000 vòng lặp mỗi lần chạy để tránh khóa bảng lâu hoặc làm chậm DB.
  - Sử dụng đồng hồ DB (`CURRENT_TIMESTAMP`) để tránh lệch múi giờ giữa các máy chủ.

### `mail.email-verification` (Hằng số `JOB_NAMES.SEND_EMAIL_VERIFICATION`)
- **Mục đích**: Gửi email xác thực tài khoản kèm link kích hoạt dùng một lần khi đăng ký mới hoặc khi người dùng yêu cầu gửi lại link xác thực.
- **Trigger**: Enqueue bất đồng bộ từ Main API (`POST /auth/register` trong cùng transaction với `user.create`, hoặc `POST /auth/email-verification/request`).
- **Payload**: `{ userId: number }` (tuyệt đối không chứa raw token, email, hay thông tin nhạy cảm).
- **Singleton key**: `email-verification:<userId>` (chống enqueue trùng lặp trong thời gian chờ xử lý).
- **Chính sách**:
  - Queue options: `policy: 'short'`, `retryLimit: 3`, `retryBackoff: true`.
  - Skip điều kiện: User không tồn tại, đã soft-deleted (`deletedAt IS NOT NULL`), trạng thái không `active`, hoặc đã xác thực (`emailVerifiedAt IS NOT NULL`) -> hoàn tất job, không gửi mail.
  - Sinh token và lưu trữ: Trong 1 transaction database, xoá toàn bộ token xác thực chưa dùng của user (`usedAt IS NULL`), sinh raw token ngẫu nhiên an toàn bằng `crypto.randomBytes(32).toString('base64url')` (43 ký tự), băm SHA-256 lưu vào bảng `EmailVerificationToken` với TTL 24 giờ (`expiresAt = CURRENT_TIMESTAMP + INTERVAL '24 hours'`).
  - Gửi mail: Sau khi transaction commit thành công, gửi email plain text tiếng Việt qua `MailerPort` với link `${APP_PUBLIC_URL}/verify-email#token=<rawToken>`.
  - Quản lý lỗi:
    - `MailDeliveryError` với `retryable: true` -> throw để pg-boss retry (mỗi lần retry sẽ xoá token cũ và sinh token mới).
    - Lỗi không retryable (`retryable: false`) -> ghi log cảnh báo chứa `jobId` và `error.name` (không log email, token hay error cause), hoàn tất job mà không throw.

### `mail.password-reset` (Hằng số `JOB_NAMES.SEND_PASSWORD_RESET`)
- **Mục đích**: Gửi email đặt lại mật khẩu kèm link chứa token dùng một lần khi người dùng yêu cầu quên mật khẩu.
- **Trigger**: Enqueue bất đồng bộ từ Main API (`POST /auth/password-reset/request`).
- **Payload**: `{ userId: number }` (tuyệt đối không chứa raw token, email, hay thông tin nhạy cảm).
- **Singleton key**: `password-reset:<userId>` (chống enqueue trùng lặp trong thời gian chờ xử lý).
- **Chính sách**:
  - Queue options: `policy: 'short'`, `retryLimit: 3`, `retryBackoff: true`.
  - Skip điều kiện: User không tồn tại, đã soft-deleted (`deletedAt IS NOT NULL`), hoặc trạng thái không `active` -> hoàn tất job, không gửi mail.
  - Sinh token và lưu trữ: Trong 1 transaction database, xoá toàn bộ reset token chưa dùng của user (`usedAt IS NULL`), sinh raw token ngẫu nhiên an toàn bằng `crypto.randomBytes(32).toString('base64url')` (43 ký tự), băm SHA-256 lưu vào bảng `PasswordResetToken` với TTL 30 phút (`expiresAt = CURRENT_TIMESTAMP + INTERVAL '30 minutes'`).
  - Gửi mail: Sau khi transaction commit thành công, gửi email plain text tiếng Việt qua `MailerPort` với link `${APP_PUBLIC_URL}/reset-password#token=<rawToken>`.
  - Quản lý lỗi:
    - `MailDeliveryError` với `retryable: true` -> throw để pg-boss retry (mỗi lần retry sẽ xoá token cũ và sinh token mới).
    - Lỗi không retryable (`retryable: false`) -> ghi log lỗi chứa `jobId` và `error.name` (không log email, token hay error cause), hoàn tất job mà không throw.

### `privacy.anonymize-account` (Hằng số `JOB_NAMES.ANONYMIZE_ACCOUNT`)
- **Mục đích**: Thực hiện ẩn danh dữ liệu người dùng sau khi hết thời gian chờ 7 ngày theo ADR-001.
- **Trigger**: Enqueue bất đồng bộ trong cùng transaction với `POST /users/me/deletion-request`.
- **Payload**: `{ requestId: number }` (chỉ chứa ID của yêu cầu xoá, tuyệt đối không chứa PII).
- **Lập lịch trì hoãn (`startAfter`)**: Đặt đúng bằng `scheduledAt` lấy từ kết quả `RETURNING scheduledAt` của câu lệnh INSERT `AccountDeletionRequest` (sử dụng đồng hồ PostgreSQL, sau 7 ngày). Job nằm ở trạng thái `created` và không được worker fetch cho đến khi đến mốc `startAfter`.
- **Singleton key**: `anonymize:<requestId>` (đảm bảo mỗi yêu cầu xoá chỉ có duy nhất 1 job ẩn danh trong queue).
- **Chính sách**:
  - Queue options: `policy: 'standard'`, `retryLimit: 3`, `retryBackoff: true`.
  - Idempotency & Skip:
    - Request không tồn tại -> cảnh báo, bỏ qua (return `false`).
    - Request không còn ở trạng thái `requested` (đã `cancelled` do người dùng đăng nhập lại, hoặc đã `completed`) -> hoàn tất an toàn (return `true`).
    - Thời gian hiện tại chưa vượt quá `scheduledAt` (chưa hết thời gian chờ) -> hoàn tất mà không đổi DB (return `true`).
  - Xử lý ẩn danh (trong transaction có khóa row `FOR UPDATE`):
    - Đổi `User.email` thành alias duy nhất `deleted+<id>@anonymized.invalid`, xoá `name = NULL`, thay mật khẩu bằng hash ngẫu nhiên không thể đăng nhập, đặt `status = 'anonymized'`.
    - Xoá thông tin hồ sơ `UserProfile`: đặt `displayName = NULL`, `avatarUrl = NULL`; giữ nguyên `locale` và `timezone`.
    - Xoá toàn bộ `UserSession`, `PasswordResetToken`, `EmailVerificationToken` của user.
    - Cập nhật `AccountDeletionRequest.status = 'completed'`, gán `completedAt = CURRENT_TIMESTAMP`.
    - Ghi `AuditLog` với `action = 'account.anonymized'`, `afterSummary = { requestId }`.
    - Giữ nguyên toàn bộ fact lịch sử (`Consent`, `LearningEvent`, bài thi, kết quả, tiến độ).
- **Xử lý sự cố Dead-letter / Job fail hết số lần retry**:
  - Nếu job gặp lỗi bất thường và cạn số lần retry (chuyển sang dead-letter hoặc failed):
  - Định kỳ hoặc khi có cảnh báo, kỹ sư vận hành chạy truy vấn tìm các yêu cầu xoá còn kẹt:
    ```sql
    SELECT id, "userId", status, "scheduledAt"
    FROM "AccountDeletionRequest"
    WHERE status = 'requested'
      AND "scheduledAt" < CURRENT_TIMESTAMP - INTERVAL '1 day';
    ```
  - Sau khi xác định nguyên nhân lỗi (ví dụ trigger database hoặc timeout mạng), tiến hành re-enqueue job bằng script nội bộ hoặc gọi handler trực tiếp trong tiến trình worker.

### `mail.account-deletion-scheduled` (Hằng số `JOB_NAMES.SEND_ACCOUNT_DELETION_SCHEDULED`)
- **Mục đích**: Gửi email thông báo cho người dùng về lịch xoá tài khoản vĩnh viễn và cách đăng nhập lại để huỷ.
- **Trigger**: Enqueue bất đồng bộ trong cùng transaction với `POST /users/me/deletion-request`.
- **Payload**: `{ requestId: number }`.
- **Singleton key**: `deletion-mail:<requestId>`.
- **Chính sách**:
  - Queue options: `policy: 'short'`, `retryLimit: 3`, `retryBackoff: true`.
  - Skip điều kiện: Request không tồn tại, trạng thái không phải `requested`, thiếu `scheduledAt` hoặc thiếu thông tin user -> bỏ qua (return `false`).
  - Format thời gian: Lấy múi giờ từ `UserProfile.timezone` của người dùng (mặc định `Asia/Ho_Chi_Minh` nếu chưa cấu hình hồ sơ), format thời điểm xoá theo locale `vi-VN`.
  - Nội dung email: Plain text tiếng Việt thông báo thời điểm xoá vĩnh viễn và hướng dẫn đăng nhập lại tại `${APP_PUBLIC_URL}/login` trước thời điểm đó. Tuyệt đối không chèn lý do (`reason`), tên hoặc PII vào email.
  - Quản lý lỗi:
    - `MailDeliveryError` với `retryable: true` -> throw để pg-boss retry.
    - Lỗi vĩnh viễn (`retryable: false`) -> ghi log lỗi chứa `jobId` và `error.name`, hoàn tất job mà không throw.

### `privacy.data-export` (Hằng số `JOB_NAMES.DATA_EXPORT`)
- **Mục đích**: Thu thập và xuất toàn bộ dữ liệu cá nhân của người dùng thành 1 file JSON lưu trong private object storage theo chính sách bảo mật (ADR-001).
- **Trigger**: Enqueue bất đồng bộ trong cùng transaction với `POST /users/me/data-exports`.
- **Payload**: `{ exportId: number }`.
- **Singleton key**: `export:<exportId>`.
- **Chính sách**:
  - Queue options: `policy: 'standard'`, `retryLimit: 3`, `retryBackoff: true`.
  - Idempotency & Trạng thái:
    - Khóa dòng `DataExportJob` bằng `FOR UPDATE`.
    - Status khác `requested` hoặc `processing` -> kết thúc idempotent (return `true`).
    - Chuyển `status = 'processing'`, `startedAt = CURRENT_TIMESTAMP`.
  - Đọc dữ liệu trong transaction cô lập `RepeatableRead` (snapshot nhất quán) dựa trên hằng số kiểm định `EXPORT_COVERAGE` với thuật toán fixpoint bắc cầu (phân loại mọi model có `userId`, quan hệ tới `User`, hoặc là quan hệ con tới các model trong `included` thành `included` hoặc `excluded` có lý do rõ ràng).
  - Cấu trúc export và bảng con lồng nhau:
    - `learningPlans[].items`: Chứa danh sách các bài học đã lên lịch (`LearningPlanItem`).
    - `reviewCards[].events`: Chứa lịch sử đánh giá thẻ ôn tập (`ReviewEvent`), đọc theo lô 1.000, chuyển đổi `id` kiểu BigInt sang String, loại bỏ trường kỹ thuật `idempotencyKey`.
    - `examAttempts[].answers`: Chứa câu trả lời của các lần thi (`ExamAnswer`), đọc theo lô 1.000, loại bỏ trường kỹ thuật `saveIdempotencyKey`.
    - `examAttempts[].events`: Chứa sự kiện thi (`ExamAttemptEvent`), chuyển đổi `id` kiểu BigInt sang String, loại bỏ trường kỹ thuật `idempotencyKey`.
    - `results[].skillScores`: Chứa điểm thành phần từng kỹ năng của kết quả thi (`ResultSkillScore`).
    - Bảng `ExamAttemptSnapshot` được đưa vào `excluded` do là bản sao nội dung đề thi tại thời điểm thi, không phải dữ liệu do người học tạo ra.
  - Cắt ngắn và giới hạn dung lượng: Đọc các bảng có khả năng phát triển lớn (`ReviewEvent`, `ExamAnswer`, `LearningEvent`) theo các lô 1.000 bản ghi (sắp xếp `id ASC`), kiểm tra tổng dung lượng tích luỹ. Nếu vượt quá `MAX_PRIVATE_MEDIA_OBJECT_BYTES` (10 MB), dừng đọc ngay và đánh dấu job `status = 'failed'`, `errorCode = 'EXPORT_TOO_LARGE'`, không ném lỗi ra ngoài (không retry vô ích).
  - Tải lên storage: Tạo key ngẫu nhiên `privacy-exports/<userId>/<exportId>-<hex 16 bytes>.json`, tính checksum SHA-256 (64 hex characters) và gọi `putPrivateObject` của `ObjectStoragePort`. Nếu lưu trữ lỗi -> throw exception để pg-boss retry.
  - Hoàn tất: Cập nhật `status = 'completed'`, `outputStorageKey`, `completedAt = CURRENT_TIMESTAMP`, `outputExpiresAt = CURRENT_TIMESTAMP + INTERVAL '24 hours'`.
  - Bảo mật log: Log chỉ ghi `exportId`, `jobId`, `error.name`. Tuyệt đối không log storage key, token, email hay dữ liệu cá nhân.

### `privacy.purge-expired-exports` (Hằng số `JOB_NAMES.PURGE_EXPIRED_EXPORTS`)
- **Mục đích**: Tự động dọn dẹp các file JSON dữ liệu xuất đã hoàn thành quá 7 ngày trong private storage để giải phóng dung lượng và bảo vệ dữ liệu cá nhân.
- **Lịch chạy**: Hằng giờ tại phút thứ 0 (`0 * * * *`).
- **Chính sách**:
  - `retryLimit: 3`, `retryBackoff: true`.
  - Quét các export có `completedAt < CURRENT_TIMESTAMP - INTERVAL '7 days'` và còn `outputStorageKey IS NOT NULL`, xử lý theo lô tối đa 100 bản ghi mỗi lần chạy.
  - Gọi `deletePrivateObject(outputStorageKey)` trên `ObjectStoragePort`. Nếu storage trả về lỗi `not_found`, coi như đối tượng đã được xoá an toàn trước đó.
  - Cập nhật `outputStorageKey = NULL` và `updatedAt = CURRENT_TIMESTAMP`.

### Xử lý sự cố: Export kẹt ở trạng thái `processing`
- **Nguyên nhân**: Tiến trình worker bị tắt đột ngột (crash, OOM, node reboot) trong lúc đang xử lý snapshot hoặc upload storage, khiến `status` của `DataExportJob` vẫn giữ `processing` dù pg-boss job có thể đã kết thúc hoặc chuyển sang retry.
- **Phát hiện**:
  Truy vấn tìm các export job kẹt ở `processing` quá 30 phút:
  ```sql
  SELECT id, "userId", status, "startedAt", "createdAt"
  FROM "DataExportJob"
  WHERE status = 'processing'
    AND "startedAt" < CURRENT_TIMESTAMP - INTERVAL '30 minutes';
  ```
- **Xử lý**:
  1. Kiểm tra trạng thái job tương ứng trong schema `pgboss.job`:
     ```sql
     SELECT id, name, state, retry_count, output
     FROM pgboss.job
     WHERE name = 'privacy.data-export'
       AND data->>'exportId' = '<exportId>';
     ```
  2. Nếu job trong pg-boss đã failed hoặc không còn tồn tại:
     Chuyển `DataExportJob` sang trạng thái `failed` với mã lỗi thích hợp để giải phóng giới hạn rate limit 24h cho người dùng:
     ```sql
     UPDATE "DataExportJob"
     SET status = 'failed',
         "errorCode" = 'PROCESSING_TIMEOUT',
         "errorMessage" = 'Job timed out or worker restarted during processing',
         "completedAt" = CURRENT_TIMESTAMP,
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE id = <exportId> AND status = 'processing';
     ```
  3. Người dùng sau đó có thể thực hiện yêu cầu xuất dữ liệu mới qua `POST /users/me/data-exports`.


