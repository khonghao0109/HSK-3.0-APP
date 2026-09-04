# PLAN — Tiến độ dự án HSK 3.0

> Cập nhật: 04/09/2026 · Baseline: branch `macdev`, HEAD `3211bf8` cộng worktree chưa commit
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
4. Thêm dòng vào mục 7 (nhật ký) khi đổi trạng thái milestone.

## 1. Tổng quan

| Milestone | Outcome | Trạng thái | Bước xong / tổng |
| --- | --- | --- | --- |
| M0 Media internal closeout | Media không còn P0/P1, gate tái lập trên Linux AMD64 | 🟡 | 2 / 5 (exit 0 / 4) |
| H Hardening & CI (chèn từ review 04/09) | CI xanh trên PR, e2e chạy một lệnh, P0/P1 review đóng | ⬜ | 0 / 14 |
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
| Worktree chưa commit | +8.744 dòng từ 22/08 (F-04) |

## 2. Đã hoàn thành theo slice

| # | Slice | Ngày | Commit | Bằng chứng |
| --- | --- | --- | --- | --- |
| 1 | Khởi tạo backend NestJS, auth module cơ bản | 05–07/05/2026 | `ad12828` … `2465fe8` | `backend/src/modules/auth` |
| 2 | Seed level, dictionary pipeline, migration đầu | 06/05 | `06f663e`, `cfdfc11` | `backend/scripts/dictionary`, `scripts/levels` |
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
| 16 | ADR-001 … ADR-008 | 10/08 – 04/09 | — | `docs/adr` (ADR-007, 008 chưa commit) |
| 17 | Review toàn dự án, chốt stack, tổ chức lại docs, PLAN.md | 04/09 | worktree | `docs/reviews`, ADR-008, `docs/README.md` |

## 3. Giai đoạn chi tiết

### M0 — Media internal closeout (NOW theo roadmap)

Outcome: Media không còn P0/P1 nội bộ và có bằng chứng tái lập trên nền tảng production.

| # | Bước | Trạng thái | Bằng chứng / còn thiếu |
| --- | --- | --- | --- |
| M0.1 | Absolute deadline/cancellation cho ClamAV và S3 body stream | ✅ | `s3-object-storage.adapter.ts` deadline 8 s, `clamav-media-malware-scanner.ts` 10 s. Còn D-04: interceptor upload không huỷ công việc phía sau |
| M0.2 | Cleanup recovery, secret scanner false-negative, availability SLI truthful | ✅ | `media-ingestion.cleanup-recovery.spec.ts`, `scripts/security/secret-scan.ts`, `ops/observability/media-alerts.yml` |
| M0.3 | Forward-only migration/preflight và bounded lock deployment | 🟡 | `scripts/operations/bounded-prisma-migrate-*.ts` có nhưng chưa commit; C-01 (BEGIN/COMMIT), C-02 (resolver dùng một lần) |
| M0.4 | Validate rendered Kubernetes artifact, OCI identity, Linux AMD64 | 🟡 | Harness có; gate không thể pass vì producer policy `HOST_ACCEPTANCE_REQUIRED` |
| M0.5 | Roadmap, owner, risk/decision register, release evidence contract | 🟡 | Roadmap 13/08 (chưa commit); owner chưa gán; evidence contract ADR-007 |

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
| H.1 | Tách worktree +8.744 dòng thành commit nhỏ; sửa typo `npm.cd` | ⬜ | F-04, E-04 |
| H.2 | `ci.yml` trên PR: backend prisma validate + lint + tsc + jest + e2e (Postgres service); frontend lint + typecheck + vitest; required checks | ⬜ | A-01 |
| H.3 | `docker-compose.test.yml` (Postgres 16, MinIO, ClamAV, Mailpit) + `pretest:e2e` tạo DB disposable và migrate | ⬜ | F-01, ADR-008 §11 |
| H.4 | `trust proxy`, nginx X-Forwarded-For, tracker theo `req.user.id ?? req.ip`, rate limit theo user bằng bảng Postgres | ⬜ | A-02, ADR-008 §2 |
| H.5 | Lockout tăng nguyên tử; login ~10 req/phút/IP + throttle theo email | ⬜ | B-01 |
| H.6 | Xoá nhánh so sánh password plaintext | ⬜ | B-02 |
| H.7 | Một 401 chung, verify giả với hash tĩnh; register trả 409 | ⬜ | B-06 |
| H.8 | `GET /users` phân trang + lọc soft-delete | ⬜ | B-05 |
| H.9 | `MEDIA_STORAGE_PROVIDER`/`MEDIA_SCANNER_PROVIDER` tường minh, assert lúc boot | ⬜ | B-04 |
| H.10 | Envelope toàn cục: APP_INTERCEPTOR + APP_FILTER, echo `x-request-id`; cập nhật api.md §1 | ⬜ | A-03 |
| H.11 | Migration: bỏ `BEGIN/COMMIT`, resolver tham số hoá, pin UTC, unique index goal/plan | ⬜ | C-01, C-02, C-05, C-04 |
| H.12 | Prisma `$disconnect`; `canonicalJson` maxDepth; idempotency TTL | ⬜ | D-06, D-01, D-02 |
| H.13 | `.nvmrc` Node 24, `.npmrc save-exact`, TypeScript 6 cả hai package, Renovate | ⬜ | ADR-008 §12 |
| H.14 | Frontend: xoá 5 route BFF không dùng hoặc redact; focus archive; logout kiểm `ok`; `/api/session/me` chỉ xoá cookie khi 401/403 | ⬜ | E-01, E-02 |

