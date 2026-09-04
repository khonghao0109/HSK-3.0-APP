# Review toàn dự án — 04/09/2026

Baseline: branch `macdev`, HEAD `3211bf8` cộng worktree chưa commit. Mọi kiểm tra
hermetic được chạy thật: tsc, eslint, prettier, jest (51 suite / 596 test), node:test
ops (129), secret scan (15), vitest (23 file / 101 test). Không chạy e2e, test DB, build
image hay lệnh chạm hạ tầng thật.

Mã finding (A-01 … G-02) được `PLAN.md` dùng để theo dõi. Mức độ: P0 chặn release,
P1 bảo mật/toàn vẹn phải sửa trước beta, P2 nên sửa trước beta, P3 vệ sinh mã.

## Kết luận

Nền backend và kỷ luật kỹ thuật cao hơn mức thường thấy ở pre-beta, nhưng đang tối ưu
sai chỗ: 31.121 dòng tooling release-evidence cho một tính năng media chưa có người
dùng, trong khi learner app chưa có màn hình nào và CI cơ bản chưa tồn tại. Nợ thật
nằm ở lớp kết nối: rate limit sau proxy, contract API, session lifecycle, khả năng chạy
test.

## A. Chặn release (P0)

| Mã | Vấn đề | Vị trí | Hướng xử lý |
| --- | --- | --- | --- |
| A-01 | Không có CI cho sản phẩm; workflow duy nhất chỉ chạy khi push tag `v3.0.0` và luôn fail vì producer policy HOST_ACCEPTANCE_REQUIRED | `.github/workflows/media-release-evidence.yml:3-6`, `ops/observability/media-evidence-producers.json` | `ci.yml` trên PR: backend prisma validate/lint/tsc/jest/e2e với Postgres service; frontend lint/typecheck/vitest; required checks |
| A-02 | Throttler theo `req.ip` không có trust proxy; BFF không forward IP; sau nginx/BFF mọi người dùng chung bucket 20 req/phút, kể cả `/media/:id/content` | `backend/src/app.module.ts:28-35`, `backend/src/main.ts`, `frontend/src/lib/api/backend-client.ts`, `ops/nginx/media-security.conf:37-39` | `trust proxy` theo hop, nginx gửi X-Forwarded-For, tracker theo `req.user.id ?? req.ip`, store chia sẻ khi nhiều replica |
| A-03 | Bốn hình dạng response; không APP_INTERCEPTOR/APP_FILTER; `meta.requestId` không tồn tại; lỗi là default Nest | `main.ts`, `auth.service.ts:57,135`, `user.service.ts:9`, `dictionary.service.ts:56`, `health.service.ts:18` | Chọn một envelope, thêm interceptor + filter toàn cục, echo `x-request-id` |
| A-04 | Harness release-evidence 31.121 dòng, gấp 2× backend/src; hard-code `v3.0.0` ở 5 file; verify image bên thứ ba trong khi dự án chưa có Dockerfile | `backend/scripts/test/media-*`, `scripts/operations/*`, `media-evidence-producer-policy.ts:4,78,81` | Đóng băng; giữ alert unit test, nginx fragment, k8s manifest, wrapper migrate rút gọn; thay bằng action chuẩn (ADR-008 §8) |

## B. Bảo mật và định danh

