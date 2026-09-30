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
