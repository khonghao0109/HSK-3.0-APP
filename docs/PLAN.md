# PLAN — Tiến độ dự án HSK 3.0

> Cập nhật: 13/09/2026 · Baseline: branch `macdev`, HEAD `808a97a`
> · Trạng thái tổng: **PRE-BETA**. Backend và admin console có nền; chưa có learner app,
> chưa có CI, chưa có hạ tầng production.

Ký hiệu:

| Ký hiệu | Ý nghĩa |
| --- | --- |
| ✅ | Hoàn thành, có bằng chứng trong repo: entry point + contract + test |
| 🟡 | Đang làm hoặc có một phần (ghi rõ phần thiếu ở cột bằng chứng) |
| ⬜ | Chưa bắt đầu |
| ⛔ | Bị chặn bởi yếu tố ngoài code (hạ tầng, pháp lý, dữ liệu) |
| 🔵 | Quyết định đang chờ duyệt |

Mã `A-01`…`G-02` trỏ tới [reviews/2026-09-04-codebase-review.md](./reviews/2026-09-04-codebase-review.md).
Mã `ADR-008 §n` trỏ tới [adr/ADR-008-TECHNOLOGY-STACK-DECISIONS.md](./adr/ADR-008-TECHNOLOGY-STACK-DECISIONS.md).
Mockup `01-onboarding-placement/03` trỏ tới [ui_image/README.md](./ui_image/README.md).

## 0. Cách dùng file này

1. Mỗi PR chạm một bước thì cập nhật dòng đó: trạng thái + commit/file làm bằng chứng.
2. Chỉ tích ✅ khi flow chạy end-to-end với DB thật và có test; schema hay mockup không đủ.
3. Không sao chép số test/checksum vào đây; dẫn link tới runbook hoặc test file.
4. Thêm dòng vào mục 8 (nhật ký) khi đổi trạng thái milestone.
5. Lộ trình mục 1 và bảng chi tiết mục 4 phải cùng trạng thái cho cùng một mã; bằng
   chứng ghi ở mục 4, mục 1 chỉ ghi ngắn.

## 1. Lộ trình hoàn thành dự án

Lộ trình chia 11 giai đoạn (GĐ0–GĐ10) theo thứ tự dependency: lưới an toàn (CI) trước,
đóng lỗ hổng, rồi mới xây learner app, sau đó hạ tầng production và beta. Mỗi task nhỏ
mang mã trùng với bảng chi tiết ở mục 4 (`H.2`, `M2.5`…). Mã có hậu tố chữ (`H.2a`) là
task con của bước cùng mã; bước cha chỉ ✅ khi mọi task con ✅. Hậu tố `E` là điều kiện
ra của giai đoạn. Ước lượng thời gian giả định một dev full-stack làm việc với AI agent,
không tính thời gian chờ pháp lý hoặc hạ tầng bên ngoài; dùng để xếp thứ tự, không phải
cam kết.

### 1.1 Tiến độ theo giai đoạn

| GĐ | Giai đoạn | Điều kiện ra | Task xong / tổng | Ước lượng | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| GĐ0 | Nền tảng đã xây (05/05 → 04/09/2026) | Đã đạt | 18 / 18 | — | ✅ |
| GĐ1 | Ổn định repo, CI, môi trường test | PR nào cũng có CI xanh; e2e chạy một lệnh | 4 / 9 | 1–2 tuần | 🟡 |
| GĐ2 | Đóng lỗ hổng bảo mật và tính đúng đắn | P0/P1 review đóng; envelope + OpenAPI | 2 / 14 | 2–3 tuần | 🟡 |
| GĐ3 | Media internal closeout (M0) | Full gate GREEN trên Linux AMD64 | 2 / 8 | 1–2 tuần | 🟡 |
| GĐ4 | Content/legal + Identity/Privacy (M1) | Không blocker license; privacy end-to-end | 0 / 14 | 3–4 tuần | ⬜ |
| GĐ5 | Learner Web Core Loop (M2) | Người học đi hết vòng học trên staging | 5 / 20 | 5–7 tuần | 🟡 backend xong |
| GĐ6 | SRS + Dictionary completion (M3) | Ôn đúng hạn, lịch sử bất biến | 0 / 7 | 3–4 tuần | ⬜ |
| GĐ7 | Exam Engine (M4) | Thi trọn flow, kết quả bất biến | 0 / 7 | 4–6 tuần | ⬜ |
| GĐ8 | Admin ops, analytics, support, trust (M5) | Mutation nhạy cảm có audit; support có SLA | 5 / 14 | 4–6 tuần | 🟡 read console |
| GĐ9 | Production foundation + Beta (M6) | Promote, rollback, restore có bằng chứng; beta go | 0 / 9 | 4–6 tuần | ⬜ (⛔ M6.3, M6.9) |
| GĐ10 | Sau beta: reader, AI, mobile, payment (M7) | Theo outcome beta | 0 / 8 | — | ⬜ |

Tổng: **36 / 128 task**. Đường găng tới beta: GĐ1 → GĐ2 → GĐ4 → GĐ5 → GĐ9; GĐ3 chạy
ngay sau GĐ1; GĐ8 (M5.1, M5.2) có thể chạy song song GĐ5 vì cần để soạn nội dung thật;
GĐ6 và GĐ7 có thể đổi chỗ theo ưu tiên sản phẩm.

### GĐ0 — Nền tảng đã xây ✅