| Mã | Mức | Vấn đề | Vị trí | Hướng xử lý |
| --- | --- | --- | --- | --- |
| B-01 | P1 | Lockout đếm read-modify-write, request song song vượt qua; login nới 200 req/phút/IP; argon2 64 MiB mỗi lần verify | `auth.service.ts:66-79,100-117`, `auth.controller.ts:32` | `{ increment: 1 }` hoặc FOR UPDATE; login ~10/phút/IP + throttle theo email |
| B-02 | P1 | Nhánh `hash === password` cho row không phải argon2id | `auth.service.ts:177-179` | Xoá fallback; row lạ buộc reset |
| B-03 | P1 | JWT 7 ngày, không revoke/refresh; `UserSession` chưa dùng; logout chỉ xoá cookie | `jwt.config.ts:18`, `session-route-handlers.ts:165-173` | Access 15 phút + refresh xoay vòng lưu hash vào UserSession |
| B-04 | P1 | `NODE_ENV=test` thay storage in-memory, scanner EICAR, secret mặc định, ingestion bật, throttle 1000 | `storage.module.ts:16`, `malware.module.ts:16`, `env.validation.ts:57-91` | `MEDIA_STORAGE_PROVIDER`/`MEDIA_SCANNER_PROVIDER` tường minh, assert lúc boot |
| B-05 | P1 | `GET /users` không phân trang, không lọc soft-delete; `/users/me` trả user đã xoá | `user.service.ts:10-39` | PaginationQueryDto + where visibility |
| B-06 | P2 | Enumeration qua 401/403/timing; register trả 401 "Email already exists"; frontend gộp 403 lockout thành "không phải admin" | `auth.service.ts:35-37,81-93`, `login-form.tsx:102-104` | Một 401 chung; verify giả với hash tĩnh |
| B-07 | P2 | Signed URL không gắn user; `/content` không guard; TTL tới 600 giây; không secret previous | `media-access-signature.ts:19-31`, `media.controller.ts:36-42` | TTL 60 giây cho non-admin; `MEDIA_SIGNING_SECRET_PREVIOUS`; cân nhắc sub trong HMAC |
| B-08 | P2 | MinLength 6, không MaxLength; pepper không có phiên bản | `register.dto.ts:13-15`, `auth.service.ts:150-153` | MinLength 10, MaxLength 128, zxcvbn/HIBP; pepper có kid |
| B-09 | P3 | JWT không pin algorithms/issuer/audience; tra secret bằng object thường; NODE_ENV thiếu → development | `jwt.strategy.ts:22-41`, `env.validation.ts:21-23` | `algorithms:['HS256']`, issuer/audience, `Object.hasOwn`, bắt buộc NODE_ENV |
| B-10 | P3 | `GET /learning/test` còn trong production; `/health` lộ env/port; `/dictionary?query[]=a` → 500 | `learning.controller.ts:19-22`, `health.service.ts:18-23`, `dictionary.controller.ts:9` | Xoá route test; health chỉ trả status; DictionaryQueryDto |
| B-11 | P3 | Override `qs` 6.15.3 còn trong dải 2 advisory moderate | `backend/package.json` overrides | Nâng pin; `npm audit --omit=dev --audit-level=moderate` trong CI |

## C. Dữ liệu, schema, migration

| Mã | Mức | Vấn đề | Vị trí | Hướng xử lý |
| --- | --- | --- | --- | --- |
| C-01 | P1 | `BEGIN;/COMMIT;` tường minh trong migration 12, 15–19 gây 25P02 khi preflight RAISE; gốc rễ của wrapper migrate 1.700 dòng | `migrations/20260813193000_*/migration.sql:5,333` | Viết lại không BEGIN/COMMIT; preflight là câu lệnh đầu; cập nhật checksum pin |
| C-02 | P1 | Resolver hard-code migration 19 và `successfulMigrationCount !== 18`; deploy áp statement_timeout 30 giây cho mọi migration | `bounded-prisma-migrate-resolve-rolled-back.ts:14-17,473,501`, `bounded-prisma-migrate-deploy.ts:4-9` | Tham số hoá theo `prisma migrate status`; timeout theo migration |
| C-03 | P1 | ADR-001 chỉ có schema; AuditLog bất biến chứa IP/UA; Cascade xoá lịch sử phải giữ | `schema.prisma:1320-1321`, `migrations/20260810093000:390-392` | IP/UA sang bảng purgeable; anonymizedAt; Restrict cho bảng lịch sử; deletion job |
| C-04 | P1 | Một goal/plan active không có unique index | `migrations/20260810091000:224,229`, `onboarding.service.ts:233-237,316-320` | Partial unique index theo userId WHERE isActive / status='active' |
| C-05 | P2 | timestamp(3) không timezone; migration 19 so sánh bằng nhau tuyệt đối | `schema.prisma`, `migrations/20260813193000:49,62,210,215` | `SET timezone='UTC'` + `options=-c TimeZone=UTC` hoặc timestamptz |
| C-06 | P2 | Hợp đồng JSON AuditLog ép bằng trigger; failureCode chuỗi ma thuật lặp 3 nơi | `migrations/20260813193000:33-84` | Enum + bảng MediaIngestionLifecycleEvent |
| C-07 | P2 | ~32 function, ~45 trigger, ~100 CHECK không có inventory/drift guard | `docs/database/*` | `SQL_ONLY_OBJECTS.md` + query pg_trigger/pg_proc trong CI |
| C-08 | P3 | Thiếu index FK Media; 21 index createdBy/updatedBy chưa dùng; ContentReview.reviewerId SetNull trên bảng bất biến | `schema.prisma:534,670,1379-1380,1305` | Thêm index FK Media; bỏ index thừa; reviewerId Restrict |

