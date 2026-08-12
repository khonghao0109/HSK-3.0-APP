# HSK Content Workbench — Frontend

Frontend Next.js App Router cho HSK 3.0. Slice hiện tại cung cấp nền tảng frontend,
đăng nhập admin qua BFF an toàn và console chỉ đọc cho `LessonExercise`.

## Phạm vi đã có

- `/login`: đăng nhập admin; browser không nhận hoặc lưu bearer token.
- `/admin/exercises`: danh sách phân trang/lọc server-side theo Lesson, Topic,
  type và status.
- `/admin/exercises/:id`: content, authoritative answer dành riêng cho admin,
  provenance, safe media projection và revision/review history.
- `/admin/media`: inventory phân trang/lọc bằng URL, semantic desktop table và
  labelled tablet/mobile record list.
- `/admin/media/:id`: safe metadata/provenance/reference, quarantine và soft
  archive có audit; không trả URL/storage secret.
- `/forbidden`, not-found, loading, empty, upstream-error và session-expired states.
- Responsive 390/768/1440 px, keyboard flow, reduced motion và axe WCAG checks.

Không có UI create/review/publish/archive/import Exercise. Media upload/ingestion,
restore, hard-delete và binary delivery chưa có; Media V1 chỉ quản trị an toàn asset
đã tồn tại.

## Kiến trúc bảo mật

Browser chỉ gọi BFF same-origin. `POST /api/session/login` kiểm tra Origin, gọi
backend theo allowlist và đặt access token vào cookie `HttpOnly`, `SameSite=Lax`,
`Secure` ở production. `Max-Age` không vượt `exp` của JWT. Mỗi protected layout
gọi backend `/auth/me`; role/account hiện tại trong database là nguồn quyết định.

Protected Server Components đưa missing/invalid/expired session thẳng tới
`/login?reason=session` bằng origin lấy duy nhất từ `APP_ORIGIN` đã validate;
không dựng redirect từ request URL hoặc `Host`. Login boundary gọi
`POST /api/session/recover` ở same origin để revalidate token. Response recovery
không được phép mutate cookie: response 204 dùng header trạng thái giới hạn;
backend 401/403 mới tạo trạng thái `invalid`, và coordinator tuần tự gọi exact-origin logout để
xóa cookie cũ **trước** khi gửi login. 5xx/network fail closed, hiển thị retry và
không xóa cookie. Vì login không chạy song song với operation có thể clear cookie,
và stale recovery response không có `Set-Cookie`, response cũ không thể xóa session
mới. Credentials vẫn nằm trong input khi người dùng submit trong lúc kiểm tra.
Các API này không tham gia page/RSC navigation. Logout chủ động vẫn chỉ dùng exact-origin
`POST /api/session/logout`; không có GET logout.

`BACKEND_API_URL` chỉ tồn tại server-side. Không dùng `NEXT_PUBLIC_API_URL`,
`localStorage` hay `sessionStorage` cho credentials. Fetch admin dùng `no-store`,
timeout hữu hạn và lỗi đã sanitize. BFF không phải generic proxy.

Giới hạn V1: logout xóa frontend cookie nhưng backend chưa có refresh/revocation
session API. Hết hạn token yêu cầu đăng nhập lại. Xem
`../docs/adr/ADR-003-FRONTEND-FOUNDATION-ADMIN-SESSION-BFF.md`.

Production dùng CSP nonce sinh ngẫu nhiên cho từng request trong `src/proxy.ts`.
Nonce được chuyển vào request để Next.js gắn vào framework/page scripts và được
trả trong response CSP. `script-src` production không dùng `unsafe-inline` hoặc
`unsafe-eval`; `media-src` hiện chỉ cho `'self'`. Do nonce cần request-time
rendering, root layout chủ động dynamic và không dùng static/ISR/PPR caching.
Matcher không chạy cho API, Next static/image, favicon/sitemap/robots hoặc router
prefetch (`next-router-prefetch`, `purpose: prefetch`). Vì vậy document request
vẫn có nonce riêng, còn JSON API/prefetch không mint nonce; các security header
chung trong `next.config.ts` vẫn áp dụng.

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

`APP_ORIGIN` phải là origin HTTP(S) tuyệt đối, không có credentials, path, query
hoặc fragment. Ví dụ `http://127.0.0.1:3200` được giữ nguyên, không canonicalize
sang `localhost`.

Backend local phải pin `ALLOWED_ORIGINS=http://127.0.0.1:3200`. Không commit file
`.env.local` hoặc credentials.

## Quality gate không cần database

`next-env.d.ts` là generated artifact do `next typegen`, `next dev` và
`next build` quản lý. File được Git/Prettier ignore, không được sửa hoặc track.
`typecheck` luôn chạy `next typegen` trước `tsc` để route types không phụ thuộc
thứ tự command hoặc artifact còn sót từ local development.

```bash
npm run test:generated-types
npm run format:check
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
```

Kiểm tra production headers sau `npm run build`:

```bash
npm run start -- --hostname 127.0.0.1 --port 3200
curl -sS -D - -o /dev/null http://127.0.0.1:3200/login
```

Hai request liên tiếp phải có nonce khác nhau. CSP không được chứa
`script-src 'unsafe-inline'`, `'unsafe-eval'` hoặc `media-src https:`. Response
phải có HSTS, `nosniff`, Referrer-Policy, Permissions-Policy và frame denial.
`/api/session/me` và request có `purpose: prefetch` không được có CSP nonce,
nhưng vẫn phải giữ các security header chung.

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
`npm run test:e2e` build và chạy production server trên Chromium ở desktop 1440,
mobile 390 và tablet 768. Không ghi số case cố định trong tài liệu; lấy kết quả từ
gate gần nhất.

## Cấu trúc chính

```text
src/app/                 App Router pages, protected layouts, BFF routes
src/features/auth/       runtime contracts, session handlers, login UI
src/features/admin-shell navigation and account shell
src/features/exercises/  query contract, server fetch, list/detail UI
src/features/media/      safe contract, URL query, list/detail/lifecycle UI
src/lib/api/             allowlisted backend client and safe errors
src/lib/auth/            HttpOnly cookie lifecycle
src/lib/security/        production CSP construction and nonce validation
src/proxy.ts             per-request CSP nonce boundary
scripts/                 portable generated-artifact regression runner
e2e/                     real-backend Playwright flows
```

Quyết định UI/token/responsive nằm trong `DESIGN.md`.

## UI reference mapping

- `/login` và `/login?reason=session`: **No direct reference — visual regression
  checked against existing UI.** `docs/ui_image/01-onboarding-placement.png` là
  consumer onboarding mobile, không phải admin login spec. Closeout chỉ thêm text
  pending/error/retry trong component button/error hiện có, không redesign.
- `/admin/exercises` và `/admin/exercises/:id`: admin CMS module, đối chiếu
  `docs/ui_image/06-admin-cms-operations.png`; closeout session không đổi layout,
  spacing, typography hay visual language của console.
- `/admin/media` và `/admin/media/:id`: admin CMS module, đối chiếu trực tiếp
  `docs/ui_image/06-admin-cms-operations.png`. List giữ hierarchy sidebar/filter/
  table/badge/pagination; detail và narrow-screen record list là suy luận có kiểm
  soát từ cùng visual language vì ảnh không có frame riêng cho các state này.

Media decision và explicit upload non-goal:
`../docs/adr/ADR-004-MEDIA-ASSET-OPERATIONS-AND-ADMIN-LIBRARY.md`.