| # | Đã đạt được | Trạng thái | Bằng chứng |
| --- | --- | --- | --- |
| 0.1 | Backend NestJS 11: config Joi, ValidationPipe whitelist, CORS allowlist, prefix `/api/v1` | ✅ | `ad12828`…, `backend/src/main.ts` |
| 0.2 | Auth: register/login/me, JWT HS256 có `kid` rotation, Argon2id + pepper, kiểm tra tài khoản active mỗi request | ✅ | `97d7027`, `test/auth.e2e-spec.ts` |
| 0.3 | Seed 7 Level HSK1…HSK7_9 và từ điển CC-CEDICT + HSK list (121.856 word, 11.086 mapping) qua `scripts/dictionary/seed.ts` (`npm run seed:dictionary`) | ✅ | `06f663e`, `cfdfc11`; DB dev 13/09: 7 Level, 121.856 Word, 200.156 WordMeaning |
| 0.4 | Learning read API: levels, lessons, topics, stories; chỉ trả `published`, chưa soft-delete | ✅ | `977b79f`…`3065da2`, `learning.e2e-spec.ts` |
| 0.5 | Schema P0: 59 model, 27 enum, 19 migration SQL, trigger bất biến, lock order, integrity/concurrency SQL test | ✅ | `17292eb`, `eaadb4f`, `test/database/*.sql` |
| 0.6 | Onboarding goal + learning plan API | ✅ | `4b80507`, `622dcfa` |
| 0.7 | CMS Lite: revision → review → publish → archive cho lesson/topic | ✅ | `b63fdd7` |
| 0.8 | Lesson/topic activity, exercise attempt, chấm điểm server-side, progress/resume, idempotency key | ✅ | `4f69f31` |
| 0.9 | Exercise authoring, preview, import atomic | ✅ | `ce7da49` |
| 0.10 | Admin console: BFF cookie HttpOnly, CSP nonce, Origin check, shell, exercises read-only, responsive | ✅ | `ce110e5`, `b10fef3`, `898e19b`, ADR-003 |
| 0.11 | Media admin library: list/detail, quarantine/archive | ✅ | `69c32bc`, ADR-004 |
| 0.12 | Media ingestion: MIME 3 lớp, ClamAV INSTREAM, sharp, S3 private, signed URL HMAC | ✅ | `356ae1f`, ADR-005 |
| 0.13 | Media observability và edge: Prometheus rules + unit test, Alertmanager, Grafana, nginx fail-closed, metrics private | ✅ | `77e2952`, `686cb25`, `a86b622`, ADR-006 |
| 0.14 | Media runtime deadline, cleanup recovery, release evidence fail-closed, producer trust policy | ✅ | `9e9a82c`, `3211bf8`, `6f74f5b`, ADR-007 |
| 0.15 | 36 mockup UI page-level | ✅ | `0e3e6d6`, `docs/ui_image` |
| 0.16 | ADR-001…ADR-008; mobile chốt React Native + Expo | ✅ | `docs/adr` (ADR-008 Proposed, §1 đã chốt) |
| 0.17 | Review toàn dự án 57 finding; docs tổ chức lại; PLAN.md | ✅ | `29e1e4b`, `docs/reviews` |
| 0.18 | Worktree 22/08–04/09 tách 3 commit; gỡ skill tooling khỏi git (= H.1) | ✅ | `b222926`, `29e1e4b`, `6f74f5b` |

### GĐ1 — Ổn định repo, CI và môi trường test (1–2 tuần)

Vào: GĐ0. Ra: mọi PR vào `main` có CI xanh; `npm run test:e2e` chạy từ checkout mới bằng một lệnh.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| H.1 | Dọn worktree thành commit theo chủ đề; typo `npm.cd` revert | ✅ | 04/09: `b222926`, `29e1e4b`, `6f74f5b` |
| H.2a | `ci.yml` backend: `npm ci --ignore-scripts`, `prisma validate`, lint, format, tsc, jest | 🟡 | 07/09: `f7c6d9b`, `665074d`. Chạy tay từ clone mới: 596/596 unit pass. Chờ run xanh trên GitHub |
| H.2b | `ci.yml` backend e2e với Postgres service; tên DB kết thúc `test` | 🟡 | 07/09: `f7c6d9b`. Chạy tay theo đúng shape của CI: 163/163 pass. Service container chưa chạy thật |
| H.2c | `ci.yml` frontend: lint, typecheck, vitest, `test:generated-types` | 🟡 | 07/09: `f7c6d9b`. Chạy tay từ clone mới: 101/101 vitest pass, generated-types PASS. Chờ run xanh |
| H.2d | Branch protection `main`: required checks, không push thẳng | ⬜ | Cần chủ repo chạy tay; lệnh `gh api` ghi trong báo cáo GĐ1. Checks: `backend`, `backend-e2e`, `frontend` |
| H.3a | `docker-compose.yml`: Postgres 16 (profile mặc định), MinIO/ClamAV/Mailpit (profile `dev`) | ✅ | 07/09: `b011518`. Chọn `docker-compose.yml` + profile thay tên `docker-compose.test.yml` để `docker compose up -d` không cần cờ `-f` |
| H.3b | `pretest:e2e` tạo DB disposable + migrate; docs một lệnh chạy e2e | ✅ | 07/09: `b011518`, `41f471d`, `1751aff`. Clone mới, không set biến nào: 163/163 pass, lặp lại vẫn 163/163 |
| H.13 | `.nvmrc` Node 24, `.npmrc save-exact`, TypeScript 6 cả hai package, Renovate | 🟡 | 07/09: `6d38f40` (.nvmrc, engines, .npmrc, renovate.json). Còn TypeScript 6 backend — ADR-008 §12 yêu cầu CI xanh trước |
| H.15 | Root `README.md`: thay boilerplate NestJS bằng mô tả monorepo, trỏ `docs/README.md` | ✅ | 07/09: `6f6d2fe` |

### GĐ2 — Đóng lỗ hổng bảo mật và tính đúng đắn (2–3 tuần, mỗi task một PR)

Vào: GĐ1 có CI. Ra: P0/P1 trong review đóng; response envelope thống nhất; `openapi.json` sinh trong CI.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| H.4a | `trust proxy`, nginx `X-Forwarded-For`; throttler tracker `req.user.id ?? req.ip` | ✅ | A-02. 14/09: `9272c58`. `TRUST_PROXY_HOPS` (mặc định 1); `CustomThrottlerGuard` tự xác minh bearer JWT vì APP_GUARD chạy trước `JwtAuthGuard` (`req.user` chưa có); `login`/`register` giữ bucket IP; BFF forward XFF nguyên chuỗi; nginx route media. jest 612, e2e 163, vitest 108 pass |
| H.4b | Rate limit theo user bằng bảng Postgres theo mẫu `MediaUploadRateLimit` | ✅ | ADR-008 §2. 14/09: `a0b1950`. migration 20 `20260914090000_rate_limit_counter` (bảng purgeable `RateLimitCounter`); `PostgresThrottlerStorage` upsert nguyên tử một câu lệnh, đồng hồ DB, cleanup batch `SKIP LOCKED` mỗi 60 s; bằng chứng đồng thời/đa replica: `backend/test/rate-limit-storage.e2e-spec.ts`. Harness `test:db:media-migration*` còn hard-code 19 migration → H.11a |
| H.5 | Lockout tăng nguyên tử; login ~10 req/phút/IP + throttle theo email | 🟡 | B-01. 14/09 chưa commit: câu `UPDATE` giữ chỗ lượt thử trước Argon2 (khoá thì không hash), `login` 10/phút/IP, 5 lần sai/15 phút/email qua `PostgresThrottlerStorage`; bằng chứng `backend/test/auth-lockout.e2e-spec.ts`, `backend/src/modules/auth/auth.service.spec.ts` |
| H.6 | Xoá nhánh so sánh password plaintext | ⬜ | B-02 |
| H.7 | 401 chung, verify giả với hash tĩnh; register trả 409 | ⬜ | B-06 |
| H.8 | `GET /users` phân trang + lọc soft-delete | ⬜ | B-05 |
| H.9 | `MEDIA_STORAGE_PROVIDER`/`MEDIA_SCANNER_PROVIDER` tường minh, assert lúc boot | ⬜ | B-04 |
| H.10a | APP_INTERCEPTOR + APP_FILTER envelope toàn cục; echo `x-request-id` | ⬜ | A-03 |
| H.10b | Cập nhật `api.md` §1 và Zod contract frontend theo envelope mới | ⬜ | |
| H.10c | Cài `@nestjs/swagger`, xuất `openapi.json` trong CI, `openapi-typescript` cho frontend | ⬜ | ADR-008 §5 |
| H.11a | Migration: bỏ `BEGIN/COMMIT` (25P02); resolver migration tham số hoá | ⬜ | C-01, C-02. Từ H.4b có 20 migration: `assertCatalog` (release validation) và test catalog trong `media-lifecycle-migration-validation.helpers.spec.ts` còn đòi đúng 19 |
| H.11b | Pin UTC/timestamptz; unique index goal/plan | ⬜ | C-05, C-04 |
| H.12 | Prisma `$disconnect`; `canonicalJson` maxDepth; idempotency TTL | ⬜ | D-06, D-01, D-02 |
| H.14 | Frontend: xoá/redact 5 route BFF không dùng; focus archive; logout kiểm `ok`; `/api/session/me` chỉ xoá cookie khi 401/403 | ⬜ | E-01, E-02 |