## D. Logic backend và API

| Mã | Mức | Vấn đề | Vị trí | Hướng xử lý |
| --- | --- | --- | --- | --- |
| D-01 | P2 | `canonicalJson` đệ quy không giới hạn độ sâu trên `answer: unknown` chưa validate | `lesson-activity-write.dto.ts:7-8`, `canonical-json.ts:11-51` | maxDepth cho canonicalJson hoặc validate trước khi hash |
| D-02 | P2 | Idempotency key không TTL; LearningEvent lớn vô hạn | `lesson-activity-idempotency.ts:5` | Chính sách TTL + partial index theo thời gian |
| D-03 | P2 | Điểm bài học loại bài chưa làm khỏi mẫu số (1/10 đúng = 100) | `lesson-activity-progress.ts:32-46` | Chốt với product; ghi vào api.md |
| D-04 | P2 | Upload timeout không huỷ công việc; multer giữ 10 MiB RAM; ClamAV không giới hạn kết nối | `media-ingestion-boundary.interceptor.ts:73,114-151` | AbortSignal xuống scanner/storage/DB; giới hạn concurrency |
| D-05 | P2 | Progress list lộ title/slug lesson chưa publish; getStatus không transactional | `lesson-activity.service.ts:631-676`, `onboarding.service.ts:105-141` | Readiness filter vào include; gom read vào transaction |
| D-06 | P2 | PrismaService không `$disconnect`; enableShutdownHooks dead code | `prisma.service.ts:10-14` | OnModuleDestroy → $disconnect |
| D-07 | P3 | Route trùng (`/levels` và `/learning/levels`…); hai pipe giống hệt; thư mục rỗng; harness trong src/ | `learning.controller.ts`, `common/pipes`, `cms/pipes` | Bỏ một bộ route; xoá pipe CMS; chuyển harness sang test/ |
| D-08 | P3 | Tài khoản inactive nhận 401 thay vì 403 | `onboarding.service.ts:394`, `lesson-activity.service.ts:694` | ForbiddenException |

## E. Frontend

