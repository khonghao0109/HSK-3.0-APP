# Kiến trúc và quy ước hiện hành

Cập nhật 04/09/2026 theo HEAD `3211bf8` và worktree. Tài liệu này thay thế
`PROJECT_CONTEXT_FOR_AI.md`. Chỉ ghi những gì có trong code; kế hoạch nằm ở
[../PLAN.md](../PLAN.md), thứ tự delivery ở [../product/roadmap.md](../product/roadmap.md),
quyết định ở [../adr/](../adr/).

## 1. Sản phẩm

Nền tảng web học, ôn và thi HSK theo bảy nhóm curriculum `HSK1`…`HSK6` và `HSK7_9`
(band 7–9). Hai vai trò: người học (`role=user`) và quản trị (`role=admin`). Luồng lõi:
đăng ký → chọn mục tiêu và lộ trình → học bài → làm activity → lưu tiến độ → tra từ và ôn
SRS → thi thử → xem kết quả. Hiện mới có backend cho onboarding, learning read, activity,
progress, dictionary search và admin CMS/media; learner UI chưa có.

## 2. Layout repo

```text
HSK-3.0-APP/
  backend/            # NestJS 11 + Prisma 5 + PostgreSQL, API /api/v1
    src/modules/      # auth, cms, dictionary, health, learning, media, onboarding, user
    src/common/       # guards, decorators, pipes, policies, validation, utils
    src/config/       # app, database, jwt, media config; env.validation (Joi); runtime-security
    src/infrastructure/  # storage (S3 + in-memory), malware (ClamAV + test), observability
    src/prisma/       # PrismaModule/PrismaService
    prisma/           # schema.prisma + 19 migration (SQL viết tay)
    scripts/          # dictionary pipeline, seed, operations (migrate wrapper), security (secret scan), test runners
    test/             # e2e (11 file) + database/*.sql (16 file)
  frontend/           # Next.js 16.3 App Router, React 19, TypeScript strict
    src/app/          # (auth)/login, admin/exercises, admin/media, api/session/*, api/admin/*
    src/features/     # auth, admin-shell, exercises, media
    src/lib/          # api client, auth cookie, config, security (CSP)
    e2e/              # Playwright + axe
  ai/                 # placeholder rỗng (4 file 0 byte); xem ADR-008 §6
  mobile/             # CHƯA TỒN TẠI. Dự kiến M7.7: React Native + Expo (ADR-008 §1)
  packages/contracts/ # CHƯA TỒN TẠI. Tách từ frontend/src/features/*/*-contract.ts khi có mobile
  ops/
    nginx/            # media-security.conf, media-security-http.conf
    observability/    # prometheus, alertmanager, grafana, kustomize, toolchain, evidence policy
  docs/               # xem docs/README.md
  .github/workflows/  # media-release-evidence.yml (chỉ chạy khi push tag v3.0.0)
```

Không có root `package.json`, Dockerfile, docker-compose, `.nvmrc`. Mỗi package dùng npm
lockfile riêng (ADR-003). Root `package.json` với npm workspaces chỉ xuất hiện cùng
`mobile/` và `packages/contracts/` (ADR-008 §1).

## 3. Backend

### 3.1 Stack

NestJS 11 (Express adapter), TypeScript, Prisma 5.22, PostgreSQL, `@nestjs/jwt` +
Passport JWT (HS256, header `kid` để xoay secret), argon2id + pepper, class-validator
+ class-transformer cho DTO, Joi cho env, `@nestjs/throttler`, `@aws-sdk/client-s3`,
`sharp`, `music-metadata`, Jest 30 + Supertest.

### 3.2 Module runtime