### GĐ3 — Media internal closeout, M0 (1–2 tuần, ngay sau GĐ1)

Vào: GĐ1 có CI để gate chạy trên Linux AMD64. Ra: không còn P0/P1 media; full internal gate GREEN.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M0.1 | Deadline/cancellation ClamAV 10 s, S3 8 s | ✅ | D-04 còn lại ở M0.E |
| M0.2 | Cleanup recovery, secret scan, availability SLI | ✅ | |
| M0.3 | Forward-only migration, bounded lock deploy | 🟡 | script đã commit `6f74f5b`; chờ H.11a |
| M0.4 | Validate K8s artifact, OCI identity, Linux AMD64 | 🟡 | gate chặn bởi producer policy; phụ thuộc #11 |
| M0.5 | Owner, risk/decision register, evidence contract | 🟡 | roadmap đã commit; owner chưa gán |
| #10 | Duyệt ADR-008 | 🔵 | Product Owner + Tech Lead |
| #11 | Đóng băng harness release-evidence hay giữ (ADR-008 §8, A-04) | 🔵 | quyết định M0.4 ở lại hay chuyển M6.2 |
| M0.E | Đóng P2 media còn lại: B-07 TTL signed URL và secret previous, D-04 AbortSignal upload; full gate GREEN | ⬜ | |

### GĐ4 — Content/legal + Identity/Privacy, M1 (3–4 tuần)

Vào: GĐ2 xong H.4–H.7. Ra: không blocker license P0; privacy request có bằng chứng end-to-end; RC không dùng fixture.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M1.1 | Xác minh license/provenance 7 HSK word list; attribution CC-CEDICT | ⬜ | R1; quyết định #2. DB dev 13/09: 7 `DataSource` HSK không có license, `referenceUrl` trỏ file trong repo |
| M1.2 | Workflow nghĩa tiếng Việt có reviewer và rollback | ⬜ | chặn bởi #2. DB dev 13/09: 200.156 `WordMeaning` đều tiếng Anh, 0 `meaningVi` |
| M1.3 | Loại content Temporary/fixture khỏi release candidate | ⬜ | DB dev 13/09: 35 Lesson, 70 Topic, 14 Story đều là seed "Temporary" từ `seed:learning` |
| M1.4a | Refresh token lưu hash trong `UserSession`; access token 15 phút | ⬜ | B-03 |
| M1.4b | Endpoint logout/revoke; BFF admin dùng refresh | ⬜ | tiền đề mobile |
| M1.5a | `MailerPort` + adapter SES và Mailpit | ⬜ | ADR-008 §9 |
| M1.5b | Email verification (token hash) | ⬜ | |
| M1.5c | Password reset (token hash, dùng một lần) | ⬜ | |
| M1.6 | Profile API (`UserProfile`) | ⬜ | |
| M1.7a | pg-boss trên PostgreSQL + worker process | ⬜ | ADR-008 §2 |
| M1.7b | Consent API + data export job | ⬜ | ADR-001 |
| M1.7c | Deletion request + anonymize worker | ⬜ | C-03 |
| M1.8 | Dockerfile backend/frontend + digest | ⬜ | ADR-008 §11 |
| M1.E | Privacy export/delete có evidence end-to-end; RC không fixture | ⬜ | |

### GĐ5 — Learner Web Core Loop, M2 (5–7 tuần)

Vào: GĐ4 xong M1.4, M1.5. Ra: người học đi hết đăng nhập → mục tiêu → bài học → activity → progress trên production build với backend staging.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M2.B1 | Onboarding goal/plan API | ✅ | `4b80507` |
| M2.B2 | Public content read + readiness policy | ✅ | `learning.e2e-spec.ts` |
| M2.B3 | Start/complete, attempt, progress/resume | ✅ | `4f69f31` |
| M2.B4 | Dictionary prefix search | ✅ | thiếu e2e riêng |
| M2.B5 | Signed media access cho learner | ✅ | `media-access.service.ts` |
| M2.1a | Learner session BFF: cookie riêng, route `api/session/*` cho learner | ⬜ | ADR-003 |
| M2.1b | UI đăng ký, đăng nhập, đăng xuất | ⬜ | mockup 01/01,02 |
| M2.2 | UI onboarding goal + kế hoạch học | ⬜ | 01/03,04 |
| M2.3a | Placement backend: chọn câu, chấm, kết quả (feature flag) | ⬜ | `PlacementAttempt` schema ✅ |
| M2.3b | Placement UI | ⬜ | 01/05,06 |
| M2.4 | Trang chủ + lộ trình học | ⬜ | 02/01,02 |
| M2.5a | Trang nội dung bài học | ⬜ | 02/03 |
| M2.5b | Activity player: mcq, fill_blank | ⬜ | 02/04,05 |
| M2.5c | Activity player: listening, arrange | ⬜ | |
| M2.5d | Hoàn thành bài, tổng kết, cập nhật progress | ⬜ | 02/06 |
| M2.6a | Backend dictionary detail + save-word API | ⬜ | |
| M2.6b | UI tra từ, chi tiết, lưu từ | ⬜ | 03/01,02 |
| M2.7 | Responsive, keyboard, screen reader, loading/empty/error/offline | ⬜ | `frontend/DESIGN.md` |
| M2.8 | Product event P0 first-party: activation, lesson completion | ⬜ | ADR-008 §10 |
| M2.E | Playwright flow end-to-end trên production build với backend staging | ⬜ | |

### GĐ6 — SRS + Dictionary completion, M3 (3–4 tuần)

Vào: GĐ5 có M2.5, M2.6. Ra: ôn đúng hạn, lịch sử review bất biến.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M3.1 | Scheduler policy/version, `ReviewCard` là source of truth | ⬜ | schema ✅ |
| M3.2 | Due queue, review session/event idempotency, concurrency | ⬜ | trigger ownership ✅ |
| M3.3 | Flashcard + lịch ôn tập UI | ⬜ | 03/03,04 |
| M3.4a | Schema + migration `WordSense`/`WordExample`/`WordRelation`, `pg_trgm` | ⬜ | mục 5 |
| M3.4b | API dictionary detail đầy đủ, ví dụ/audio, saved-word lifecycle | ⬜ | |
| M3.4c | UI chi tiết từ | ⬜ | |
| M3.5 | Test scheduler correctness, retention, timezone | ⬜ | C-05 |

