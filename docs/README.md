# Tài liệu HSK 3.0 APP

Nền tảng học, ôn và thi HSK 1–9 (bảy nhóm curriculum `HSK1`…`HSK6`, `HSK7_9`).
Monorepo gồm `backend/` (NestJS 11 + Prisma 5 + PostgreSQL), `frontend/`
(Next.js 16 App Router), `ai/` (chưa có runtime), `ops/` (nginx, observability).

Cập nhật cấu trúc tài liệu: 04/09/2026.

## Đọc theo thứ tự

1. [PLAN.md](./PLAN.md) — tiến độ dự án theo giai đoạn và từng bước, có tích xanh.
   Đây là nơi duy nhất ghi "đã làm / đang làm / chưa làm".
2. [product/roadmap.md](./product/roadmap.md) — tầm nhìn, ma trận năng lực, thứ tự
   milestone M0–M7, KPI, risk register.
3. [architecture/overview.md](./architecture/overview.md) — kiến trúc, layout repo,
   module, quy ước API/bảo mật, biến môi trường, lệnh chạy, quy tắc cho dev và AI agent.
4. [api/api.md](./api/api.md) — hợp đồng HTTP: Part A là endpoint đã có code,
   Part B là endpoint dự kiến.
5. [adr/](./adr/) — quyết định kiến trúc ADR-001…008. Đọc ADR trước khi sửa vùng liên quan.

## Cấu trúc thư mục

```text
docs/
  README.md                     # file này
  PLAN.md                       # tiến độ theo giai đoạn/bước
  product/
    roadmap.md                  # tầm nhìn và milestone
    functional-hierarchy.md     # cây chức năng User/Admin, ưu tiên P0/P1/P2
    assets/                     # ảnh kiến trúc concept
  architecture/
    overview.md                 # kiến trúc và quy ước hiện hành
  api/
    api.md                      # hợp đồng HTTP đã có / dự kiến
  adr/                          # ADR-001 … ADR-008
  database/
    P0_DATA_DICTIONARY.md       # ngữ nghĩa bảng/cột và invariant
    P0_ERD.md                   # ERD logic theo bounded context
    P0_SCHEMA_MIGRATION_RUNBOOK.md  # cách chạy, kiểm chứng và phục hồi migration
  operations/
    MEDIA_INGESTION_RELEASE_RUNBOOK.md  # vận hành/release Media
  process/
    engineering-process.md      # nguyên tắc, gate, Definition of Done
  reviews/
    2026-09-04-codebase-review.md   # kết quả review toàn dự án, mã finding A-01…G-02
  ui_image/                     # 36 mockup page-level, nguồn thiết kế UI
  archive/                      # tài liệu lịch sử đã bị thay thế, chỉ để tra cứu
```

## Nguồn sự thật theo thứ tự

1. Code runtime, `backend/prisma/schema.prisma`, migration và test trên HEAD hiện tại.
2. ADR và runbook viết từ chính HEAD đó.
3. `PLAN.md` cho trạng thái, `product/roadmap.md` cho thứ tự delivery.
4. `ui_image/` cho thiết kế UI khi triển khai màn hình.

Schema, mockup hay tài liệu "sẵn sàng" không được tính là chức năng đã hoàn thành.
Chỉ tích xanh trong `PLAN.md` khi có entry point, contract và test trong repo.

## Quy tắc bảo trì tài liệu

- Thay đổi endpoint, DTO hoặc hành vi thì sửa `api/api.md` và `PLAN.md` trong cùng PR.
- Quyết định khó đảo ngược (auth, storage, event, provider, hạ tầng) đi kèm một ADR mới,
  đánh số tiếp theo; không sửa nội dung ADR đã Accepted, hãy viết ADR thay thế.
- Tài liệu lỗi thời chuyển vào `archive/` kèm một dòng ghi rõ bị thay thế bởi gì;
  không để hai tài liệu cùng nói về một trạng thái.
- Không sao chép số liệu test, checksum hay số migration vào nhiều nơi; dẫn link tới
  runbook hoặc `PLAN.md`.

## Bắt đầu nhanh

```bash
# Backend
cd backend && npm install && cp .env.example .env   # điền DATABASE_URL, JWT_SECRETS...
npm run start:dev                                   # http://localhost:3000/api/v1

# Frontend (cần backend chạy ở BACKEND_API_URL)
cd frontend && npm install && cp .env.example .env
npm run dev
```

Chi tiết lệnh kiểm thử, tên database disposable và cách chạy e2e nằm trong
[architecture/overview.md](./architecture/overview.md) mục "Lệnh chạy và kiểm thử".