| Module | Prefix | Chức năng | ADR |
| --- | --- | --- | --- |
| `auth` | `/auth` | register, login, me; lockout 5 lần/15 phút; JWT 7 ngày | — |
| `user` | `/users` | me; danh sách user cho admin | — |
| `onboarding` | `/onboarding`, `/learning-plans` | goal + learning plan V1, row lock theo user | — |
| `learning` | `/levels`, `/lessons`, `/topics`, `/stories`, `/learning/*`, `/progress` | public content read có readiness policy; lesson/topic start-complete; exercise attempt chấm server-side; progress/resume | — |
| `dictionary` | `/dictionary` | prefix search hanzi/pinyin, 20 kết quả | — |
| `cms` | `/admin/cms/*` | lesson/topic/exercise revision → review → publish → archive; exercise import preview + commit; media library, quarantine/archive; media ingestion | ADR-002, 004, 005 |
| `media` | `/media` | cấp signed URL và trả nội dung private | ADR-005 |
| `health` | `/health` | `SELECT 1` | — |

Thư mục `infrastructure/`: `storage` (port `ObjectStoragePort`, adapter S3 và in-memory),
`malware` (port scanner, adapter ClamAV INSTREAM và test), `observability` (metrics
listener riêng, cardinality cố định). Adapter được chọn theo `NODE_ENV === 'test'`
(xem finding B-04 trong review).

### 3.3 Quy ước API thực tế

- Prefix `/api/v1`; versioning theo path.
- Auth: `Authorization: Bearer <jwt>` cho route có `JwtAuthGuard`; strategy đọc lại
  `status`/`deletedAt`/`role` từ DB mỗi request nên khoá tài khoản có hiệu lực ngay.
- Validation toàn cục: `whitelist`, `forbidNonWhitelisted`, `transform`; field lạ →
  400 với path `$.$unknown`; boolean chỉ nhận JSON boolean thật.
- Envelope: learning, onboarding, activity, CMS, media trả `{ success: true, data,
  meta? }`; auth, users, dictionary trả object/array trần; health trả shape riêng.
  Chưa có interceptor toàn cục (xem [../api/api.md](../api/api.md) §1).
- Lỗi: body mặc định của Nest `{ statusCode, message, error }`; validation trả
  `{ code, message, errors }`; một số lỗi domain trả `{ code, message }`.
- Pagination: `page ≥ 1`, `limit 1..100` mặc định 20, `meta { page, limit, total,
  totalPages }`; không có `sortBy/sortOrder`.
- Idempotency: header `Idempotency-Key` cho activity write (8–128 ký tự), exercise
  import commit (8–128) và media ingestion (32–128); replay trả kết quả gốc, cùng key
  khác body → 409.
- Mọi `POST` trả `201` kể cả replay (chưa dùng `@HttpCode`).
- Throttle toàn cục 20 req/phút/IP (register 100, login 200); xem finding A-02.

### 3.4 Invariant nghiệp vụ

- Public read chỉ trả `status = published` và `deletedAt IS NULL`. Lesson chỉ "ready"
  khi Level cha published và có ít nhất một Topic hoặc Story published. Public lesson
  không trả `LessonExercise.answer`, không trả `speaking_repeat`, listening chỉ khi
  audio `ready` và URL không rỗng.
- CMS: `ContentRevision`, `ContentReview`, `AuditLog` append-only (trigger DB). Hash
  revision dùng canonical JSON (khoá sắp xếp, NFKC) không phụ thuộc locale. Lock order
  publish: `User` admin `FOR SHARE` → `Lesson`/`Topic`/`LessonExercise` `FOR UPDATE` →
  `Media` `FOR SHARE` khi listening. Import: lock actor → `DataSource` → parent theo id
  tăng dần; interactive transaction `maxWait 5s`, `timeout 30s`; tối đa 100 dòng.
- Activity: write serialize theo `User`; scorer chấm `mcq`, `listening_choice`,
  `fill_blank`, `arrange_sentence` trên server; attempt và `LearningEvent` bất biến;
  progress derive từ event, không nhận score/progress/userId từ client.