### GĐ7 — Exam Engine, M4 (4–6 tuần)

Vào: GĐ5 xong. Ra: thi trọn flow, snapshot không đổi khi content sửa, submit/retry không double result.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M4.1 | Admin question/test authoring + publish | ⬜ | 06/05; schema 14 model ✅ |
| M4.2a | Start → snapshot bất biến | ⬜ | `ExamAttemptSnapshot` ✅ |
| M4.2b | Autosave, resume, timer | ⬜ | |
| M4.2c | Submit idempotent, chống double result | ⬜ | |
| M4.3 | Server scoring, skill breakdown, explanation policy | ⬜ | |
| M4.4 | Concurrency/capacity test theo workload duyệt | ⬜ | |
| M4.5 | Learner exam/review/result UI | ⬜ | 04/01–04 |

### GĐ8 — Admin ops, analytics, support, trust, M5 (4–6 tuần; M5.1–M5.2 song song GĐ5)

Vào: GĐ2 xong H.8, H.10. Ra: 100% mutation nhạy cảm có audit; support queue có owner/SLA; dashboard có reconciliation.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M5.B1 | Admin login qua BFF, protected shell, forbidden/session states | ✅ | `ce110e5` |
| M5.B2 | Exercise list/detail read-only | ✅ | |
| M5.B3 | Media list/detail + quarantine/archive | ✅ | `69c32bc` |
| M5.B4 | Backend CMS lesson/topic/exercise/import + media ingestion API | ✅ | |
| M5.B5 | `GET /users` cho admin | ✅ | cần H.8 |
| M5.1a | CMS mutation UI lesson/topic: tạo, sửa, review, publish | ⬜ | 06/02,03 |
| M5.1b | Exercise authoring + import UI | ⬜ | 06/04 |
| M5.2 | Upload media UI + trạng thái processing + reconciliation | ⬜ | |
| M5.3 | User lifecycle admin: role, khoá/mở, audit UX | ⬜ | 06/06 |
| M5.4 | CMS cho Level, Story, Word, Question, Test; generic import; scheduled publish | ⬜ | |
| M5.5 | Dashboard data-quality/content/product/ops (Metabase) | ⬜ | 06/01; ADR-008 §10 |
| M5.6 | Support ticket / content report: taxonomy, API, queue, SLA | ⬜ | |
| M5.7 | Trust & Safety: report/action/appeal/audit, least-privilege role | ⬜ | |
| M5.8 | Notification preference + consent | ⬜ | |

### GĐ9 — Production foundation + Beta, M6 (4–6 tuần)

Vào: GĐ4 M1.8 và quyết định #8 (hosting). Ra: promote theo digest, rollback, restore drill có bằng chứng; beta go/no-go.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M6.1 | Dockerfile multi-stage non-root; compose local | ⬜ | hoàn thiện M1.8 |
| M6.2 | CI/CD build-once/promote-many theo digest; SBOM, scan, cosign, attest | 🟡 | harness media có; chưa có image dự án |
| M6.3 | Terraform AWS ap-southeast-1: ECS, RDS PITR, S3, CloudFront + WAF, Secrets, SES | ⛔ | chờ #8 |
| M6.4 | Staging production-like, environment parity | ⬜ | |
| M6.5 | OTel + Sentry + pino; SLI/SLO; dashboards; alerts; incident runbooks | 🟡 | media ✅; toàn hệ thống ⬜ |
| M6.6 | Backup/PITR, restore drill, RPO/RTO; retention object storage | ⬜ | |
| M6.7 | Gate capacity, security/privacy, accessibility, dependency/license | ⬜ | |
| M6.8 | Beta rollout tăng dần, observation window, go/no-go | ⬜ | |
| M6.9 | Live Media Infrastructure Rehearsal | ⛔ | BLOCKED_EXTERNAL |

### GĐ10 — Sau beta, M7 (theo outcome beta)

| # | Task | Trạng thái | Điều kiện bắt đầu |
| --- | --- | --- | --- |
| M7.1 | Interactive reader, materials | ⬜ | mockup 03/05,06 |
| M7.2 | Pronunciation/shadowing | ⬜ | consent/retention, provider, rubric |
| M7.3 | Notifications | ⬜ | M5.8 |
| M7.4 | AI/RAG: service riêng, pgvector, provider adapter ≥2 | ⬜ | ADR-008 §6; corpus có license |
| M7.5 | Hanzi/OCR | ⬜ | product validation, licensed model |
| M7.6 | Subscription/payment | ⬜ | business model, legal/tax |
| M7.7 | Mobile: `mobile/` Expo, npm workspaces, `packages/contracts/` | ⬜ | ADR-008 §1; M1.4, H.2, H.4, H.10 |
| M7.8 | Community | ⬜ | moderation |

## 2. Tổng quan

| Milestone | Outcome | Trạng thái | Bước xong / tổng |
| --- | --- | --- | --- |
| M0 Media internal closeout | Media không còn P0/P1, gate tái lập trên Linux AMD64 | 🟡 | 2 / 5 (exit 0 / 4) |
| H Hardening & CI (chèn từ review 04/09) | CI xanh trên PR, e2e chạy một lệnh, P0/P1 review đóng | 🟡 | 1 / 15 |
| M1 Content/legal + Identity/Privacy | Dữ liệu và tài khoản đủ an toàn để mở beta | ⬜ | 0 / 8 |
| M2 Learner Web Core Loop | Đăng nhập → mục tiêu → bài học → activity → progress | 🟡 backend xong, UI chưa | 5 / 13 |
| M3 SRS + Dictionary completion | Ôn đúng hạn, lịch sử bất biến | ⬜ | 0 / 5 |
| M4 Exam Engine | Thi trọn flow, kết quả bất biến | ⬜ (schema ✅) | 0 / 5 |
| M5 Admin Ops, Analytics, Support, Trust | Vận hành nội dung/người dùng an toàn | 🟡 read console | 5 / 13 |
| M6 Production foundation + Beta | Promote, quan sát, rollback, phục hồi | ⬜ | 0 / 9 |
| M7+ Later | Reader, pronunciation, AI, mobile, payment | ⬜ | 0 / 8 |

Số liệu hiện tại (đo 04/09/2026):