### M1 — Content/legal + Identity/Privacy foundation

Outcome: dữ liệu và tài khoản đủ an toàn để mở learner beta.

| # | Bước | Trạng thái | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| M1.1 | Xác minh license/provenance 7 HSK word list; attribution CC-CEDICT (CC BY-SA 4.0) | ⬜ | Roadmap R1; `DataSource` đã có bảng và provenance snapshot |
| M1.2 | Workflow nghĩa tiếng Việt có reviewer và rollback | ⬜ | Rubric chất lượng: archive master plan §13.4 |
| M1.3 | Loại content Temporary/fixture khỏi release candidate | ⬜ | |
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
| M3.4 | Dictionary detail, ví dụ/audio, saved-word lifecycle | ⬜ | `WordSense/WordExample` chưa có schema (mục 4) |
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
| M5.B4 | Backend CMS lesson/topic/exercise/import + media ingestion API | ✅ | mục 2 dòng 7, 9, 12 |
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
| M6.3 | Terraform AWS ap-southeast-1: ECS Fargate, RDS 16 PITR, S3, CloudFront + WAF, Secrets Manager, SES | ⬜ | ADR-008 §8; ⛔ chờ kết luận pháp lý mục 5 #8 |
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
| M7.7 | Mobile React Native + Expo; npm workspaces + `packages/contracts` | ⬜ | ADR-008 §1; Web MVP outcome |
| M7.8 | Community | ⬜ | Moderation |

## 4. Schema backlog

Model chưa build dù đã có thiết kế (archive `DATABASE_SCHEMA_COMPLETION_PLAN.md`):
`AuthIdentity` (OAuth), `Material`/`MaterialItem`, `ContentAccess`/`Entitlement`,
`WordSense`/`WordExample`/`WordRelation` + `pg_trgm`, `QuestionRevision`/`TestRevision`;
nhóm P1/P2: reader/pronunciation/Hanzi (GĐ5), engagement/notification/support (GĐ7),
payment (GĐ8), AI DB tách riêng (GĐ9).

Hardening dữ liệu: inventory SQL-only object + drift guard (C-07), dọn index (C-08),
timestamptz (C-05), partition/retention cho bảng event, cập nhật data dictionary và ERD
cho migration 16–19, đóng băng schema domain chưa có runtime (Exam, SRS, privacy) tới
khi vertical slice bắt đầu.

## 5. Quyết định mở

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

## 6. Việc cần làm ngay (2 tuần tới)

1. H.1 dọn worktree và commit theo chủ đề.
2. H.2 + H.3: CI trên PR và compose test; đây là lưới an toàn cho mọi bước sau.
3. H.4 → H.9: đóng P0/P1 bảo mật (mỗi mục là một PR nhỏ).
4. H.10: chốt envelope, sau đó bật OpenAPI (ADR-008 §5).
5. Duyệt ADR-008 và quyết định #11 để biết M0.4 đi đâu.
6. Bắt đầu M2.1 + M2.2 như vertical slice đầu tiên cho người học.

## 7. Nhật ký cập nhật

| Ngày | Thay đổi |
| --- | --- |
| 04/09/2026 | Tạo PLAN.md. Tổ chức lại docs (xoá placeholder/duplicate, archive master plan). Review toàn dự án (57 finding). ADR-008 chốt stack còn lại (Proposed). Mobile chốt React Native + Expo. |
