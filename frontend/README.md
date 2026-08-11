# HSK Content Workbench — Frontend

Frontend Next.js App Router cho HSK 3.0. Slice hiện tại cung cấp nền tảng frontend,
đăng nhập admin qua BFF an toàn và console chỉ đọc cho `LessonExercise`.

## Phạm vi đã có

- `/login`: đăng nhập admin; browser không nhận hoặc lưu bearer token.
- `/admin/exercises`: danh sách phân trang/lọc server-side theo Lesson, Topic,
  type và status.
- `/admin/exercises/:id`: content, authoritative answer dành riêng cho admin,
  provenance, safe media projection và revision/review history.
- `/forbidden`, not-found, loading, empty, upstream-error và session-expired states.
- Responsive 390/768/1440 px, keyboard flow, reduced motion và axe WCAG checks.

Không có UI create/review/publish/archive/import. Media Library chỉ là nhãn “Next”,
không phải module đã triển khai.

## Kiến trúc bảo mật

Browser chỉ gọi BFF same-origin. `POST /api/session/login` kiểm tra Origin, gọi
backend theo allowlist và đặt access token vào cookie `HttpOnly`, `SameSite=Lax`,
`Secure` ở production. `Max-Age` không vượt `exp` của JWT. Mỗi protected layout
gọi backend `/auth/me`; role/account hiện tại trong database là nguồn quyết định.

`BACKEND_API_URL` chỉ tồn tại server-side. Không dùng `NEXT_PUBLIC_API_URL`,
`localStorage` hay `sessionStorage` cho credentials. Fetch admin dùng `no-store`,
timeout hữu hạn và lỗi đã sanitize. BFF không phải generic proxy.

Giới hạn V1: logout xóa frontend cookie nhưng backend chưa có refresh/revocation
session API. Hết hạn token yêu cầu đăng nhập lại. Xem
`../docs/adr/ADR-003-FRONTEND-FOUNDATION-ADMIN-SESSION-BFF.md`.

## Yêu cầu

- Node.js 22, 24 hoặc 26
- npm 10+
- Backend NestJS chạy cổng `3100`
- PostgreSQL theo chính sách database của backend

## Cài đặt và chạy local

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 3200
```

Các biến server-only:

```dotenv
BACKEND_API_URL=http://127.0.0.1:3100
APP_ORIGIN=http://127.0.0.1:3200
BFF_REQUEST_TIMEOUT_MS=8000
SESSION_COOKIE_NAME=hsk_admin_session
```

Backend local phải pin `ALLOWED_ORIGINS=http://127.0.0.1:3200`. Không commit file
`.env.local` hoặc credentials.

## Quality gate không cần database

```bash
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
```

## Playwright với backend thật

Chỉ dùng database disposable mới, tên kết thúc bằng `_test`/`_e2e` theo backend
guard. Không chạy seed hoặc browser test trên `hsk_system`, staging hay production.

```bash
# backend — database mới, migration-only
NODE_ENV=test \
DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/hsk_frontend_console_test?schema=public' \
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/hsk_frontend_console_test' \
npx prisma migrate deploy

# seed một lần; script dừng trước khi ghi nếu database không còn fresh
NODE_ENV=test \
DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/hsk_frontend_console_test?schema=public' \
TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/hsk_frontend_console_test' \
AUTH_PASSWORD_PEPPER='test-pepper-at-least-16-characters' \
npm run test:seed:frontend-console

# frontend — backend phải đang chạy ở 3100 với cùng database
npx playwright install chromium
npm run test:e2e
```

Credential mặc định chỉ dành cho fixture disposable được ghi trong `.env.example`.
Playwright chạy 12 case trên Chromium ở desktop 1440, mobile 390 và tablet 768.

## Cấu trúc chính

```text
src/app/                 App Router pages, protected layouts, BFF routes
src/features/auth/       runtime contracts, session handlers, login UI
src/features/admin-shell navigation and account shell
src/features/exercises/  query contract, server fetch, list/detail UI
src/lib/api/             allowlisted backend client and safe errors
src/lib/auth/            HttpOnly cookie lifecycle
e2e/                     real-backend Playwright flows
```

Quyết định UI/token/responsive nằm trong `DESIGN.md`.