| Chỉ số | Giá trị |
| --- | --- |
| Backend runtime | 8 module, ≈60 endpoint, 15.087 dòng src + 7.695 dòng spec |
| Kiểm thử hermetic | jest 51 suite / 596 test ✅ · node:test ops 129 ✅ · secret scan ✅ · vitest 23 file / 101 test ✅ · lint/format/typecheck ✅ |
| Kiểm thử cần DB | 11 file e2e (~129 case) + 16 file SQL — không chạy được từ checkout mới (F-01) |
| Schema | 59 model · 27 enum · 19 migration · 23 model có runtime |
| Frontend | login + admin exercises/media (read, quarantine/archive); 0/30 màn learner |
| AI | 0 byte |
| CI | 1 workflow, chỉ chạy khi push tag `v3.0.0`, hiện không thể pass (A-01) |
| Worktree | Sạch sau 3 commit 04/09 (`b222926`, `29e1e4b`, `6f74f5b`); F-04 đóng |

## 3. Đã hoàn thành theo slice

| # | Slice | Ngày | Commit | Bằng chứng |
| --- | --- | --- | --- | --- |
| 1 | Khởi tạo backend NestJS, auth module cơ bản | 05–07/05/2026 | `ad12828` … `2465fe8` | `backend/src/modules/auth` |
| 2 | Seed level + dictionary (một script), dictionary pipeline, migration đầu | 06/05 | `06f663e`, `cfdfc11` | `backend/scripts/dictionary/seed.ts` upsert Level rồi insert Word; `scripts/levels/seed.ts` là file rỗng 0 byte từ commit đầu, không dùng |
| 3 | Learning read API level/lesson/topic/story, response format | 08–22/05 | `977b79f` … `3065da2` | `backend/src/modules/learning` |
| 4 | P0 schema foundation: 59 model, migration P0-00…P0-04, integrity/concurrency hardening | 10/08 | `17292eb`, `eaadb4f` | `backend/prisma/migrations/202608*`, `test/database/p0-schema.integration.sql` |
| 5 | Auth active-account JWT authorization (status/deletedAt từ DB mỗi request) | 10/08 | `97d7027` | `jwt.strategy.ts`, `test/auth.e2e-spec.ts` |
| 6 | Onboarding goal + learning plan V1 | 10/08 | `4b80507`, `622dcfa` | `modules/onboarding`, `test/onboarding.e2e-spec.ts` (17 case) |
| 7 | CMS Lite lesson/topic revision → review → publish → archive | 11/08 | `b63fdd7` | `modules/cms/cms.service.ts`, `test/cms-lite.e2e-spec.ts` (16 case) |
| 8 | Lesson activity attempt, scoring server-side, progress, idempotency | 11/08 | `4f69f31` | `modules/learning/activity`, `test/lesson-activity.e2e-spec.ts` (19 case) |
| 9 | Exercise authoring + preview/atomic import | 11/08 | `ce7da49` | `exercise-authoring.service.ts`, `exercise-import/`, 2 file e2e (19 case) |
| 10 | Frontend: secure admin shell, BFF session, exercise console read-only, responsive | 11–12/08 | `ce110e5`, `b10fef3`, `898e19b` | `frontend/src/features/{auth,admin-shell,exercises}`, ADR-003 |
| 11 | Media asset operations + admin library UI (quarantine/archive) | 12/08 | `69c32bc` | `media-admin.service.ts`, `frontend/src/features/media`, ADR-004 |
| 12 | Secure media ingestion: validate, ClamAV, sharp, S3 private, signed delivery | 12/08 | `356ae1f` | `media-ingestion/`, `infrastructure/{storage,malware}`, `modules/media`, ADR-005 |
| 13 | 36 mockup UI page-level | 13/08 | `0e3e6d6` | `docs/ui_image` |
| 14 | Media provenance/storage reconciliation, telemetry và edge fail-closed, hermetic gates | 13/08 | `77e2952`, `686cb25`, `a86b622` | migration 17–18, `ops/observability`, ADR-006 |
| 15 | Media runtime deadlines, readiness gaps, release evidence fail-closed | 22/08 | `9e9a82c`, `3211bf8` | migration 19, `scripts/test/media-*`, ADR-007 |
| 16 | ADR-001 … ADR-008 | 10/08 – 04/09 | `6f74f5b`, `29e1e4b` | `docs/adr` (ADR-007 trong `6f74f5b`, ADR-008 trong `29e1e4b`) |
| 17 | Review toàn dự án, chốt stack, tổ chức lại docs, PLAN.md | 04/09 | `29e1e4b` | `docs/reviews`, ADR-008, `docs/README.md` |
| 18 | Dọn worktree 22/08–04/09 thành 3 commit; gỡ skill tooling khỏi git | 04/09 | `b222926`, `6f74f5b` | H.1; `.gitignore` |

## 4. Giai đoạn chi tiết

### M0 — Media internal closeout (NOW theo roadmap)

Outcome: Media không còn P0/P1 nội bộ và có bằng chứng tái lập trên nền tảng production.

| # | Bước | Trạng thái | Bằng chứng / còn thiếu |
| --- | --- | --- | --- |
| M0.1 | Absolute deadline/cancellation cho ClamAV và S3 body stream | ✅ | `s3-object-storage.adapter.ts` deadline 8 s, `clamav-media-malware-scanner.ts` 10 s. Còn D-04: interceptor upload không huỷ công việc phía sau |
| M0.2 | Cleanup recovery, secret scanner false-negative, availability SLI truthful | ✅ | `media-ingestion.cleanup-recovery.spec.ts`, `scripts/security/secret-scan.ts`, `ops/observability/media-alerts.yml` |
| M0.3 | Forward-only migration/preflight và bounded lock deployment | 🟡 | `scripts/operations/bounded-prisma-migrate-*.ts` đã commit `6f74f5b`; còn C-01 (BEGIN/COMMIT), C-02 (resolver dùng một lần) |
| M0.4 | Validate rendered Kubernetes artifact, OCI identity, Linux AMD64 | 🟡 | Harness có; gate không thể pass vì producer policy `HOST_ACCEPTANCE_REQUIRED` |
| M0.5 | Roadmap, owner, risk/decision register, release evidence contract | 🟡 | Roadmap 13/08 đã commit `29e1e4b`; owner chưa gán; evidence contract ADR-007 |

Exit criteria:

| Điều kiện | Trạng thái |
| --- | --- |
| Không còn P0/P1 trong scope Media | ⬜ (B-04, B-07, D-04 còn mở) |
| Full internal gate GREEN trên Linux AMD64 | ⬜ |
| Không trộn local evidence với immutable CI attestation | 🟡 |
| Live Media Infrastructure Rehearsal | ⛔ BLOCKED_EXTERNAL (chưa có S3/ClamAV/proxy thật) |

🔵 ADR-008 §8 đề xuất đóng băng harness và thay bằng action chuẩn khi có Dockerfile của
dự án. Nếu duyệt: M0.4 chuyển vào M6.2, M0.5 chỉ còn phần owner/risk register.

### H — Hardening & CI (đề xuất chèn trước M1, từ review 04/09)

Outcome: mọi PR có CI xanh, e2e chạy được bằng một lệnh, P0/P1 trong review đóng.