- Onboarding: mỗi user một goal và một plan active, bảo vệ bằng `SELECT … FOR UPDATE`
  trên `User` (chưa có unique index, finding C-04); plan chỉ chứa lesson ready.
- Media: object key UUID do server sinh; ba lớp kiểm MIME; scan ClamAV trước khi ghi
  object; `MediaIngestion` có state machine và fencing ở DB; signed URL HMAC-SHA256
  gồm method, path, expiry, checksum; TTL 60–600 giây.
- Migration forward-only, viết tay SQL, có preflight; không sửa migration đã áp.

### 3.5 Bảo mật và cấu hình

- Production bắt buộc `NODE_ENV=production`; `assertProductionSecrets` yêu cầu mọi
  secret ≥ 32 byte sau decode, entropy đủ, không placeholder, không trùng nhau.
- `ALLOWED_ORIGINS` là danh sách origin chính xác; production chỉ nhận HTTPS, từ chối
  wildcard, userinfo, path, query.
- Header API: nosniff, `X-Frame-Options: DENY`, Referrer-Policy no-referrer,
  Permissions-Policy, CSP `default-src 'none'`. HSTS chỉ ở TLS edge.
- Bootstrap fail-closed: lỗi cấu hình không log object env; metrics listener riêng bind
  trước public listener.
- Password: argon2id (64 MiB, t=3) + `AUTH_PASSWORD_PEPPER`.

### 3.6 Biến môi trường

Backend (`backend/.env.example`):

| Biến | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `NODE_ENV` | có | `development` / `production` / `test` |
| `PORT` | mặc định 3000 | |
| `DATABASE_URL` | có | Prisma; có thể kèm `?schema=public` |
| `TEST_DATABASE_URL` | khi chạy test DB | cùng host/db với `DATABASE_URL`, không query param; tên DB phải khớp `(test\|e2e\|verify\|disposable\|hardening)` |
| `JWT_SECRETS` | có | JSON `{ "kid": "secret" }` |
| `JWT_ACTIVE_KID` | có | kid dùng để ký |
| `JWT_EXPIRES_IN` | mặc định `7d` | |
| `AUTH_PASSWORD_PEPPER` | production | ≥ 16 ký tự ngoài production |
| `ALLOWED_ORIGINS` | production | mặc định loopback 3001 ngoài production |
| `MEDIA_STORAGE_BUCKET`, `MEDIA_STORAGE_REGION` | ngoài test | S3-compatible |
| `MEDIA_STORAGE_ENDPOINT` | tuỳ chọn | phải HTTPS |
| `MEDIA_SIGNING_SECRET` | ngoài test | ≥ 32 |
| `MEDIA_ACCESS_TTL_SECONDS` | mặc định 300 | 60–600 |
| `MEDIA_SCANNER_HOST`, `MEDIA_SCANNER_PORT` | ngoài test | ClamAV, mặc định 3310 |
| `MEDIA_INGESTION_ENABLED` | mặc định false | kill switch upload |
| `MEDIA_UPLOAD_TIMEOUT_MS` | mặc định 30000 | 1000–120000 |
| `MEDIA_METRICS_BEARER_TOKEN` (+`_PREVIOUS`) | ngoài test | scrape token |
| `MEDIA_METRICS_HOST`, `MEDIA_METRICS_PORT` | production | listener riêng, khác `PORT` |
| `MEDIA_METRICS_DB_STATEMENT_TIMEOUT_MS` < `MEDIA_METRICS_COLLECTION_TIMEOUT_MS` | mặc định 750/1000 | |
| `MEDIA_METRICS_CACHE_TTL_MS` < `MEDIA_METRICS_STALE_TTL_MS` | mặc định 5000/60000 | |

