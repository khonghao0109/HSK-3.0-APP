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