| # | Bước | Trạng thái | Finding / ghi chú |
| --- | --- | --- | --- |
| H.1 | Tách worktree +8.744 dòng thành commit nhỏ; sửa typo `npm.cd` | ✅ | F-04, E-04 đóng 04/09: `b222926`, `29e1e4b`, `6f74f5b`; typo revert về bản đã commit |
| H.2 | `ci.yml` trên PR: backend prisma validate + lint + tsc + jest + e2e (Postgres service); frontend lint + typecheck + vitest; required checks | 🟡 | A-01. 07/09: `f7c6d9b`, `665074d`. Ba job đã viết và chạy tay từ clone mới; chỉ ✅ khi có run xanh trên GitHub và H.2d bật xong |
| H.3 | `docker-compose.yml` (Postgres 16 + profile `dev` cho MinIO/ClamAV/Mailpit) + `pretest:e2e` tạo DB disposable và migrate | ✅ | F-01 đóng phần e2e 07/09: `b011518`, `41f471d`, `1751aff`. e2e phải `--runInBand`: 11 suite dùng chung DB và cùng upsert Level theo `code` |
| H.4 | `trust proxy`, nginx X-Forwarded-For, tracker theo `req.user.id ?? req.ip`, rate limit theo user bằng bảng Postgres | ✅ | A-02, ADR-008 §2. H.4a `9272c58`; H.4b `a0b1950` |
| H.5 | Lockout tăng nguyên tử; login ~10 req/phút/IP + throttle theo email | 🟡 | B-01. Xem GĐ2 H.5 |
| H.6 | Xoá nhánh so sánh password plaintext | ⬜ | B-02 |
| H.7 | Một 401 chung, verify giả với hash tĩnh; register trả 409 | ⬜ | B-06 |
| H.8 | `GET /users` phân trang + lọc soft-delete | ⬜ | B-05 |
| H.9 | `MEDIA_STORAGE_PROVIDER`/`MEDIA_SCANNER_PROVIDER` tường minh, assert lúc boot | ⬜ | B-04 |
| H.10 | Envelope toàn cục: APP_INTERCEPTOR + APP_FILTER, echo `x-request-id`; cập nhật api.md §1; sau đó bật OpenAPI | ⬜ | A-03, ADR-008 §5 |
| H.11 | Migration: bỏ `BEGIN/COMMIT`, resolver tham số hoá, pin UTC, unique index goal/plan | ⬜ | C-01, C-02, C-05, C-04 |
| H.12 | Prisma `$disconnect`; `canonicalJson` maxDepth; idempotency TTL | ⬜ | D-06, D-01, D-02 |
| H.13 | `.nvmrc` Node 24, `.npmrc save-exact`, TypeScript 6 cả hai package, Renovate | 🟡 | 07/09: `6d38f40` (.nvmrc, engines, .npmrc, renovate.json). Còn TypeScript 6 backend — ADR-008 §12 yêu cầu CI xanh trước |
| H.14 | Frontend: xoá 5 route BFF không dùng hoặc redact; focus archive; logout kiểm `ok`; `/api/session/me` chỉ xoá cookie khi 401/403 | ⬜ | E-01, E-02 |
| H.15 | Root `README.md`: thay boilerplate NestJS bằng mô tả monorepo, trỏ `docs/README.md` | ✅ | F-05 đóng một phần 07/09: `6f6d2fe` |

### M1 — Content/legal + Identity/Privacy foundation

Outcome: dữ liệu và tài khoản đủ an toàn để mở learner beta.

| # | Bước | Trạng thái | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| M1.1 | Xác minh license/provenance 7 HSK word list; attribution CC-CEDICT (CC BY-SA 4.0) | ⬜ | Roadmap R1; `DataSource` đã có bảng và provenance snapshot. Kiểm tra DB dev 13/09: CC-CEDICT có license CC BY-SA 4.0, 7 nguồn HSK list chưa có license |
| M1.2 | Workflow nghĩa tiếng Việt có reviewer và rollback | ⬜ | Rubric chất lượng: archive master plan §13.4. Kiểm tra DB dev 13/09: 0 nghĩa tiếng Việt trên 200.156 nghĩa |
| M1.3 | Loại content Temporary/fixture khỏi release candidate | ⬜ | Kiểm tra DB dev 13/09: toàn bộ 35 Lesson, 70 Topic, 14 Story là placeholder "Temporary" |
| M1.4 | Session refresh/revoke dùng `UserSession`; access 15 phút | ⬜ | B-03; schema ✅ |
| M1.5 | Email verification + password reset qua `MailerPort` (SES / Mailpit) | ⬜ | ADR-008 §9; token schema ✅ |
| M1.6 | Profile API (`UserProfile`) | ⬜ | schema ✅ |
| M1.7 | Privacy: consent API, export job, deletion/anonymize worker (pg-boss) | ⬜ | C-03, ADR-001; schema ✅ |
| M1.8 | Immutable build artifact cơ bản (Dockerfile + digest) | ⬜ | Sau H.2; ADR-008 §11 |

Exit: không content/license blocker P0 ⬜ · privacy request có evidence end-to-end ⬜ ·
release candidate không dùng fixture ⬜.

### M2 — Learner Web Core Learning Loop

Outcome: người học hoàn thành đăng nhập → mục tiêu/lộ trình → bài học → activity → progress.

Backend đã có:

| # | Bước | Trạng thái | Bằng chứng |
| --- | --- | --- | --- |
| M2.B1 | Onboarding goal/plan API | ✅ | `4b80507`; `onboarding.e2e-spec.ts` |
| M2.B2 | Public content read + readiness policy | ✅ | `learning.service.ts`; `learning.e2e-spec.ts` (21 case) |
| M2.B3 | Lesson/topic start-complete, exercise attempt, progress/resume | ✅ | `4f69f31`; `lesson-activity.e2e-spec.ts` |
| M2.B4 | Dictionary prefix search | ✅ | `dictionary.service.ts` (chưa có e2e riêng, T-gap) |
| M2.B5 | Signed media access cho learner | ✅ | `media-access.service.ts`; `media-ingestion.e2e-spec.ts` |

UI và phần backend còn thiếu:

| # | Bước | Trạng thái | Mockup / ghi chú |
| --- | --- | --- | --- |
| M2.1 | Learner session: đăng ký, đăng nhập, đăng xuất qua BFF (cookie riêng cho learner) | ⬜ | `01-onboarding-placement/01,02` |
| M2.2 | Onboarding goal + kế hoạch học UI | ⬜ | `01-onboarding-placement/03,04` |
| M2.3 | Placement test (feature flag): backend chọn câu, chấm, kết quả + UI | ⬜ | `01-onboarding-placement/05,06`; schema `PlacementAttempt` ✅ |
| M2.4 | Trang chủ + lộ trình học | ⬜ | `02-learning-lesson/01,02` |
| M2.5 | Nội dung bài học, activity player (mcq, fill_blank, listening, arrange), hoàn thành | ⬜ | `02-learning-lesson/03,04,05,06` |
| M2.6 | Dictionary search/detail/save-word cơ bản (backend detail + save API còn thiếu) | ⬜ | `03-dictionary-review-reader/01,02` |
| M2.7 | Responsive, keyboard, screen reader, loading/empty/error/offline states | ⬜ | `frontend/DESIGN.md` |
| M2.8 | Product event P0 first-party: activation, lesson completion | ⬜ | ADR-008 §10 |

