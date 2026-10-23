# PLAN — Tiến độ dự án HSK 3.0

> Cập nhật: 13/10/2026 · Baseline: branch `macdev`, HEAD `5d8d81a` (PR #6 vào `main`, chưa merge)
> · Trạng thái tổng: **PRE-BETA**. Backend, admin console và learner app (M2.1–M2.8) có nền; CI chạy trên PR vào `main`
> (run xanh đầu tiên ở PR #5); chưa có branch protection, hạ tầng production.

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
Mẫu HTML local (gitignored) ở `docs/ui_reference/` chia `mobile/`, `web/`, `admin/`.

## 0. Cách dùng file này

1. Mỗi PR chạm một bước thì cập nhật dòng đó: trạng thái + commit/file làm bằng chứng.
2. Chỉ tích ✅ khi flow chạy end-to-end với DB thật và có test; schema hay mockup không đủ.
3. Không sao chép số test/checksum vào đây; dẫn link tới runbook hoặc test file.
4. Thêm dòng vào mục 8 (nhật ký) khi đổi trạng thái milestone.
5. Lộ trình mục 1 và bảng chi tiết mục 4 phải cùng trạng thái cho cùng một mã; bằng
   chứng ghi ở mục 4, mục 1 chỉ ghi ngắn.
6. Tổng = tổng cột 'Task xong / tổng' của bảng 1.1; mỗi GĐ = số dòng có ô trạng thái trong bảng
   của mục GĐ đó, kể cả mã `0.n` và `#n`; chỉ ✅ tính là xong.

## 1. Lộ trình hoàn thành dự án

Lộ trình chia 13 giai đoạn (GĐ0–GĐ12) theo thứ tự dependency: lưới an toàn (CI) trước,
đóng lỗ hổng, rồi xây learner app, mobile và AI cho đồ án tốt nghiệp, sau đó hạ tầng
production và beta. Mỗi task nhỏ
mang mã trùng với bảng chi tiết ở mục 4 (`H.2`, `M2.5`…). Mã có hậu tố chữ (`H.2a`) là
task con của bước cùng mã; bước cha chỉ ✅ khi mọi task con ✅. Hậu tố `E` là điều kiện
ra của giai đoạn. Ước lượng thời gian giả định một dev full-stack làm việc với AI agent,
không tính thời gian chờ pháp lý hoặc hạ tầng bên ngoài; dùng để xếp thứ tự, không phải
cam kết.

### 1.0 Phạm vi đồ án tốt nghiệp

Đồ án nộp và bảo vệ trước **17/01/2027** (15 tuần từ 05/10/2026). Ưu tiên hoàn thiện web,
rồi mobile + AI + nhận diện (GĐ9), rồi deploy bản demo và bảo vệ (GĐ10). Production
foundation và beta (GĐ11) làm sau bảo vệ.

- Thứ tự: GĐ5 → GĐ6 → GĐ7, song song M5.1, M5.2 (GĐ8) và M2.9a → GĐ9 → GĐ10.
- Thiết kế đi trước code: màn nào trong [product/design-coverage.md](./product/design-coverage.md)
  còn thiếu thì làm task M2.UXa–M2.UXd cho màn đó trước khi dựng UI thật.
- Mốc theo lộ trình báo cáo: web đủ chức năng cuối tuần 9 (06/12/2026); GĐ9 tuần 10–13
  (07/12/2026–03/01/2027); GĐ10 tuần 14–15 (04/01–17/01/2027).
- M7.7a có thể bắt đầu sớm hơn tuần 10 nếu web vượt tiến độ. M7.4b–d cần chốt quyết định
  #6 và ADR-008 §6 (M7.4a) trước tuần 12.
- "Staging" trong điều kiện ra của GĐ5 (M2.E) được thoả bằng bản deploy demo TN.1 cho tới
  khi có GĐ11.
- Hoãn sau bảo vệ, giữ nguyên trạng thái: phần còn lại của GĐ3 (M0.3–M0.5, M0.E, #11);
  M5.5–M5.7; M2.1e OAuth; toàn bộ GĐ11 và GĐ12.

### 1.1 Tiến độ theo giai đoạn

| GĐ | Giai đoạn | Điều kiện ra | Task xong / tổng | Ước lượng | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| GĐ0 | Nền tảng đã xây (05/05 → 04/09/2026) | Đã đạt | 18 / 18 | — | ✅ |
| GĐ1 | Ổn định repo, CI, môi trường test | PR nào cũng có CI xanh; e2e chạy một lệnh | 9 / 10 | 1–2 tuần | 🟡 |
| GĐ2 | Đóng lỗ hổng bảo mật và tính đúng đắn | P0/P1 review đóng; envelope + OpenAPI | 14 / 14 | 2–3 tuần | ✅ |
| GĐ3 | Media internal closeout (M0) | Full gate GREEN trên Linux AMD64 | 2 / 8 | 1–2 tuần | 🟡 |
| GĐ4 | Content/legal + Identity/Privacy (M1) | Không blocker license; privacy end-to-end | 11 / 17 | 3–4 tuần | 🟡 |
| GĐ5 | Learner Web Core Loop (M2) | Người học đi hết vòng học trên staging | 39 / 53 | 5–7 tuần | 🟡 |
| GĐ6 | SRS + Dictionary completion (M3) | Ôn đúng hạn, lịch sử bất biến | 0 / 12 | 3–4 tuần | ⬜ |
| GĐ7 | Exam Engine (M4) | Thi trọn flow, kết quả bất biến | 0 / 8 | 4–6 tuần | ⬜ |
| GĐ8 | Admin ops, analytics, support, trust (M5) | Mutation nhạy cảm có audit; support có SLA | 11 / 17 | 4–6 tuần | 🟡 read console |
| GĐ9 | Đồ án: Mobile, AI và nhận diện (M7) | App đủ vòng học; chat AI có trích nguồn; phát âm, viết tay, OCR chạy trên app | 0 / 16 | 4 tuần | ⬜ |
| GĐ10 | Đồ án: Deploy demo và bảo vệ (TN) | Hội đồng mở được web, cài được app; bảo vệ 17/01/2027 | 0 / 6 | 2 tuần | ⬜ |
| GĐ11 | Production foundation + Beta (M6), sau bảo vệ | Promote, rollback, restore có bằng chứng; beta go | 0 / 9 | 4–6 tuần | ⬜ (⛔ M6.3, M6.9) |
| GĐ12 | Sau beta: reader, payment, community (M7+) | Theo outcome beta | 0 / 3 | — | ⬜ |

Tổng: **104 / 191 task**. Đường găng tới bảo vệ đồ án: GĐ5 → GĐ6 → GĐ7 → GĐ9 → GĐ10; đường
găng tới beta sau bảo vệ: GĐ4 → GĐ11. GĐ3 chạy
ngay sau GĐ1; GĐ8 (M5.1, M5.2) có thể chạy song song GĐ5 vì cần để soạn nội dung thật;
GĐ6 và GĐ7 có thể đổi chỗ theo ưu tiên sản phẩm. Ba bước sản xuất nội dung M1.2b, M2.9,
M4.6 là track biên soạn chạy song song từ GĐ4 và chỉ gate ở M6.7 (xem 1.2).

### 1.2 Dữ liệu: có gì, đủ sau bước nào, còn thiếu gì

Kiểm tra DB dev `hsk_system` ngày 13/09/2026 (19/19 migration). Không có bước nào mà sau đó
database "đủ toàn bộ dữ liệu": schema và công cụ nhập liệu đủ theo giai đoạn, còn nội dung
thật là track biên soạn chạy song song và chỉ được gate ở M6.7. Chỉ tiêu dưới đây là đề
xuất, chờ quyết định #12.

| Lớp dữ liệu | Hôm nay | Đủ sau bước | GĐ |
| --- | --- | --- | --- |
| Schema Web MVP | 59 model; thiếu `WordSense`/`WordExample`/`WordRelation`, `pg_trgm` | M3.4a | GĐ6 |
| Schema tính năng M7 (OAuth, Material, Entitlement, QuestionRevision) | chưa có | backlog mục 5, theo từng tính năng | GĐ9, GĐ12 |
| Từ điển tiếng Anh | 121.856 Word, 200.156 WordMeaning (CC-CEDICT, CC BY-SA 4.0) | đã đủ | GĐ0 ✅ |
| Mapping từ theo cấp HSK | 11.086 WordLevel; 7 DataSource HSK chưa có license | M1.1 | GĐ4 |
| Nghĩa tiếng Việt | 0 | M1.2a workflow → M1.2b 2.263 từ HSK1–HSK3 | GĐ4, song song tới GĐ8 |
| Ví dụ câu, audio, stroke cho từ | 0; `Word.audioId`/`imageId` đều null | M3.4a/b schema và API; dữ liệu theo M2.9; media cần M5.2, M6.9 | GĐ6, GĐ8, GĐ11 |
| Bài học, topic, story thật | 0; 35 Lesson, 70 Topic, 14 Story placeholder | M1.3 xoá placeholder; M2.9a pilot 5 bài HSK1; M2.9 nội dung HSK1–HSK3 | GĐ4, GĐ5 |
| Bài tập trong bài học | 0 LessonExercise | M2.9 (API authoring/import đã có; UI M5.1b1) | GĐ5, GĐ8 |
| Câu placement | 0 | M2.3a code; câu lấy từ M4.6 | GĐ5, GĐ7 |
| Ngân hàng câu hỏi, đề thi | 0 trên 14 bảng Exam | M4.1 công cụ; M4.6 dữ liệu HSK1–HSK3 | GĐ7 |
| Media (audio, ảnh) | 0 Media; S3/ClamAV thật chưa có | M5.2 upload UI; M6.9 rehearsal ⛔ | GĐ8, GĐ11 |
| Dữ liệu vận hành: User, Progress, ReviewCard, ExamAttempt | 0 | sinh ra từ beta M6.8; không có mốc "đủ" | GĐ11 trở đi |

Mốc gộp:

- Đủ schema Web MVP: sau **M3.4a** (GĐ6).
- Đủ công cụ nhập mọi loại nội dung: sau **M5.4** (GĐ8).
- Đủ nội dung cho beta (HSK1–HSK3): khi **M1.2b, M2.9, M4.6** đạt chỉ tiêu, kiểm ở **M6.7** (GĐ11).

**Sau khi hết PLAN, data vẫn còn thiếu:**

1. Nghĩa tiếng Việt cho 8.823 từ HSK4–HSK7_9 và 110.770 từ CC-CEDICT ngoài HSK: chỉ có
   tiếng Anh, chưa có bước nào.
2. Bài học, bài tập, đề thi cho HSK4–HSK7_9: chỉ lên kế hoạch sau beta; riêng HSK7–9 chưa
   có nguồn chính thức và mô hình riêng (quyết định #1).
3. Audio phát âm, ví dụ câu, stroke animation cho 11.086 từ HSK: chưa có nguồn hoặc license
   (TTS hay thu âm), nằm trong quyết định #12.
4. Media thật trên S3/ClamAV: 0 cho tới khi M6.9 hết ⛔.
5. Reader materials, corpus pronunciation, corpus AI có license: M7.1, M7.2, M7.4.
6. Dữ liệu vận hành và baseline metric (quyết định #7): dashboard M5.5 không có gì để đo cho
   tới sau beta.
7. Provenance/license 7 HSK word list: tới khi M1.1 xong, 11.086 mapping và mọi nội dung
   dựa vào nó vẫn ở trạng thái chưa xác minh.

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
| H.2a | `ci.yml` backend: `npm ci --ignore-scripts`, `prisma validate`, lint, format, tsc, jest | ✅ | 07/09: `f7c6d9b`, `665074d`. 28/09: job `backend` xanh trên GitHub, PR #5 run `36375778246` |
| H.2b | `ci.yml` backend e2e với Postgres service; tên DB kết thúc `test` | ✅ | 07/09: `f7c6d9b`. 28/09: run đầu `36374888359` fail 1 case vì superagent serialize payload lồng 5.000 cấp thành chuỗi placeholder trên Node 24 (sửa `b79b8ed`); job `backend-e2e` xanh ở run `36375778246` |
| H.2c | `ci.yml` frontend: lint, typecheck, vitest, `test:generated-types` | ✅ | 07/09: `f7c6d9b`. 28/09: job `frontend` xanh, PR #5 run `36375778246` |
| H.2d | Branch protection `main`: required checks, không push thẳng | ⬜ | 28/09: GitHub trả `Branch not protected`. Cần chủ repo bật: required checks `backend`, `backend-e2e`, `frontend` từ app GitHub Actions, strict (nhánh phải cập nhật), áp cả admin, bắt buộc PR (0 approval vì một dev), cấm force-push và xoá nhánh |
| H.3a | `docker-compose.yml`: Postgres 16 (profile mặc định), MinIO/ClamAV/Mailpit (profile `dev`) | ✅ | 07/09: `b011518`. Chọn `docker-compose.yml` + profile thay tên `docker-compose.test.yml` để `docker compose up -d` không cần cờ `-f` |
| H.3b | `pretest:e2e` tạo DB disposable + migrate; docs một lệnh chạy e2e | ✅ | 07/09: `b011518`, `41f471d`, `1751aff`. Clone mới, không set biến nào: 163/163 pass, lặp lại vẫn 163/163 |
| H.13 | `.nvmrc` Node 24, `.npmrc save-exact`, TypeScript 6 cả hai package, Renovate | ✅ | 07/09: `6d38f40` (.nvmrc, engines, .npmrc, renovate.json). 28/09: `58d5c5e` nâng TypeScript backend lên 6.0.3 exact khớp frontend (ADR-008 §12); PR #5 run `36378049255` xanh 3 job (`backend`, `backend-e2e`, `frontend`) |
| H.15 | Root `README.md`: thay boilerplate NestJS bằng mô tả monorepo, trỏ `docs/README.md` | ✅ | 07/09: `6f6d2fe` |
| H.16 | Điều tra e2e flaky (onboarding #15 + concurrency poll); giải quyết 2 điều kiện review D-04 | ✅ | 29/09: `28cd345` (kèm `48ad32b`), PR #5 run `36514585300`. Supertest tự `listen(0)`/`close()` mỗi request khi app chỉ `init()`, response lỗi đến từ process khác trên loopback (không có `x-request-id`); đo được: mặc định 3/116 fail, tắt keep-alive 3/100 fail, listen một lần 0/200 fail; áp dụng cho cả 8 suite `init()`-only; thực hiện L1+L2 D-04 trong `backend/test/media-ingestion-concurrency.e2e-spec.ts`; 10 lượt `test:e2e` toàn bộ PASS |

### GĐ2 — Đóng lỗ hổng bảo mật và tính đúng đắn (2–3 tuần, mỗi task một PR)

Vào: GĐ1 có CI. Ra: P0/P1 trong review đóng; response envelope thống nhất; `openapi.json` sinh trong CI.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| H.4a | `trust proxy`, nginx `X-Forwarded-For`; throttler tracker `req.user.id ?? req.ip` | ✅ | A-02. 14/09: `9272c58`. `TRUST_PROXY_HOPS` (mặc định 1); `CustomThrottlerGuard` tự xác minh bearer JWT vì APP_GUARD chạy trước `JwtAuthGuard` (`req.user` chưa có); `login`/`register` giữ bucket IP; BFF forward XFF nguyên chuỗi; nginx route media. jest 612, e2e 163, vitest 108 pass |
| H.4b | Rate limit theo user bằng bảng Postgres theo mẫu `MediaUploadRateLimit` | ✅ | ADR-008 §2. 14/09: `a0b1950`. migration 20 `20260914090000_rate_limit_counter` (bảng purgeable `RateLimitCounter`); `PostgresThrottlerStorage` upsert nguyên tử một câu lệnh, đồng hồ DB, cleanup batch `SKIP LOCKED` mỗi 60 s; bằng chứng đồng thời/đa replica: `backend/test/rate-limit-storage.e2e-spec.ts`. Harness `test:db:media-migration*` còn hard-code 19 migration → H.11a |
| H.5 | Lockout tăng nguyên tử; login ~10 req/phút/IP + throttle theo email | ✅ | B-01. 14/09: `ac7faa4`. câu `UPDATE` giữ chỗ lượt thử trước Argon2 (khoá thì không hash), `login` 10/phút/IP, 5 lần sai/15 phút/email qua `PostgresThrottlerStorage`; bằng chứng `backend/test/auth-lockout.e2e-spec.ts`, `backend/src/modules/auth/auth.service.spec.ts` |
| H.6 | Xoá nhánh so sánh password plaintext | ✅ | B-02. 14/09: `039b6af`. `verifyPassword` chỉ nhận `$argon2id$`, bỏ upgrade hash inline; bằng chứng `backend/src/modules/auth/auth.service.spec.ts` (stored password format), `backend/test/auth.e2e-spec.ts` |
| H.7 | 401 chung, verify giả với hash tĩnh; register trả 409 | ✅ | B-06. 14/09: `3db5ae1`. email lạ và account inactive verify Argon2id với hash mồi rồi `401` chung; chỉ account khoá trả `403`, BFF gắn `kind: account_locked`, form login hiện lý do; register trùng (kể cả race `P2002`) → `409`; bằng chứng `backend/test/auth.e2e-spec.ts`, `frontend/src/features/auth/login-form.spec.tsx` |
| H.8 | `GET /users` phân trang + lọc soft-delete | ✅ | B-05. 14/09: `99fb219`. `GET /users` nhận `page`/`limit` (`PaginationQueryDto`, limit ≤ 100), trả `{ items, total, page, limit, totalPages }`, bỏ user có `deletedAt`; `getProfile` chỉ đọc account `active` chưa soft-delete (404); `page` chặn ≤ 2147483647 cho mọi list dùng DTO chung (trước đó `page=1e20` → 500); bằng chứng `backend/test/users.e2e-spec.ts`, `backend/src/modules/user/user.service.spec.ts` |
| H.9 | `MEDIA_STORAGE_PROVIDER`/`MEDIA_SCANNER_PROVIDER` tường minh, assert lúc boot | ✅ | B-04. 14/09: `e6e6620`. adapter chọn theo `media.storageProvider`/`media.scannerProvider` (mặc định `s3`/`clamav` ở mọi môi trường); `assertMediaProviders` trong config validation chỉ nhận `memory`/`test` khi `NODE_ENV=test`, còn lại process không khởi động; bucket/region/scanner host bắt buộc theo provider thay vì theo `NODE_ENV`; bỏ signing secret, metrics token và `MEDIA_INGESTION_ENABLED=true` mặc định dưới `NODE_ENV=test`, e2e khai báo tường minh trong `backend/test/utils/e2e-environment.ts`. Còn lại của B-04: throttle 1.000/phút dưới `NODE_ENV=test`. Bằng chứng `backend/src/infrastructure/media-adapter-wiring.spec.ts`, `backend/src/config/env.validation.spec.ts`, `backend/src/config/runtime-security.spec.ts` |
| H.10a | APP_INTERCEPTOR + APP_FILTER envelope toàn cục; echo `x-request-id` | ✅ | A-03. 14/09: `37e0198`. `TransformInterceptor` bọc `{ success, data, meta: { requestId, timestamp, pagination? } }` (service trả `{ success, data, meta }` được bóc, phân trang vào `meta.pagination`; `@RawResponse()` cho bytes media); `GlobalExceptionFilter` trả `{ success: false, error: { code, message, details? }, meta }`, lỗi không phải HttpException → `500` chung, message parser/404 không trích input; `RequestIdMiddleware` nhận UUID hoặc 32 hex nginx, echo `X-Request-ID`, audit CMS dùng cùng id. Bằng chứng `backend/test/response-envelope.e2e-spec.ts`, `backend/src/common/{middleware,interceptors,filters}/*.spec.ts`; Playwright với backend thật pass |
| H.10b | Cập nhật `api.md` §1 và Zod contract frontend theo envelope mới | ✅ | 14/09: `37e0198`, làm cùng H.10a: đổi envelope mà không sửa BFF thì login gãy. `frontend/src/lib/api/backend-envelope.ts` parse envelope backend, BFF giữ shape trả browser; `docs/api/api.md` §1, A.1–A.3, A.5, A.10–A.12 |
| H.10c | Cài `@nestjs/swagger`, xuất `openapi.json` trong CI, `openapi-typescript` cho frontend | ✅ | ADR-008 §5. `f2448d3` (Tech Lead duyệt). `@nestjs/swagger` 11.4.7 + CLI plugin; `backend/openapi.json` commit trong repo, `npm run openapi:generate` sinh ở preview mode (không cần DB), CI backend `npm run openapi:check` fail khi lệch. Mọi operation có envelope §1, lỗi `default`, `X-Request-ID` tuỳ chọn, security `JWT` đúng route có `JwtAuthGuard`; `data` có schema cho call BFF và public learning, endpoint khác `data` chưa có schema. Swagger UI `/api/docs` chỉ `NODE_ENV=development`. Frontend `openapi-typescript` 7.13.0 → `src/lib/api/backend-generated-types.ts` (chỉ type, không fetch client). Bằng chứng `backend/src/common/openapi/openapi-document.spec.ts`, `frontend/src/lib/api/backend-openapi-contract.spec.ts` (type fresh, response document của call BFF qua được Zod) |
| H.11a | Migration: bỏ `BEGIN/COMMIT` (25P02); resolver migration tham số hoá | ✅ | C-01, C-02. `46396d7` (Tech Lead duyệt). bỏ `BEGIN/COMMIT` ở 6 migration (checksum mới, runbook P0 §19); resolver `migrate:resolve:rolled-back:production -- --target-migration <name>` tính số migration đứng trước từ catalog; catalog/historical root của harness đọc động; `MIGRATION_STATEMENT_TIMEOUT_MS` cho deploy |
| H.11b | Pin UTC/timestamptz; unique index goal/plan | ✅ | C-05, C-04. `e350948` (Tech Lead duyệt). migration 21 `20260916090000_user_active_goal_plan_unique` (partial unique index + preflight, runbook P0 §20); service map `P2002` → 409; session Prisma, deploy và resolver ghim `TimeZone=UTC`; chưa chuyển cột sang `timestamptz` |
| H.12 | Prisma `$disconnect`; `canonicalJson` maxDepth; idempotency TTL | ✅ | D-06, D-01, D-02. `56168cb` (Tech Lead duyệt). `PrismaService` dùng `OnModuleDestroy` (bỏ dead code `enableShutdownHooks`); chặn độ sâu JSON hai lớp — middleware biên `REQUEST_JSON_MAX_DEPTH=32` (duyệt không đệ quy, vì `ValidationPipe` vỡ stack trước khi tới `canonicalJson`) và `CANONICAL_JSON_MAX_DEPTH=16`; idempotency key hết hạn sau 24 h trả 400 |
| H.14 | Frontend: xoá/redact 5 route BFF không dùng; focus archive; logout kiểm `ok`; `/api/session/me` chỉ xoá cookie khi 401/403 | ✅ | E-01, E-02. 26/09 (Tech Lead duyệt): xoá 4 route BFF đọc không consumer (`/api/admin/exercises[/:id]`, `/api/admin/media[/:id]`); `/api/session/me` giữ lại (Playwright dùng), chỉ xoá cookie khi 401/403, 5xx/mạng trả 500/503 giữ cookie; focus archive/quarantine không rơi về `<body>`; logout chỉ rời trang khi `ok`; 4 trang admin map 403 → `/forbidden` vì layout không render lại khi điều hướng client |

### GĐ3 — Media internal closeout, M0 (1–2 tuần, ngay sau GĐ1)

Vào: GĐ1 có CI để gate chạy trên Linux AMD64. Ra: không còn P0/P1 media; full internal gate GREEN.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M0.1 | Deadline/cancellation ClamAV 10 s, S3 8 s | ✅ | |
| M0.2 | Cleanup recovery, secret scan, availability SLI | ✅ | |
| M0.3 | Forward-only migration, bounded lock deploy | 🟡 | script đã commit `6f74f5b`; H.11a ✅ `46396d7` (C-01, C-02 đóng) |
| M0.4 | Validate K8s artifact, OCI identity, Linux AMD64 | 🟡 | gate chặn bởi producer policy; phụ thuộc #11 |
| M0.5 | Owner, risk/decision register, evidence contract | 🟡 | roadmap đã commit; owner chưa gán |
| #10 | Duyệt ADR-008 | 🟡 | §1, §2, §9 đã chốt (§2, §9: Product Owner 29/09/2026); còn lại 🔵 |
| #11 | Đóng băng harness release-evidence hay giữ (ADR-008 §8, A-04) | 🔵 | quyết định M0.4 ở lại hay chuyển M6.2 |
| M0.E | Đóng P2 media còn lại: B-07 TTL signed URL và secret previous, D-04 limiter per process; full gate GREEN | 🟡 | B-07 (`f51c71b`); D-04 đã đóng ở `6a61efc` (run `36407315763`, limiter per process + busy 503; huỷ việc sau nhận body được bỏ theo review 28/09); còn full gate Linux AMD64 (#11) |

### GĐ4 — Content/legal + Identity/Privacy, M1 (3–4 tuần)

Vào: GĐ2 xong H.4–H.7. Ra: không blocker license P0; privacy request có bằng chứng end-to-end; RC không dùng fixture. M1.2b là track biên soạn, không phải điều kiện ra GĐ4.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M1.1 | Xác minh license/provenance 7 HSK word list; attribution CC-CEDICT | ⬜ | R1; quyết định #2. DB dev 13/09: 7 `DataSource` HSK không có license, `referenceUrl` trỏ file trong repo |
| M1.2a | Workflow nghĩa tiếng Việt: import theo `DataSource`, reviewer duyệt, rollback theo batch | ⬜ | chặn bởi #2. DB dev 13/09: 200.156 `WordMeaning` đều tiếng Anh, 0 `meaningVi` |
| M1.2b | Nhập nghĩa tiếng Việt đã duyệt cho 2.263 từ HSK1–HSK3 trước beta (HSK1 530, HSK2 765, HSK3 968) | ⬜ | chỉ tiêu 🔵 #12; chạy song song GĐ5–GĐ8, gate ở M6.7; 8.823 từ HSK4–HSK7_9 sau beta |
| M1.3 | Loại content Temporary/fixture khỏi release candidate | ⬜ | DB dev 13/09: 35 Lesson, 70 Topic, 14 Story đều là seed "Temporary" từ `seed:learning` |
| M1.4a | Refresh token lưu hash trong `UserSession`; access token gắn session (`sid`) | ✅ | B-03. 29/09: `1b27a45`, PR #5 run `36521807782`. Xoay vòng refresh token, DB lưu hash sha256, access token gắn sid; access giữ 7d |
| M1.4b | Logout revoke session; khoảng ân hạn refresh 10 s | ✅ | B-03. 29/09: `08a78ea`, PR #5 run `36533471666`. POST /auth/logout (204) thu hồi session theo sid, khoảng ân hạn 10s cho race refresh |
| M1.4c | BFF refresh trong proxy, cookie refresh, hạ access 15 phút | ✅ | tiền đề mobile; 29/09: ✅ đã đóng (`01f468c`, PR #5 run `36547912748`) |
| M1.5a | `MailerPort` + adapter SES và Mailpit | ✅ | ADR-008 §9; 30/09: `685f441`, kèm `ba83411`, PR #5 run `36672199065` |
| M1.5b | Email verification (token hash) | ✅ | 30/09: `2df43f5`, kèm `c543fd9`, `ff13c40`, PR #5 run `36684650025`. Xác thực email một lần qua link hash SHA-256 TTL 24h, fragment #token= |
| M1.5c | Password reset (token hash, dùng một lần) | ✅ | 30/09: `4ca031b`, kèm `9e67628`, `ec3b901`, PR #5 run `36689833324`. Đặt lại mật khẩu một lần qua link hash SHA-256 TTL 30m, revoke sessions, fragment #token= |
| M1.6 | Profile API (`UserProfile`) | ✅ | 30/09: `3c9b3b5`, kèm `a9adb2a`, PR #5 run `36696120929`. GET/PATCH /users/me/profile, GET mặc định không tạo dòng, PATCH atomic upsert chống race, validate displayName (1–50 code point, chặn bidi/Cc), timezone IANA chuẩn định dạng và lưu nguyên bản, không có avatarUrl |
| M1.7a | pg-boss trên PostgreSQL + worker process | ✅ | ADR-008 §2 |
| M1.7b1 | Export dữ liệu cá nhân (JSON qua S3 private, TTL 24h, purge 7d) | ✅ | ADR-001; 01/10: `57eac10`, kèm `65b96df`, `f2e2b85`, PR #5 run `36808552129`. POST/GET /users/me/data-exports, GET /users/me/data-exports/:id/download, worker privacy.data-export snapshot RepeatableRead, cron privacy.purge-expired-exports |
| M1.7b2 | Consent API | ⬜ | Chờ quyết định Product Owner: version terms/privacy, consent lúc đăng ký |
| M1.7c | Deletion request + anonymize worker | ✅ | 30/09: `b1aa20e`, kèm `2b0f0b5`, `3123025`, PR #5 run `36705287180`. POST /users/me/deletion-request 7 ngày, huỷ qua login, worker anonymize, C-03 |
| M1.8 | Dockerfile backend/frontend + digest | ✅ | ADR-008 §11; 15/10: ✅ đã đóng (`29e23ac`, run `38684167028`); image ID amd64 backend `03ac99c86809`, frontend `6f4aec84fa3d`; docs/operations/CONTAINER_IMAGES.md |
| M1.E | Privacy export/delete có evidence end-to-end; RC không fixture | ⬜ | |

### GĐ5 — Learner Web Core Loop, M2 (5–7 tuần)

Vào: GĐ4 xong M1.4, M1.5. Ra: người học đi hết đăng nhập → mục tiêu → bài học → activity → progress trên production build với backend staging.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M2.B1 | Onboarding goal/plan API | ✅ | `4b80507` |
| M2.B2 | Public content read + readiness policy | ✅ | `learning.e2e-spec.ts` |
| M2.B3 | Start/complete, attempt, progress/resume | ✅ | `4f69f31`; contract `start` đổi theo Q18 (M2.B9): bài chưa mở trả `409 lesson_locked` |
| M2.B4 | Dictionary prefix search | ✅ | thiếu e2e riêng |
| M2.B5 | Signed media access cho learner | ✅ | `media-access.service.ts` |
| M2.B6 | Lưu lý do học `learningPurpose` cho UserGoal | ✅ | 05/10: ✅ đã đóng (`d1c249e`, `5b1e87e`, `ada69f3`, `3f6896d`, PR #5 run `37259009433`) |
| M2.B7 | Job gửi nhắc nhở học theo reminderEnabled/reminderTime | ⬜ | PO 05/10: UI lưu tuỳ chọn, câu phụ "Nhắc nhở sẽ được gửi khi tính năng ra mắt"; cải tiến R20 (mục 5.1) |
| M2.B8 | GET /levels trả code/minBand/maxBand; seed e2e HSK2/HSK3/HSK7_9 | ✅ | 05/10: ✅ đã đóng (`32ebce0`, `830aa81`, `c869fe1`, `c8373ca`, `36c236a`, `256bd00`, `c4270b0`, `4d5b5a2`, PR #5 run `37265687035`) |
| M2.B9 | `GET /learning/path` (trạng thái bài done/current/available/locked, `nextLesson`) và khoá bài tuần tự ở `POST /learning/lessons/:lessonId/start` (Q18) | ✅ | 07/10: ✅ đã đóng (`35464e9`, `f944589`, `82ced4e`, `529f1da`, `4823c2c`, PR #5 run `37574103921`) |
| M2.B10 | `GET /learning/home`: Mục tiêu hôm nay, Chuỗi ngày học do backend tính (Q13) | ✅ | 09/10: ✅ đã đóng (`89c991d`, `a144a71`, `019f1a7`, `3613c00`, PR #5 run `37884908537`); dùng lại `selectNextLesson` của M2.B9 |
| M2.B11 | Rate limit theo route cho luồng learner: `GET /auth/me` 120/phút/user, `POST /learning/exercises/:exerciseId/attempts` 60/phút/user; sửa mô tả rate limit trong `docs/api/api.md` và `docs/architecture/overview.md` (20/phút là cho mỗi route và mỗi user/IP) | ✅ | 11/10: ✅ đã đóng (`ca0462f`, `c1e0ec9`, `1ec914c`, `b16401e`, PR #6 run `38104896978`); kèm việc nhỏ còn lại của M2.7d (`client-bundle-guard.spec.ts`, padding panel trống) |
| M2.B12 | Media cho player M2.5 | ✅ | Phạm vi 12/10: `GET /media/:id/content` đếm 60/phút theo grant (`grant:` + SHA-256 của mediaId:expires:signature, không chứa chữ ký; grant sai dạng hoặc ngoài cửa sổ hạn thì đếm theo IP) cộng throttler `mediaContentIp` 600/phút/IP chỉ cho route này; `GET /media/:id/access` 120/phút/user; TTL learner 300 giây; điều kiện cấp grant cho learner dùng đúng predicate của route attempts (`PUBLIC_LESSON_EXERCISE_WHERE` + `buildLessonReadyWhere()`, có Level published); Range một đoạn → 206, ngoài kích thước → 416 envelope JSON, còn lại 200 cả file, `Accept-Ranges: bytes`; nginx `limit_req` 20r/s burst 200, 429 `private, no-store`; docs `api.md`, `overview.md`. Chưa làm: `test:ops:media:linux-amd64` và live rehearsal (mode RELEASE), audio từ vựng. Đầu vào: `GET /media/:id/content` là route public nên bị đếm theo IP: learner sau NAT/CGNAT chia chung 20/phút; signed URL của learner sống 60 giây, nghe lại phải xin access mới; ký URL cho từng từ vựng sẽ vượt 20/phút ở `media/:id/access`; nginx chưa có `limit_req`, tức lớp anonymous mà ADR-008 §2 dựa vào chưa tồn tại; cần quyết định trước khi làm M2.5b; backlog 11/10: media grant của learner không kiểm Level published; phương án PO 11/10 (Q46): route content đếm lượt theo mediaId + chữ ký thay cho IP, route access đếm theo user khoảng 120/phút, TTL learner 300 giây, kiểm thêm Level published, thêm nginx `limit_req` trong `ops/`, kiểm Safari có hỗ trợ Range không, audio từ vựng để task sau; 12/10: ✅ đã đóng (`578ca94`, `5de2b86`, PR #6 run `38204114744`) |
| M2.B13 | Mở rộng `GET /learning/lessons/:lessonId/activity` cho màn bài học (Q43): `level`, `position`, `state` cùng nguồn với `GET /learning/path`, `sections` (từ vựng, ngữ pháp, luyện tập) | ✅ | 11/10: ✅ đã đóng (`e9dfee5`, `83618ee`, `b2419c8`, `0dd29ac`, PR #6 run `38110835934`) |
| M2.B14 | Backend: GET /dictionary tra thêm theo nghĩa tiếng Việt (bỏ dấu) và tiếng Anh (Q64) | ✅ | PO 12/10; làm trước M2.6b; dữ liệu thật hôm nay chỉ có nghĩa tiếng Anh (M1.2a chưa làm); commit `5089fee`; 12/10: ✅ đã đóng (`5089fee`, `98af98d`, PR #6 run `38264090030`) |
| M2.1a | Learner session BFF: cookie riêng, route `/api/learner/session/*` cho learner | ✅ | ADR-003; 01/10: `2bd2da9`, kèm `13b9d72`, PR #5 run `36815829812`. POST login/register/logout, GET me, cookie riêng LEARNER_SESSION_COOKIE_NAME, chặn role admin 403 admin_account, proxy refresh theo đường dẫn |
| M2.1b | UI đăng ký, đăng nhập, đăng xuất | ✅ | mockup 01/01,02; 05/10: ✅ đã đóng (`8d09d41`, `23ecd30`, `d774724`, `cc9b0e9`, `88d155f`, PR #5 run `37255512085`). 6 route /(learner), guard server, form auth, nút logout, Playwright e2e |
| M2.1c | Trang `/verify-email` (frontend) | ✅ | Việc còn lại sau M1.5b: nhận fragment `#token=`, gọi confirm API; Q71–Q74: thêm `/forgot-password` và link "Quên mật khẩu?" (Q71), xác thực khi bấm nút (Q72), gửi lại (Q73), nút chính jade-800 cả luồng (Q74); commit `5e46bef`; 13/10: ✅ đã đóng (`5e46bef`, `03734f0`, PR #6 run `38343537592`) |
| M2.1d | Trang `/reset-password` (frontend) | ✅ | Việc còn lại sau M1.5c: nhận fragment `#token=`, form mật khẩu mới, gọi POST /auth/password-reset/confirm; Q71–Q74: thêm `/forgot-password` và link "Quên mật khẩu?" (Q71), xác thực khi bấm nút (Q72), gửi lại (Q73), nút chính jade-800 cả luồng (Q74); commit `5e46bef`; 13/10: ✅ đã đóng (`5e46bef`, `03734f0`, PR #6 run `38343537592`) |
| M2.1e | OAuth Google/Apple/Facebook | ⬜ | Nút trên UI hiện báo "Tính năng sắp ra mắt.", chờ backend OAuth |
| M2.1f | Nội dung thật /terms, /privacy — gắn M1.7b2 | ⬜ | Hiện là trang tĩnh tạm thời, gắn quyết định Consent M1.7b2 |
| M2.1g | Thay hình minh hoạ trang chào bằng file gốc độ phân giải cao (hiện cắt từ mockup 310px) | ⬜ | Assets SVG/@3x khi có |
| M2.2 | UI onboarding goal + kế hoạch học | ✅ | 05/10: ✅ đã đóng (`4549dcd`, `218e0d3`, `fe89443`, `01c1ffd`, `2d16b74`, `2dfb834`, `0f08df2`, PR #5 run `37281941987`); 01/03,04; 2 route goal/plan, pure routeForOnboarding, BFF complete, Playwright 118 pass, so pixel 26/26 và 40/40 PASS |
| M2.3a | Placement backend: chọn câu, chấm, kết quả (feature flag) | ⬜ | `PlacementAttempt` schema ✅; cải tiến R1 (mục 5.1) |
| M2.3b | Placement UI | ⬜ | 01/05,06; cải tiến R2 (mục 5.1) |
| M2.4 | Trang chủ + lộ trình học | ✅ | 02/01,02; 12/10: ✅ phạm vi 02/01,02 đã phủ bởi M2.4a, M2.4b |
| M2.4a | Trang chủ + tab bar + `/learn/profile` (Q14–Q17) | ✅ | 09/10: ✅ đã đóng (`b3e85a9`, `46690c6`, `b8645cf`, PR #5 run `37917119665`); việc còn lại (forced colors icon tab, test hồi quy) đã đóng cùng M2.4b 10/10; `02-learning-lesson/01`; Q21–Q24 |
| M2.4b | Lộ trình (Q18–Q20) | ✅ | 10/10: ✅ đã đóng (`618b302`, `2c36586`, `d34c3b8`, PR #5 run `38016160000`); `/learn/path`, tab Học; `02-learning-lesson/02`; Q25–Q31 |
| M2.5a | Trang nội dung bài học | ✅ | 11/10: ✅ đã đóng (`7159999`, `f376863`, `f61b0f8`, PR #6 run `38144395840`); 02/03; Q32–Q44 |
| M2.5b | Activity player: khung, arrange_sentence, mcq, fill_blank | ✅ | 02/04, 02/05 phần lưới; Q45, Q47–Q50; 12/10: ✅ đã đóng (`c5647e0`, `2f0b720`, `d92675f`, PR #6 run `38200991127`) |
| M2.5c | Activity player: listening_choice (cần M2.B12) | ✅ | 02/05; Q45, Q48, Q54–Q57; audio qua BFF cùng origin (`/api/learner/media/:id/access`, `/api/learner/media/:id/content` chuyển tiếp Range), giữ `media-src 'self'`; chưa đo tỉ lệ 429 của bucket grant (backlog M2.B12 mục 2), vẫn để backlog; 12/10: ✅ đã đóng (`fc52f26`, `5014020`, `3c7c049`, run `38213402357`) |
| M2.5d | Hoàn thành bài, tổng kết, cập nhật progress | ✅ | 02/06; Q58–Q61; BFF `POST /api/learner/topics/:id/complete` (body `{ lessonId }`) và `POST /api/learner/lessons/:id/complete` (đóng topic đã đủ attempt rồi complete bài, `409` + progress `done` là thành công); player đóng topic sau bài tập cuối của topic, xong bài tập cuối hoặc mở player khi mọi bài tập đã có attempt thì complete và chuyển `/learn/lessons/:id/complete`; màn Hoàn thành không XP/thành tích, điểm `Math.round(Progress.score)`; 12/10: ✅ đã đóng (`c8d2348`, `36e332a`, PR #6 run `38232025356`) |
| M2.5e | Trình phát nghe: chọn tốc độ (0,75x / 1x) và nghe lại, dùng cho bài listening và thi thử | ⬜ | khảo sát đối thủ 10/10 (Migii HSK); tuỳ chọn phía client, không đổi API |
| M2.6a | Backend dictionary detail + save-word API | ✅ | Q62, Q63; chi tiết từ public, lưu/bỏ lưu (JWT, Idempotency-Key); search thêm id; commit `6b1397b`; 12/10: ✅ đã đóng (`6b1397b`, `ef51c56`, PR #6 run `38238233906`) |
| M2.6b | UI tra từ, chi tiết, lưu từ | ✅ | 03/01,02; Q62–Q70; kèm giới hạn đọc dictionary theo route; commit `230b821`; review 12/10: commit PASS, còn thiếu `/api/learner/dictionary/:path*` trong matcher `frontend/src/proxy.ts` (sửa cùng M2.1c/d); commit `5e46bef`; 13/10: ✅ đã đóng (`5e46bef`, `03734f0`, PR #6 run `38343537592`); sửa matcher proxy ở `5e46bef` |
| M2.7 | Responsive, keyboard, screen reader, loading/empty/error/offline | ✅ | `frontend/DESIGN.md`; 13/10: ✅ M2.7a–M2.7e đã đóng; bố cục web ≥ 1024px tách sang M2.10 (Q81) |
| M2.7a | Vệ sinh test e2e/unit (helper DB disposable cho psql, ghim TZ Vitest) và focus a11y learner (vòng focus jade-700 cho mọi control (Q12), ≥ 3:1 so với nền liền kề; forced-colors outline) | ✅ | 05/10: ✅ đã đóng (`d4d664d`, `234a3d6`, `063ef39`, `a9a91bf`, `b1a043b`, PR #5 run `37296349078`) |
| M2.7b | Guard DB disposable chặn tham số libpq đổi đích (frontend chỉ cho `sslmode`; backend chặn `dbname`, `host`, `hostaddr`, `port`, `service`, `servicefile`), test e2e bảo vệ màu vòng focus jade-700, forced-colors cho cấp độ đang chọn; chặn fragment `#` ở guard backend và helper e2e (libpq đọc `#?dbname=` thành tham số); Playwright `testIgnore` `**/e2e/support/**`; Vitest chạy `e2e/support` | ✅ | 07/10: ✅ đã đóng (`87833f7`, `b7b553b`, `2882e3d`, `3333d48`, PR #5 run `37564398158`) |
| M2.7c | Test forced-colors đo chữ cấp độ đang chọn đọc được (pixel đổi khi ẩn chữ, tương phản ≥ 4,5:1), tài liệu quyết định PO learner UI `docs/product/learner-ui-decisions.md` | ✅ | 07/10: ✅ đã đóng (`d949b14`, `7d0dda8`, `ebf86bb`, PR #5 run `37568128763`) |
| M2.7d | Lộ trình khi zoom lớn (dưới 320px lưới 2 cột, ẩn ảnh trong ô; vòng focus inset cho panel cấp), tách giá trị onboarding khỏi Zod (`onboarding-values.ts`) để hard-load `/onboarding/goal` và `/onboarding/plan` không vi phạm CSP, test chốt chặn `client-bundle-guard.spec.ts` | ✅ | 11/10: ✅ đã đóng (`b400ea5`, `c8d8f3b`, `d063cd3`, PR #6 run `38103091483`) |
| M2.7e | Kiểm a11y tự động (axe WCAG 2.1 AA) mọi màn learner × 4 viewport, luồng chỉ dùng bàn phím, trạng thái loading/empty/error/offline có thông báo cho screen reader | ✅ | Bàn giao bởi M2.7; chuẩn là WCAG 2.1 AA và `docs/product/learner-ui-decisions.md`, không dùng `frontend/DESIGN.md` (brief admin); 13/10: ✅ đã đóng (`59ac0a3`, `5d8d81a`, PR #6 run `38365835081`); Q78–Q80 |
| M2.8 | Product event P0 first-party: activation, lesson completion | ✅ | ADR-008 §10; Q75: chỉ dữ liệu first-party đã có, không bảng `ProductEvent` tới khi có consent (M1.7b2); Q76: activation = ≥ 1 `lesson_completed` trong 7 ngày đầu sau đăng ký; kèm sửa 2 test e2e chập chờn; Q77: onboarded = user có ≥ 1 `LearningPlan` bất kỳ status, `createdAt < asOf`; 13/10: ✅ đã đóng (`a8613cd`, `7dc6c59`, PR #6 run `38347856594`) |
| M2.10 | Bố cục web cho learner từ 1024px (Q81): khung `.w-app` sidebar + thanh trên, `.w-public` nav ngang + footer, `.w-focus` màn làm bài; dưới 1024px giữ nguyên | ✅ | Mẫu local `docs/ui_reference/web/` (20 trang); so ảnh ở 1024 và 1440; 15/10: ✅ đóng theo M2.10a–d; bài khoá chưa có mẫu web (TL-1) |
| M2.10a | Khung web `.w-app` (sidebar + thanh trên) cho /learn, /learn/path, /learn/profile, /learn/dictionary, /learn/dictionary/[id]; nội dung web Trang chủ, Lộ trình, Hồ sơ (Q81–Q83, Q85) | ✅ | mẫu `web/home.html`, `web/path.html`, `web/profile.html`; 13/10: ✅ đã đóng (`0de3e57`, `b37e96d`, PR #6 run `38395402644`) |
| M2.10b | Nội dung web Tra từ, Chi tiết từ, Bài học (kể cả bài khoá, not-found) trong `.w-app`; Luyện tập và Hoàn thành trong `.w-focus` | ✅ | mẫu `web/dictionary.html`, `web/word.html`, `web/lesson*.html`, `web/practice-*.html`; 14/10: ✅ đã đóng (`2b0523a`, PR #6 run `38503428606`) |
| M2.10c | Trang công khai `.w-public`: /, đăng nhập, đăng ký, quên/đặt lại mật khẩu, xác thực email, onboarding, điều khoản, bảo mật (Q84) | ✅ | mẫu `web/index.html`, `web/sign-*.html`, `web/onboarding-*.html`, ...; 14/10: ✅ đã đóng (`734dc77` + `dd7adb2`, PR #6 run `38600729243`); K3a 20 + K3b 6 cặp 0 pixel; K4 522 passed / 6 skipped; Q86, Q87, TL-5 |
| M2.10d | Sửa lỗi review sau đóng M2.10a/M2.10b: vùng chạm 44px (Q69), thứ tự focus Lộ trình 1024–1279, khung 404 dưới practice/complete, gợi ý player theo loại bài, test menu ⋮ web, fixture riêng của spec web, bám mẫu Tra từ và Bài học, lỗi Prisma 500 khi hoàn thành bài | ✅ | 14/10: ✅ đã đóng (`2125a67`, PR #6 run `38531633716`); F2 chưa tái hiện sau 146 lượt, log không có mã Pxxxx, xem mục 8 |
| M2.9a | Pipeline seed nội dung có agent hỗ trợ + pilot HSK1: (1) xoá placeholder trên DB dev cùng M1.3; (2) script nạp Lesson/Topic từ file JSON qua CMS API và bài tập qua exercise import (preview → commit, `Idempotency-Key`), mọi bản ghi ở trạng thái draft; (3) agent soạn nháp 5 bài HSK1 đầu: từ vựng, câu ví dụ, nghĩa tiếng Việt trong nội dung bài, ≥ 8 bài tập trên ≥ 3 loại; (4) người duyệt review → approve → publish theo workflow CMS | ⬜ | Bắt đầu ngay, không chờ M5.1 UI; nghĩa tiếng Việt vào `WordMeaning` vẫn chờ M1.2a; audio chờ chọn nguồn TTS (#12); không chép hàng loạt từ nguồn bên thứ ba; mở rộng theo đợt sang phần còn lại của M2.9; cải tiến R21 (mục 5.1) |
| M2.9 | Nội dung học thật HSK1–HSK3 thay 35 bài placeholder: 20 từ/bài, phủ ≥ 80% từ vựng cấp (HSK1 ≈ 22, HSK2 ≈ 31, HSK3 ≈ 39 bài), mỗi bài ≥ 2 topic, ≥ 8 bài tập trên ≥ 3 loại, audio từ vựng; ≥ 1 story mỗi 10 bài | ⬜ | chỉ tiêu 🔵 #12; nhập qua CMS API/import hoặc M5.1; audio cần M5.2 + M6.9; HSK4–HSK7_9 sau beta |
| M2.UXa | Bổ sung thiết kế mobile P1 còn thiếu (MB-01…MB-19): học từ vựng và ngữ pháp trong bài, fill_blank, dictation, tốc độ nghe, chi tiết từ đầy đủ, sổ từ, sổ lỗi, tổng kết ôn, giới thiệu đề và lịch sử thi, chọn xếp trình độ, luyện viết, các trạng thái chat AI, xin quyền và consent, cài đặt tài khoản, video YouTube | ⬜ | [product/design-coverage.md](./product/design-coverage.md) §2; thêm vào `docs/ui_reference/mobile/` rồi đưa lên Figma section Mobile |
| M2.UXb | Bổ sung thiết kế web học viên P1 còn thiếu (WB-01…WB-14, WB-17, WB-18): bài khoá, học từ vựng và ngữ pháp, các dạng bài tập, xếp trình độ, ôn tập, sổ từ và sổ lỗi, chi tiết từ và Hán tự, thi thử, trợ lý AI, video, thông báo, cài đặt tài khoản, luyện phát âm, trạng thái "Dùng trên app" cho viết tay và OCR | ⬜ | design-coverage §3; web cần bản 1440 và 1024px; quyết định 19/10: phát âm có trên web, viết tay và OCR chỉ trên app |
| M2.UXc | Bổ sung thiết kế admin P1 (AD-01…AD-09): đăng nhập và hết phiên, thư viện media, soạn bài tập, soạn đề thi, từ vựng và duyệt nghĩa theo lô, truyện và cấp độ, video phụ đề, chi tiết người dùng, AI Ops | ⬜ | design-coverage §4; khung "Hán Lộ Admin" đã có (M5.0), màn mới theo bộ mẫu |
| M2.UXd | Trạng thái dùng chung cho mobile, web, admin: mất mạng, lỗi, trống, đang tải, hết phiên, tính năng tắt | ⬜ | design-coverage §5; điều kiện để M2.7 có chuẩn so |
| M2.E | Playwright flow end-to-end trên production build với backend staging | ⬜ | |

### GĐ6 — SRS + Dictionary completion, M3 (3–4 tuần)

Vào: GĐ5 có M2.5, M2.6. Ra: ôn đúng hạn, lịch sử review bất biến.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M3.1 | Scheduler policy/version, `ReviewCard` là source of truth | ⬜ | schema ✅; cải tiến R3 (mục 5.1) |
| M3.2 | Due queue, review session/event idempotency, concurrency | ⬜ | trigger ownership ✅; cải tiến R4 (mục 5.1) |
| M3.3 | Flashcard + lịch ôn tập UI | ⬜ | 03/03,04; cải tiến R5 (mục 5.1) |
| M3.4a | Schema + migration `WordSense`/`WordExample`/`WordRelation`, `pg_trgm` | ⬜ | mục 5; cải tiến R6 (mục 5.1) |
| M3.4b | API dictionary detail đầy đủ, ví dụ/audio, saved-word lifecycle | ⬜ | cải tiến R6 (mục 5.1) |
| M3.4c | UI chi tiết từ | ⬜ | |
| M3.4d | Bộ thủ và âm Hán Việt trong chi tiết từ; ví dụ câu theo M3.4a/b | ⬜ | khảo sát 10/10 (Hanzii); lợi thế riêng cho người Việt; cần nguồn dữ liệu có giấy phép (#2); cải tiến R7 (mục 5.1) |
| M3.5 | Test scheduler correctness, retention, timezone | ⬜ | C-05 |
| M3.6 | Sổ lỗi sai: ôn lại bài tập làm sai từ lịch sử attempt bất biến, sau M4 thêm câu thi làm sai | ⬜ | khảo sát 10/10 (Migii HSK); đọc từ `LessonExerciseAttempt`, không sửa lịch sử; cải tiến R8 (mục 5.1) |
| M3.7 | Dạng bài nghe chép chính tả (dictation): validator, scorer, player | ⬜ | khảo sát 10/10 (Baolingo, Trùm Chinese); thêm vào shared validator và scorer `lesson-activity`; cải tiến R9 (mục 5.1) |
| M3.8a | Video YouTube: schema video và câu phụ đề có mốc thời gian, tách từ theo từ điển, gắn cấp HSK; admin nhập phụ đề, duyệt, publish | ⬜ | khảo sát 10/10 (Baolingo); phụ đề tự soạn, không tải phụ đề hay video từ YouTube |
| M3.8b | Trình xem video cho người học: phụ đề chữ Hán, pinyin, tiếng Việt; lặp câu, đổi tốc độ, shadowing; tab từ vựng lọc theo cấp HSK, lưu vào ôn tập | ⬜ | nhúng `youtube-nocookie.com` qua IFrame API; mở CSP `frame-src` đúng tên miền |

### GĐ7 — Exam Engine, M4 (4–6 tuần)

Vào: GĐ5 xong. Ra: thi trọn flow, snapshot không đổi khi content sửa, submit/retry không double result.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M4.1 | Admin question/test authoring + publish | ⬜ | 06/05; schema 14 model ✅; cải tiến R10 (mục 5.1) |
| M4.2a | Start → snapshot bất biến | ⬜ | `ExamAttemptSnapshot` ✅; cải tiến R11 (mục 5.1) |
| M4.2b | Autosave, resume, timer | ⬜ | cải tiến R12 (mục 5.1) |
| M4.2c | Submit idempotent, chống double result | ⬜ | |
| M4.3 | Server scoring, skill breakdown, explanation policy | ⬜ | cải tiến R11, R13 (mục 5.1) |
| M4.4 | Concurrency/capacity test theo workload duyệt | ⬜ | |
| M4.5 | Learner exam/review/result UI | ⬜ | 04/01–04; cải tiến R14 (mục 5.1) |
| M4.6 | Ngân hàng đề HSK1–HSK3: ≥ 300 câu/cấp có tag kỹ năng và giải thích, ≥ 2 đề đầy đủ/cấp theo cấu trúc chính thức; placement M2.3a lấy ≥ 60 câu từ đây | ⬜ | chỉ tiêu 🔵 #12; nhập qua M4.1/M5.4; HSK4–HSK7_9 sau beta, HSK7–9 chờ #1; cải tiến R10 (mục 5.1) |

### GĐ8 — Admin ops, analytics, support, trust, M5 (4–6 tuần; M5.1–M5.2 song song GĐ5)

Vào: GĐ2 xong H.8, H.10. Ra: 100% mutation nhạy cảm có audit; support queue có owner/SLA; dashboard có reconciliation.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M5.B1 | Admin login qua BFF, protected shell, forbidden/session states | ✅ | `ce110e5` |
| M5.B2 | Exercise list/detail read-only | ✅ | |
| M5.B3 | Media list/detail + quarantine/archive | ✅ | `69c32bc` |
| M5.B4 | Backend CMS lesson/topic/exercise/import + media ingestion API | ✅ | |
| M5.B5 | `GET /users` cho admin | ✅ | cần H.8 |
| M5.0 | Khung admin "Hán Lộ Admin" tiếng Việt theo mẫu 06 (Q88): sidebar/thanh trên/drawer, dịch Bài tập, Media, đăng nhập | ✅ | Q4, Q88–Q94; 16/10: ✅ đã đóng (`59a7570`, run `38834186034`) |
| M5.1a | CMS mutation UI lesson/topic: tạo, sửa, review, publish | ✅ | Q89–Q91, Q95; 19/10: ✅ đã đóng (`cadce315e33396f704c1b9a1002be2bd0d16313d`, run `39221424166`) |
| M5.1b1 | Soạn, duyệt, xuất bản bài tập bằng form từng loại | ✅ | Q89, Q91, Q95, Q96; 20/10: ✅ đã đóng (`c8f2131`, run `39408418130`) |
| M5.1b2 | API nguồn dữ liệu + trang nhập bài tập JSON + sidebar "Nhập dữ liệu" | ✅ | Q97–Q101; 06/04; 21/10: ✅ đã đóng (`d468a48`, run `39540541415`) |
| M5.2a | Tải media 1 tệp + lọc nguồn đủ giấy phép + cờ bật/tắt + nút "Tải lên" | ✅ | Q102–Q105; 06/05; 21/10: ✅ đã đóng (`ac3bf9e`, run `39547048119`) |
| M5.2b | Danh sách ingestion cần xử lý + dọn dẹp (reconciliation) + nghe/xem trước media | ✅ | Q106, Q107; 21/10: ✅ đã đóng (`92731cb`, run `39572342680`) |
| M5.3 | User lifecycle admin: role, khoá/mở, audit UX | ⬜ | 06/06 |
| M5.4 | CMS cho Level, Story, Word, Question, Test; generic import; scheduled publish | ⬜ | |
| M5.5 | Dashboard data-quality/content/product/ops (Metabase) | ⬜ | 06/01; ADR-008 §10 |
| M5.6 | Support ticket / content report: taxonomy, API, queue, SLA | ⬜ | cải tiến R22 (mục 5.1) |
| M5.7 | Trust & Safety: report/action/appeal/audit, least-privilege role | ⬜ | |
| M5.8 | Notification preference + consent | ⬜ | |

### GĐ9 — Đồ án: Mobile, AI và nhận diện, M7 (tuần 10–13)

Vào: web đủ vòng học (GĐ5 M2.5, M2.6; GĐ6; GĐ7); tiền đề mobile M1.4, H.2, H.4, H.10 ✅. Ra: app
đủ vòng học trên bản build; chat AI trả lời có trích nguồn; phát âm, viết tay, OCR chạy trên app.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M7.7 | Mobile React Native + Expo tại `mobile/` | ⬜ | ADR-008 §1 đã chốt; bước cha của M7.7a–d |
| M7.7a | Khởi tạo `mobile/` Expo + Expo Router; root npm workspaces + `packages/contracts/` sinh từ `openapi.json`; đăng ký, đăng nhập, token trong SecureStore, refresh xoay vòng | ⬜ | tuần 10; gọi backend trực tiếp, không qua BFF web; cải tiến R19 (mục 5.1) |
| M7.7b | Onboarding, trang chủ, lộ trình, bài học, activity player 4 dạng | ⬜ | tuần 10; dùng lại API M2.B*, M2.5 |
| M7.7c | Từ điển, ôn tập flashcard, thi thử, hồ sơ | ⬜ | tuần 11; cần M2.6, GĐ6, GĐ7 |
| M7.7d | CI mobile (lint, typecheck, test) và bản build Android/iOS cài được cho demo | ⬜ | tuần 11 |
| M7.3 | Thông báo đẩy nhắc lịch học qua Expo Notifications, gắn job M2.B7 | ⬜ | tuần 11; dùng tuỳ chọn reminder đã lưu ở UserGoal thay điều kiện M5.8; cải tiến R20 (mục 5.1) |
| M7.4 | AI/RAG: NestJS service riêng, pgvector, provider adapter ≥ 2 | ⬜ | bước cha của M7.4a–d |
| M7.4a | Duyệt ADR-008 §6; chốt nhà cung cấp (#6); bộ câu hỏi đánh giá tiếng Trung/Việt; ngân sách và hạn mức | ⬜ | trước tuần 12; chỉ API chính thức có điều khoản xử lý dữ liệu, không dùng proxy gom tài khoản |
| M7.4b | `ai/services/rag-api` + PostgreSQL pgvector riêng; ingest từ điển và nội dung đã publish | ⬜ | tuần 12; thêm pgvector vào `docker-compose.yml` |
| M7.4c | Truy xuất và trả lời có trích nguồn hoặc từ chối trung thực; hạn mức theo người dùng; kill switch | ⬜ | tuần 12; cải tiến R16 (mục 5.1) |
| M7.4d | Gateway backend `POST /api/v1/ai/chat` (JWT, rate limit) + UI chat web và mobile | ⬜ | tuần 12; mockup `05-ai-hanzi-support/01,02`; cải tiến R17 (mục 5.1) |
| M7.2 | Luyện phát âm: ghi âm trên app và web, chấm âm tiết và thanh điệu qua dịch vụ đánh giá phát âm, consent và xoá bản ghi | ⬜ | tuần 13; mở `speaking_repeat` (đang 422); kết quả tô màu từng chữ và thanh điệu sai (khảo sát 10/10, SuperChinese); mockup `04-exam-pronunciation-profile/05`; cải tiến R15 (mục 5.1) |
| M7.5 | Hán tự nâng cao: viết tay và OCR | ⬜ | bước cha của M7.5a–b |
| M7.5a | Thứ tự nét, luyện viết, nhận dạng chữ viết tay trên thiết bị (chỉ app; web hiện "Dùng trên app") | ⬜ | tuần 13; dữ liệu nét phải kiểm license; mockup `05-ai-hanzi-support/03`; cải tiến R18 (mục 5.1) |
| M7.5b | Tra từ bằng camera: OCR chữ Hán trên thiết bị, chạm để tra từ điển (chỉ app; web hiện "Dùng trên app") | ⬜ | tuần 13; mockup `05-ai-hanzi-support/04` |
| M7.E | Demo trên bản build: app đủ vòng học, chat AI có trích nguồn, phát âm, viết tay, OCR | ⬜ | |

### GĐ10 — Đồ án: Deploy demo và bảo vệ, TN (tuần 14–15)

Vào: GĐ9. Ra: hội đồng mở được web qua HTTPS và cài được app; báo cáo kiểm thử; bảo vệ 17/01/2027.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| TN.1 | Dockerfile backend, frontend, rag-api; deploy docker-compose lên một VPS có HTTPS qua Nginx | ⬜ | đóng cùng M1.8; không cần Terraform/ECS (để GĐ11) |
| TN.2 | Backup database theo lịch và một lần khôi phục thử | ⬜ | bản rút gọn của M6.6 |
| TN.3 | Giám sát cơ bản: health check, log tập trung, cảnh báo uptime | ⬜ | bản rút gọn của M6.5 |
| TN.4 | Playwright trọn vòng trên bản deploy (thay staging cho M2.E) và smoke test app | ⬜ | |
| TN.5 | Báo cáo kiểm thử, hướng dẫn cài đặt và sử dụng, dữ liệu demo | ⬜ | |
| TN.E | Bảo vệ đồ án | ⬜ | 17/01/2027 |

### GĐ11 — Production foundation + Beta, M6 (sau bảo vệ đồ án, 4–6 tuần)

Vào: GĐ10, GĐ4 M1.8 và quyết định #8 (hosting). Ra: promote theo digest, rollback, restore drill có bằng chứng; beta go/no-go.

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M6.1 | Dockerfile multi-stage non-root; compose local | ⬜ | hoàn thiện M1.8 |
| M6.2 | CI/CD build-once/promote-many theo digest; SBOM, scan, cosign, attest | 🟡 | harness media có; chưa có image dự án |
| M6.3 | Terraform AWS ap-southeast-1: ECS, RDS PITR, S3, CloudFront + WAF, Secrets, SES | ⛔ | chờ #8 |
| M6.4 | Staging production-like, environment parity | ⬜ | |
| M6.5 | OTel + Sentry + pino; SLI/SLO; dashboards; alerts; incident runbooks | 🟡 | media ✅; toàn hệ thống ⬜ |
| M6.6 | Backup/PITR, restore drill, RPO/RTO; retention object storage | ⬜ | |
| M6.7 | Gate capacity, security/privacy, accessibility, dependency/license, độ phủ nội dung (M1.2b, M2.9, M4.6 đạt chỉ tiêu #12) | ⬜ | |
| M6.8 | Beta rollout tăng dần, observation window, go/no-go | ⬜ | |
| M6.9 | Live Media Infrastructure Rehearsal | ⛔ | BLOCKED_EXTERNAL |

### GĐ12 — Sau beta, M7+ (theo outcome beta)

| # | Task | Trạng thái | Điều kiện bắt đầu |
| --- | --- | --- | --- |
| M7.1 | Interactive reader, materials | ⬜ | mockup 03/05,06 |
| M7.6 | Subscription/payment | ⬜ | business model, legal/tax; cải tiến R23 (mục 5.1) |
| M7.8 | Community | ⬜ | moderation; cải tiến R24 (mục 5.1) |

## 2. Tổng quan

| Milestone | Outcome | Trạng thái | Bước xong / tổng |
| --- | --- | --- | --- |
| M0 Media internal closeout | Media không còn P0/P1, gate tái lập trên Linux AMD64 | 🟡 | 2 / 5 (exit 0 / 4) |
| H Hardening & CI (chèn từ review 04/09) | CI xanh trên PR, e2e chạy một lệnh, P0/P1 review đóng | 🟡 | 14 / 15 |
| M1 Content/legal + Identity/Privacy | Dữ liệu và tài khoản đủ an toàn để mở beta | ⬜ | 0 / 8 |
| M2 Learner Web Core Loop | Đăng nhập → mục tiêu → bài học → activity → progress | 🟡 backend xong, UI chưa | 5 / 14 |
| M3 SRS + Dictionary completion | Ôn đúng hạn, lịch sử bất biến | ⬜ | 0 / 8 |
| M4 Exam Engine | Thi trọn flow, kết quả bất biến | ⬜ (schema ✅) | 0 / 6 |
| M5 Admin Ops, Analytics, Support, Trust | Vận hành nội dung/người dùng an toàn | 🟡 read console | 6 / 13 |
| M7 Đồ án: Mobile, AI, nhận diện | App đủ vòng học, chat AI có trích nguồn, phát âm, viết tay, OCR | ⬜ | 0 / 5 |
| TN Đồ án: Deploy demo và bảo vệ | Web và app chạy trên bản deploy, bảo vệ 17/01/2027 | ⬜ | 0 / 5 |
| M6 Production foundation + Beta (sau bảo vệ) | Promote, quan sát, rollback, phục hồi | ⬜ | 0 / 9 |
| M7+ Later | Reader, payment, community | ⬜ | 0 / 3 |

Số liệu hiện tại (đo 04/09/2026; dòng Kiểm thử, CI, Nhánh cập nhật 28/09):

| Chỉ số | Giá trị |
| --- | --- |
| Backend runtime | 8 module, ≈60 endpoint, 15.087 dòng src + 7.695 dòng spec |
| Kiểm thử hermetic | Chạy trong CI job `backend`, `frontend` (xanh ở PR #5, run `36375778246`); secret scan và `test:ops:media:unit` chưa có trong CI, chạy tay |
| Kiểm thử cần DB | e2e chạy một lệnh (H.3) và trong CI job `backend-e2e`; SQL `test:db:*` vẫn chạy tay trên DB disposable |
| Schema | 59 model · 27 enum · 19 migration · 23 model có runtime |
| Frontend | login + admin exercises/media (read, quarantine/archive); 0/30 màn learner |
| AI | 0 byte |
| CI | `ci.yml` 3 job trên PR và push vào `main`, run xanh đầu tiên 28/09 ở PR #5; `media-release-evidence.yml` vẫn chỉ chạy theo tag (A-04, quyết định #11) |
| Nhánh | `main` đứng ở `9e9a82c` (22/08); PR #5 đưa `macdev` (GĐ1–GĐ2) vào `main`, chưa merge |

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
| M0.1 | Absolute deadline/cancellation cho ClamAV và S3 body stream | ✅ | `s3-object-storage.adapter.ts` deadline 8 s, `clamav-media-malware-scanner.ts` 10 s. (D-04 đóng ở `6a61efc`, M0.E) |
| M0.2 | Cleanup recovery, secret scanner false-negative, availability SLI truthful | ✅ | `media-ingestion.cleanup-recovery.spec.ts`, `scripts/security/secret-scan.ts`, `ops/observability/media-alerts.yml` |
| M0.3 | Forward-only migration/preflight và bounded lock deployment | 🟡 | `scripts/operations/bounded-prisma-migrate-*.ts` đã commit `6f74f5b`; C-01, C-02 đóng ở H.11a `46396d7` |
| M0.4 | Validate rendered Kubernetes artifact, OCI identity, Linux AMD64 | 🟡 | Harness có; gate không thể pass vì producer policy `HOST_ACCEPTANCE_REQUIRED` |
| M0.5 | Roadmap, owner, risk/decision register, release evidence contract | 🟡 | Roadmap 13/08 đã commit `29e1e4b`; owner chưa gán; evidence contract ADR-007 |

Exit criteria:

| Điều kiện | Trạng thái |
| --- | --- |
| Không còn P0/P1 trong scope Media | ⬜ (B-04 đóng ở H.9 `e6e6620` trừ throttle 1.000/phút dưới `NODE_ENV=test`; B-07 xong TTL và secret previous `f51c71b`, gắn user chưa quyết; D-04 đóng ở `6a61efc`, M0.E) |
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
| H.2 | `ci.yml` trên PR: backend prisma validate + lint + tsc + jest + e2e (Postgres service); frontend lint + typecheck + vitest; required checks | 🟡 | A-01. 07/09: `f7c6d9b`, `665074d`. 28/09: ba job xanh trên GitHub (PR #5, run `36375778246`); còn H.2d |
| H.3 | `docker-compose.yml` (Postgres 16 + profile `dev` cho MinIO/ClamAV/Mailpit) + `pretest:e2e` tạo DB disposable và migrate | ✅ | F-01 đóng phần e2e 07/09: `b011518`, `41f471d`, `1751aff`. e2e phải `--runInBand`: 11 suite dùng chung DB và cùng upsert Level theo `code` |
| H.4 | `trust proxy`, nginx X-Forwarded-For, tracker theo `req.user.id ?? req.ip`, rate limit theo user bằng bảng Postgres | ✅ | A-02, ADR-008 §2. H.4a `9272c58`; H.4b `a0b1950` |
| H.5 | Lockout tăng nguyên tử; login ~10 req/phút/IP + throttle theo email | ✅ | B-01. `ac7faa4` |
| H.6 | Xoá nhánh so sánh password plaintext | ✅ | B-02. `039b6af` |
| H.7 | Một 401 chung, verify giả với hash tĩnh; register trả 409 | ✅ | B-06. Xem GĐ2 H.7 |
| H.8 | `GET /users` phân trang + lọc soft-delete | ✅ | B-05. Xem GĐ2 H.8 |
| H.9 | `MEDIA_STORAGE_PROVIDER`/`MEDIA_SCANNER_PROVIDER` tường minh, assert lúc boot | ✅ | B-04. Xem GĐ2 H.9 |
| H.10 | Envelope toàn cục: APP_INTERCEPTOR + APP_FILTER, echo `x-request-id`; cập nhật api.md §1; sau đó bật OpenAPI | ✅ | A-03, ADR-008 §5. H.10a + H.10b `37e0198`; H.10c `f2448d3` |
| H.11 | Migration: bỏ `BEGIN/COMMIT`, resolver tham số hoá, pin UTC, unique index goal/plan | ✅ | C-01, C-02, C-05, C-04. H.11a `46396d7`; H.11b `e350948` |
| H.12 | Prisma `$disconnect`; `canonicalJson` maxDepth; idempotency TTL | ✅ | D-06, D-01, D-02. `56168cb` (Tech Lead duyệt). `PrismaService` dùng `OnModuleDestroy` (bỏ dead code `enableShutdownHooks`); chặn độ sâu JSON hai lớp — middleware biên `REQUEST_JSON_MAX_DEPTH=32` (duyệt không đệ quy, vì `ValidationPipe` vỡ stack trước khi tới `canonicalJson`) và `CANONICAL_JSON_MAX_DEPTH=16`; idempotency key hết hạn sau 24 h trả 400 |
| H.13 | `.nvmrc` Node 24, `.npmrc save-exact`, TypeScript 6 cả hai package, Renovate | ✅ | 07/09: `6d38f40` (.nvmrc, engines, .npmrc, renovate.json). 28/09: `58d5c5e` nâng TypeScript backend lên 6.0.3 exact khớp frontend (ADR-008 §12), thêm `rootDir: .` giải quyết TS5011; PR #5 run `36378049255` xanh 3 job |
| H.14 | Frontend: xoá 5 route BFF không dùng hoặc redact; focus archive; logout kiểm `ok`; `/api/session/me` chỉ xoá cookie khi 401/403 | ✅ | E-01, E-02. 26/09 (Tech Lead duyệt): xoá 4 route BFF đọc không consumer (`/api/admin/exercises[/:id]`, `/api/admin/media[/:id]`); `/api/session/me` giữ lại (Playwright dùng), chỉ xoá cookie khi 401/403, 5xx/mạng trả 500/503 giữ cookie; focus archive/quarantine không rơi về `<body>`; logout chỉ rời trang khi `ok`; 4 trang admin map 403 → `/forbidden` vì layout không render lại khi điều hướng client |
| H.15 | Root `README.md`: thay boilerplate NestJS bằng mô tả monorepo, trỏ `docs/README.md` | ✅ | F-05 đóng một phần 07/09: `6f6d2fe` |
| H.16 | Điều tra e2e flaky (onboarding #15 + concurrency poll); giải quyết 2 điều kiện review D-04 | ✅ | 29/09: `28cd345` (kèm `48ad32b`), PR #5 run `36514585300`. Thực hiện L1 (xoá rate limit trong loop poll) + L2 (dời assertion abortedIngestion sau 201) trong `backend/test/media-ingestion-concurrency.e2e-spec.ts`; supertest tự `listen(0)`/`close()` mỗi request khi app chỉ `init()`, response lỗi đến từ process khác trên loopback (không có `x-request-id`); đo được: mặc định 3/116 fail, tắt keep-alive 3/100 fail, listen một lần 0/200 fail; áp dụng cho cả 8 suite `init()`-only; 10 lượt `test:e2e` toàn bộ liên tiếp PASS (giữ nguyên `src/**`) |

### M1 — Content/legal + Identity/Privacy foundation

Outcome: dữ liệu và tài khoản đủ an toàn để mở learner beta.

| # | Bước | Trạng thái | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| M1.1 | Xác minh license/provenance 7 HSK word list; attribution CC-CEDICT (CC BY-SA 4.0) | ⬜ | Roadmap R1; `DataSource` đã có bảng và provenance snapshot. Kiểm tra DB dev 13/09: CC-CEDICT có license CC BY-SA 4.0, 7 nguồn HSK list chưa có license |
| M1.2 | Workflow nghĩa tiếng Việt có reviewer và rollback (M1.2a), rồi nhập nghĩa đã duyệt cho 2.263 từ HSK1–HSK3 trước beta (M1.2b) | ⬜ | Rubric chất lượng: archive master plan §13.4. Chỉ tiêu 🔵 #12. Kiểm tra DB dev 13/09: 0 nghĩa tiếng Việt trên 200.156 nghĩa |
| M1.3 | Loại content Temporary/fixture khỏi release candidate | ⬜ | Kiểm tra DB dev 13/09: toàn bộ 35 Lesson, 70 Topic, 14 Story là placeholder "Temporary" |
| M1.4a | Refresh token lưu hash trong `UserSession`; access token gắn session (`sid`) | ✅ | B-03; schema ✅. 29/09: `1b27a45`, PR #5 run `36521807782`. Xoay vòng refresh token, DB lưu hash sha256, access token gắn sid; access giữ 7d |
| M1.4b | Logout revoke session; khoảng ân hạn refresh 10 s | ✅ | B-03; schema ✅. 29/09: `08a78ea`, PR #5 run `36533471666`. POST /auth/logout (204) thu hồi session theo sid, khoảng ân hạn 10s cho race refresh |
| M1.4c | BFF refresh trong proxy, cookie refresh, hạ access 15 phút | ✅ | tiền đề mobile; 29/09: ✅ đã đóng (`01f468c`, PR #5 run `36547912748`) |
| M1.5a | `MailerPort` + adapter SES và Mailpit | ✅ | ADR-008 §9; 30/09: ✅ đã đóng (`685f441`, kèm `ba83411`, PR #5 run `36672199065`), `MailerPort`, `SesMailerAdapter`, `MailpitMailerAdapter`, `InMemoryMailerAdapter` |
| M1.5b | Email verification (token hash) | ✅ | ADR-008 §9; 30/09: ✅ đã đóng (`2df43f5`, kèm `c543fd9`, `ff13c40`, PR #5 run `36684650025`), POST /auth/email-verification/{request,confirm}, worker mail.email-verification sinh token SHA-256 TTL 24h, link fragment #token= |
| M1.5c | Password reset (token hash, dùng một lần) | ✅ | ADR-008 §9; 30/09: ✅ đã đóng (`4ca031b`, kèm `9e67628`, `ec3b901`, PR #5 run `36689833324`), POST /auth/password-reset/request (204, throttle 5/15m/IP, 3/1h/email), POST /auth/password-reset/confirm (204, throttle 10/1m/IP), worker mail.password-reset sinh token SHA-256 TTL 30m, revoke mọi session, link fragment #token= |
| M1.6 | Profile API (`UserProfile`) | ✅ | schema ✅; 30/09: ✅ đã đóng (`3c9b3b5`, kèm `a9adb2a`, PR #5 run `36696120929`), GET/PATCH /users/me/profile, GET mặc định không tạo dòng, PATCH atomic upsert chống race, validate displayName (1–50 ký tự code point, chặn bidi/Cc), timezone IANA chuẩn định dạng và lưu nguyên bản, không nhận avatarUrl |
| M1.7a | pg-boss trên PostgreSQL + worker process | ✅ | ADR-008 §2; 30/09: ✅ đã đóng (`b836cd7`, kèm `50ee3ee`, PR #5 run `36666904294`), schema pgboss v43, migrate: false, worker process riêng |
| M1.7b1 | Export dữ liệu cá nhân (JSON qua S3 private, TTL 24h, purge 7d) | ✅ | ADR-001; 01/10: ✅ đã đóng (`57eac10`, kèm `65b96df`, `f2e2b85`, PR #5 run `36808552129`), POST/GET /users/me/data-exports, GET /users/me/data-exports/:id/download, worker privacy.data-export snapshot RepeatableRead, cron privacy.purge-expired-exports |
| M1.7b2 | Consent API | ⬜ | Chờ quyết định Product Owner: version terms/privacy, consent lúc đăng ký |
| M1.7c | Deletion request + anonymize worker | ✅ | C-03. Ghi chú M1.6: anonymize phải xoá `UserProfile.displayName`; 30/09: ✅ đã đóng (`b1aa20e`, kèm `2b0f0b5`, `3123025`, PR #5 run `36705287180`), POST /users/me/deletion-request (202, xác thực lại mật khẩu 400 INVALID_PASSWORD, thời gian chờ 7 ngày, huỷ bằng đăng nhập đúng mật khẩu, guard H.7 chống lộ inactive account), worker privacy.anonymize-account (startAfter 7 ngày, ẩn danh email deleted+<id>, null name/displayName, 0 session/token, giữ fact lịch sử), worker mail.account-deletion-scheduled |
| M1.8 | Immutable build artifact cơ bản (Dockerfile + digest) | ✅ | Sau H.2; ADR-008 §11; 15/10: ✅ đã đóng (`29e23ac`, run `38684167028`); image ID amd64 backend `03ac99c86809`, frontend `6f4aec84fa3d`; docs/operations/CONTAINER_IMAGES.md |

Exit: không content/license blocker P0 ⬜ · privacy request có evidence end-to-end ⬜ ·
release candidate không dùng fixture ⬜.

### M2 — Learner Web Core Learning Loop

Outcome: người học hoàn thành đăng nhập → mục tiêu/lộ trình → bài học → activity → progress.

Backend đã có:

| # | Bước | Trạng thái | Bằng chứng |
| --- | --- | --- | --- |
| M2.B1 | Onboarding goal/plan API | ✅ | `4b80507`; `onboarding.e2e-spec.ts` |
| M2.B2 | Public content read + readiness policy | ✅ | `learning.service.ts`; `learning.e2e-spec.ts` (21 case) |
| M2.B3 | Lesson/topic start-complete, exercise attempt, progress/resume | ✅ | `4f69f31`; `lesson-activity.e2e-spec.ts`; contract `start` đổi theo Q18 (M2.B9): bài chưa mở trả `409 lesson_locked` |
| M2.B4 | Dictionary prefix search | ✅ | `dictionary.service.ts` (chưa có e2e riêng, T-gap) |
| M2.B5 | Signed media access cho learner | ✅ | `media-access.service.ts`; `media-ingestion.e2e-spec.ts` |

UI và phần backend còn thiếu:

| # | Bước | Trạng thái | Mockup / ghi chú |
| --- | --- | --- | --- |
| M2.B6 | Lưu lý do học `learningPurpose` cho UserGoal | ✅ | 05/10: ✅ đã đóng (`d1c249e`, `5b1e87e`, `ada69f3`, `3f6896d`, PR #5 run `37259009433`) |
| M2.B7 | Job gửi nhắc nhở học theo reminderEnabled/reminderTime | ⬜ | PO 05/10: UI lưu tuỳ chọn, câu phụ "Nhắc nhở sẽ được gửi khi tính năng ra mắt"; cải tiến R20 (mục 5.1) |
| M2.B8 | GET /levels trả code/minBand/maxBand; seed e2e HSK2/HSK3/HSK7_9 | ✅ | 05/10: ✅ đã đóng (`32ebce0`, `830aa81`, `c869fe1`, `c8373ca`, `36c236a`, `256bd00`, `c4270b0`, `4d5b5a2`, PR #5 run `37265687035`) |
| M2.B9 | `GET /learning/path` (trạng thái bài done/current/available/locked, `nextLesson`) và khoá bài tuần tự ở `POST /learning/lessons/:lessonId/start` (Q18) | ✅ | 07/10: ✅ đã đóng (`35464e9`, `f944589`, `82ced4e`, `529f1da`, `4823c2c`, PR #5 run `37574103921`) |
| M2.B10 | `GET /learning/home`: Mục tiêu hôm nay, Chuỗi ngày học do backend tính (Q13) | ✅ | 09/10: ✅ đã đóng (`89c991d`, `a144a71`, `019f1a7`, `3613c00`, PR #5 run `37884908537`); dùng lại `selectNextLesson` của M2.B9 |
| M2.B11 | Rate limit theo route cho luồng learner: `GET /auth/me` 120/phút/user, `POST /learning/exercises/:exerciseId/attempts` 60/phút/user; sửa mô tả rate limit trong `docs/api/api.md` và `docs/architecture/overview.md` (20/phút là cho mỗi route và mỗi user/IP) | ✅ | 11/10: ✅ đã đóng (`ca0462f`, `c1e0ec9`, `1ec914c`, `b16401e`, PR #6 run `38104896978`); kèm việc nhỏ còn lại của M2.7d (`client-bundle-guard.spec.ts`, padding panel trống) |
| M2.B12 | Media cho player M2.5 | ✅ | Phạm vi 12/10: `GET /media/:id/content` đếm 60/phút theo grant (`grant:` + SHA-256 của mediaId:expires:signature, không chứa chữ ký; grant sai dạng hoặc ngoài cửa sổ hạn thì đếm theo IP) cộng throttler `mediaContentIp` 600/phút/IP chỉ cho route này; `GET /media/:id/access` 120/phút/user; TTL learner 300 giây; điều kiện cấp grant cho learner dùng đúng predicate của route attempts (`PUBLIC_LESSON_EXERCISE_WHERE` + `buildLessonReadyWhere()`, có Level published); Range một đoạn → 206, ngoài kích thước → 416 envelope JSON, còn lại 200 cả file, `Accept-Ranges: bytes`; nginx `limit_req` 20r/s burst 200, 429 `private, no-store`; docs `api.md`, `overview.md`. Chưa làm: `test:ops:media:linux-amd64` và live rehearsal (mode RELEASE), audio từ vựng. Đầu vào: `GET /media/:id/content` là route public nên bị đếm theo IP: learner sau NAT/CGNAT chia chung 20/phút; signed URL của learner sống 60 giây, nghe lại phải xin access mới; ký URL cho từng từ vựng sẽ vượt 20/phút ở `media/:id/access`; nginx chưa có `limit_req`, tức lớp anonymous mà ADR-008 §2 dựa vào chưa tồn tại; cần quyết định trước khi làm M2.5b; backlog 11/10: media grant của learner không kiểm Level published; phương án PO 11/10 (Q46): route content đếm lượt theo mediaId + chữ ký thay cho IP, route access đếm theo user khoảng 120/phút, TTL learner 300 giây, kiểm thêm Level published, thêm nginx `limit_req` trong `ops/`, kiểm Safari có hỗ trợ Range không, audio từ vựng để task sau; 12/10: ✅ đã đóng (`578ca94`, `5de2b86`, PR #6 run `38204114744`) |
| M2.B13 | Mở rộng `GET /learning/lessons/:lessonId/activity` cho màn bài học (Q43): `level`, `position`, `state` cùng nguồn với `GET /learning/path`, `sections` (từ vựng, ngữ pháp, luyện tập) | ✅ | 11/10: ✅ đã đóng (`e9dfee5`, `83618ee`, `b2419c8`, `0dd29ac`, PR #6 run `38110835934`) |
| M2.B14 | Backend: GET /dictionary tra thêm theo nghĩa tiếng Việt (bỏ dấu) và tiếng Anh (Q64) | ✅ | PO 12/10; làm trước M2.6b; dữ liệu thật hôm nay chỉ có nghĩa tiếng Anh (M1.2a chưa làm); commit `5089fee`; 12/10: ✅ đã đóng (`5089fee`, `98af98d`, PR #6 run `38264090030`) |
| M2.1a | Learner session BFF: cookie riêng, route `/api/learner/session/*` cho learner | ✅ | ADR-003; 01/10: ✅ đã đóng (`2bd2da9`, kèm `13b9d72`, PR #5 run `36815829812`), POST login/register/logout, GET me, cookie riêng LEARNER_SESSION_COOKIE_NAME, chặn role admin 403 admin_account, proxy refresh theo đường dẫn |
| M2.1b | UI đăng ký, đăng nhập, đăng xuất | ✅ | mockup 01/01,02; 05/10: ✅ đã đóng (`8d09d41`, `23ecd30`, `d774724`, `cc9b0e9`, `88d155f`, PR #5 run `37255512085`). 6 route /(learner), guard server, form auth, nút logout, Playwright e2e |
| M2.1c | Trang `/verify-email` (frontend) | ✅ | Việc còn lại sau M1.5b: nhận token từ URL fragment `#token=`, gọi POST /auth/email-verification/confirm; Q71–Q74: thêm `/forgot-password` và link "Quên mật khẩu?" (Q71), xác thực khi bấm nút (Q72), gửi lại (Q73), nút chính jade-800 cả luồng (Q74); commit `5e46bef`; 13/10: ✅ đã đóng (`5e46bef`, `03734f0`, PR #6 run `38343537592`) |
| M2.1d | Trang `/reset-password` (frontend) | ✅ | Việc còn lại sau M1.5c: nhận token từ URL fragment `#token=`, form mật khẩu mới, gọi POST /auth/password-reset/confirm; Q71–Q74: thêm `/forgot-password` và link "Quên mật khẩu?" (Q71), xác thực khi bấm nút (Q72), gửi lại (Q73), nút chính jade-800 cả luồng (Q74); commit `5e46bef`; 13/10: ✅ đã đóng (`5e46bef`, `03734f0`, PR #6 run `38343537592`) |
| M2.1e | OAuth Google/Apple/Facebook | ⬜ | Nút trên UI hiện báo "Tính năng sắp ra mắt.", chờ backend OAuth |
| M2.1f | Nội dung thật /terms, /privacy — gắn M1.7b2 | ⬜ | Hiện là trang tĩnh tạm thời, gắn quyết định Consent M1.7b2 |
| M2.1g | Thay hình minh hoạ trang chào bằng file gốc độ phân giải cao (hiện cắt từ mockup 310px) | ⬜ | Assets SVG/@3x khi có |
| M2.2 | Onboarding goal + kế hoạch học UI | ✅ | 05/10: ✅ đã đóng (`4549dcd`, `218e0d3`, `fe89443`, `01c1ffd`, `2d16b74`, `2dfb834`, `0f08df2`, PR #5 run `37281941987`); `01-onboarding-placement/03,04`; 2 route goal/plan, pure routeForOnboarding, BFF complete, Playwright 118 pass, so pixel 26/26 và 40/40 PASS |
| M2.3 | Placement test (feature flag): backend chọn câu, chấm, kết quả + UI | ⬜ | `01-onboarding-placement/05,06`; schema `PlacementAttempt` ✅; cải tiến R1, R2 (mục 5.1) |
| M2.4 | Trang chủ + lộ trình học | ✅ | `02-learning-lesson/01,02`; 12/10: ✅ phạm vi 02/01,02 đã phủ bởi M2.4a, M2.4b |
| M2.4a | Trang chủ + tab bar + `/learn/profile` (Q14–Q17) | ✅ | 09/10: ✅ đã đóng (`b3e85a9`, `46690c6`, `b8645cf`, PR #5 run `37917119665`); việc còn lại (forced colors icon tab, test hồi quy) đã đóng cùng M2.4b 10/10; `02-learning-lesson/01`; Q21–Q24 |
| M2.4b | Lộ trình (Q18–Q20) | ✅ | 10/10: ✅ đã đóng (`618b302`, `2c36586`, `d34c3b8`, PR #5 run `38016160000`); `/learn/path`, tab Học; `02-learning-lesson/02`; Q25–Q31 |
| M2.5 | Nội dung bài học, activity player (mcq, fill_blank, listening, arrange), hoàn thành | ✅ | `02-learning-lesson/03,04,05,06`; 12/10: ✅ mọi task con M2.5a–M2.5d đã đóng |
| M2.6 | Dictionary search/detail/save-word cơ bản (backend detail + save API còn thiếu) | ✅ | `03-dictionary-review-reader/01,02`; 13/10: ✅ M2.6a, M2.6b đã đóng |
| M2.7 | Responsive, keyboard, screen reader, loading/empty/error/offline states | ✅ | `frontend/DESIGN.md`; 13/10: ✅ M2.7a–M2.7e đã đóng; bố cục web ≥ 1024px tách sang M2.10 (Q81) |
| M2.7a | Vệ sinh test e2e/unit (helper DB disposable cho psql, ghim TZ Vitest) và focus a11y learner (vòng focus jade-700 cho mọi control (Q12), ≥ 3:1 so với nền liền kề; forced-colors outline) | ✅ | 05/10: ✅ đã đóng (`d4d664d`, `234a3d6`, `063ef39`, `a9a91bf`, `b1a043b`, PR #5 run `37296349078`) |
| M2.7b | Guard DB disposable chặn tham số libpq đổi đích (frontend chỉ cho `sslmode`; backend chặn `dbname`, `host`, `hostaddr`, `port`, `service`, `servicefile`), test e2e bảo vệ màu vòng focus jade-700, forced-colors cho cấp độ đang chọn; chặn fragment `#` ở guard backend và helper e2e (libpq đọc `#?dbname=` thành tham số); Playwright `testIgnore` `**/e2e/support/**`; Vitest chạy `e2e/support` | ✅ | 07/10: ✅ đã đóng (`87833f7`, `b7b553b`, `2882e3d`, `3333d48`, PR #5 run `37564398158`) |
| M2.7c | Test forced-colors đo chữ cấp độ đang chọn đọc được (pixel đổi khi ẩn chữ, tương phản ≥ 4,5:1), tài liệu quyết định PO learner UI `docs/product/learner-ui-decisions.md` | ✅ | 07/10: ✅ đã đóng (`d949b14`, `7d0dda8`, `ebf86bb`, PR #5 run `37568128763`) |
| M2.7d | Lộ trình khi zoom lớn (dưới 320px lưới 2 cột, ẩn ảnh trong ô; vòng focus inset cho panel cấp), tách giá trị onboarding khỏi Zod (`onboarding-values.ts`) để hard-load `/onboarding/goal` và `/onboarding/plan` không vi phạm CSP, test chốt chặn `client-bundle-guard.spec.ts` | ✅ | 11/10: ✅ đã đóng (`b400ea5`, `c8d8f3b`, `d063cd3`, PR #6 run `38103091483`) |
| M2.7e | Kiểm a11y tự động (axe WCAG 2.1 AA) mọi màn learner × 4 viewport, luồng chỉ dùng bàn phím, trạng thái loading/empty/error/offline có thông báo cho screen reader | ✅ | Bàn giao bởi M2.7; chuẩn là WCAG 2.1 AA và `docs/product/learner-ui-decisions.md`, không dùng `frontend/DESIGN.md` (brief admin); 13/10: ✅ đã đóng (`59ac0a3`, `5d8d81a`, PR #6 run `38365835081`); Q78–Q80 |
| M2.8 | Product event P0 first-party: activation, lesson completion | ✅ | ADR-008 §10; Q75: chỉ dữ liệu first-party đã có, không bảng `ProductEvent` tới khi có consent (M1.7b2); Q76: activation = ≥ 1 `lesson_completed` trong 7 ngày đầu sau đăng ký; kèm sửa 2 test e2e chập chờn; Q77: onboarded = user có ≥ 1 `LearningPlan` bất kỳ status, `createdAt < asOf`; 13/10: ✅ đã đóng (`a8613cd`, `7dc6c59`, PR #6 run `38347856594`) |
| M2.10 | Bố cục web cho learner từ 1024px (Q81): khung `.w-app` sidebar + thanh trên, `.w-public` nav ngang + footer, `.w-focus` màn làm bài; dưới 1024px giữ nguyên | ✅ | Mẫu local `docs/ui_reference/web/` (20 trang); so ảnh ở 1024 và 1440; 15/10: ✅ đóng theo M2.10a–d; bài khoá chưa có mẫu web (TL-1) |
| M2.10a | Khung web `.w-app` (sidebar + thanh trên) cho /learn, /learn/path, /learn/profile, /learn/dictionary, /learn/dictionary/[id]; nội dung web Trang chủ, Lộ trình, Hồ sơ (Q81–Q83, Q85) | ✅ | mẫu `web/home.html`, `web/path.html`, `web/profile.html`; 13/10: ✅ đã đóng (`0de3e57`, `b37e96d`, PR #6 run `38395402644`) |
| M2.10b | Nội dung web Tra từ, Chi tiết từ, Bài học (kể cả bài khoá, not-found) trong `.w-app`; Luyện tập và Hoàn thành trong `.w-focus` | ✅ | mẫu `web/dictionary.html`, `web/word.html`, `web/lesson*.html`, `web/practice-*.html`; 14/10: ✅ đã đóng (`2b0523a`, PR #6 run `38503428606`) |
| M2.10c | Trang công khai `.w-public`: /, đăng nhập, đăng ký, quên/đặt lại mật khẩu, xác thực email, onboarding, điều khoản, bảo mật (Q84) | ✅ | mẫu `web/index.html`, `web/sign-*.html`, `web/onboarding-*.html`, ... (20 trang); 14/10: ✅ đã đóng (`734dc77` + `dd7adb2`, PR #6 run `38600729243`): 10 trang công khai `.w-public`, khung `display:contents` dưới 1024px nên mobile không đổi (K3a 20 cặp 390/768 + K3b 6 cặp 1024/1440: 0 pixel; base `ab7adab`), K4 522 passed / 6 skipped / 0 failed, gate frontend 0 failed; Q86 (navy-900), Q87 (câu dưới nút Tiếp tục), TL-5 (ô "Sắp có" 2 cột ở 1024–1279) |
| M2.10d | Sửa lỗi review sau đóng M2.10a/M2.10b: vùng chạm 44px (Q69), thứ tự focus Lộ trình 1024–1279, khung 404 dưới practice/complete, gợi ý player theo loại bài, test menu ⋮ web, fixture riêng của spec web, bám mẫu Tra từ và Bài học, lỗi Prisma 500 khi hoàn thành bài | ✅ | 14/10: ✅ đã đóng (`2125a67`, PR #6 run `38531633716`); F2 chưa tái hiện sau 146 lượt, log không có mã Pxxxx, xem mục 8 |
| M2.9a | Pipeline seed nội dung có agent hỗ trợ + pilot HSK1: (1) xoá placeholder trên DB dev cùng M1.3; (2) script nạp Lesson/Topic từ file JSON qua CMS API và bài tập qua exercise import (preview → commit, `Idempotency-Key`), mọi bản ghi ở trạng thái draft; (3) agent soạn nháp 5 bài HSK1 đầu: từ vựng, câu ví dụ, nghĩa tiếng Việt trong nội dung bài, ≥ 8 bài tập trên ≥ 3 loại; (4) người duyệt review → approve → publish theo workflow CMS | ⬜ | Bắt đầu ngay, không chờ M5.1 UI; nghĩa tiếng Việt vào `WordMeaning` vẫn chờ M1.2a; audio chờ chọn nguồn TTS (#12); không chép hàng loạt từ nguồn bên thứ ba; mở rộng theo đợt sang phần còn lại của M2.9; cải tiến R21 (mục 5.1) |
| M2.9 | Nội dung học thật HSK1–HSK3 thay 35 bài placeholder: 20 từ/bài, phủ ≥ 80% từ vựng cấp (≈ 92 bài), ≥ 2 topic, ≥ 8 bài tập trên ≥ 3 loại, audio từ vựng, ≥ 1 story mỗi 10 bài | ⬜ | Chỉ tiêu 🔵 #12; track biên soạn song song, gate M6.7; audio cần M5.2 và M6.9 |
| M2.UXa | Bổ sung thiết kế mobile P1 còn thiếu (MB-01…MB-19): học từ vựng và ngữ pháp trong bài, fill_blank, dictation, tốc độ nghe, chi tiết từ đầy đủ, sổ từ, sổ lỗi, tổng kết ôn, giới thiệu đề và lịch sử thi, chọn xếp trình độ, luyện viết, các trạng thái chat AI, xin quyền và consent, cài đặt tài khoản, video YouTube | ⬜ | [product/design-coverage.md](./product/design-coverage.md) §2; thêm vào `docs/ui_reference/mobile/` rồi đưa lên Figma section Mobile |
| M2.UXb | Bổ sung thiết kế web học viên P1 còn thiếu (WB-01…WB-14, WB-17, WB-18): bài khoá, học từ vựng và ngữ pháp, các dạng bài tập, xếp trình độ, ôn tập, sổ từ và sổ lỗi, chi tiết từ và Hán tự, thi thử, trợ lý AI, video, thông báo, cài đặt tài khoản, luyện phát âm, trạng thái "Dùng trên app" cho viết tay và OCR | ⬜ | design-coverage §3; web cần bản 1440 và 1024px; quyết định 19/10: phát âm có trên web, viết tay và OCR chỉ trên app |
| M2.UXc | Bổ sung thiết kế admin P1 (AD-01…AD-09): đăng nhập và hết phiên, thư viện media, soạn bài tập, soạn đề thi, từ vựng và duyệt nghĩa theo lô, truyện và cấp độ, video phụ đề, chi tiết người dùng, AI Ops | ⬜ | design-coverage §4; khung "Hán Lộ Admin" đã có (M5.0), màn mới theo bộ mẫu |
| M2.UXd | Trạng thái dùng chung cho mobile, web, admin: mất mạng, lỗi, trống, đang tải, hết phiên, tính năng tắt | ⬜ | design-coverage §5; điều kiện để M2.7 có chuẩn so |

Exit: flow end-to-end trên production build với backend thật ở staging ⬜ · không bearer
token trong browser storage (BFF đã đảm bảo cho admin ✅) · a11y/perf/security/visual QA ⬜.

### M3 — SRS và Dictionary completion

| # | Bước | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M3.1 | Scheduler policy/version (`ReviewCard` là source of truth) | ⬜ | schema ✅; invariant: archive master plan §16.4; cải tiến R3 (mục 5.1) |
| M3.2 | Due queue, review session/event idempotency và concurrency | ⬜ | trigger ownership card→session ✅; cải tiến R4 (mục 5.1) |
| M3.3 | Flashcard và lịch ôn tập UI | ⬜ | `03-dictionary-review-reader/03,04`; cải tiến R5 (mục 5.1) |
| M3.4 | Dictionary detail, ví dụ/audio, saved-word lifecycle, bộ thủ và âm Hán Việt | ⬜ | `WordSense/WordExample` chưa có schema (mục 5); M3.4d cần nguồn có giấy phép; cải tiến R6, R7 (mục 5.1) |
| M3.5 | Test scheduler correctness, retention, timezone | ⬜ | C-05 |
| M3.6 | Sổ lỗi sai từ lịch sử attempt bất biến | ⬜ | Khảo sát đối thủ 10/10; cải tiến R8 (mục 5.1) |
| M3.7 | Dạng bài nghe chép chính tả (dictation) | ⬜ | Khảo sát đối thủ 10/10; cải tiến R9 (mục 5.1) |
| M3.8 | Video YouTube có phụ đề, shadowing, từ vựng theo cấp HSK | ⬜ | Khảo sát đối thủ 10/10; M3.8a backend và admin, M3.8b người học |

### M4 — Exam Engine Web MVP

| # | Bước | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M4.1 | Admin question/test authoring + publish workflow | ⬜ | schema 14 model + trigger ✅; `06-admin-cms-operations/05`; cải tiến R10 (mục 5.1) |
| M4.2 | Start → snapshot → autosave → resume → timer → submit idempotency | ⬜ | `ExamAttemptSnapshot`/`Event` bất biến ✅; cải tiến R11, R12 (mục 5.1) |
| M4.3 | Server scoring, result/skill breakdown, explanation policy | ⬜ | cải tiến R11, R13 (mục 5.1) |
| M4.4 | Concurrency/capacity test theo workload được duyệt | ⬜ | |
| M4.5 | Learner exam/review/result UI | ⬜ | `04-exam-pronunciation-profile/01–04`; cải tiến R14 (mục 5.1) |
| M4.6 | Ngân hàng đề HSK1–HSK3: ≥ 300 câu/cấp có tag kỹ năng và giải thích, ≥ 2 đề đầy đủ/cấp; placement M2.3a lấy ≥ 60 câu từ đây | ⬜ | Chỉ tiêu 🔵 #12; nhập qua M4.1 và M5.4; HSK7–9 chờ quyết định #1; cải tiến R10 (mục 5.1) |

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
| M5.0 | Khung admin "Hán Lộ Admin" tiếng Việt theo mẫu 06 (Q88): sidebar/thanh trên/drawer, dịch Bài tập, Media, đăng nhập | ✅ | Q4, Q88–Q94; 16/10: ✅ đã đóng (`59a7570`, run `38834186034`) |

Còn thiếu:

| # | Bước | Trạng thái | Mockup / ghi chú |
| --- | --- | --- | --- |
| M5.1 | Mutation UI CMS: tạo/sửa/review/publish/import lesson, topic, exercise | ✅ | M5.1a, M5.1b1, M5.1b2 xong; Q89–Q91, Q95, Q96; `06-admin-cms-operations/02,03,04` |
| M5.2 | Upload media UI + trạng thái processing + reconciliation | ✅ | tách M5.2a/M5.2b; cả hai đã đóng (`ac3bf9e`, `92731cb`) |
| M5.3 | User lifecycle admin: role, khoá/mở, audit UX | ⬜ | `06-admin-cms-operations/06` |
| M5.4 | CMS cho Level, Story, Word, Question, Test; generic import; scheduled publish | ⬜ | |
| M5.5 | Dashboard data-quality/content/product/ops (Metabase) | ⬜ | `06-admin-cms-operations/01`; ADR-008 §10 |
| M5.6 | Support ticket / content report taxonomy, API, queue, SLA | ⬜ | cải tiến R22 (mục 5.1) |
| M5.7 | Trust & Safety: policy, report/action/appeal/audit, least-privilege roles | ⬜ | |
| M5.8 | Notification preference và consent (nếu vào beta) | ⬜ | |

Exit: 100% mutation nhạy cảm có audit (backend CMS/media ✅, user ⬜) · support queue có
owner/SLA ⬜ · dashboard có reconciliation/runbook ⬜.

### M6 — Project-wide Production Foundation và Web MVP Beta (GĐ11, sau bảo vệ đồ án)

| # | Bước | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M6.1 | Dockerfile backend/frontend multi-stage non-root; compose local | ⬜ | ADR-008 §11 (H.3 làm compose test trước) |
| M6.2 | CI/CD build-once/promote-many theo digest; SBOM, scan, cosign keyless, attest | 🟡 | Harness media có (A-04); chưa có image dự án |
| M6.3 | Terraform AWS ap-southeast-1: ECS Fargate, RDS 16 PITR, S3, CloudFront + WAF, Secrets Manager, SES | ⬜ | ADR-008 §8; ⛔ chờ kết luận pháp lý mục 6 #8; backlog 12/10 (M2.B12): nginx `limit_req` của route media content khoá theo `$binary_remote_addr`, sau CloudFront phải chuyển sang WAF rate-based rule hoặc realip (`set_real_ip_from` + `real_ip_recursive`) |
| M6.4 | Staging production-like, environment parity | ⬜ | |
| M6.5 | OTel + Sentry + pino; SLI/SLO journey; dashboards; alerts; incident runbooks | 🟡 | Media metrics/alerts/dashboard ✅ (`ops/observability`); toàn hệ thống ⬜ |
| M6.6 | PostgreSQL backup/PITR, restore drill, RPO/RTO; object-storage retention | ⬜ | |
| M6.7 | Gate capacity, security/privacy, accessibility, dependency/license, độ phủ nội dung (M1.2b, M2.9, M4.6 đạt chỉ tiêu #12) | ⬜ | |
| M6.8 | Progressive beta rollout, observation window, go/no-go | ⬜ | |
| M6.9 | Live Media Infrastructure Rehearsal | ⛔ | BLOCKED_EXTERNAL |

Checklist go-live và rollback chi tiết: archive master plan §27, §34, §35.

### M7 — Đồ án: Mobile, AI và nhận diện (GĐ9)

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| M7.7 | Mobile React Native + Expo tại `mobile/` | ⬜ | ADR-008 §1 đã chốt; bước cha của M7.7a–d |
| M7.7a | Khởi tạo `mobile/` Expo + Expo Router; root npm workspaces + `packages/contracts/` sinh từ `openapi.json`; đăng ký, đăng nhập, token trong SecureStore, refresh xoay vòng | ⬜ | tuần 10; gọi backend trực tiếp, không qua BFF web; cải tiến R19 (mục 5.1) |
| M7.7b | Onboarding, trang chủ, lộ trình, bài học, activity player 4 dạng | ⬜ | tuần 10; dùng lại API M2.B*, M2.5 |
| M7.7c | Từ điển, ôn tập flashcard, thi thử, hồ sơ | ⬜ | tuần 11; cần M2.6, GĐ6, GĐ7 |
| M7.7d | CI mobile (lint, typecheck, test) và bản build Android/iOS cài được cho demo | ⬜ | tuần 11 |
| M7.3 | Thông báo đẩy nhắc lịch học qua Expo Notifications, gắn job M2.B7 | ⬜ | tuần 11; dùng tuỳ chọn reminder đã lưu ở UserGoal thay điều kiện M5.8; cải tiến R20 (mục 5.1) |
| M7.4 | AI/RAG: NestJS service riêng, pgvector, provider adapter ≥ 2 | ⬜ | bước cha của M7.4a–d |
| M7.4a | Duyệt ADR-008 §6; chốt nhà cung cấp (#6); bộ câu hỏi đánh giá tiếng Trung/Việt; ngân sách và hạn mức | ⬜ | trước tuần 12; chỉ API chính thức có điều khoản xử lý dữ liệu, không dùng proxy gom tài khoản |
| M7.4b | `ai/services/rag-api` + PostgreSQL pgvector riêng; ingest từ điển và nội dung đã publish | ⬜ | tuần 12; thêm pgvector vào `docker-compose.yml` |
| M7.4c | Truy xuất và trả lời có trích nguồn hoặc từ chối trung thực; hạn mức theo người dùng; kill switch | ⬜ | tuần 12; cải tiến R16 (mục 5.1) |
| M7.4d | Gateway backend `POST /api/v1/ai/chat` (JWT, rate limit) + UI chat web và mobile | ⬜ | tuần 12; mockup `05-ai-hanzi-support/01,02`; cải tiến R17 (mục 5.1) |
| M7.2 | Luyện phát âm: ghi âm trên app và web, chấm âm tiết và thanh điệu qua dịch vụ đánh giá phát âm, consent và xoá bản ghi | ⬜ | tuần 13; mở `speaking_repeat` (đang 422); kết quả tô màu từng chữ và thanh điệu sai (khảo sát 10/10, SuperChinese); mockup `04-exam-pronunciation-profile/05`; cải tiến R15 (mục 5.1) |
| M7.5 | Hán tự nâng cao: viết tay và OCR | ⬜ | bước cha của M7.5a–b |
| M7.5a | Thứ tự nét, luyện viết, nhận dạng chữ viết tay trên thiết bị (chỉ app; web hiện "Dùng trên app") | ⬜ | tuần 13; dữ liệu nét phải kiểm license; mockup `05-ai-hanzi-support/03`; cải tiến R18 (mục 5.1) |
| M7.5b | Tra từ bằng camera: OCR chữ Hán trên thiết bị, chạm để tra từ điển (chỉ app; web hiện "Dùng trên app") | ⬜ | tuần 13; mockup `05-ai-hanzi-support/04` |
| M7.E | Demo trên bản build: app đủ vòng học, chat AI có trích nguồn, phát âm, viết tay, OCR | ⬜ | |

### TN — Đồ án: Deploy demo và bảo vệ (GĐ10)

| # | Task | Trạng thái | Ghi chú |
| --- | --- | --- | --- |
| TN.1 | Dockerfile backend, frontend, rag-api; deploy docker-compose lên một VPS có HTTPS qua Nginx | ⬜ | đóng cùng M1.8; không cần Terraform/ECS (để GĐ11) |
| TN.2 | Backup database theo lịch và một lần khôi phục thử | ⬜ | bản rút gọn của M6.6 |
| TN.3 | Giám sát cơ bản: health check, log tập trung, cảnh báo uptime | ⬜ | bản rút gọn của M6.5 |
| TN.4 | Playwright trọn vòng trên bản deploy (thay staging cho M2.E) và smoke test app | ⬜ | |
| TN.5 | Báo cáo kiểm thử, hướng dẫn cài đặt và sử dụng, dữ liệu demo | ⬜ | |
| TN.E | Bảo vệ đồ án | ⬜ | 17/01/2027 |

### M7+ — Differentiation và scale (GĐ12, sau beta)

| # | Hạng mục | Trạng thái | Điều kiện bắt đầu |
| --- | --- | --- | --- |
| M7.1 | Interactive reader, materials | ⬜ | Web MVP outcome; mockup `03-dictionary-review-reader/05,06` |
| M7.6 | Subscription/payment | ⬜ | Business model, legal/tax; cải tiến R23 (mục 5.1) |
| M7.8 | Community | ⬜ | Moderation; cải tiến R24 (mục 5.1) |

## 5. Schema backlog

Model chưa build dù đã có thiết kế (archive `DATABASE_SCHEMA_COMPLETION_PLAN.md`):
`AuthIdentity` (OAuth), `Material`/`MaterialItem`, `ContentAccess`/`Entitlement`,
`WordSense`/`WordExample`/`WordRelation` + `pg_trgm`, `QuestionRevision`/`TestRevision`;
nhóm P1/P2 theo stage của plan schema archive: reader/pronunciation/Hanzi (stage 5),
engagement/notification/support (stage 7), payment (stage 8), AI DB tách riêng (stage 9).

Hardening dữ liệu: inventory SQL-only object + drift guard (C-07), dọn index (C-08),
timestamptz (C-05), partition/retention cho bảng event, cập nhật data dictionary và ERD
cho migration 16–19, đóng băng schema domain chưa có runtime (Exam, SRS, privacy) tới
khi vertical slice bắt đầu.

### 5.1 Acceptance bổ sung từ khảo sát đối thủ (23/10/2026)

Nguồn: khảo sát dịch ngược 8 app/web (Hanzii web và app, Baolingo, SuperChinese, Migii, Speak Chinese,
HelloChinese), báo cáo local `reverse/_report-cai-tien-tong-hop.md` (gitignored, chỉ tham khảo, không
sao chép mã, dữ liệu hay văn bản). Mockup và quyết định PO thắng mọi đề xuất dưới đây. Đây là tiêu chí
nghiệm thu thêm cho task đã có, không phải task mới; không tính vào tổng mục 1.1.

| Mã | Task | Acceptance bổ sung | Vì sao (đối thủ) | Ưu tiên |
| --- | --- | --- | --- | --- |
| R1 | M2.3a | Server giữ trạng thái placement; client chỉ gửi `{attemptId, questionId, answer, idempotencyKey}`; server chấm và tự quyết kết thúc và cấp; không trả đáp án hay đúng/sai trước khi nộp câu. Bậc thang tối đa 20 câu, dừng sớm khi đổi chiều hai lần quanh một cấp. `detailSnapshot` lưu chuỗi câu, `finishReason`, cờ kết quả tạm/đủ tin cậy, ước lượng từ vựng và ngữ pháp; map ra một Level (HSK7_9 giữ band 7/8/9). Không tự ghi đè `targetLevel`/`LearningPlan` (#13) | Hanzii web gửi cờ đáp án xuống client, SuperChinese cho client tự gửi `finish`/level; Hanzii app có quy tắc CAT rõ nhất | P0 |
| R2 | M2.3b | Kết quả theo `ui_reference/mobile/placement-result.html` (radar có `<desc>` liệt kê điểm cho screen reader); nhãn "kết quả tạm"/"đủ tin cậy"; nút xác nhận đặt trình độ; "Làm sau" | Hanzii, SuperChinese: người học phải bấm xác nhận | P1 |
| R3 | M3.1 | Test vectors theo archive master plan §16.4–16.6 (§16.2 Redis/BullMQ đã bị ADR-008 thay) cho bước đầu từng grade: again lặp step đầu, hard khác good, good sang step kế, easy tốt nghiệp; floor `easeFactor` 1.3 theo SM-2; ôn trễ tính theo thời gian thực `lastReviewedAt → now`. Cùng migration: thêm `relearning` vào `ReviewCardState`, `ReviewEvent.source` (hiện chỉ `flashcard`). Cột FSRS chờ #14. Không lấy thông số từ đối thủ | Baolingo để hard = good ở bước đầu; HelloChinese kẹp eFactor ≥ 2.5 nên từ khó không rút ngắn được khoảng ôn | P0 |
| R4 | M3.2 | Submit review trả `nextDueAt`/`nextState`; hàng đợi đến hạn trả preview khoảng ôn cho cả 4 grade, client không tự tính. POST ngay mỗi lần chấm với `idempotencyKey` sinh ở client, retry khi lỗi mạng; nếu gom lô thì flush bằng `sendBeacon` lúc `pagehide`. Hạn phiên và con trỏ resume lưu trong `ReviewSession.summary`. Không UPDATE/DELETE `ReviewEvent`; hoàn tác (nếu #14 duyệt) chỉ bằng event bù | Hanzii web đệm review trong localStorage, mất khi đóng tab; SuperChinese có phiên hết hạn và resume | P0 |
| R5 | M3.3 | 4 nút có nhãn kèm khoảng ôn lấy từ server, phím 1–4, vuốt chỉ là lối tắt, thanh nút dính đáy ở 390px, bộ đếm x/N, trạng thái trống có lối về Lộ trình/Tra từ. Nhãn mức thuộc Yếu/Đang củng cố/Quen/Thuộc và "Chưa đủ dữ liệu" suy từ state/interval/lapses, không thêm cột, không hiện phần trăm giả. Lịch ôn: số đến hạn hôm nay + phân bố 3/7/14 ngày theo timezone. Mockup `flashcards.html`, `review-calendar.html`, `review-complete.html` thắng (mockup không có nút hoàn tác) | Baolingo 4 nút + phím 1–4; SuperChinese có trạng thái "chưa đủ dữ liệu" | P0 |
| R6 | M3.4a, M3.4b | Xếp hạng tra từ: khớp chính xác > tiền tố > trigram; nhận pinyin có dấu thanh hoặc số (dùng chung normalizer R9); badge Level, HSK7_9 kèm band; dữ liệu ít đổi (bộ thủ, bảng Hán Việt) phục vụ tĩnh có version. Không gửi nét viết tay tới endpoint bên thứ ba | Hanzii web tra theo tab loại, gửi nét viết tay tới endpoint Google không chính thức | P1 |
| R7 | M3.4d | Trường âm Hán Việt theo chữ (chữ đa âm có nhiều âm) và bộ thủ gắn chữ; nguồn có giấy phép (#2) | Hanzii web và app coi âm Hán Việt cạnh pinyin là lõi cho người Việt | P1 |
| R8 | M3.6 | Theo mockup `mistakes.html`, `mistakes-review.html`; "đã sửa" suy từ attempt đúng sau đó; không xoá attempt sai, không thêm bảng | Migii lấy câu sai từ lịch sử | P1 |
| R9 | M3.7 | Normalizer pinyin khoan dung: dấu thanh và số, v = ü, bỏ `'` và khoảng trắng, chấp nhận biến điệu 一/不 và 3-3; trả mức "đúng âm, sai thanh" (vẫn không trả đáp án, Q50). Hiện `normalize-pinyin.ts` chỉ bỏ số thanh | HelloChinese, Hanzii app chấm gõ pinyin 3 mức | P1 |
| R10 | M4.1, M4.6 | Chốt bộ `Tag` slug dạng câu HSK 3.0 theo đề mẫu chính thức trước khi soạn ≥ 300 câu/cấp, kèm test đồng bộ nhãn tiếng Việt; không trộn dạng HSK 2.0 (#15) | Migii clone dạng 3.0 từ 2.0; Baolingo gắn nhãn 3.0 cho đề 2.0 | P1 |
| R11 | M4.2a, M4.3 | Serializer đề và câu kế tiếp loại `correctAnswer`/`explanation`; submit chỉ nhận đáp án thô, bỏ qua mọi score/result/point từ client; giải thích chỉ trả sau submit, đọc từ snapshot. Test contract khẳng định payload lúc đang làm bài không chứa khoá đáp án | 7/8 đối thủ gửi đáp án trong payload đề hoặc tin điểm client; "mã hoá" bằng khoá nằm ở client không phải bảo mật | P0 |
| R12 | M4.2b | Attempt và đồng hồ chỉ bắt đầu khi bấm "Bắt đầu" ở `exam-intro.html` (MB-10); hết giờ tính từ `startedAt/expiresAt` theo giờ server, thời gian client gửi chỉ dùng cho analytics; autosave idempotent từng câu, thêm lô khi reconnect/resume; tải trước audio cả đề; banner mất mạng | Baolingo autosave từng câu và theo lô; Migii màn chuẩn bị có thử loa | P1 |
| R13 | M4.3 | `ExamAnswer` thêm trạng thái chấm `pending/grading/graded/failed` cho câu viết/nói (migration mới); Result tách điểm tạm và điểm cuối; pass/fail tính ở server; weak areas theo Tag dạng câu (R10); kết quả AI theo descriptor của rubric | Hanzii app cờ `process`; Migii trả kết quả HSKK/viết bất đồng bộ | P1 |
| R14 | M4.5 | Điểm theo kỹ năng và dạng câu, thời gian theo phần, "tổng X/Y, điểm đỗ Z"; đúng/sai bằng icon kèm chữ, không chỉ màu; giải thích câu sai không paywall; trạng thái "đang chấm"; nộp sớm có xác nhận; không quảng cáo. Mockup `exam-result.html`, `exam-review.html`, `exam-history.html` | Hanzii web donut + thanh theo phần + lưới câu; Hanzii app đặt quảng cáo trên màn kết quả | P1 |
| R15 | M7.2 | `detailJson` = điểm tổng + accuracy/fluency/completeness (+ tone) + mảng âm tiết `{initial, final, tone, expectedTone, score, issue, fix}`; qua khi tổng ≥ ngưỡng và mọi ký tự trọng tâm ≥ ngưỡng; ngưỡng là config server, khoảng nửa mở, test biên; cho "Tiếp tục" sau 3 lần. Audio đi browser/app → backend → vendor, key vendor chỉ ở server. Bản ghi mặc định private, signed URL ngắn hạn, không userId trong tên file, không feed/xếp hạng giọng nói, xoá theo lifecycle; xin quyền micro theo `permissions.html` (MB-15) trước lần ghi đầu. Câu rỗng hoặc không nhận dạng được = "thử lại", không được điểm | SuperChinese giải mã key STT trên máy; Baolingo công khai audio người học và cho câu rỗng 100 điểm; Hanzii web hard-code ngưỡng ở client | P1 |
| R16 | M7.4c | Quota là transaction PostgreSQL theo user, feature và ngày (timezone hồ sơ): trừ trước khi gọi vendor, hoàn khi vendor lỗi, idempotent; `GET /ai/usage` trả `used/limit/remaining/resetsAt`; giới hạn độ dài input; kill switch theo feature. Validator bài viết (số chữ Hán, từ bắt buộc, lặp) chạy trước LLM, sai thì không trừ quota. Prompt và rubric chỉ nằm trong `ai/services/rag-api`, kết quả lưu `rubricVersion`. Không Redis (ADR-008 §2) | Hanzii web, HelloChinese, Speak Chinese đếm quota ở client; Speak Chinese để key và rubric trong app | P1 |
| R17 | M7.4d | SSE trên `POST /api/v1/ai/chat` qua BFF; request mang `clientEventId`; stream có pha; phân trang tin nhắn bằng cursor | Hanzii web dùng WebSocket mang token trong frame | P2 |
| R18 | M7.5a | Dữ liệu nét chữ pin version, kiểm license, tự host qua media pipeline | Speak Chinese tải dữ liệu nét `@latest` từ CDN | P2 |
| R19 | M7.7a | Gate mobile: chỉ HTTPS, không ngoại lệ cleartext/ATS, không log payload xác thực, không quyền AD_ID hay SDK session replay, không secret trong app. Khi có offline: chỉ upload event log có `idempotencyKey`, server tính lại SRS/streak/progress, pull theo `since` + tombstone, không last-write-wins | HelloChinese đăng nhập và biên lai IAP qua `http://`, sync last-write-wins; Speak Chinese bật AD_ID + Clarity | P1 khi bắt đầu |
| R20 | M2.B7, M7.3 | Job nhắc chạy theo `reminderTime` + timezone, bỏ qua ngày đã có sự kiện học, ưu tiên ngày sắp đứt chuỗi; xin quyền push theo `permissions.html` | SuperChinese, Migii nhắc theo giờ và khi sắp mất chuỗi | P2 |
| R21 | M2.9a | Script ngoài sinh file import bài tập nháp (mcq, arrange_sentence, listening_choice) từ Word/LessonWord; distractor cùng Level, thiếu ≥ 4 mục thì báo lỗi; đi qua revision → review → publish đã có, không thêm endpoint | Speak Chinese sinh 6 dạng bài từ dữ liệu bài; Hanzii app kiểm đủ 4 mục mới sinh trắc nghiệm | P1 |
| R22 | M5.6 | Báo lỗi nội dung một bảng chung `targetType + targetId + contentVersion + lý do`, rate limit theo user, chống báo trùng, vào hàng đợi CMS; thống kê % đúng theo câu để phát hiện đáp án sai. Bật nút ở learner cần PO mở lại Q67 | Cả 8 đối thủ có báo lỗi nội dung | P2 |
| R23 | M7.6 | Client chỉ gửi `sku`; entitlement chỉ cấp qua webhook/IPN có verify chữ ký, idempotent; đơn lưu snapshot giá; poll có timeout; không countdown giả, gacha/vòng quay, quảng cáo trong luồng học | Hanzii web cho client gửi `percent`/`sandbox`, kích hoạt qua query redirect; Migii duyệt ảnh chuyển khoản bằng tay | P2 |
| R24 | M7.8 | DTO công khai chỉ displayName/avatar/level; không lộ trạng thái premium, hạn hay online; bảng xếp hạng opt-in | Hanzii web lộ `is_premium`, `premium_expired`, `last_online_at` | P2 |

### 5.2 Backlog nhỏ từ khảo sát đối thủ (chưa thành task)

Chỉ đưa vào mục 1 khi có lý do sản phẩm hoặc evidence; không tính vào tổng.

- Kẹp `durationSeconds` của attempt theo khoảng start → submit server đo; phút học hôm nay (Q13) không lấy giá trị client vượt khoảng đó.
- Liệt kê phiên đăng nhập và đăng xuất thiết bị khác (`UserSession` đã có `deviceId/userAgent/lastSeenAt`), mã lỗi `session_revoked`; chưa giới hạn số thiết bị (#16).
- Header `Retry-After` cho 429 của `CustomThrottlerGuard` (hiện chỉ media ingestion có).
- Mật khẩu mới tối thiểu 8 ký tự (đang `@MinLength(6)`), login giữ 6 (#16).
- Test integrity đếm số từ theo Level so với chuẩn chính thức; không seed từ danh sách bên thứ ba.
- Sau M3.3: phiên ôn thích ứng, chọn dạng câu theo độ quá hạn.
- `streakMax` tính từ ngày học sẵn có; freeze chỉ khi có ADR.
- Dạng bài ngữ pháp "sắp xếp từ thành câu", "nối nửa câu" qua validator/scorer chung; player có fallback "chưa hỗ trợ" cho loại lạ.
- Attempt tham chiếu revision/version của bài để kết quả bất biến khi CMS sửa.
- M7.1: tách từ ở server lúc publish, lưu token trong content Json; không tải từ điển/jieba về browser.

### 5.3 Invariant cắt ngang rút từ phản mẫu của đối thủ

- Đáp án, điểm, thưởng, quota, chuỗi ngày học và quyết định kết thúc chỉ tính ở server; không nhận score/correct/XP/finish từ client.
- Không secret, không ký request, không "mã hoá" payload ở client; bảo vệ bằng auth, rate limit PostgreSQL và không trả field thừa (ADR-003, ADR-008).
- Bản ghi giọng nói và nội dung người học mặc định private; không feed công khai.
- Không dark pattern: countdown giả, gacha/vòng quay, chặn việc học bằng tài nguyên ảo, quảng cáo trong luồng học.
- Không trộn chuẩn HSK 2.0 và 3.0; HSK7_9 là một Level.

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
| 10 | Chấp nhận ADR-008 (stack còn lại) | Product Owner + Tech Lead | 🟡 §1, §2, §9 đã chốt (§2, §9: Product Owner 29/09/2026); còn lại 🔵 |
| 11 | Đóng băng harness release-evidence theo ADR-008 §8 và review A-04 | Tech Lead | 🔵 |
| 12 | Chỉ tiêu nội dung trước beta: số từ có nghĩa tiếng Việt (M1.2b), số bài học và bài tập mỗi cấp (M2.9), số câu hỏi và đề mỗi cấp (M4.6); nguồn và license cho audio từ vựng | Product Owner + Content | 🔵 đề xuất 14/09 trong mục 1.2 |
| 13 | Placement có được tự đổi `targetLevel` không hay luôn cần người học xác nhận; có dùng nhãn "kết quả tạm" (R1, R2) | Product Owner | 🔵 đề xuất: luôn xác nhận |
| 14 | SRS: chính sách grade bước đầu (R3); thêm cột FSRS ngay migration M3.1 hay chỉ SM-2, có chấp nhận dependency `ts-fsrs`; exercise attempt có sinh thẻ/ReviewEvent không (Q62), tra từ có tính lần ôn (đề xuất: không); nút hoàn tác lần chấm (mockup không có) | Product Owner + Tech Lead | 🔵 chặn phần tương ứng của M3.1–M3.3 |
| 15 | Bộ Tag dạng câu HSK 3.0 do ai chốt, dựa trên đề mẫu chính thức nào (R10); có báo trong app khi câu viết/nói chấm xong không (Q15 đang chỉ toast) | Curriculum + Product Owner | 🔵 cần trước M4.6 |
| 16 | Học và tài khoản: ngày học bắt đầu 02:00–04:00 thay 00:00 (đổi Q13); nút "Không thể nghe/nói lúc này" và topic có tính hoàn thành (Q18, Q58); câu sai xếp lại cuối bài (Q50); `daysOfWeek` cho nhắc học; mật khẩu tối thiểu 8; màn quản lý thiết bị | Product Owner | 🔵 |

## 7. Việc cần làm ngay (2 tuần tới)

1. H.2d: chủ repo bật branch protection `main`, rồi merge PR #5 khi ba check xanh.
2. H.13 ✅: TypeScript 6 backend 6.0.3 exact (`58d5c5e`, run `36378049255`) → GĐ1 9/10 (còn H.2d).
3. GĐ3 M0.E: D-04 limiter per process đã đóng (`6a61efc`, run `36407315763`); song song duyệt ADR-008 (#10) và #11 để biết M0.4 đi đâu.
4. GĐ4 theo đường găng: M1.4 session refresh/revoke (B-03), M1.5 mail; M1.1 chờ quyết định #2.
5. M2.1 + M2.2 chỉ bắt đầu khi GĐ4 xong M1.4, M1.5 (điều kiện vào GĐ5).
6. M2.9a: dựng pipeline seed nội dung có agent hỗ trợ và pilot 5 bài HSK1, chạy song song M2.4b–M2.5.
7. M7.4a: chốt quyết định #6 (nhà cung cấp AI) và duyệt ADR-008 §6 trước tuần 12 của đồ án.
8. M2.UXa–M2.UXd: bổ sung các màn thiết kế còn thiếu theo [product/design-coverage.md](./product/design-coverage.md), thứ tự Mobile P1 → Web P1 → Admin P1 → trạng thái chung.
9. Ngoài PLAN: thu hồi phiên tài khoản Hanzii đã dùng để capture; `reverse/` (local, gitignored) chứa token phiên và thông tin cá nhân thật, không đưa capture hay ảnh chụp vào docs, PR hay prompt gửi ra ngoài.

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
| 14/09/2026 | GĐ2: H.5 ✅ (`ac7faa4`, đã push). H.6 🟡: bỏ so sánh plaintext và upgrade hash inline khi login; mật khẩu lưu không phải Argon2id luôn bị từ chối. Rà fixture: user đăng nhập qua API đều tạo bằng register hoặc seed Argon2id; các giá trị giả trong `test/database/*.sql` và script concurrency chỉ ghi DB, không đăng nhập. |
| 14/09/2026 | GĐ2: H.6 ✅ (`039b6af`, đã push). H.7 🟡: chống dò email qua mã lỗi và thời gian login (hash mồi Argon2id), register trùng → `409`, form login tách 403 khoá khỏi 403 không phải admin. |
| 14/09/2026 | GĐ2: H.7 ✅ (`3db5ae1`, đã push). H.8 🟡: `GET /users` phân trang và bỏ user soft-delete, `GET /users/me` chỉ trả account active; `PaginationQueryDto.page` ≤ 2147483647 để `page` quá lớn trả `400` thay vì `500`. |
| 14/09/2026 | GĐ2: H.8 ✅ (`99fb219`, đã push). H.9 🟡: provider media tường minh (`MEDIA_STORAGE_PROVIDER`, `MEDIA_SCANNER_PROVIDER`), adapter giả chỉ hợp lệ khi `NODE_ENV=test`, không còn secret/ingestion mặc định suy từ `NODE_ENV=test`. |
| 14/09/2026 | GĐ2: H.9 ✅ (`e6e6620`, đã push). H.10a 🟡 + H.10b 🟡: envelope response/lỗi toàn cục, `X-Request-ID`, BFF parse envelope; `GET /users` chuyển phân trang sang `meta.pagination`, `/health` bỏ `success` tự gắn. |
| 14/09/2026 | Thêm mục 1.2 "Dữ liệu: có gì, đủ sau bước nào, còn thiếu gì" với danh sách data còn thiếu sau khi hết PLAN; thêm bước sản xuất nội dung M1.2b, M2.9, M4.6 (chỉ tiêu đề xuất, quyết định #12) và tiêu chí độ phủ nội dung vào M6.7. Tổng task 128 → 131. |
| 14/09/2026 | GĐ2: H.10a + H.10b ✅ (`37e0198`, đã push). H.10c 🟡: `backend/openapi.json` sinh từ code (Swagger CLI plugin, preview mode không cần DB) với envelope, lỗi `default`, `X-Request-ID`, bearer `JWT`; CI kiểm file commit không lệch; frontend sinh type bằng `openapi-typescript` và kiểm response đã document của call BFF qua được Zod. |
| 26/09/2026 | GĐ2: H.10c (`f2448d3`), H.11a (`46396d7`), H.11b (`e350948`), H.12 (`56168cb`) ✅ sau khi Tech Lead duyệt và đã push; GĐ2 13/14. H.14 🟡 chờ review (task cuối GĐ2): xoá 4 route BFF đọc thừa, `/api/session/me` giữ cookie khi 5xx, focus archive, logout kiểm `ok`, trang admin map 403. |
| 26/09/2026 | GĐ2: H.14 ✅ sau khi Tech Lead duyệt. GĐ2 hoàn thành 14/14; tổng 48/131. |
| 28/09/2026 | GĐ1: mở PR #5 `macdev` → `main` để CI chạy lần đầu trên GitHub (trước đó 0 run vì `ci.yml` chỉ chạy trên PR/push `main`). Run `36374888359` fail 1 e2e: payload lồng 5.000 cấp bị superagent serialize thành chuỗi placeholder trên Node 24; sửa `b79b8ed`. Run `36375778246` xanh cả `backend`, `backend-e2e`, `frontend` → H.2a, H.2b, H.2c ✅. H.2d ⬜: `main` chưa có branch protection. M0.E 🟡: `f51c71b` (B-07 TTL learner 60 s, `MEDIA_SIGNING_SECRET_PREVIOUS`). `270fb54`: secret scan fail từ `9272c58` do fixture không theo mẫu placeholder. Đồng bộ header, mục 1.1, 2, 4 (M0.3, exit M0, H.2), 7. Tổng 51/131. |
| 28/09/2026 | GĐ1: H.13 ✅ (`58d5c5e`) nâng TypeScript backend lên 6.0.3 exact khớp frontend (ADR-008 §12), khai báo `rootDir: .` trong `backend/tsconfig.json` xử lý TS5011; PR #5 run `36378049255` xanh cả 3 job `backend`, `backend-e2e`, `frontend`. GĐ1 đạt 8/9 (chỉ còn H.2d do chủ repo bật branch protection); tổng 52/131. |
| 28/09/2026 | GĐ3: M0.E phần D-04 đã đóng (`6a61efc`, run `36407315763`, limiter per process với `MEDIA_INGESTION_MAX_CONCURRENCY` + busy 503 `MEDIA_INGESTION_BUSY`, drain có giới hạn trước khi trả response để tránh EPIPE; huỷ ngắt ngang sau nhận body được gỡ theo quyết định 28/09). M0.E vẫn giữ 🟡 vì full gate Linux AMD64 bị chặn bởi #11. Tổng 52/131. |
| 29/09/2026 | GĐ1: H.16 ✅ đã đóng (`28cd345`, kèm `48ad32b`, PR #5 run `36514585300`): xác định nguyên nhân flaky do supertest tự `listen(0)`/`close()` mỗi request khi app chỉ `init()`, response lỗi đến từ process khác trên loopback (không có `x-request-id`); đo được: mặc định 3/116 fail, tắt keep-alive 3/100 fail, listen một lần 0/200 fail; áp dụng cho cả 8 suite `init()`-only; triển khai 2 điều kiện review D-04 (L1 xoá rate limit trong loop poll + L2 dời check `abortedIngestion` sau 201 trong `media-ingestion-concurrency.e2e-spec.ts`); 10 lượt e2e toàn bộ liên tiếp pass và full gate backend GREEN. GĐ1 đạt 9/10, tổng 53/132. |
| 29/09/2026 | GĐ4: M1.4a ✅ đã đóng (`1b27a45`, PR #5 run `36521807782`): refresh token xoay vòng lưu hash sha256 trong `UserSession`, claim nguyên tử với `CURRENT_TIMESTAMP`, phát hiện dùng lại thu hồi toàn bộ session, access token gắn `sid`; giữ access token 7d, hạ 15 phút chuyển sang M1.4b cùng BFF refresh. |
| 29/09/2026 | GĐ4: M1.4b ✅ đã đóng (`08a78ea`, PR #5 run `36533471666`): POST /auth/logout (204) thu hồi session theo sid, khoảng ân hạn 10s cho race refresh vô hại giữa các tab; tách M1.4c cho BFF proxy refresh và cookie. Tổng 55/133. |
| 29/09/2026 | GĐ4: M1.4c ✅ đã đóng (`01f468c`, PR #5 run `36547912748`): BFF proxy âm thầm refresh access token khi còn dưới 2 phút với single-flight sha256 map, cookie refresh song song với session cookie, route handler /api/session/logout gọi backend logout thật (204) để revoke session, hạ mặc định access token backend xuống 15m (`15m`). Tổng 56/133. |
| 30/09/2026 | GĐ4: M1.7a ✅ đã đóng (`b836cd7`, kèm `50ee3ee`, PR #5 run `36666904294`): pg-boss trên PostgreSQL (schema pgboss v43, migrate: false), worker process riêng (`src/worker.ts`), purge expired sessions job (batch 1000, 30 days). Tổng 57/133. |
| 30/09/2026 | GĐ4: M1.5a ✅ đã đóng (`685f441`, kèm `ba83411`, PR #5 run `36672199065`): `MailerPort` (DIP), 3 adapter (`SesMailerAdapter`, `MailpitMailerAdapter`, `InMemoryMailerAdapter`), module gắn worker process (`WorkerModule`), ma trận cấu hình mail và `assertMailProvider`, bảo vệ CRLF và chống rò rỉ PII. Tổng 58/133. |
| 30/09/2026 | GĐ4: M1.5b ✅ đã đóng (`2df43f5`, kèm `c543fd9`, `ff13c40`, PR #5 run `36684650025`): xác thực email một lần qua link hash SHA-256 TTL 24h, transactional register enqueue job `mail.email-verification`, POST /auth/email-verification/request (204, throttle 3/15m), POST /auth/email-verification/confirm (204, throttle 10/1m/IP), raw token trong mail fragment `#token=`, không lọt raw token ra DB/job/log. Tổng 59/133. |
| 30/09/2026 | GĐ4: M1.5c ✅ đã đóng (`4ca031b`, kèm `9e67628`, `ec3b901`, PR #5 run `36689833324`): đặt lại mật khẩu một lần qua link hash SHA-256 TTL 30 phút, POST /auth/password-reset/request (204, rate limit 2 lớp 5/15m/IP và 3/1h/email anti-enumeration), POST /auth/password-reset/confirm (204, throttle 10/1m/IP, claim token và đổi password trong transaction, thu hồi toàn bộ session active, xoá token cũ chưa dùng, lỗi không phân biệt 400 INVALID_RESET_TOKEN), worker mail.password-reset short policy retry 3 backoff, link fragment #token=. M1.5 đóng; đủ điều kiện vào GĐ5. Tổng 60/133. |
| 30/09/2026 | GĐ4: M1.6 ✅ đã đóng (`3c9b3b5`, kèm `a9adb2a`, PR #5 run `36696120929`): Profile API GET/PATCH /users/me/profile (JwtAuthGuard), đọc và sửa hồ sơ cá nhân { displayName, locale, timezone }. GET khi chưa có profile trả mặc định (null, vi-VN, Asia/Ho_Chi_Minh) và không tạo dòng; PATCH atomic upsert chống race condition (INSERT ... ON CONFLICT ("userId") DO UPDATE), validate displayName (trim, 1–50 code points, chặn control \p{Cc} và bidi override U+202A–U+202E/U+2066–U+2069, null để xoá), locale hỗ trợ vi-VN, timezone IANA chuẩn định dạng và lưu nguyên bản (Asia/Ho_Chi_Minh giữ nguyên, chặn asia/ho_chi_minh, +07:00, EST5EDT, Mars/Base), chặn body rỗng và field lạ, không có avatarUrl, cô lập theo user. Tổng 61/133. |
| 30/09/2026 | GĐ4: M1.7c ✅ đã đóng (`b1aa20e`, kèm `2b0f0b5`, `3123025`, PR #5 run `36705287180`): xoá tài khoản có thời gian chờ 7 ngày (Product Owner chốt 30/09/2026), POST /users/me/deletion-request (202, throttle 5/15m, xác thực lại mật khẩu hiện tại 400 INVALID_PASSWORD, thu hồi session ngay lập tức), huỷ yêu cầu khi đăng nhập lại đúng mật khẩu trong 7 ngày (POST /auth/login kích hoạt lại tài khoản active, guard H.7 decoy timing chống lộ tài khoản inactive), worker privacy.anonymize-account (startAfter 7 ngày, ẩn danh email deleted+<id>@anonymized.invalid, xoá name và displayName, tạo mật khẩu ngẫu nhiên không thể đăng nhập, xoá toàn bộ session/token, bảo toàn toàn bộ fact lịch sử theo ADR-001, giải phóng email gốc), worker mail.account-deletion-scheduled thông báo thời điểm xoá và link huỷ. Tổng 62/133. |
| 01/10/2026 | GĐ4: M1.7b1 ✅ đã đóng (`57eac10`, kèm `65b96df`, `f2e2b85`, PR #5 run `36808552129`): Export dữ liệu cá nhân dạng JSON qua ObjectStoragePort (ADR-001, Product Owner duyệt 30/09/2026), POST /users/me/data-exports (202, rate limit 1 export/24h/user trên DB clock, enqueue privacy.data-export), GET /users/me/data-exports (danh sách 10 export gần nhất), GET /users/me/data-exports/:id/download (kiểm tra quyền sở hữu, TTL 24h, đối soát checksum sha256 từ storage, 4 header an toàn, cấm URL ký), worker privacy.data-export (snapshot RepeatableRead, coverage DMMF 100%, chặn leak secret tokenHash/password, streaming batch LearningEvent 1000 dòng fail EXPORT_TOO_LARGE nếu >10MB), cron privacy.purge-expired-exports (dọn file S3 sau 7 ngày). Tách M1.7b2 Consent API (⬜) chờ quyết định Product Owner. Tổng 63/134. |
| 01/10/2026 | GĐ5: M2.1a ✅ đã đóng (`2bd2da9`, kèm `13b9d72`, PR #5 run `36815829812`): Learner session BFF (ADR-003, Tech Lead chốt 01/10/2026), cookie riêng LEARNER_SESSION_COOKIE_NAME (mặc định hsk_learner_session và _refresh, validate refine chống trùng), chỉ cho phép role user (admin nhận 403 admin_account, thu hồi session backend ngay lập tức), các route POST /api/learner/session/{login,register,logout} và GET /api/learner/session/me (CSRF same-origin, Zod validation, safeResponse), proxy chọn cookie theo đường dẫn, backend-client allowlist thêm /api/v1/auth/register. Không làm UI. Tổng 64/135. |
| 01/10/2026 | GĐ5: M2.1b 🟡 chờ review: UI chào mừng, đăng ký, đăng nhập, đăng xuất cho learner; nguồn thiết kế là bản HTML mẫu local docs/ui_reference (gitignore), áp dụng các quyết định PO 01/10/2026 (social toast "Tính năng sắp ra mắt.", điều khoản/bảo mật tĩnh tạm, desktop/tablet cột giữa rộng tối đa 480px với nền ngoài cream-100 và viền bóng, /sign-in dùng bố cục /sign-up với dòng phụ "Đăng nhập để tiếp tục học"), route group src/app/(learner)/, layout với next/font và learner.css riêng, xoá src/app/page.tsx, server guard qua getServerLearnerSession và resolveLearnerSession, form email/mật khẩu chuẩn a11y, validation client, nút hiện/ẩn mật khẩu, chặn double submit, thông báo lỗi thân thiện, nút đăng xuất tại /learn, Playwright e2e và script so pixel 40/40 PASS. Tổng 64/138. |
| 05/10/2026 | GĐ5: M2.1b ✅ đã đóng (`8d09d41`, `23ecd30`, `d774724`, `cc9b0e9`, `88d155f`, PR #5 run `37255512085`). Thêm M2.B6 🟡 chờ review (lưu `learningPurpose` cho UserGoal, migration `20261005023447_user_goal_learning_purpose`) và M2.B7 ⬜ (job gửi nhắc nhở học); quyết định PO 05/10 cho M2.2. Tổng 65/140. |
| 05/10/2026 | GĐ5: M2.B6 ✅ đã đóng (`d1c249e`, `5b1e87e`, `ada69f3`, `3f6896d`, PR #5 run `37259009433`). Thêm M2.B8 🟡 chờ review (`GET /levels` trả code/minBand/maxBand, seed e2e HSK2/HSK3/HSK7_9, bổ sung e2e onboarding, kèm sửa link Return to platform (regression `23ecd30`), README env e2e); điều kiện trước M2.2. Tổng 66/141. |
| 05/10/2026 | GĐ5: M2.B8 ✅ đã đóng (`32ebce0`, `830aa81`, `c869fe1`, `c8373ca`, `36c236a`, `256bd00`, `c4270b0`, `4d5b5a2`, PR #5 run `37265687035`). M2.2 🟡 chờ review: UI onboarding Mục tiêu và Kế hoạch (learner), 2 route Server Component `/(learner)/onboarding/{goal,plan}`, điều hướng `/learn`, BFF POST `/api/learner/onboarding/complete`, Playwright e2e (118 passed, 6 skipped, 0 failed), m22-compare 26/26 PASS, m21b-compare 40/40 PASS. Tổng 67/141 (66 + 1 = 67). |
| 05/10/2026 | GĐ5: M2.2 ✅ đã đóng (`4549dcd`, `218e0d3`, `fe89443`, `01c1ffd`, `2d16b74`, `2dfb834`, `0f08df2`, PR #5 run `37281941987`). Thêm M2.7a 🟡 chờ review (helper DB disposable cho kiểm psql trong e2e, ghim `TZ` cho Vitest, vòng focus jade-700 cho mọi control (Q12), ≥ 3:1 so với nền liền kề; forced-colors outline, ẩn thông báo `content_unavailable` khi đổi lựa chọn, mock `redirect` ném lỗi như Next). Đếm lại bằng script theo từng dòng task: GĐ4 10/17 (bảng 1.1 ghi 4/16), tổng trước thay đổi 67/142 (dòng tổng ghi 57/133). Tổng 68/143. |
| 05/10/2026 | GĐ5: M2.7a ✅ đã đóng (`d4d664d`, `234a3d6`, `063ef39`, `a9a91bf`, `b1a043b`, PR #5 run `37296349078`). Thêm M2.7b 🟡 chờ review (guard DB disposable frontend chỉ cho `sslmode`, bỏ `schema`, chặn mọi tham số khác, dùng pattern tên DB của backend, có unit test Vitest; guard backend chặn `dbname`, `host`, `hostaddr`, `port`, `service`, `servicefile` cho cả `DATABASE_URL` và `TEST_DATABASE_URL`; e2e assert vòng focus `rgb(2, 142, 106)` ở ô email sign-in, nút cấp độ đang chọn, select giờ; forced-colors tô `Highlight` cho cấp độ đang chọn; chặn fragment `#` ở guard backend và helper e2e (libpq đọc `#?dbname=` thành tham số); Playwright `testIgnore` `**/e2e/support/**`; Vitest chạy `e2e/support`). Đếm lại bằng script theo từng dòng task: GĐ5 11/31. Tổng 69/144. |
| 07/10/2026 | GĐ5: M2.7b ✅ đã đóng (`87833f7`, `b7b553b`, `2882e3d`, `3333d48`, PR #5 run `37564398158`). Thêm M2.7c 🟡 chờ review (test 8 đo chữ của cấp độ đang chọn ở forced-colors: pixel đổi khi ẩn chữ và tương phản ≥ 4,5:1, bỏ `border-color` chết; tài liệu quyết định PO learner UI `docs/product/learner-ui-decisions.md` chép bảng Q1–Q12, PO đồng ý 07/10/2026, trỏ từ `frontend/DESIGN.md`). Đếm lại bằng script theo từng dòng task: GĐ5 12/32. Tổng 70/145. |
| 07/10/2026 | GĐ5: M2.7c ✅ đã đóng (`d949b14`, `7d0dda8`, `ebf86bb`, PR #5 run `37568128763`). Thêm M2.B9 🟡 chờ review (`GET /learning/path` trả trạng thái bài theo Q18 và `nextLesson`; `POST /learning/lessons/:lessonId/start` trả `409 lesson_locked` khi bài ready liền trước chưa xong; quyết định PO Q13–Q20 chép vào `docs/product/learner-ui-decisions.md`), M2.B10 ⬜ `GET /learning/home` (Q13), M2.4a ⬜ Trang chủ + tab bar + `/learn/profile` (Q14–Q17), M2.4b ⬜ Lộ trình (Q18–Q20). Đếm lại bằng script theo từng dòng task: GĐ5 13/36. Tổng 71/149. |
| 07/10/2026 | GĐ5: M2.B9 ✅ đã đóng (`35464e9`, `f944589`, `82ced4e`, `529f1da`, `4823c2c`, PR #5 run `37574103921`). M2.B10 🟡 chờ review (`GET /learning/home` trả `nextStep`, `greetingName`, `dailyGoal` với `minutesToday` theo ngày local của timezone profile (cap 1440), `streakDays` tính chuỗi ngày học từ `lesson_completed`/`topic_completed`/`exercise_submitted` bằng một câu SQL gaps-and-islands, chuỗi kết thúc hôm qua vẫn giữ, `continueLesson` từ `selectNextLesson` kèm `completionPercent`; `LearningPathService.loadPathState` dùng chung cho path và home). Đếm lại bằng script theo từng dòng task: GĐ5 14/36. Tổng 72/149. |
| 09/10/2026 | GĐ5: M2.B10 ✅ đã đóng (`89c991d`, `a144a71`, `019f1a7`, `3613c00`, PR #5 run `37884908537`). M2.4a 🟡 chờ review (Trang chủ learner `/learn` dựng trên `GET /learning/home`: hero, Mục tiêu hôm nay tô theo tỉ lệ trần 100% (Q21), Chuỗi ngày học, Tiếp tục học, Khám phá; layout `/learn` có tab bar và toast dùng chung; Học, Tra từ, Ôn tập, chuông, Khám phá và thẻ Tiếp tục học ra toast (Q15, Q16, Q22); `/learn/profile` tối thiểu có tên, email, Đăng xuất (Q17); thêm Q21–Q22 vào `docs/product/learner-ui-decisions.md`). Đếm lại bằng script theo từng dòng task: GĐ5 15/36. Tổng 73/149. |
| 09/10/2026 | GĐ5: M2.4a FIX, vẫn 🟡 chờ review: vòng focus jade-700 cho avatar, vòng inset cho tab bar; màn 195px không tràn (Khám phá 3 cột, ẩn ô minh hoạ bài dưới 300px); thẻ Tiếp tục học dùng span thay h3/p; số liệu 2 thẻ đọc qua `aria-labelledby` và chữ sr-only; Hồ sơ vẫn hiện email và Đăng xuất khi `/learning/home` lỗi khác 401/403; thêm Q23 (chữ tab đang chọn jade-800) và Q24; thêm rule forced colors cho Home. Đếm lại bằng script theo từng dòng task: GĐ5 15/36. Tổng 73/149. |
| 09/10/2026 | GĐ5: M2.4a ✅ đã đóng (`b3e85a9`, `46690c6`, `b8645cf`, PR #5 run `37917119665`); việc còn lại của M2.4a (icon tab đang chọn theo màu hệ thống ở forced colors, test hồi quy 195/299px, focus inset, màu Q23) chờ review cùng M2.4b. M2.4b 🟡 chờ review (Lộ trình learner `/learn/path` dựng trên `GET /learning/path`: 7 tab cấp cố định chọn mặc định cấp mục tiêu, lưới bài done/current/available/locked với ô minh hoạ chung, ô khoá `aria-disabled` ra toast khoá, ô mở và nút "Bắt đầu" ra toast sắp ra mắt, thanh "Bài tiếp theo" ẩn khi `nextLesson` null; tab Học nối tới `/learn/path`; thêm Q25–Q31 vào `docs/product/learner-ui-decisions.md`). Đếm lại bằng script theo từng dòng task: GĐ5 16/36. Tổng 74/149. |
| 09/10/2026 | GĐ5: M2.4b FIX, vẫn 🟡 chờ review: thanh tab cấp cao 45px (tab 44px nằm trọn, vùng bấm đủ, vòng focus không bị cắt); dưới 300px lưới bài 2 cột, ẩn ô minh hoạ bài, nhãn và tên ở thanh "Bài tiếp theo" một dòng; forced colors giữ viền focus trong tab và viền Highlight khi rê ô đang học; phím tắt có Alt/Ctrl/Meta không đổi tab; panel cấp chưa có bài nhận focus. Tên đọc của ô bài (dấu cách trước dấu phẩy) chưa sửa, chờ quyết định. Đếm lại bằng script theo từng dòng task: GĐ5 16/36. Tổng 74/149. |
| 10/10/2026 | GĐ5: thêm M2.9a (pipeline seed nội dung có agent hỗ trợ + pilot 5 bài HSK1) làm task con của M2.9; bắt đầu ngay vì API CMS và exercise import đã có, không chờ UI M5.1. GĐ5 16/37; tổng 74/150. |
| 10/10/2026 | Sắp lại lộ trình cho đồ án tốt nghiệp (hạn 17/01/2027): thêm mục 1.0 phạm vi đồ án; GĐ9 mới = mobile, AI và nhận diện (M7.7a–d, M7.3, M7.4a–d, M7.2, M7.5a–b, M7.E); GĐ10 mới = deploy demo và bảo vệ (TN.1–TN.5, TN.E); production foundation + beta chuyển thành GĐ11 sau bảo vệ; reader, payment, community thành GĐ12. Tổng 74/167. |
| 10/10/2026 | Bổ sung từ khảo sát đối thủ (ưu tiên cao và trung bình): M2.5e trình phát nghe đổi tốc độ (GĐ5); M3.4d bộ thủ và âm Hán Việt, M3.6 sổ lỗi sai, M3.7 bài nghe chép chính tả, M3.8a–b video YouTube có phụ đề (GĐ6); yêu cầu tô màu chữ phát âm sai cho M7.2. GĐ5 16/38, GĐ6 0/12; tổng 74/173. |
| 10/10/2026 | GĐ5: M2.4b ✅ đã đóng (`618b302`, `2c36586`, `d34c3b8`, PR #5 run `38016160000`). M2.7d 🟡 chờ review (Lộ trình dưới 320px lưới 2 cột, ẩn ảnh trong ô, thanh "Bài tiếp theo" một dòng giữ dưới 300px; vòng focus inset cho panel cấp, forced colors `outline-offset: -3px`; ghi Q28; tách `LEARNING_PURPOSES`, `parseGoalPageSearchParams`, `resolveLevelForBand`, `availableBands`, `localDateString` sang `onboarding-values.ts` không kéo Zod để hard-load `/onboarding/goal` không vi phạm CSP; test chốt chặn `client-bundle-guard.spec.ts`). Tên đọc của ô bài (dấu cách trước dấu phẩy): Tech Lead bỏ, vì là lỗi hình thức và trình đọc màn hình đọc không khác. Đếm lại bằng script theo từng dòng task: GĐ5 17/37. Tổng 75/150. |
| 10/10/2026 | GĐ5: M2.B11 🟡 chờ review (rate limit theo route cho luồng learner: `GET /auth/me` 120/phút/user, `POST /learning/exercises/:exerciseId/attempts` 60/phút/user, 1.000 khi `NODE_ENV=test`; giữ bucket theo route, các route khác, bucket IP của auth và bảng `RateLimitCounter`; sửa mô tả rate limit ở `docs/api/api.md` và `docs/architecture/overview.md`; kèm việc nhỏ còn lại của M2.7d: `client-bundle-guard.spec.ts` coi file không phải code là nút lá, thử `.ts`/`.tsx` cho specifier `.js`, resolve `.`/`..`; e2e kiểm padding-bottom panel trống). Thêm M2.B12 ⬜ Media cho player M2.5 (route media public bị đếm theo IP, signed URL 60 giây, nginx chưa có `limit_req`; cần quyết định trước M2.5b). Đếm lại bằng script theo từng dòng task: GĐ5 17/39. Tổng 75/152. |
| 11/10/2026 | GĐ5: M2.B11 ✅ đã đóng (`ca0462f`, `c1e0ec9`, `1ec914c`, `b16401e`, PR #6 run `38104896978`). M2.B13 🟡 chờ review (mở rộng activity cho màn bài học, Q43: `level`, `position`, `state` cùng nguồn `loadLevelPaths` với Path, `sections` đếm từ vựng/ngữ pháp/luyện tập; bài khoá đọc `200` với `state: "locked"`, `POST start` vẫn `409 lesson_locked`). M2.5a ghi Q32–Q43, chờ M2.B13. Backlog: (1) public lesson detail dùng `ParseIntPipe`, cần kiểm id > int32; (2) `NextActivityAction` có giá trị bắt đầu topic mà không bao giờ trả (đã gỡ ở FIX M2.B13); (3) media grant của learner không kiểm Level published (gắn vào M2.B12). Đếm lại bằng script theo từng dòng task: GĐ5 18/40. Tổng 76/153. |
| 11/10/2026 | GĐ5: M2.7d ✅ đã đóng (`b400ea5`, `c8d8f3b`, `d063cd3`, PR #6 run `38103091483`). M2.B13 ✅ đã đóng (`e9dfee5`, `83618ee`, `b2419c8`, `0dd29ac`, PR #6 run `38110835934`). M2.5a 🟡 chờ review (màn bài học `/learn/lessons/[id]` đọc `GET /learning/lessons/:id/activity`; dòng Từ vựng/Ngữ pháp/Luyện tập theo Q35–Q37; bài khoá theo Q40, Q44; not-found tiếng Việt HTTP 404 theo Q41; ô mở ở Lộ trình, nút "Bắt đầu" và thẻ "Tiếp tục học" thành link tới bài). Q44 chép vào `docs/product/learner-ui-decisions.md`. Đếm lại bằng script theo từng dòng task: GĐ5 20/40. Tổng 78/153. |
| 11/10/2026 | GĐ5: M2.5a ✅ đã đóng (`7159999`, `f376863`, `f61b0f8`, PR #6 run `38144395840`). M2.5b 🟡 chờ review (player `/learn/lessons/[id]/practice`: thanh trên có X, tiêu đề, số x/y, thanh tiến độ, thanh kết quả; arrange_sentence chạm để ghép câu, mcq lưới 2×2, fill_blank theo Q47; listening_choice và dạng chưa hỗ trợ hiện thẻ sắp ra mắt theo Q48; BFF `POST /api/learner/lessons/:id/start` và `POST /api/learner/exercises/:id/attempts` có Idempotency-Key; nút "Tiếp tục học" và dòng Luyện tập của màn bài học mở player). Đổi tên M2.5b, M2.5c theo Q45; ghi phương án Q46 vào M2.B12. Q45–Q50 chép vào `docs/product/learner-ui-decisions.md`; FIX cùng ngày thêm Q51–Q53 (nút "Kiểm tra" cho cả 3 dạng; gợi ý, tiêu đề, câu đúng chung và control ≥ 44px thật theo Q42; ô trống mờ ở chỗ từ đã dùng). Backlog: DTO OpenAPI cho response 201 của `POST /learning/lessons/:id/start` và `POST /learning/exercises/:id/attempts` (hiện `data: unknown`). Đếm lại bằng script theo từng dòng task: GĐ5 21/40. Tổng 79/153. |
| 12/10/2026 | GĐ5: M2.B12 🟡 chờ review (route media content đếm theo grant 60/phút + trần 600/phút/IP, route access 120/phút/user, TTL learner 300 giây, grant learner dùng predicate của route attempts có Level published, Range 206/416 cho Safari, nginx `limit_req`; docs `api.md`, `overview.md`). Backlog M6.3: `limit_req` sau CloudFront cần WAF rate-based rule hoặc realip. Đổi `ops/nginx` nên evidence phát hành media cũ không còn mô tả cấu hình mới, phải thu lại ở mode RELEASE. M2.5b ✅ đã đóng (`c5647e0`, `2f0b720`, `d92675f`, PR #6 run `38200991127`). Backlog sau review M2.B12: (1) harness nginx: ca burst `limit_req` và `worker_connections 1024` chưa chạy thật vì local thiếu nginx, bắt buộc chạy `test:ops:media:linux-amd64` ở mode RELEASE; (2) grant cùng media xin trong cùng một giây dùng chung bucket 60/phút, đo tỉ lệ 429 ở M2.5c trước khi đổi định dạng grant; (3) `bytes=-N` với N > size trả 416 thay vì 206 như RFC 9110 (mức thấp); (4) comment trong `backend/.env.example` còn ghi 60 giây (PO sửa tay). Đếm lại bằng script theo từng dòng task: GĐ5 22/40. Tổng 80/153. |
| 12/10/2026 | GĐ5: M2.B12 ✅ đã đóng (`578ca94`, `5de2b86`, PR #6 run `38204114744`). M2.5c 🟡 chờ review (player listening_choice: nút phát, sóng âm trang trí 67 vạch tô theo tiến độ, thời gian `floor(currentTime)`/`ceil(duration)`, "Nghe lại"; không tự phát và không tải audio trước khi bấm phát; chọn đáp án là Kiểm tra được; audio qua BFF cùng origin `GET /api/learner/media/:id/access` và `GET /api/learner/media/:id/content` (stream, chuyển tiếp Range, `private, no-store`), CSP giữ `media-src 'self'`; listening_choice không có media vẫn là thẻ sắp ra mắt). Backlog M2.B12 mục 2 (đo tỉ lệ 429 của bucket grant) chưa làm ở M2.5c, vẫn để backlog. Backlog sau review M2.5c: (1) backend trả 401 ở route access thì BFF chưa xoá cookie; (2) lỗi của route content dùng `no-store`, chưa phải `private, no-store`; (3) chưa có test truyền abort signal lên backend; (4) cần thử phát audio trên iPhone/Safari thật trước khi phát hành. Q54–Q57 chép vào `docs/product/learner-ui-decisions.md`; ADR-003 ghi media learner đi qua BFF. Đếm lại bằng script theo từng dòng task: GĐ5 23/40. Tổng 81/153. |
| 12/10/2026 | GĐ5: M2.5c ✅ đã đóng (`fc52f26`, `5014020`, `3c7c049`, run `38213402357`). M2.5d 🟡 đang làm (hoàn thành bài theo Q58–Q61: player tự đóng topic khi đã làm hết bài tập của topic qua BFF start + complete topic, xong bài tập cuối thì complete bài rồi mở màn Hoàn thành `/learn/lessons/[id]/complete`; màn Hoàn thành không có XP và thẻ thành tích, điểm lấy `Progress.score`, "Ôn từ mới" ra toast, "Bài tiếp theo" theo `GET /learning/path`, bài cuối Level là "Về lộ trình"; không đổi backend). Q58–Q61 chép vào `docs/product/learner-ui-decisions.md`. Đếm lại bằng script theo từng dòng task: GĐ5 24/40. Tổng 82/153. |
| 12/10/2026 | GĐ5: M2.5d 🟡 chờ review (BFF đóng topic và hoàn thành bài, mỗi lệnh ghi một `Idempotency-Key` UUID sinh phía server; player đóng topic sau bài tập cuối của topic, hoàn thành bài sau bài tập cuối hoặc khi mở player với mọi bài tập đã có attempt rồi chuyển `/learn/lessons/:id/complete`, lỗi hiện `role="alert"` và "Thử lại"; màn Hoàn thành theo mẫu 06 và Q59–Q61, pháo giấy đặt bằng `:nth-child`, không thuộc tính `style`; thẻ "Bạn đã làm xong phần luyện tập" chỉ còn khi có bài tập chưa có attempt, ví dụ dạng sắp ra mắt Q48). Backlog sau review M2.5d: (1) Màn bài học khi bài đã done chưa đổi hành vi; (2) Điểm trên màn Hoàn thành dùng aria-label trên <p> (ARIA cấm), đổi sang chữ sr-only. Đếm lại bằng script theo từng dòng task: GĐ5 24/40. Tổng 82/153. |
| 12/10/2026 | GĐ5: M2.5d ✅ đã đóng (`c8d2348`, `36e332a`, PR #6 run `38232025356`). M2.4 ✅: phạm vi 02/01,02 đã phủ bởi M2.4a, M2.4b. M2.6a 🟡 đang làm (Q62, Q63: chi tiết từ public, lưu/bỏ lưu từ có JWT và Idempotency-Key, search thêm `id`). Đếm lại bằng script theo quy tắc 0.6 (gồm `#10`, `#11`): GĐ5 26/40, tổng 84/153. |
| 12/10/2026 | GĐ5: M2.6a 🟡 chờ review, xong code (`6b1397b`): chi tiết từ public `GET /dictionary/words/:id` (`404 WORD_NOT_FOUND`), search thêm `id`, lưu/bỏ lưu `GET/POST/DELETE /dictionary/words/:id/save` idempotent theo `Idempotency-Key`, khoá `User FOR UPDATE`, POST trả `201` theo `api.md` §1. Backlog: (1) bỏ lưu không ghi event vì enum `LearningEventType` thiếu loại, xem lại khi làm M2.8/M3; (2) `parseIdempotencyKey` và `classifyLessonActivityPersistenceError` đang import chéo từ `learning/activity`, chuyển sang `common/` khi có module thứ ba dùng; (3) server test chạy curl nạp `backend/.env` qua dotenv, cần bước xác nhận mail và storage ở chế độ test. Đếm lại bằng script theo quy tắc 0.6: GĐ5 26/40, tổng 84/153. |
| 12/10/2026 | GĐ5: M2.6a ✅ đã đóng (`6b1397b`, `ef51c56`, PR #6 run `38238233906`). Thêm M2.B14 🟡 đang làm theo Q64: `GET /dictionary` tra thêm theo nghĩa tiếng Việt (bỏ dấu) và tiếng Anh, vì mẫu tra được nghĩa Việt; dữ liệu thật hiện có 0 nghĩa Việt (M1.2a chưa làm) nên hôm nay tra được nhờ nghĩa Anh. Q65–Q68 cho M2.6b, chép vào `docs/product/learner-ui-decisions.md`. Đếm lại bằng script theo quy tắc 0.6: GĐ5 27/41, tổng 85/154. |
| 12/10/2026 | GĐ5: M2.B14 🟡 chờ review: `GET /dictionary` nhận query Latin có dấu (1–64 ký tự); nhóm 1 khớp tiền tố pinyin, nhóm 2 khớp nghĩa theo đầu từ (`meaningViNormalized`/`meaningEnNormalized`, regex Postgres có tham số, query bỏ dấu ≥ 2 ký tự), tối đa 20. Xếp hạng: hanzi theo cấp HSK thấp nhất (không cấp xếp sau), độ dài, `hanzi`, `id`; pinyin theo cấp HSK, khớp trọn, độ dài, `pinyinNormalized`, `id`; nghĩa theo khớp chính xác, cấp HSK, độ dài nghĩa khớp, `id`. Hàm chung `normalizeMeaning` cho query và seed. Dòng backfill P0 giữ dấu chỉ khớp query có dấu (shortcut, backfill khi M1.2a). Đo sau `VACUUM (ANALYZE)` trên 200.156 nghĩa CC-CEDICT, 8 query: p95 ≤ 34,4 ms. Đếm không đổi: GĐ5 27/41, tổng 85/154. Code ở `5089fee`. |
| 12/10/2026 | GĐ5: M2.B14 ✅ đã đóng (`5089fee`, `98af98d`, PR #6 run `38264090030`). M2.6b 🟡 đang làm (màn Tra từ `/learn/dictionary` và Chi tiết từ `/learn/dictionary/[id]` theo Q62–Q70, lưu/bỏ lưu qua BFF, tab Tra từ thành link; kèm `@Throttle` riêng cho 3 route GET dictionary vì giới hạn mặc định 20/phút/user). Q69, Q70 chép vào `docs/product/learner-ui-decisions.md`. Backlog sau review M2.B14: xếp "khớp trọn từ" trên "chỉ khớp tiền tố của từ" (ví dụ `water` ra 门 nhờ nghĩa "Watergate"). Đếm lại bằng script theo quy tắc 0.6: GĐ5 28/41, tổng 86/154. |
| 12/10/2026 | GĐ5: M2.6b 🟡 chờ review: màn Tra từ `/learn/dictionary` (tra khi gõ sau 300 ms qua BFF `GET /api/learner/dictionary`, huỷ request cũ, đồng bộ `?q=` bằng `replaceState`, Enter mở kết quả đầu, lỗi có nút Thử lại) và Chi tiết từ `/learn/dictionary/[id]` (Giản/Phồn chỉ đổi chữ đầu màn, menu ⋮ với Sao chép thật, lưu/bỏ lưu qua BFF `POST`/`DELETE /api/learner/dictionary/words/:id/save`, trang 404 "Không tìm thấy từ"); tab Tra từ thành link; CSS chép từ `m03.css` (03-01, 03-02, khối M2.6b); backend thêm `dictionaryReadLimit` 120/phút (1.000 khi `NODE_ENV=test`) cho 3 route GET dictionary. Đếm không đổi: GĐ5 28/41, tổng 86/154. |
| 12/10/2026 | GĐ5: M2.6b review PASS có điều kiện; K4 chạy lại 0 FAIL sau khi Tech Lead sửa `m26b-compare.cjs` (menu ⋮ đang mở được phép che control bên dưới). Code ở `230b821`. Backlog: `learner-listening.spec.ts:229 [desktop-1440]` có lần gọi access 3 lần thay vì 2. |
| 12/10/2026 | GĐ5: review commit M2.6b (`230b821`, `dfc7a58`, PR #6 run `38277976523`) PASS, nhưng M2.6b chưa đóng: thiếu `/api/learner/dictionary/:path*` trong matcher `frontend/src/proxy.ts`, nên sau 15 phút access token hết hạn, lần tra/lưu tiếp theo nhận 401 và BFF xoá cả cookie phiên (đăng xuất). Sửa cùng M2.1c/d. Mục 4: M2.5 ✅ (mọi task con đã đóng). M2.1c, M2.1d 🟡 đang làm theo Q71–Q74 (chép vào `docs/product/learner-ui-decisions.md`). Backlog: link điều khoản ở Đăng nhập jade-700 (4,13:1), ở 195px hai link chồng vùng bấm. Đếm lại theo quy tắc 0.6: GĐ5 28/41, tổng 86/154. |
| 13/10/2026 | GĐ5: M2.1c, M2.1d 🟡 chờ review: trang `/forgot-password` (Q71), `/reset-password`, `/verify-email` (bấm nút mới xác thực, Q72; gửi lại hoặc đăng nhập để gửi lại, Q73), link "Quên mật khẩu?" ở Đăng nhập, nút chính jade-800 cả luồng (Q74); 4 route BFF `/api/learner/password-reset/{request,confirm}`, `/api/learner/email-verification/{request,confirm}` (same-origin, `no-store`, chuyển tiếp X-Forwarded-For, đặt lại xong xoá cookie learner); token đọc từ `#token=` rồi xoá khỏi URL; `/sign-in?next=` chỉ nhận đúng `verify-email`; `BackendRequestError` giữ `error.code` của backend để phân biệt `INVALID_RESET_TOKEN` với mật khẩu yếu. M2.6b 🟡 chờ review: thêm `/api/learner/dictionary/:path*` (và `/api/learner/email-verification/:path*`) vào matcher `frontend/src/proxy.ts`. Backend e2e `dictionary-read-limit` có timeout riêng 30 giây (CI run `38334793131` hết 5 giây). Đếm không đổi: GĐ5 28/41, tổng 86/154. |
| 13/10/2026 | GĐ5: M2.1c, M2.1d review PASS (kèm sửa matcher proxy M2.6b, timeout test read-limit). Code ở `5e46bef`. Backlog test e2e chập chờn: `learner-listening.spec.ts:229 [mobile-390]` (3 lần gọi access), `learner-auth.spec.ts:105 [tablet-768]` (openProfile bấm trước khi trang sẵn sàng); chạy lại riêng 5 lần mỗi project: 40/40 PASS. |
| 13/10/2026 | GĐ5: M2.1c, M2.1d, M2.6b ✅ đã đóng (`d36feab`, `5e46bef`, `03734f0`, PR #6 run `38343537592`); M2.6 ✅ (mục 4). M2.8 🟡 đang làm theo Q75, Q76, kèm sửa `learner-listening.spec.ts:229` và `learner-auth.spec.ts:105` chập chờn. Script đếm chuẩn tính cả dòng mã `#n` và mọi ô trạng thái (⛔, 🔵). Đếm lại: GĐ5 31/41, tổng 89/154. |
| 13/10/2026 | GĐ5: M2.8 🟡 chờ review: `npm run analytics:p0` (`backend/scripts/analytics/p0-product-metrics.ts`, transaction READ ONLY, `$queryRaw` + `Prisma.sql`) tính signups, onboarded (Q77: user có ≥ 1 `LearningPlan` bất kỳ status, `createdAt < asOf`), activation 7 ngày (Q76), lesson started/completed/completion rate, chỉ số tổng, không PII; định nghĩa và SQL Metabase ở `docs/analytics/P0_PRODUCT_METRICS.md`; e2e `p0-product-metrics.e2e-spec.ts`. Sửa `learner-listening.spec.ts:229` chập chờn: player gọi access lần 2 khi bấm Phát lúc grant của lần mount còn đang chờ, nay dùng chung request đang chờ (unit test mới). `learner-auth.spec.ts:105 [tablet-768]` không tái hiện được (240/240 PASS), chưa sửa. Đếm không đổi: GĐ5 31/41, tổng 89/154. Backlog: `learner-auth.spec.ts:105`; grant cũ có thể ghi đè `grantRef` nếu `media.id` đổi khi đang mount (có từ trước). |
| 13/10/2026 | GĐ5: M2.8 ✅ đã đóng (`2c786d0`, `a8613cd`, `7dc6c59`, PR #6 run `38347856594`; Q77 onboarded = đã từng tạo plan). Thêm M2.7e 🟡 đang làm (axe, bàn phím, trạng thái learner). Đếm lại: GĐ5 32/42, tổng 90/155. |
| 13/10/2026 | GĐ5: M2.7e ✅ đã đóng (`59ac0a3`, `5d8d81a`, PR #6 run `38365835081`; Q78–Q80 tương phản); M2.7 ✅ (M2.7a–M2.7e đã đóng). Thêm M2.10 ⬜ bố cục web learner từ 1024px (Q81). Đếm lại: GĐ5 34/43, tổng 92/156. |
| 13/10/2026 | GĐ5: tách M2.10 thành M2.10a (khung web `.w-app`, nội dung web Trang chủ, Lộ trình, Hồ sơ; 🟡 đang làm), M2.10b (nội dung web Tra từ, Chi tiết từ; màn làm bài `.w-focus`; ⬜), M2.10c (trang công khai `.w-public`; ⬜). Q82–Q85 chép vào `docs/product/learner-ui-decisions.md` và đồng bộ bảng với README. Đếm lại: GĐ5 34/46, tổng 92/159. |
| 13/10/2026 | GĐ5: M2.10a ✅ đã đóng (`0de3e57`, `b37e96d`, PR #6 run `38395402644`): khung web `.w-app` từ 1024px (sidebar 264px + thanh trên 64px, nội dung ≤ 1200px căn giữa), nội dung web Trang chủ/Lộ trình/Hồ sơ theo Q81–Q83, Q85. Test mới `learner-web.spec.ts`: đo cột nội dung 1200px ở 1920, lưới Khám phá/Lộ trình khớp mẫu ở 1280/1440, không tràn ngang ở 1024/1280/1920, zoom 200% và forced-colors không chồng chữ và giữ vòng focus; phá thử (max-width 1400, lưới 3 cột) đều FAIL đúng, khôi phục khớp sha256. M2.10b 🟡 đang làm. Đếm lại: GĐ5 35/46, tổng 93/159. |
| 14/10/2026 | GĐ5: M2.10b ✅ đã đóng (`2b0523a`, PR #6 run `38503428606`): nội dung web Tra từ, Chi tiết từ, Bài học (kể cả bài khoá, not-found) trong `.w-app`; Luyện tập và Hoàn thành trong `.w-focus` (760px). Sidebar chỉ ẩn ở practice/complete; wrapper `display:contents` và `.w-only` ở cuối `learner.css` giữ pixel dưới 1024px không đổi (16 cặp ảnh 390/768 vs HEAD `f715795`: 0 pixel khác). Test mới chốt `.w-only` = `display:none` ở 390px cho bài học/Tra từ/luyện tập; xoá rule cuối file thì test FAIL, khôi phục khớp sha256. M2.10c 🟡 đang làm. Đếm lại: GĐ5 36/46, tổng 94/159. |
| 14/10/2026 | GĐ5: thêm M2.10d 🟡 đang làm — sửa lỗi review sau đóng M2.10a/M2.10b (review Tech Lead 14/10/2026): vùng chạm 44px (Q69), thứ tự focus Lộ trình 1024–1279, khung 404 dưới practice/complete, gợi ý player theo loại bài, test menu ⋮ web, fixture riêng của spec web, bám mẫu Tra từ và Bài học, lỗi Prisma 500 khi hoàn thành bài. M2.10c ⬜, làm sau M2.10d. Đếm lại theo quy tắc 0.6: GĐ5 36/47, tổng 94/160. |
| 14/10/2026 | GĐ5: M2.10d ✅ đã đóng (`2125a67`, PR #6 run `38531633716`): F1, F3–F13 — fixture riêng cho spec web (bỏ phụ thuộc seed), vùng chạm 44px cho breadcrumb/.word-web__back, thứ tự DOM = thứ tự nhìn ở Lộ trình 1024–1279 (thẻ "Bài tiếp theo" giữa tablist và panel), khung 404 dưới practice/complete giữ sidebar + topbar và ẩn tabbar (CSS `:has(.app > .ex)`), gợi ý player chỉ với bài mcq/listening, unit test menu ⋮ bản web, 3 nút công cụ Tra từ cùng hàng, hàng kết quả đầu theo mẫu (chữ Hán + badge pill theo cấp), mục "Nội dung bài học" dùng h2 `.w-h2` thay card lồng card, icon khoá/đã xong đúng cỡ + nhãn "Đã học xong" bản web, nền kem cho Tra từ/Chi tiết từ, ô tìm kiếm web đặt `maxLength = SEARCH_QUERY_MAX_LENGTH`. Test F11 mới trong `page.spec.tsx` (28 passed): xoá `.lrow__state` thì FAIL đúng 1 test, khôi phục khớp sha256; gate frontend 7/7 EXIT 0, 998 unit test, 81 file. K3: 18 cặp ảnh 0 pixel khác so `7b5ca39`. K4: 454 passed, 6 skipped, 0 failed. F2: chưa tái hiện sau 146 lượt (10+10 lượt `--repeat-each` cho test content columns ở 1440/1024 và 126 lượt cả `learner-web.spec.ts`), backend 0 ERROR, PostgreSQL 0 ERROR; không lấy được mã `Pxxxx` của lỗi gốc vì `GlobalExceptionFilter` chỉ log tên lỗi + requestId. Backlog: (a) pill cấp độ thiếu `nowrap`; (b) rule lặp `.dict-item--top .dict-item__hz`; (c) backend: `GlobalExceptionFilter` log thêm mã Prisma (chỉ `code`). M2.10c 🟡 đang làm. Đếm lại: GĐ5 37/47, tổng 95/160. |
| 14/10/2026 | GĐ5: M2.10c ✅ đã đóng (`734dc77` + `dd7adb2`, PR #6 run `38600729243`). CI `734dc77` (run 38597703618) đỏ do unit test đọc docs/ui_reference (gitignored); sửa ở `dd7adb2`. Nội dung: 10 trang công khai `.w-public` (landing + pháp lý, xác thực + khôi phục, onboarding) theo Q81/Q84; khung `.w-public` `display:contents` dưới 1024px nên mobile không đổi. Q86 (thẻ "HSK 7–9" navy-900), Q87 (câu dưới nút Tiếp tục) chép vào `docs/product/learner-ui-decisions.md`; TL-5: ô "Sắp có" 2 cột ở 1024–1279. Vòng review 2 (V1–V6 + R1): bỏ `order` trên tiêu đề/radio/nút (dùng `grid-row` cho `.obw-tip`), khoảng trắng thật thay `::before` (innerText không thấy nội dung CSS sinh ra), mũi tên trong nút "Tiếp tục", nền khung một màu như mẫu, 5 symbol sprite bổ sung, ẩn "Quay lại đăng nhập" ở `/verify-email`, bỏ bóng đổ desktop của `.app`. Đo: K3a 20 cặp 390/768 + K3b 6 cặp 1024/1440 = 0 pixel (base `ab7adab`), K4 522 passed / 6 skipped / 0 failed, gate frontend 0 failed. Mô hình team: Lead giữ khung chung (`.w-public`, `LearnerBrand`, sprite) + điều phối, 3 agent L/A/O song song theo 3 nhóm trang, Pha C (gộp, gate, K3, K4, ảnh, D1) Lead tự chạy. Đếm lại theo quy tắc 0.6: GĐ5 38/47, tổng 96/160. |
| 15/10/2026 | GĐ4: M1.8 🟡 đang làm (Dockerfile backend/frontend multi-stage non-root + digest, ADR-008 §11). GĐ5: M2.10 ✅ đóng theo M2.10a–d; bài khoá chưa có mẫu web (TL-1). Backlog: (e) scanner secret dùng `git cat-file --batch` (gate docs từng đỏ khi máy tải cao, chạy lại PASS). Đếm lại theo quy tắc 0.6: GĐ4 10/17, GĐ5 39/47, tổng 97/160. |
| 15/10/2026 | GĐ4: M1.8 ✅ đã đóng (`29e23ac`, run `38684167028`): Dockerfile backend/frontend multi-stage non-root (ADR-008 §11), base `node:24-bookworm-slim` pin digest `sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5` dùng chung hai service, `npm ci --ignore-scripts`, `.dockerignore` chặn `.env*`; backend 1 image chạy 3 lệnh (API `node dist/src/main.js` là CMD mặc định, worker `node dist/src/worker.js`, migrate `node dist/scripts/operations/bounded-prisma-migrate-deploy.js`), migrate không tự chạy khi start; frontend Next `output: 'standalone'` chạy `node server.js` với `.next/static` + `public`. Job CI `images` (linux/amd64, `id -u` = 1000 cả hai, image ID vào summary + log, không push registry): image ID amd64 backend `03ac99c86809`, frontend `6f4aec84fa3d`. Kiểm local bằng VM Lima `hsk-docker` arm64 (Docker CE 29.9.1): migrate 23/23, smoke full-stack Postgres→migrate→API 200→frontend 200→đăng ký qua BFF 201; e2e frontend trên DB disposable mới 522 passed / 6 skipped / 0 failed; gate all 0 failed. Backlog: (f) build frontend tải Google Fonts lúc build, Turbopack đôi khi fail `next/font/google queries have exactly one entry`; cân nhắc next/font/local. (g) `GET /api/v1/health` trả `env` và `port` ra public. Đếm lại theo quy tắc 0.6: GĐ4 11/17, GĐ5 39/47, tổng 98/160. |
| 15/10/2026 | GĐ8: mở M5.0 🟡 đang làm — khung admin "Hán Lộ Admin" tiếng Việt theo mẫu `admin/` 06 (Q4, Q88): sidebar/thanh trên/drawer, dịch Bài tập, Media, đăng nhập. Q88–Q92 chép vào `docs/product/learner-ui-decisions.md`. M5.1a theo sau M5.0 (Q89–Q91). Đếm lại theo quy tắc 0.6: GĐ8 5/15, tổng 98/161. |
| 16/10/2026 | GĐ8: M5.0 ✅ đã đóng (`59a7570`, run `38834186034`) — khung admin "Hán Lộ Admin" tiếng Việt theo mẫu `admin/` 06 (Q4, Q88–Q94; TL-6..TL-10): sidebar 232px navy-850, mục chưa có trang KHÔNG chip, chữ `#8a9bbd` 5,60:1 trên navy-850, "Sắp có" trong tên đọc và `title`, mọi nhãn 1 dòng (e2e đo scrollWidth ≤ clientWidth, mục cao ≤ 44px); thanh trên 60px trắng không ô tìm kiếm/chuông/badge (test (e) chạy cả 4 viewport); drawer ≤900px (test (d) chạy 390 + 768); mục đang chọn và nút chính jade-800 (Q92); ngày giờ admin một hàm `dd/mm/yyyy hh:mm` UTC (TL-10); placeholder ô ID nêu tên trường; `styles.css` bỏ 103 selector admin cũ (1550 → 259 dòng); learner 20 cặp ảnh 390/1440 so base `e07c804` = 0 pixel khác (không chạy lại ở vòng này vì diff chỉ trong file admin); gate frontend 0 failed (91 file / 1084 test); e2e admin-console 4 viewport 62 passed / 10 skipped; phá thử thêm lại chip "Sắp có" → test (b) FAIL (`toHaveCount(0)` nhận 9) rồi khôi phục khớp sha256; Q93, Q94 chép nguyên vào `docs/product/learner-ui-decisions.md`. Đếm lại theo quy tắc 0.6: GĐ8 6/15, tổng 99/161. Backlog (h): `src/app/not-found.tsx` và `src/app/global-error.tsx` cấp root còn tiếng Anh — người học gặp khi vào URL lạ. |
| 16/10/2026 | GĐ8: mở M5.1a 🟡 đang làm — CMS mutation UI lesson/topic: tạo, sửa, duyệt, xuất bản, lưu trữ (Q89–Q91, Q95). Q95 chép nguyên vào `docs/product/learner-ui-decisions.md` (diff bảng Q rỗng, 92/92). Quyết định Tech Lead: TL-11 trang Nội dung chỉ liệt kê Bài học (không tab loại, không checkbox/bulk, không menu ⋮, không bộ lọc nâng cao, không chọn cỡ trang; cột Tiêu đề+slug/Cấp độ/Thứ tự/Trạng thái/Trạng thái duyệt/Cập nhật gần nhất/Thao tác; lọc cấp độ, trạng thái, tìm kiếm tiêu đề/slug ≤ 200 ký tự; phân trang như trang Bài tập; "Trạng thái duyệt" lấy từ bản sửa mới nhất). TL-12 cấp độ từ `GET /api/v1/levels` (chỉ published), nhãn "HSK 1"…"HSK 7–9" theo luật `levelLabel` (hàm nhãn đặt trong `admin-labels.ts`, không import chéo learner-home kéo Zod vào client); cấp độ chỉ chọn lúc tạo, trang sửa chỉ đọc. TL-13 người viết/duyệt hiện "Bạn" khi trùng id phiên admin, khác thì "Quản trị viên #<id>"; không thêm email/tên vào API. TL-14 409 có mã máy + câu tiếng Việt trong `admin-labels.ts`, message tiếng Anh của backend giữ nguyên từng chữ. TL-15 sửa = tạo bản sửa mới (POST revisions), form điền sẵn từ snapshot bản sửa mới nhất (chưa có thì từ bản live); không tự lưu, không nhân bản, không xoá (Q91); lưu trữ xác nhận ngay trong trang, không modal. Đếm lại theo quy tắc 0.6: GĐ8 6/15, tổng 99/161 (không đổi vì chỉ ⬜→🟡). |
| 19/10/2026 | GĐ8: M5.1a ✅ đã đóng (`cadce315e33396f704c1b9a1002be2bd0d16313d`, run `39221424166`) — CMS lesson/topic: trang Nội dung (danh sách bài học, lọc cấp độ/trạng thái/tìm kiếm + phân trang, bảng ↔ thẻ ≤900px), soạn bài học/chủ đề theo bản sửa (Q91, TL-15; prefill từ snapshot bản sửa mới nhất), ô JSON chủ đề kiểm ở server ≤100KB báo dòng/cột (Q90), duyệt có cảnh báo tự duyệt (Q89), 4 bước quy trình + thẻ "Trạng thái hiện tại" (TL-16; bước 4 khi publishedAt ≥ bản sửa HOẶC nội dung live trùng snapshot), khu duyệt không chọn sẵn quyết định + lỗi cạnh nhóm radio (TL-17), giờ Việt Nam (Q95), lưu trữ inline; backend lessons/:id trả topics + latestRevision tóm tắt, 409 có mã máy (B1–B3); TL-11..TL-15 giữ nguyên. Gate backend 14/14 EXIT 0 (91 suite / 1181 unit, 32 suite / 383 e2e), gate frontend 7/7 EXIT 0 (101 file / 1173 unit); e2e admin 4 viewport 88 passed / 20 skipped / 0 failed; learner-listening 12 passed trên `playwright.config.ts` gốc; CI 4 job (backend, backend-e2e, images, frontend) success. Phá thử: xoá `timeZone` của formatter Q95 → test S3 FAIL rồi khôi phục khớp sha256; P4 prefill từ bản live → e2e R1 FAIL; P5 chọn sẵn quyết định → test TL-17 FAIL. Bảng Q không đổi (92/92). Đếm lại theo quy tắc 0.6: GĐ8 7/15, tổng 100/161. Backlog: (i) error.tsx admin (content, exercises, media) nút "Thử lại" chỉ `reset()`, không tải lại dữ liệu → dùng retry của Next 16; (ii) `CONTENT_CONSTRAINT_CONFLICT`/`CONTENT_CONCURRENT_UPDATE` mới có unit, chưa e2e; (iii) B1 tải mọi bản sửa rồi lọc trong JS (shortcut, chuyển `DISTINCT ON` qua `$queryRaw` + `Prisma.sql` khi lịch sử lớn); (iv) đồng hồ audio Chromium trên máy dev có lúc kẹt khi chạy Playwright — vòng này K3 pass 12/12 với config gốc, nếu tái diễn chạy repro tối thiểu trước khi kết luận. |
| 19/10/2026 | GĐ8: tách M5.1b (backend + 4 form + trang nhập quá lớn cho một vòng review) thành M5.1b1 🟡 đang làm (soạn, duyệt, xuất bản bài tập bằng form từng loại, Q89/Q91/Q95/Q96) và M5.1b2 ⬜ (API nguồn dữ liệu + trang nhập bài tập JSON + sidebar "Nhập dữ liệu", Q97–Q99, 06/04). Q96–Q99 chép nguyên vào `docs/product/learner-ui-decisions.md` (diff bảng Q rỗng, 96/96). Quyết định Tech Lead: TL-18 trang `/admin/exercises/new` và `/admin/exercises/[id]` (sửa + quy trình + lịch sử, thay trang chi tiết chỉ đọc; giữ khối Nguồn gốc/Media chỉ đọc; bài học/chủ đề chọn lúc tạo, chỉ đọc khi sửa; `?lessonId=` từ link "Thêm bài tập" ở trang bài học, không có thì ô chọn từ `GET lessons` limit 100 theo cấp độ/thứ tự kèm comment `shortcut: 100 bài đầu, khi > 100 bài thì chuyển sang ô tìm kiếm`; chủ đề: chủ đề chưa lưu trữ của bài + "Không gắn chủ đề"). TL-19 form theo Q96, chung: Loại *, Đề bài * (≤ 4096), Giải thích (≤ 4096), Thứ tự * (1..1 000 000); đổi loại → xoá phần riêng loại cũ, câu báo dưới ô Loại; trắc nghiệm/nghe chọn 2–100 lựa chọn + radio "Đáp án đúng" (bắt buộc 1), id ổn định `opt-<n>`; nghe chọn thêm "Audio *" từ `GET media type=audio&processingStatus=ready&lifecycle=active` limit 100 (hiện filename); điền từ 1–100 đáp án chấp nhận + "Phân biệt chữ hoa/thường", content `{}`; sắp xếp câu 2–100 mảnh, thứ tự nhập = thứ tự đúng ("Lên"/"Xuống" có aria-label), `answer.tokenIds` theo thứ tự, id `tok-<n>`; luyện nói "Câu mẫu" tuỳ chọn + "Loại này chưa xuất bản được." dưới ô Loại; kiểm client số lượng/rỗng (chữ Việt cạnh ô, aria-describedby, focus ô lỗi đầu tiên), server vẫn là nguồn đúng. TL-20 lỗi 422 hiện ở đúng ô qua `error.details.path` (vd `content.options[1].text`), không khớp ô → vùng lỗi chung; nhãn tiếng Việt cho mọi mã validator (grep `code:` trong `lesson-exercise-authoring.validator.ts` và `exercise-publish-readiness.ts`), mã lạ → câu chung. TL-21 quy trình/lịch sử/cảnh báo tự duyệt/4 bước dùng lại content-workflow + revision-history M5.1a, bước 4 so snapshot bài tập (type, prompt, content, answer, explanation, mediaId, orderIndex), luyện nói "Xuất bản" tắt. TL-22 seed admin-console contentHash dùng canonical JSON như backend, bài điền từ nháp đúng shape (`content {}`, `answer.acceptedTexts`). SKILL §6a (mỗi lúc một job nặng; agent song song chung checkout, tối đa 2; phá thử ưu tiên unit; load1 ≥ 8 đợi tối đa 5 phút; caffeinate) áp cho M5.1b1. Đếm lại theo quy tắc 0.6: GĐ8 7/16, tổng 100/162. |
| 19/10/2026 | Kiểm độ phủ thiết kế: bộ HTML mẫu `docs/ui_reference/` (40 mobile, 20 web, 10 admin, đã đưa lên Figma) đối chiếu với mọi task chức năng; danh sách màn còn thiếu ghi ở [product/design-coverage.md](./product/design-coverage.md). Thêm M2.UXa (mobile), M2.UXb (web), M2.UXc (admin), M2.UXd (trạng thái chung) vào GĐ5. GĐ5 16/42; tổng 74/177. |
| 19/10/2026 | Quyết định phạm vi web cho nhận dạng: phát âm (M7.2) làm cả web và app, dùng chung dịch vụ chấm qua backend, web ghi âm bằng micro trình duyệt; viết tay (M7.5a) và OCR (M7.5b) chỉ chạy trên app, web hiện trạng thái "Dùng trên app" kèm mã QR. Thêm WB-17, WB-18 vào M2.UXb ([product/design-coverage.md](./product/design-coverage.md) §3). Không đổi số task. |
| 19/10/2026 | Gộp nhánh `claude/relaxed-hamilton-f07sck` (lộ trình đồ án GĐ9–GĐ12, M2.9a, mục khảo sát đối thủ, M2.UXa–M2.UXd, quyết định phát âm/viết tay/OCR trên web) vào `macdev`: giữ mọi trạng thái và task của `macdev`, thêm M2.5e, M2.9a vào GĐ5. Đếm lại theo quy tắc 0.6: GĐ4 11/17, GĐ5 39/53, GĐ6 0/12, GĐ8 7/16, GĐ9 0/16, GĐ10 0/6, GĐ11 0/9, GĐ12 0/3. Tổng 100/190. |
| 20/10/2026 | GĐ8: M5.1b1 ✅ đã đóng (`c8f2131`, run `39408418130`) — soạn/sửa/duyệt/xuất bản bài tập bằng form từng loại (Q89, Q91, Q95, Q96; TL-18–TL-22, TL-24): 2 trang `/admin/exercises/new` + `/admin/exercises/[exerciseId]`, 5 form theo loại (trắc nghiệm/nghe chọn/điền từ/sắp xếp câu/luyện nói) dùng chung state + payload canonical, kiểm client theo loại (chữ Việt cạnh ô, `aria-describedby`, focus ô lỗi đầu), 422 map `error.details.path` về đúng ô, quy trình 4 bước + lịch sử bản sửa + cảnh báo tự duyệt Q89, luyện nói tắt Xuất bản kèm lý do, lưu trữ inline, ô chọn bài học bỏ bài lưu trữ và `?lessonId=` bài lưu trữ báo không thêm được. TL-24: `answer.tokenIds` giữ thứ tự soạn (thứ tự đúng) còn `content.tokens` là thứ tự hiển thị khác thứ tự đáp án, so theo chữ đã trim (nếu mọi mảnh cùng một chữ thì so id), xáo bằng `crypto.getRandomValues`; sửa chỉ đề giữ thứ tự hiển thị cũ, mảnh mới nối cuối, mảnh xoá bỏ khỏi cả hai; lưu thành công nhớ thứ tự vừa gửi cho lần lưu sau. Gate `all` 0 failed; e2e admin-exercise 4 viewport 94 passed/22 skipped/0 failed, ma trận admin-exercise + admin-console × 4 project chạy 2 lần cùng DB: 94 passed/22 skipped/0 failed mỗi lần, audio fixture còn đúng 1 bản ghi. Đếm lại theo quy tắc 0.6: GĐ8 8/16, tổng 101/190 (không đổi vì chỉ ⬜→🟡). |
| 20/10/2026 | GĐ8: mở M5.1b2 🟡 đang làm — API nguồn dữ liệu (`GET /admin/cms/data-sources`) + trang nhập bài tập JSON `/admin/import` + sidebar "Nhập dữ liệu" (Q97–Q100, 06/04). Q100 chép nguyên vào `docs/product/learner-ui-decisions.md` (thêm dòng sau Q99; bảng Q trong repo 97 dòng; `docs/ui_reference/README.md` là bản local đang được session M2.UX dùng nên không sửa). Quyết định Tech Lead: TL-25 Kiểm tra dữ liệu do backend preview làm. Client chỉ kiểm cấu trúc tệp: đuôi .json, ≤ 90 000 byte, JSON.parse được, là mảng, 1–100 phần tử, mỗi phần tử là object (không mảng/null). Không viết lại validator bài tập ở client. TL-26 GET /api/v1/admin/cms/data-sources trong CmsController (admin-only như controller). Query dùng PaginationQueryDto (page, limit 1..100). Response theo envelope phân trang của list admin có sẵn (đọc một list admin đang có, vd danh sách bài tập admin, làm giống hệt), mỗi item đúng 4 field {id, code, name, version} (Prisma select đúng 4 field, dùng lại AdminDataSourceDto). Thứ tự: name asc, version desc, id asc. Không migration, không đổi schema. Response DTO đầy đủ để openapi có schema. TL-27 Idempotency-Key do trình duyệt tạo bằng crypto.randomUUID() mỗi khi preview thành công; thử lại commit (mạng lỗi/503) dùng lại đúng key đó. BFF bắt buộc header idempotency-key, kiểm bằng IDEMPOTENCY_KEY_PATTERN (`frontend/src/features/learner-lesson/lesson-player-model.ts:35`), sai/thiếu → 400; chuyển tiếp qua RequestOptions.idempotencyKey. TL-28 Đổi tệp hoặc đổi nguồn sau khi preview → xoá kết quả preview và key, phải preview lại; nút "Nhập dữ liệu" chỉ bật khi có preview hiện hành với invalidRows = 0. TL-29 Route /admin/import. Bố cục theo 06/04 sau khi bỏ theo Q98: stepper 3 bước (Tải dữ liệu → Xem trước & kiểm tra → Nhập dữ liệu; ol, aria-current="step"); panel tải tệp gồm select "Nguồn dữ liệu *" (hiện "Tên · mã · phiên bản") + vùng thả tệp (label bọc input file sr-only, nút "Chọn tệp", kéo-thả có lớp is-over, sau khi chọn hiện tên tệp, dung lượng, "N dòng", "Chọn tệp khác"); nút "Xem trước & kiểm tra"; thẻ "Kết quả kiểm tra" chỉ Tổng dòng / Hợp lệ / Lỗi; bảng lỗi cột Dòng \| Trường \| Lỗi (caption, th scope, bọc vùng cuộn tabindex=0 có nhãn); footer "Quay lại" + "Nhập dữ liệu". Không bảng xem trước 10 dòng (cột từ vựng không áp cho bài tập), không ghép cột, không cảnh báo, không tiến độ, không tải báo cáo lỗi. Thành công: khối role="status" "Đã nhập N bài tập ở trạng thái Bản nháp." + danh sách link /admin/exercises/{id} (lấy từ data.exercises, kiểm shape thật), focus vào heading kết quả. TL-30 Kích thước: giữ nguyên giới hạn JSON mặc định 100 KB của backend (không sửa main.ts). Client chặn tệp > 90 000 byte ("Tệp tối đa 90 KB."); BFF route nhập chặn body > 102 400 byte → 413. Backend e2e chứng minh body ~110 KB tới preview → 413 và BFF chuyển 413 thành lỗi có câu tiếng Việt (không lộ thông báo thô). TL-31 Nhãn lỗi: chuẩn hoá code về chữ thường rồi tra EXERCISE_VALIDATION_MESSAGE có sẵn; thêm nhãn trong `admin-labels.ts` cho source_key_already_exists, duplicate_source_key_in_batch, unexpected_field, option_id_not_found, parent_lesson_not_found, topic_lesson_mismatch, media_not_found (kiểm mã thật trong `exercise-import.service.ts` và `lesson-exercise-import.ts`); mã lạ → câu chung kèm mã gốc trong `<code>`. 422 IMPORT_VALIDATION_FAILED khi commit → hiện details.errors trong cùng bảng lỗi + câu "Dữ liệu đã thay đổi, hãy xem trước lại.", quay về bước 2. 409 (không có mã) → cùng câu đó, quay về bước 2. 403/401 như trang admin khác. TL-32 Ngay dưới vùng thả tệp có một dòng hướng dẫn: "Tệp .json là một mảng bài tập theo định dạng nhập v1 (tối đa 100 dòng, 90 KB). Bài nhập vào ở trạng thái Bản nháp." Không có nút tải tệp mẫu. TL-33 Q100: danh sách nguồn rỗng → câu báo Q100, select và vùng tải tệp bị khoá (disabled, có lý do hiển thị). Sidebar "Nhập dữ liệu" thành link /admin/import (`admin-navigation.tsx:43` thêm href); sửa `admin-shell.spec` theo (bỏ "(Sắp có)", số mục sắp có 8 → 7). SKILL §6a áp cho M5.1b2. Đếm lại theo quy tắc 0.6: GĐ8 8/16, tổng 101/190 (không đổi vì chỉ ⬜→🟡). |
| 21/10/2026 | GĐ8: M5.1b2 vòng sửa 1 — Q101: ô "Nguồn dữ liệu" hiện mọi nguồn, **đính chính production có 8 nguồn từ điển từ migration `20260810092000_p0_cms_provenance_import_audit`** (CC-CEDICT + HSK word list HSK1–HSK7_9); Q100 chỉ áp khi danh sách rỗng; không lọc, không đổi schema, phân loại nguồn (kind) để task sau. Q101 chép nguyên vào `docs/product/learner-ui-decisions.md` (sau Q100; bảng Q repo 98 dòng; `docs/ui_reference/README.md` local không sửa). Vòng sửa theo review M5.1b2: Z1 cắt 100 lỗi preview ở BFF + errorsTotal; Z2 khoá UI khi pending + chốt requestId; Z3 kiểm 90 KB trước khi đọc + chốt thứ tự đọc; Z4 "Nhập tệp khác" sau thành công; Z5 aria-live chỉ vùng thông báo; Z6 input file tabIndex=-1 + focus-within; Z7 một câu lý do mỗi nút tắt + aria-describedby; Z8 vùng bấm link ≥ 44px ≤900px; Z9 e2e lấy id từ phản hồi commit + kiểm archive; Z10 e2e thiếu key đúng shape + mã lỗi; Z11 test 413/kéo-thả; Z12 Content-Length > 102 400 → 413 trước khi đọc body; Z13 ô nguồn rộng, caption sr-only, dòng nhắc Q101. Không đổi số đếm. Đếm lại theo quy tắc 0.6: GĐ8 8/16, tổng 101/190 (không đổi vì chỉ ⬜→🟡). |
| 21/10/2026 | GĐ8: M5.1b2 ✅ đã đóng (`d468a48`, run `39540541415`) — API nguồn dữ liệu `GET /admin/cms/data-sources` (4 field, envelope phân trang, sort name/version/id), trang `/admin/import` (stepper 3 bước, dropzone, preview/errors/commit, Q100/Q101, a11y), BFF `exercise-imports/preview` + `exercise-imports` (Origin→cookie→413→JSON→key, cắt 100 lỗi + errorsTotal, Content-Length chặn trước khi đọc), sidebar "Nhập dữ liệu" thành link; TL-25…TL-33; Q100 (chưa nguồn → câu báo + khoá tải tệp), Q101 (hiện mọi nguồn + dòng nhắc; đính chính production có 8 nguồn từ điển từ migration `20260810092000_p0_cms_provenance_import_audit`); vòng sửa 2: W1–W6. Đếm lại theo quy tắc 0.6: GĐ8 9/16, tổng 102/190. |
| 21/10/2026 | GĐ8: tách M5.2 thành M5.2a 🟡 đang làm (tải media 1 tệp + lọc nguồn đủ giấy phép + cờ bật/tắt + nút "Tải lên", 06/05) và M5.2b ⬜ (danh sách ingestion cần xử lý + dọn dẹp + nghe/xem trước). Q102–Q105 chép vào `docs/product/learner-ui-decisions.md`. Quyết định Tech Lead: TL-34 một tệp, đồng bộ, hiện processingStatus của phản hồi 201; TL-35 `GET /admin/cms/data-sources?eligibleFor=media` dùng chung predicate finalize (một fragment `Prisma.sql`); TL-36 `GET /admin/cms/media` thêm `meta.ingestionEnabled`; TL-37 409 ingestion có mã máy; TL-38 Idempotency-Key theo tệp/nguồn, giữ khi thử lại lỗi tạm; TL-39 kiểm tên/đuôi/kích thước ở client + MIME chuẩn theo đuôi; TL-40 BFF `POST /api/admin/media/ingestions` (Origin→cookie→415→411/413→key→dataSourceId→413, timeout 125 s); TL-41 nhãn tiếng Việt cho mọi mã lỗi media; TL-42 trang `/admin/media/upload`; TL-43 link "Tải lên" ở `/admin/media` theo cờ; TL-44 nút footer M5.1b2 `adm-btn--outline`; TL-45 e2e `admin-media-upload.spec.ts` (upload thật chỉ desktop-1440, ≤ 3 lần/lượt vì rate limit 5/phút). Rủi ro phát hành: nginx ops chưa có `client_max_body_size`/`proxy_read_timeout` (mặc định 1 MB) → chặn ở M6.9. SKILL §6a áp cho M5.2a. Đếm lại theo quy tắc 0.6: GĐ8 9/17, tổng 102/191. |
| 21/10/2026 | GĐ8: M5.2a ✅ đã đóng (`ac3bf9e`, run `39547048119`) — tải media 1 tệp (Q102–Q105; TL-34…TL-45): `GET /admin/cms/data-sources?eligibleFor=media` dùng chung predicate finalize (fragment `MEDIA_ELIGIBLE_DATA_SOURCE_SQL`), `GET /admin/cms/media` thêm `meta.ingestionEnabled` qua `extraMeta` của envelope (chỉ giá trị scalar, chặn khoá base `requestId`/`timestamp`/`pagination`), 409 ingestion có mã máy (`IDEMPOTENCY_KEY_IN_USE`, `MEDIA_INGESTION_IN_PROGRESS`, `IDEMPOTENCY_KEY_RENEWAL_REQUIRED`, `MEDIA_STORAGE_PROVIDER_MISMATCH`); BFF `POST /api/admin/media/ingestions` (Origin→cookie→415→411/413→key→dataSourceId→413→độ dài khớp Content-Length, timeout 125 s), `experimental.proxyClientMaxBodySize` = 10 551 296 byte để proxy không cắt tệp 10 MiB; trang `/admin/media/upload` (Idempotency-Key theo tệp/nguồn, MIME chuẩn theo đuôi, nhãn Việt mọi mã lỗi, MB/KB), link "Tải lên" theo cờ, nút footer M5.1b2 `adm-btn--outline`; vòng sửa 1: V1–V4 + nit. E2e upload thật chỉ desktop-1440 (3 lần/lượt, gồm tệp 10 485 700 byte). Rủi ro phát hành: nginx ops chưa có `client_max_body_size`/`proxy_read_timeout` (mặc định 1 MB) → chặn ở M6.9. Đếm lại theo quy tắc 0.6: GĐ8 10/17, tổng 103/191. |
| 21/10/2026 | GĐ8: M5.2b 🟡 đang làm — danh sách tải lên cần xử lý + nút Dọn dẹp + nghe/xem trước media. Q106–Q107 chép vào `docs/product/learner-ui-decisions.md`. Quyết định Tech Lead: TL-46 tập "có vấn đề" = `cleanup_required` hoặc `processing` quá 15 phút (một hằng `Prisma.sql` dùng chung với metric `hsk_media_stuck_processing`); TL-47 `GET /admin/cms/media/ingestions` admin-only, phân trang, no-store, không gắn cờ ingestion, không trả cột nhạy cảm, `cleanupAvailable` so provider hiện tại; TL-48 seed bản ghi kẹt bằng `SET LOCAL TIME ZONE`; TL-49 allowlist backend-client; TL-50 BFF `POST /api/admin/media/ingestions/[id]/cleanup` (Origin→id→cookie→backend); TL-51 trang `/admin/media/ingestions` + link từ `/admin/media`; TL-52 nút Dọn dẹp không xác nhận, kết quả vào vùng live, làm mới danh sách; TL-53 không đếm ngược; TL-54 BFF admin access/content dùng lại handler learner; TL-55 xem trước ảnh/audio chỉ khi media sẵn sàng, không tự phát; TL-56 log env Playwright; TL-57 admin phụ cho upload ảnh; TL-58 seed lượt tải bằng SQL trong spec; TL-59 không assert 0 console error ở chi tiết ảnh lượt khác; TL-60 docs api.md. SKILL §6a áp dụng cho M5.2b. Đếm lại theo quy tắc 0.6: GĐ8 10/17, tổng 103/191. |
| 21/10/2026 | GĐ8: M5.2b 🟡 chờ review — `GET /admin/cms/media/ingestions` (hằng `MEDIA_INGESTION_STUCK_PROCESSING_SQL` dùng chung với metric `hsk_media_stuck_processing`, khai báo trước `media/:mediaId`, không gắn cờ ingestion); BFF `POST /api/admin/media/ingestions/[id]/cleanup` và `GET /api/admin/media/[id]/access|content` (dùng lại handler learner qua `sessionCookieName` + `contentRoutePrefix`); trang `/admin/media/ingestions` + link từ Thư viện media; thẻ "Xem trước" ở chi tiết media (ảnh JPG/PNG, audio MP3/WAV bấm "Nghe thử", hết hạn theo `expiresAt`); admin phụ `admin.media.frontend@example.test` trong seed Playwright. Seed bản ghi kẹt bằng `SET LOCAL TIME ZONE` chạy được trên DB disposable (e2e I8). Đếm lại theo quy tắc 0.6: GĐ8 10/17, tổng 103/191. |
| 21/10/2026 | GĐ8: M5.2b ✅ đã đóng (`92731cb`, run `39572342680`) — danh sách tải lên cần xử lý + Dọn dẹp + nghe/xem trước media (Q106, Q107; TL-46…TL-60): `GET /admin/cms/media/ingestions` (cleanup_required + processing kẹt >15 phút, hằng `MEDIA_INGESTION_STUCK_PROCESSING_SQL` dùng chung metric), BFF cleanup và admin access/content dùng lại handler learner, trang `/admin/media/ingestions`, thẻ Xem trước. Vòng sửa 1: V1 trang vượt không hiện phân trang, V2 focus chuyển sang `<audio>` có nhãn, V3 khung ảnh tối thiểu + chữ đang tải, N1 hết hạn không cướp focus, N2 test focus-return thật, N3 I6 chờ hydrate. Nợ test: I8/429 phụ thuộc DB sạch và khoảng cách >60 s giữa các lượt chạy; fileSize chi tiết "1.6 KB" lệch `formatMediaBytes`. Rủi ro phát hành: nginx ops chưa có `client_max_body_size`/`proxy_read_timeout` (mặc định 1 MB) → chặn ở M6.9. Đếm lại theo quy tắc 0.6: GĐ8 11/17, tổng 104/191. |
| 23/10/2026 | Khảo sát đối thủ: thêm mục 5.1 (24 acceptance R1–R24 gắn task đã có, đánh dấu "cải tiến Rn" ở ghi chú task), 5.2 backlog nhỏ, 5.3 invariant cắt ngang; quyết định mở #13–#16; mục 7 thêm việc thu hồi phiên capture. Không thêm task, tổng giữ 104 / 191. Nguồn: báo cáo local `reverse/_report-cai-tien-tong-hop.md`. |