Frontend (`frontend/.env.example`): `BACKEND_API_URL` (server-only), `APP_ORIGIN`,
`BFF_REQUEST_TIMEOUT_MS` (8000), `SESSION_COOKIE_NAME` (`hsk_admin_session`),
`PLAYWRIGHT_BASE_URL`, `E2E_ADMIN_EMAIL/PASSWORD`, `E2E_USER_EMAIL/PASSWORD`.
Không có biến `NEXT_PUBLIC_*`.

## 4. Database

- 59 model, 27 enum, 19 migration; runtime hiện chạm 23 model. Exam (14 model), SRS,
  privacy chỉ có schema.
- Migration là SQL viết tay với ~45 trigger, ~32 function, ~100 CHECK; Prisma
  introspection không thấy các object này, nên `prisma migrate dev` không dùng được.
- Tài liệu: [../database/P0_DATA_DICTIONARY.md](../database/P0_DATA_DICTIONARY.md),
  [../database/P0_ERD.md](../database/P0_ERD.md),
  [../database/P0_SCHEMA_MIGRATION_RUNBOOK.md](../database/P0_SCHEMA_MIGRATION_RUNBOOK.md).

## 5. Frontend

- Next.js 16.3 App Router, React 19, TypeScript 6 strict, Zod 4, CSS variables theo
  `frontend/DESIGN.md` (không Tailwind, không CSS-in-JS), Vitest + RTL, Playwright + axe.
- Same-origin BFF: browser không cầm bearer token; token nằm trong cookie HttpOnly,
  SameSite=Lax, Secure ở production, `Max-Age` bằng `exp` của JWT. Route handler
  `api/session/{login,logout,me,recover}` và `api/admin/{exercises,media}` kiểm Origin,
  allowlist path backend bằng regex, `cache: 'no-store'`, timeout 8 giây, lột bỏ field
  nhạy cảm (ADR-003, ADR-004).
- `proxy.ts` (thay middleware) chỉ sinh CSP nonce; chốt auth nằm ở `app/admin/layout.tsx`
  và trong từng page.
- Route hiện có: `/login`, `/forbidden`, `/admin/exercises[/[id]]`, `/admin/media[/[id]]`;
  root redirect tới `/admin/exercises`. Chưa có learner UI.
- Thiết kế: 36 mockup trong [../ui_image/README.md](../ui_image/README.md).
- Mobile: React Native + Expo tại `mobile/` (ADR-008 §1), chưa có code. Mobile không đi
  qua BFF; gọi backend trực tiếp với bearer token trong `expo-secure-store`. Bắt đầu ở
  PLAN M7.7 sau khi M1.4, H.2, H.4, H.10 xong.

## 6. Dữ liệu và scripts

- `backend/scripts/dictionary/`: `raw/` (HSK 1–7-9 txt/json, `cedict_ts.u8` CC BY-SA
  4.0), `parse.ts`, `normalize.ts`, `map-level.ts`, `build-final.ts`, `convert-hsk.ts`,
  `seed.ts`; output `parsed/` (121.856 word, 200.156 nghĩa tiếng Anh, 11.086 mapping
  word-level). Nghĩa tiếng Việt và license HSK list chưa xác minh (roadmap R1).
- `backend/scripts/levels/seed.ts`, `backend/scripts/learning/seed-*.ts`,
  `backend/scripts/test/seed-frontend-admin-console.ts` (fixture cho Playwright).
- `backend/scripts/operations/`: wrapper `prisma migrate deploy` có timeout,
  resolver migration 19, render observability.
- `backend/scripts/security/`: secret scan + allowlist theo fingerprint.
- `backend/scripts/test/media-*`: harness release-evidence (xem finding A-04, ADR-008 §8).

## 7. Ops

- `ops/nginx/`: fragment bảo vệ signed content và chặn `/metrics`.
- `ops/observability/`: Prometheus rules + unit test, Alertmanager, Grafana dashboard,
  kustomize cho private metrics network, toolchain pin, producer policy.