Exit: flow end-to-end trên production build với backend thật ở staging ⬜ · không bearer
token trong browser storage (BFF đã đảm bảo cho admin ✅) · a11y/perf/security/visual QA ⬜.

### M3 — SRS và Dictionary completion

| # | Bước | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M3.1 | Scheduler policy/version (`ReviewCard` là source of truth) | ⬜ | schema ✅; invariant: archive master plan §16.4 |
| M3.2 | Due queue, review session/event idempotency và concurrency | ⬜ | trigger ownership card→session ✅ |
| M3.3 | Flashcard và lịch ôn tập UI | ⬜ | `03-dictionary-review-reader/03,04` |
| M3.4 | Dictionary detail, ví dụ/audio, saved-word lifecycle | ⬜ | `WordSense/WordExample` chưa có schema (mục 5) |
| M3.5 | Test scheduler correctness, retention, timezone | ⬜ | C-05 |

### M4 — Exam Engine Web MVP

| # | Bước | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M4.1 | Admin question/test authoring + publish workflow | ⬜ | schema 14 model + trigger ✅; `06-admin-cms-operations/05` |
| M4.2 | Start → snapshot → autosave → resume → timer → submit idempotency | ⬜ | `ExamAttemptSnapshot`/`Event` bất biến ✅ |
| M4.3 | Server scoring, result/skill breakdown, explanation policy | ⬜ | |
| M4.4 | Concurrency/capacity test theo workload được duyệt | ⬜ | |
| M4.5 | Learner exam/review/result UI | ⬜ | `04-exam-pronunciation-profile/01–04` |

Đặc tả chi tiết: archive master plan §17. Exit: snapshot không đổi khi content sửa ⬜ ·
submit/retry không double result ⬜ · SLO staging ⬜.

### M5 — Admin Operations, Analytics, Support và Trust

Đã có:

| # | Bước | Trạng thái | Bằng chứng |
| --- | --- | --- | --- |
| M5.B1 | Admin login qua BFF, protected shell, forbidden/session states | ✅ | `ce110e5`, ADR-003 |
| M5.B2 | Exercise list/detail read-only | ✅ | `frontend/src/features/exercises` |
| M5.B3 | Media list/detail + quarantine/archive | ✅ | `69c32bc`, `frontend/src/features/media` |
| M5.B4 | Backend CMS lesson/topic/exercise/import + media ingestion API | ✅ | mục 3 dòng 7, 9, 12 |
| M5.B5 | `GET /users` cho admin | ✅ | cần H.8 |

Còn thiếu:

| # | Bước | Trạng thái | Mockup / ghi chú |
| --- | --- | --- | --- |
| M5.1 | Mutation UI CMS: tạo/sửa/review/publish/import lesson, topic, exercise | ⬜ | `06-admin-cms-operations/02,03,04` |
| M5.2 | Upload media UI + trạng thái processing + reconciliation | ⬜ | |
| M5.3 | User lifecycle admin: role, khoá/mở, audit UX | ⬜ | `06-admin-cms-operations/06` |
| M5.4 | CMS cho Level, Story, Word, Question, Test; generic import; scheduled publish | ⬜ | |
| M5.5 | Dashboard data-quality/content/product/ops (Metabase) | ⬜ | `06-admin-cms-operations/01`; ADR-008 §10 |
| M5.6 | Support ticket / content report taxonomy, API, queue, SLA | ⬜ | |
| M5.7 | Trust & Safety: policy, report/action/appeal/audit, least-privilege roles | ⬜ | |
| M5.8 | Notification preference và consent (nếu vào beta) | ⬜ | |

Exit: 100% mutation nhạy cảm có audit (backend CMS/media ✅, user ⬜) · support queue có
owner/SLA ⬜ · dashboard có reconciliation/runbook ⬜.

### M6 — Project-wide Production Foundation và Web MVP Beta

| # | Bước | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M6.1 | Dockerfile backend/frontend multi-stage non-root; compose local | ⬜ | ADR-008 §11 (H.3 làm compose test trước) |
| M6.2 | CI/CD build-once/promote-many theo digest; SBOM, scan, cosign keyless, attest | 🟡 | Harness media có (A-04); chưa có image dự án |
| M6.3 | Terraform AWS ap-southeast-1: ECS Fargate, RDS 16 PITR, S3, CloudFront + WAF, Secrets Manager, SES | ⬜ | ADR-008 §8; ⛔ chờ kết luận pháp lý mục 6 #8 |
| M6.4 | Staging production-like, environment parity | ⬜ | |
| M6.5 | OTel + Sentry + pino; SLI/SLO journey; dashboards; alerts; incident runbooks | 🟡 | Media metrics/alerts/dashboard ✅ (`ops/observability`); toàn hệ thống ⬜ |
| M6.6 | PostgreSQL backup/PITR, restore drill, RPO/RTO; object-storage retention | ⬜ | |
| M6.7 | Gate capacity, security/privacy, accessibility, dependency/license | ⬜ | |
| M6.8 | Progressive beta rollout, observation window, go/no-go | ⬜ | |
| M6.9 | Live Media Infrastructure Rehearsal | ⛔ | BLOCKED_EXTERNAL |

Checklist go-live và rollback chi tiết: archive master plan §27, §34, §35.

### M7+ — Differentiation và scale

| # | Hạng mục | Trạng thái | Điều kiện bắt đầu |
| --- | --- | --- | --- |
| M7.1 | Interactive reader, materials | ⬜ | Web MVP outcome; mockup `03-dictionary-review-reader/05,06` |
| M7.2 | Pronunciation/shadowing | ⬜ | Consent/retention, provider, rubric |
| M7.3 | Notifications | ⬜ | Preference/consent M5.8 |
| M7.4 | AI/RAG: NestJS service riêng, pgvector, provider adapter ≥2 | ⬜ | ADR-008 §6; corpus có license, golden eval, DPA |
| M7.5 | Hanzi/OCR | ⬜ | Product validation, licensed model |
| M7.6 | Subscription/payment | ⬜ | Business model, legal/tax |
| M7.7 | Mobile React Native + Expo tại `mobile/`; root npm workspaces + `packages/contracts/`; gọi backend trực tiếp bằng bearer trong SecureStore | ⬜ | ADR-008 §1; Web MVP outcome; tiền đề M1.4, H.2, H.4, H.10 |
| M7.8 | Community | ⬜ | Moderation |

## 5. Schema backlog