| Mã | Mức | Vấn đề | Vị trí | Hướng xử lý |
| --- | --- | --- | --- | --- |
| E-01 | P2 | 5 route BFF GET không consumer; snapshot vẫn chứa answer; `media.url` lộ; `/api/session/me` xoá cookie khi 5xx | `app/api/admin/exercises/route.ts:33-37`, `exercise-contract.ts:19`, `session-route-handlers.ts:140-144` | Xoá route thừa hoặc omit url, redact snapshot; me chỉ xoá cookie khi 401/403 |
| E-02 | P2 | Mất focus khi confirm archive; logout bỏ qua lỗi; layout không chạy lại khi soft navigation | `media-mutation.tsx:68-100`, `logout-button.tsx:15-23`, `admin/layout.tsx:13-16` | Ref focus; kiểm response.ok; gọi session trong page |
| E-03 | P2 | Trùng lặp exercises/media: 5 titleCase, 2 pagination, 4 statusFromError | `features/exercises/*`, `features/media/*` | lib/format, lib/query, components/ui/pagination |
| E-04 | P3 | Diff chưa commit đổi `npm.cmd` → `npm.cd`; quality-contract chỉ liệt kê page exercises | `scripts/check-generated-types.mjs:10`, `tooling/frontend-quality-contract.spec.ts:44-48` | Sửa typo; cập nhật danh sách page |
| E-05 | P3 | ~25 hex thô ngoài :root trái DESIGN.md; zod 4 API deprecated | `app/styles.css`, `auth-contract.ts:5,11` | Token hoá; `z.email()`, `z.iso.datetime()` |

## F. Ops, CI, release

| Mã | Mức | Vấn đề | Vị trí | Hướng xử lý |
| --- | --- | --- | --- | --- |
| F-01 | P1 | E2E/DB test không chạy được từ checkout mới; 3.300+ dòng service chỉ có e2e; auth.service 3 e2e | `backend/test/jest-e2e.json` | docker-compose.test.yml + `pretest:e2e` tạo DB và migrate; tách state machine ra unit test |
| F-02 | P2 | E2E cách ly bằng quy ước HSK level; deleteMany không scope | `test/learning.e2e-spec.ts:126-140`, `test/media-ingestion.e2e-spec.ts:99-101` | globalSetup truncation hoặc runInBand + ghi rõ quy ước |
| F-03 | P2 | Freshness lệch policy vs prerequisites; inhibit rule chết; 5/19 alert chưa test; nginx thiếu limit_req/body size | `media-evidence-producer-policy.ts:121,133`, `media-alertmanager.yml:32-35`, `ops/nginx/*.conf` | Spec kiểm freshness; `equal: [owner, slo]`; test 5 alert; thêm limit |
| F-04 | P2 | 8.744 dòng nằm ngoài git từ 22/08 | `git status` | Tách commit nhỏ theo chủ đề |
| F-05 | P3 | README boilerplate; không .nvmrc, CODEOWNERS, LICENSE, dependabot; Node 24.5 vs 26.3; health không tách liveness/readiness | root | Theo ADR-008 §12 |

## G. Tài liệu

| Mã | Mức | Vấn đề | Trạng thái 04/09 |
| --- | --- | --- | --- |
| G-01 | P2 | api.md mô tả endpoint không tồn tại; PROJECT_CONTEXT liệt kê 13 module trong khi có 8; bcrypt vs argon2 | Đã xử lý trong đợt tổ chức lại docs: api.md tách Part A/B, PROJECT_CONTEXT gộp vào overview |
| G-02 | P3 | Số migration 15/16/17/18 mâu thuẫn; report 02–09 placeholder; master plan nói frontend rỗng | Đã xử lý: xoá placeholder, archive master plan, sửa count trong runbook |

## Đã làm tốt

- Toàn vẹn dữ liệu ở DB: trigger bất biến, FK lịch sử RESTRICT, lock order trong runbook
  và trong trigger, idempotency key trên bảng write-once.
- E2E backend thật và mạnh (11 file, ~129 case): publish hai lần, import hai lần cùng
  key, double-complete, race quarantine, không orphan object, signed URL hết hạn/giả.
- Secret validation fail-closed; bootstrap không log env; CORS từ chối wildcard.
- Media pipeline: 3 lớp MIME, polyglot, sharp re-encode, WAV parse, ClamAV deadline,
  key UUID.
- BFF: cookie HttpOnly/Secure/Lax, Origin check, allowlist path, CSP nonce; zod contract
  khớp DTO từng field.
- Không `any`, không non-null assertion; lint/format/typecheck sạch; 596 unit test chạy
  4,5 giây.