- Workflow duy nhất `media-release-evidence.yml` chạy khi push tag `v3.0.0` trên
  self-hosted linux/amd64; không có CI cho PR.

## 8. AI

`ai/services/rag-api` là placeholder rỗng. Quyết định runtime, DB và provider ở
[../adr/ADR-008-TECHNOLOGY-STACK-DECISIONS.md](../adr/ADR-008-TECHNOLOGY-STACK-DECISIONS.md) §6.
Backend không chứa module AI.

## 9. Lệnh chạy và kiểm thử

Backend (`cd backend`):

| Lệnh | Cần DB? | Ghi chú |
| --- | --- | --- |
| `npm run start:dev` | có | dev server |
| `npm run lint:check`, `npm run format:check`, `npx tsc --noEmit` | không | |
| `npm test` | không | jest unit, rootDir `src`, 51 suite |
| `npm run test:e2e` | có, disposable | `NODE_ENV=test`, `DATABASE_URL` và `TEST_DATABASE_URL` trỏ cùng DB tên hợp lệ; migrate trước bằng `npm run build && npm run migrate:deploy:production` |
| `npm run test:db:p0`, `test:db:concurrency`, `test:db:cms-concurrency`, `test:db:activity-*`, `test:db:exercise-*`, `test:db:media-*` | có, fresh migration-only | runner concurrency để lại fixture; mỗi lần chạy lại cần DB mới |
| `npm run test:ops:media:unit`, `npm run test:security:secrets` | không | node:test |
| `npm run test:ops:media` | tải tool | release harness, chỉ PASS ở profile linux-amd64 |
| `npm run seed:learning`, `npm run test:seed:frontend-console` | có | seed |

Frontend (`cd frontend`): `npm run dev`, `npm run lint`, `npm run typecheck`
(chạy `next typegen` trước), `npm test` (vitest), `npm run test:e2e` (build + Playwright,
cần backend thật ở `BACKEND_API_URL` và DB đã seed console), `npm run test:generated-types`.

Chưa có docker-compose; xem PLAN.md hạng mục F-01.

## 10. Quy tắc cho dev và AI agent

1. Đọc `docs/README.md`, `PLAN.md` và ADR liên quan trước khi sửa vùng nào.
2. Không suy đoán chức năng từ schema, mockup hay tên file; chỉ tin code, test và
   migration trên HEAD.
3. Mọi thay đổi endpoint/DTO/hành vi phải cập nhật `docs/api/api.md`, test và `PLAN.md`
   trong cùng PR.
4. Không hard-delete row có lịch sử; không sửa migration đã áp; không lưu token trong
   browser storage; không trả `answer` ra public.
5. Quyết định khó đảo ngược đi kèm ADR mới.
6. Không thêm Redis, queue, microservice, framework state mới khi chưa có bằng chứng
   tải theo ADR-008.
7. Tài liệu viết tiếng Việt có dấu; code, commit và identifier viết tiếng Anh.

## 11. Bản đồ tài liệu

| Cần biết | Đọc |
| --- | --- |
| Trạng thái từng bước | `docs/PLAN.md` |
| Thứ tự milestone, KPI, risk | `docs/product/roadmap.md` |
| Chức năng theo vai trò và ưu tiên | `docs/product/functional-hierarchy.md` |
| Hợp đồng HTTP | `docs/api/api.md` |
| Quyết định kiến trúc | `docs/adr/` |
| Ngữ nghĩa bảng, ERD, cách chạy migration | `docs/database/` |
| Vận hành và release media | `docs/operations/MEDIA_INGESTION_RELEASE_RUNBOOK.md` |
| Gate, DoD, nguyên tắc | `docs/process/engineering-process.md` |
| Kết quả review mã | `docs/reviews/` |
| Thiết kế UI | `docs/ui_image/` |
| Đặc tả chi tiết phase tương lai | `docs/archive/PRODUCT_IMPLEMENTATION_MASTER_PLAN.md` |