Model chưa build dù đã có thiết kế (archive `DATABASE_SCHEMA_COMPLETION_PLAN.md`):
`AuthIdentity` (OAuth), `Material`/`MaterialItem`, `ContentAccess`/`Entitlement`,
`WordSense`/`WordExample`/`WordRelation` + `pg_trgm`, `QuestionRevision`/`TestRevision`;
nhóm P1/P2: reader/pronunciation/Hanzi (GĐ5), engagement/notification/support (GĐ7),
payment (GĐ8), AI DB tách riêng (GĐ9).

Hardening dữ liệu: inventory SQL-only object + drift guard (C-07), dọn index (C-08),
timestamptz (C-05), partition/retention cho bảng event, cập nhật data dictionary và ERD
cho migration 16–19, đóng băng schema domain chưa có runtime (Exam, SRS, privacy) tới
khi vertical slice bắt đầu.

## 6. Quyết định mở

| # | Quyết định | Owner | Trạng thái |
| --- | --- | --- | --- |
| 1 | Nguồn chính thức và mô hình riêng cho HSK 7, 8, 9 | Curriculum | ⬜ |
| 2 | Nguồn, license và QA nghĩa tiếng Việt / ví dụ / audio | Content + Legal | ⬜ chặn M1.2 |
| 3 | Web-first hay song song mobile; phạm vi offline | Product Owner | ✅ web-first; mobile RN + Expo là P2 (ADR-008 §1) |
| 4 | OAuth, session management, role ngoài user/admin | Tech Lead | 🟡 session ở M1.4; OAuth và role mở rộng ⬜ |
| 5 | Free/premium boundary, pricing, payment provider | Product Owner | ⬜ deferred P2 |
| 6 | Use case AI đầu tiên, quota, retention, citation/eval, provider | Product + Tech | 🟡 runtime và DB đã chốt (ADR-008 §6); provider ⬜ |
| 7 | Baseline metric learning/exam để roadmap có ngưỡng thành công | Data | ⬜ |
| 8 | Nghĩa vụ lưu trữ dữ liệu cá nhân trong nước (Luật ANM 2018 Đ.26, NĐ 53/2022, NĐ 13/2023) → chọn hosting | Legal | ⬜ chặn M6.3 |
| 9 | Công thức điểm bài học: loại bài chưa làm khỏi mẫu số hay không (D-03) | Product Owner | ⬜ |
| 10 | Chấp nhận ADR-008 (stack còn lại) | Product Owner + Tech Lead | 🔵 |
| 11 | Đóng băng harness release-evidence theo ADR-008 §8 và review A-04 | Tech Lead | 🔵 |

## 7. Việc cần làm ngay (2 tuần tới)

1. H.1 ✅ (04/09). H.15 ✅ và H.13 🟡 (07/09): còn TypeScript 6 backend sau khi có CI.
2. H.2 + H.3: CI trên PR và compose test; đây là lưới an toàn cho mọi bước sau.
3. H.4 → H.9: đóng P0/P1 bảo mật (mỗi mục là một PR nhỏ).
4. H.10: chốt envelope, sau đó bật OpenAPI (ADR-008 §5).
5. Duyệt ADR-008 và quyết định #11 để biết M0.4 đi đâu.
6. Bắt đầu M2.1 + M2.2 như vertical slice đầu tiên cho người học.

## 8. Nhật ký cập nhật

| Ngày | Thay đổi |
| --- | --- |
| 04/09/2026 | Tạo PLAN.md. Tổ chức lại docs (xoá placeholder/duplicate, archive master plan). Review toàn dự án (57 finding). ADR-008 chốt stack còn lại (Proposed). Mobile chốt React Native + Expo. |
| 04/09/2026 | Đồng bộ docs về quyết định mobile: roadmap §3.2/§3.3/§5 bỏ câu "chưa chốt Flutter"; ADR-008 §1 nêu vị trí `mobile/` + `packages/contracts/`, workspaces và tiền đề; overview §2/§5 và M7.7 cập nhật theo. |
| 04/09/2026 | Thêm mục 1 "Lộ trình hoàn thành dự án": GĐ0–GĐ10, 128 task nhỏ, tick theo bằng chứng. H.1 ✅ sau 3 commit; thêm H.15; baseline HEAD `6f74f5b`; đổi số mục 2–8. |
| 07/09/2026 | GĐ1 PR1: H.15 ✅ root README mô tả monorepo (`6f6d2fe`); H.13 🟡 pin Node 24 qua `.nvmrc` + `engines`, `.npmrc save-exact`, `renovate.json` (`6d38f40`). TypeScript 6 backend tách PR riêng theo ADR-008 §12. |
| 07/09/2026 | GĐ1 PR2: H.3a + H.3b ✅. `docker-compose.yml` + `pretest:e2e` dựng DB disposable, `prisma generate` và `migrate deploy`. Chạy thật từ clone mới không cần cấu hình: 163/163 pass, chạy lại lần hai vẫn 163/163. Phát hiện e2e phải chạy `--runInBand` vì các suite đua fixture trên Level dùng chung. |
| 07/09/2026 | GĐ1 PR3: H.2a + H.2b + H.2c 🟡. Thêm `.github/workflows/ci.yml` (ba job, action pin theo SHA, Node từ `.nvmrc`, cache npm theo từng lockfile). Chạy tay đủ chuỗi lệnh của từng job từ clone mới: backend 596/596, frontend 101/101, e2e 163/163. Chưa có run trên GitHub và chưa lint bằng actionlint (không có trên máy). |
| 13/09/2026 | Kiểm tra DB dev `hsk_system`: chỉ có từ điển (121.856 Word, 200.156 nghĩa tiếng Anh, 11.086 mapping level) và 35 lesson placeholder; 0 user/exercise/media. Áp dụng 7 migration còn thiếu (12 → 19) sau rehearsal trên bản sao disposable; tạo `backend/.env` (gitignore) và sửa `.env.example`: `JWT_SECRETS` phải là JSON trong nháy đơn vì dotenv không unescape `\"` (bản cũ làm backend fail-closed khi `cp .env.example .env`); backend khởi động trên DB đã migrate, `GET /api/v1/health` 200; thêm `npm run seed:dictionary`; sửa tham chiếu seed ở 0.3, slice 2, overview §6/§9; ghi bằng chứng dữ liệu vào M1.1–M1.3. |
| 14/09/2026 | GĐ2: H.4a ✅ (`9272c58`): `TRUST_PROXY_HOPS`, tracker `user:<id>` từ bearer JWT đã xác minh hoặc `ip:<req.ip>`, BFF forward `X-Forwarded-For`, nginx route media. H.4b 🟡: migration 20 `RateLimitCounter` + `PostgresThrottlerStorage` cho throttler toàn cục, dùng chung giữa các replica. DB dev `hsk_system` cần `prisma migrate deploy` để nhận migration 20. |
| 14/09/2026 | GĐ2: H.4b ✅ (`a0b1950`, đã push cùng H.4a). H.5 🟡: lockout giữ chỗ nguyên tử trước Argon2, `login` 10/phút/IP, throttle 5 lần sai/15 phút theo email băm SHA-256. |
