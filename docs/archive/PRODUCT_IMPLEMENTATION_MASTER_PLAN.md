> **ARCHIVED 04/09/2026.** Tài liệu này đã bị thay thế và không phản ánh trạng thái hiện tại. Xem `docs/archive/README.md` và `docs/PLAN.md`. Liên kết tương đối bên trong có thể đã lỗi thời.

# Kế hoạch tổng thể triển khai HSK System từ số 0 đến Production

> Phiên bản tài liệu: 1.0
>
> Ngày xác minh hiện trạng: 08/08/2026
>
> Phạm vi: Product Strategy → UX/UI → Architecture → Data/Content → Backend → Web/Mobile → AI → Quality → DevOps → Production Operations
>
> Nguồn sự thật liên quan: [PROJECT_CONTEXT_FOR_AI.md](../architecture/overview.md), [FUNCTIONAL_HIERARCHY.md](../product/functional-hierarchy.md), [DATABASE_SCHEMA_COMPLETION_PLAN.md](./DATABASE_SCHEMA_COMPLETION_PLAN.md), [api.md](../api/api.md), [roadmap.md](../product/roadmap.md)

## 0. Mục đích và cách sử dụng tài liệu

Tài liệu này là playbook triển khai toàn bộ HSK System từ ý tưởng ban đầu đến một hệ thống production có thể phát hành, quan sát, vận hành, sao lưu và phục hồi. Đây không chỉ là danh sách tính năng; mỗi phase đều chỉ rõ:

- Mục tiêu và dependency.
- Quyết định cần chốt trước khi code.
- Công nghệ đang có, công nghệ mặc định đề xuất và công nghệ cần ADR.
- Trình tự công việc chi tiết.
- Dữ liệu, API, security, privacy và observability liên quan.
- Artifact bắt buộc.
- Chiến lược kiểm thử.
- Quality gate và Definition of Done.

### 0.1 Quy ước trạng thái công nghệ

| Trạng thái | Ý nghĩa |
|---|---|
| **Đang có** | Đã được xác minh trong source, manifest, migration hoặc runtime hiện tại |
| **Mặc định đề xuất** | Lựa chọn phù hợp với kiến trúc hiện tại; chỉ cài sau khi ADR/PR được duyệt |
| **Cần chốt** | Có nhiều lựa chọn hợp lệ; quyết định phụ thuộc đội ngũ, ngân sách, provider hoặc yêu cầu pháp lý |
| **Không dùng ở phase đầu** | Tránh tăng độ phức tạp trước khi có tải, dữ liệu hoặc nhu cầu chứng minh |

Không hiểu “mặc định đề xuất” là “phiên bản mới nhất”. Khi bắt đầu implementation phải kiểm tra compatibility/security, pin phiên bản bằng lockfile và ghi ADR nếu lựa chọn ảnh hưởng dài hạn.

### 0.2 Quy ước ưu tiên

- **P0:** bắt buộc để Web MVP có thể onboarding, học, ôn, thi và được admin vận hành an toàn.
- **P1:** nâng chất lượng học tập và vận hành sau khi core loop ổn định.
- **P2:** khác biệt hóa, monetization hoặc mở rộng như AI, mobile offline, handwriting và community.

### 0.3 Nguyên tắc phát hành

1. Phát hành theo vertical slice có giá trị, không hoàn thiện toàn bộ backend rồi mới làm UI.
2. Không đưa dữ liệu/content vào production nếu thiếu source, license, version, reviewer và rollback.
3. Không coi schema/API/UI mockup là chức năng hoàn chỉnh nếu chưa có runtime và test end-to-end.
4. Không triển khai migration lớn trong một lần; dùng expand → backfill → verify → contract.
5. Không thêm microservice nếu modular monolith vẫn đáp ứng ownership, scale và delivery.
6. Không dùng client-side flag thay authorization hoặc entitlement phía server.
7. Mọi production capability phải có telemetry, owner, runbook và rollback/disable path.

---

## 1. Baseline hiện tại của repository

### 1.1 Thành phần đã có

| Thành phần | Hiện trạng xác minh | Công nghệ |
|---|---|---|
| Backend core | Có runtime và một số module hoạt động | NestJS `^11.0.1`, TypeScript `^5.7.3`, Node.js |
| Persistence | Có schema và 5 migration ban đầu | Prisma/Prisma Client `^5.22.0`, PostgreSQL |
| Authentication | Register/login/me, JWT guard, role guard, lockout cơ bản | `@nestjs/jwt`, Passport, `passport-jwt`, Argon2id |
| Validation/config | DTO validation và env validation | `class-validator`, `class-transformer`, Joi |
| API protection | Throttling và RBAC user/admin ở mức cơ bản | `@nestjs/throttler`, Nest guards/decorators |
| Backend test | Unit scaffold và e2e | Jest 30, Supertest 7, ts-jest |
| Code quality | Có ESLint và Prettier | ESLint 9, Prettier 3 |
| Dữ liệu học | Raw/parsed HSK và CEDICT, seed scripts | TypeScript scripts, JSON/TXT, Prisma |
| Frontend | File/folder scaffold nhưng package và source runtime đang rỗng | Chưa chốt runtime thực tế |
| AI service | Folder `rag-api` scaffold nhưng package và entry point đang rỗng | Chưa chốt runtime thực tế |
| Documentation | API, roadmap, context, functional hierarchy và schema plan | Markdown, ERD PNG |

### 1.2 Capability backend runtime đã xác minh

- `auth`: register, login, current user.
- `user`: current profile và admin user list.
- `health`: health endpoint cùng unit test.
- `dictionary`: search cơ bản.
- `learning`: đọc levels, lessons, topics và stories.

Các module exam, progress nâng cao, SRS, CMS, materials, analytics, notification, payment và AI gateway chưa được coi là hoàn thiện chỉ vì schema hoặc folder đã tồn tại.

### 1.3 Schema hiện có

Schema hiện có các nhóm model:

- Identity: `User`.
- Content/media: `Media`, `Level`, `Lesson`, `Topic`, `Story`.
- Dictionary: `Word`, `WordMeaning`, `WordLevel`, `LessonWord`, `Sentence` và mapping example.
- Learning: `LessonExercise`, `LessonExerciseAttempt`, `Progress`.
- Pronunciation: `PronunciationPractice`, `PronunciationAttempt`.
- Exam: `Question`, `Test`, `TestSection`, `QuestionGroup`, `TestQuestion`, `Result`, `ResultSkillScore`.
- User vocabulary: `UserWord`, `UserWordProgress`.

Khoảng trống quan trọng nằm trong [DATABASE_SCHEMA_COMPLETION_PLAN.md](./DATABASE_SCHEMA_COMPLETION_PLAN.md): onboarding/profile/privacy, content revision/import/audit, activity state, SRS history, exam attempt/snapshot/autosave, notification/support, subscription/entitlement, analytics events và database AI độc lập.

---

## 2. Định nghĩa sản phẩm hoàn thiện

### 2.1 P0 — Web MVP có thể phát hành

#### Người học

- Đăng ký, đăng nhập, đăng xuất, refresh/revoke session và quản lý hồ sơ.
- Onboarding mục tiêu, thời gian học và placement test tối thiểu.
- Chọn HSK 1–9, xem lộ trình, bài học, chủ đề và nội dung published.
- Làm lesson activity, nhận feedback và lưu tiến độ.
- Tra từ Hanzi/Pinyin/Việt/Anh, xem nghĩa/ví dụ/audio/level và lưu từ.
- Ôn flashcard bằng SRS, xem due queue và lịch sử review.
- Làm thi thử với timer, autosave, resume, review, submit và kết quả theo skill.
- Xem dashboard tiến độ và lịch sử cơ bản.

#### Admin

- Quản lý user, role, trạng thái account và audit action.
- CMS cho level, lesson, topic, story, word, sentence, media và activity.
- Import CSV/JSON có preview, validation, duplicate report và rollback.
- Workflow draft → review → published → archived cùng revision.
- Quản lý question bank, test/section/group, answer, explanation và publish.
- Xem báo cáo vận hành P0 và xử lý content report.

#### Nền tảng

- Auth/RBAC, validation, error contract, rate limit và audit.
- PostgreSQL migration/seed có thể tái tạo môi trường.
- CI/CD, staging, logging, metrics, alert, backup/restore và runbook.
- Privacy consent/export/delete, retention và provenance/license.

### 2.2 P1 — Trải nghiệm và vận hành nâng cao

- Interactive reader với tap-to-lookup, audio highlight và reading progress.
- Ghi âm/phát âm, feedback tone và shadowing.
- Daily goal, streak, XP, achievement và notification preference.
- Media library, transcript/subtitle và cloud storage.
- Admin analytics, content-quality dashboard và support console.
- Accessibility/i18n đầy đủ, performance hardening và experimentation có kiểm soát.

### 2.3 P2 — Khác biệt hóa và mở rộng

- AI tutor/RAG có citation, evaluation, feedback, cost/quota và safety.
- Hanzi stroke order, handwriting recognition và OCR.
- Subscription, entitlement, coupon/payment và revenue reporting.
- Native mobile/PWA offline sync.
- Community/tutor/social learning nếu discovery chứng minh giá trị.

---

## 3. Kiến trúc mục tiêu

```text
Web Browser / Mobile App
          |
          | HTTPS + REST/OpenAPI
          v
Frontend Web (Next.js/React/TypeScript)
          |
          v
Core API (NestJS modular monolith)
  |       |         |         |
  |       |         |         +--> Email / Push / Payment providers
  |       |         +------------> Redis cache + job queues
  |       +----------------------> S3-compatible object storage + CDN
  +------------------------------> Core PostgreSQL (Prisma)
          |
          | authenticated AI gateway contract
          v
AI/RAG Service (separate runtime and database)
  |       |         |
  |       |         +------------> LLM / embedding / speech providers
  |       +----------------------> Redis/worker queue (if required)
  +------------------------------> AI PostgreSQL + pgvector/vector store

Cross-cutting: OpenTelemetry, logs, metrics, traces, Sentry/error tracking,
CI/CD, secrets, backup, feature flags, audit and security controls.
```

### 3.1 Boundary bắt buộc

- Core backend sở hữu user, content, learning, exam, entitlement và business rules.
- AI service sở hữu document/chunk/embedding/RAG run/chat/evaluation.
- Frontend không truy cập database trực tiếp.
- AI không tạo foreign key sang core database; chỉ lưu external user/content ID và permission context cần thiết.
- Object storage chỉ lưu binary; metadata/lifecycle/owner nằm trong database core hoặc AI tương ứng.
- Analytics không được trở thành nguồn quyết định quyền hoặc kết quả thi.

---

## 4. Bảng công nghệ tổng thể

### 4.1 Backend và API

| Hạng mục | Công nghệ | Trạng thái/lý do |
|---|---|---|
| Runtime | Node.js LTS, TypeScript | Node version phải pin trong `.nvmrc`/toolchain; TypeScript đang có |
| Framework | NestJS 11 | Đang có; phù hợp modular monolith, DI, guards, modules |
| HTTP adapter | Express adapter hiện tại | Đang có qua `@nestjs/platform-express`; chỉ đổi Fastify sau benchmark/ADR |
| ORM | Prisma 5 hiện tại | Đang có; nâng version phải qua migration/client compatibility test |
| Database | PostgreSQL | Đang có; dùng managed PostgreSQL ở staging/production |
| API style | REST `/api/v1` + OpenAPI | Phù hợp contract hiện tại; sinh client/type sau khi spec ổn định |
| Validation | `class-validator`, `class-transformer`, Joi | Đang có; DTO và env fail-fast |
| Auth | Passport JWT, Argon2id, access/refresh session | Phần cơ bản đang có; cần session/revocation/rotation |
| Rate limit | `@nestjs/throttler`, Redis-backed khi scale | Memory chỉ phù hợp single instance/local |
| Cache/queue | Redis + BullMQ | Mặc định đề xuất cho cache, notification, import và background jobs |
| File storage | S3-compatible API; MinIO local | Mặc định đề xuất; provider cloud cần ADR |
| Email | Provider adapter qua interface | Cần chốt provider; dùng queue và idempotency |
| Push | FCM/APNs qua notification service | Chỉ triển khai khi có mobile/PWA token flow |

### 4.2 Frontend web

| Hạng mục | Công nghệ mặc định | Ghi chú |
|---|---|---|
| Framework | Next.js App Router + React + TypeScript | Phù hợp folder hiện tại và web user/admin |
| Package manager | pnpm workspace hoặc npm workspace | Cần ADR vì backend hiện có npm lock; chỉ dùng một chuẩn sau migration |
| Monorepo task runner | Turborepo | Chỉ thêm khi có nhiều package chạy thật và giúp cache/task graph |
| Styling | Tailwind CSS + CSS variables/design tokens | Chốt qua design-system ADR; không hard-code token trong component |
| Accessible primitives | Radix UI hoặc React Aria | Chọn một; bọc trong component library của dự án |
| Server state | TanStack Query khi client fetching cần thiết | Không duplicate Next.js server cache |
| Form | React Hook Form + Zod | Form state, validation phía client; backend vẫn là authority |
| Local/global state | React state; Zustand cho state chia sẻ tối thiểu | Không đưa server state vào global store |
| API client | OpenAPI-generated client hoặc typed fetch wrapper | Error/auth/retry/cancel thống nhất |
| Unit/component test | Vitest + React Testing Library | Mặc định đề xuất cho frontend mới |
| E2E | Playwright | Multi-browser, auth state, visual/smoke flow |
| Error tracking | Sentry hoặc OpenTelemetry-compatible service | Provider cần chốt; scrub PII |

### 4.3 Mobile/offline

| Hạng mục | Mặc định đề xuất | Điều kiện thay đổi |
|---|---|---|
| Mobile | React Native + Expo + TypeScript | Tận dụng TypeScript/contracts/design knowledge |
| Alternative | Flutter/Dart | Chọn nếu team Flutter mạnh hơn hoặc prototype chứng minh lợi ích |
| Local DB | Expo SQLite/SQLite abstraction | Có schema version và migration |
| Secure storage | Keychain/Keystore qua secure-storage adapter | Không lưu access secret trong plain storage |
| E2E | Maestro hoặc Detox | Chọn theo CI/device strategy |
| OTA update | Expo Updates nếu dùng Expo | Không OTA native breaking change; có rollout/rollback |

### 4.4 AI/RAG và speech

| Hạng mục | Mặc định đề xuất | Ghi chú |
|---|---|---|
| AI API runtime | Python + FastAPI + Pydantic | AI scaffold đang rỗng; cần ADR vì repo hiện có `package.json` rỗng |
| Alternative | TypeScript + Fastify/NestJS | Chọn nếu ưu tiên một ngôn ngữ hơn hệ sinh thái AI Python |
| AI database | PostgreSQL độc lập + pgvector | Dễ vận hành giai đoạn đầu; không dùng core DB |
| Migration | Alembic/SQLAlchemy nếu dùng Python | Version database AI độc lập |
| RAG orchestration | Code domain riêng; có thể dùng LlamaIndex/LangChain có giới hạn | Không để framework định nghĩa domain/contract |
| LLM/embedding | Provider adapter | OpenAI/Gemini/khác phải qua ADR, DPA, cost/eval |
| Evaluation | pytest + golden dataset + retrieval/answer metrics | Chạy offline và regression trong CI phù hợp |
| Worker | Celery/RQ/Dramatiq + Redis khi cần ingest nền | Chỉ chọn một sau spike tải/retry |
| Speech | Provider adapter cho STT/pronunciation | Cần consent, retention, cost và fallback |

### 4.5 Data, analytics và BI

| Hạng mục | Công nghệ | Ghi chú |
|---|---|---|
| Transaction data | PostgreSQL | Source of truth nghiệp vụ |
| Data pipeline ban đầu | TypeScript scripts + manifest/hash | Phù hợp pipeline hiện có; bắt buộc idempotent |
| Event collection | Backend/client event contract | Có schema/version/consent; provider analytics cần chốt |
| Product analytics | PostHog/self-hosted hoặc managed alternative | Cần ADR về privacy, region, cost |
| BI ban đầu | SQL views/materialized views + Metabase/Superset | Chỉ thêm warehouse khi volume/use case chứng minh |
| Data quality | Script validation + DB constraints + reconciliation | Great Expectations/dbt chỉ thêm khi pipeline phức tạp |

### 4.6 Infrastructure và operations

| Hạng mục | Công nghệ mặc định | Ghi chú |
|---|---|---|
| Container | Docker multi-stage, non-root | Build artifact duy nhất qua môi trường |
| Local orchestration | Docker Compose | PostgreSQL, Redis, MinIO, mail catcher |
| CI/CD | GitHub Actions | Repo GitHub hiện tại; dùng OIDC/short-lived credentials |
| IaC | Terraform/OpenTofu | Chọn một; remote state, review plan và drift detection |
| Ingress/proxy | Managed load balancer hoặc Nginx | Không cần tự quản Nginx nếu platform đã cung cấp |
| Telemetry | OpenTelemetry | Chuẩn chung cho logs/metrics/traces |
| Metrics | Prometheus-compatible + Grafana | Managed hoặc self-hosted theo năng lực vận hành |
| Logs | Structured JSON + Loki/managed logs | Có request ID, retention và PII redaction |
| Traces | Tempo/managed APM | Bắt buộc cho backend → AI/provider path quan trọng |
| Error tracking | Sentry/managed equivalent | Tách environment/release, scrub dữ liệu |
| Secrets | Cloud secret manager/Vault | Không dùng `.env` production làm cơ chế phân phối chính |
| CDN/WAF | Cloud CDN/WAF | Provider cần ADR; rate limit/bot protection cho public API |

---

## 5. Môi trường và chiến lược cấu hình

### 5.1 Môi trường tối thiểu

| Môi trường | Mục đích | Dữ liệu | Deploy |
|---|---|---|---|
| Local | Phát triển từng service | Seed giả/lô nhỏ, không PII | Docker Compose + dev process |
| Test/CI | Unit/integration/contract | Tạo mới mỗi run | Ephemeral database/container |
| Development shared | Tích hợp sớm | Synthetic | Auto deploy branch/trunk tùy workflow |
| Staging | Rehearsal gần production | Synthetic/anonymized representative | Promote cùng artifact production |
| Production | Người dùng thật | Dữ liệu thật | Approval, canary/phased và audited |

### 5.2 Biến môi trường bắt buộc

- Core: `NODE_ENV`, `PORT`, `DATABASE_URL`.
- JWT: `JWT_SECRETS`, `JWT_ACTIVE_KID`, `JWT_EXPIRES_IN`, `AUTH_PASSWORD_PEPPER`.
- Redis: URL, TLS, namespace và queue prefix.
- Storage: endpoint, region, bucket, access role/credential, CDN base URL.
- Observability: OTEL endpoint, service name/version/environment, sampling.
- Email/push/payment/AI: API endpoint, secret reference, webhook secret và timeout.

Mọi biến phải được validate khi startup. `.env.example` chỉ chứa tên và giá trị giả; production secret lấy từ secret manager. Rotation phải hỗ trợ nhiều key active/grace period khi cần.

---

## 6. Hệ thống quality gate xuyên suốt

| Gate | Khi nào | Điều kiện tối thiểu |
|---|---|---|
| G0 — Product | Trước design | Problem, persona, outcome, metric, priority và owner rõ |
| G1 — Design | Trước implementation | Luồng/state/responsive/accessibility và content được review |
| G2 — Architecture | Trước schema/API lớn | ADR, boundary, threat model, data owner và NFR rõ |
| G3 — Data | Trước migration/import | Schema/SQL/backfill/rollback/provenance/license được review |
| G4 — Code | Trước merge | Format/lint/type/build/test/security scan pass |
| G5 — Integration | Trước staging sign-off | Contract/e2e/migration/content reconciliation pass |
| G6 — Release | Trước production | Artifact, config, migration, observability, backup và rollback ready |
| G7 — Production | Sau deploy | Smoke, invariant, SLI, business metric và support channel ổn định |

---

## 7. Phase 0 — Khởi tạo chương trình và quyền quyết định

### 7.1 Mục tiêu

Thiết lập phạm vi, owner, cách ra quyết định, nguồn sự thật, công cụ làm việc và baseline trước khi cam kết roadmap.

### 7.2 Công nghệ/công cụ

- Git + GitHub repository, protected branch và pull request.
- Markdown trong `docs/` làm nguồn tài liệu versioned.
- Issue/project tracker: GitHub Projects, Linear, Jira hoặc tương đương; chọn một.
- Diagram: Mermaid/PlantUML cho diagram versioned; Figma cho design.
- CodeGraph/`rg`/compiler/test để khảo sát repo; không dựa vào folder name.

### 7.3 Các bước

1. Chỉ định product owner, tech lead, curriculum/content owner, security/privacy owner và release owner.
2. Lập RACI/DACI cho product scope, HSK curriculum, architecture, data license, pricing và go-live.
3. Xác minh worktree, branch, build, migration, test và môi trường local.
4. Phân loại từng tài liệu/code/schema/UI thành hiện trạng, mục tiêu hoặc giả định.
5. Lập decision log và risk register ban đầu.
6. Chốt naming, ID, timezone, locale, HSK version, supported platform và target market.
7. Chốt Definition of Ready/Done và nhịp review hàng tuần.
8. Tạo milestone/epic theo outcome; không tách roadmap chỉ theo team/layer.

### 7.4 Artifact

- Project charter, RACI/DACI, decision log và risk register.
- Baseline report, repository map và environment inventory.
- Documentation ownership/review schedule.
- Definition of Ready/Done và release authority.

### 7.5 Kiểm thử/kiểm tra

- Backend `npm ci`, Prisma generate/validate, build và unit/e2e baseline.
- Xác minh migration tạo được database rỗng.
- Xác minh frontend/AI là scaffold rỗng, không ghi “đã hoàn thành”.

### 7.6 Exit criteria

- Mọi quyết định critical có decider.
- Baseline có bằng chứng command/file.
- Không có phạm vi P0 chưa có owner.
- Risk/license/data blocker được ghi rõ trước Phase 1.

---

## 8. Phase 1 — Product Discovery, Strategy và Roadmap

### 8.1 Mục tiêu

Chứng minh vấn đề, persona, outcome, ưu tiên và mô hình nội dung/kinh doanh trước khi xây solution lớn.

### 8.2 Công nghệ/công cụ

- Interview/survey/prototype testing; lưu consent và evidence có kiểm soát.
- Product analytics hiện có nếu có; nếu chưa có dùng structured research repository.
- Spreadsheet/SQL cho sizing và competitor matrix.
- Figma cho concept test; Markdown cho PRD/decision.
- RICE/WSJF hoặc scoring framework thống nhất; không trộn framework tùy ý.

### 8.3 Các bước

1. Xác định persona: người mới, người ôn thi, người học dài hạn, content admin và operations admin.
2. Viết problem statement cho onboarding, học, ôn, thi, retention và content operations.
3. Phỏng vấn/quan sát người học; ghi sample, context, consent và limitation.
4. Benchmark app học tiếng Trung/HSK theo capability, chiều sâu, price, privacy và platform; dữ liệu biến động phải có nguồn/ngày.
5. Xây opportunity map và hypothesis về value/usability/feasibility/viability.
6. Chốt north-star metric và guardrail: activation, lesson completion, review adherence, exam completion, retention và content publishing SLA.
7. Viết PRD P0/P1/P2 với scope/out-of-scope, NFR, data, permission, analytics và rollout.
8. Tách story end-to-end và acceptance criteria Given/When/Then.
9. Chấm ưu tiên, vẽ dependency và tạo Now/Next/Later roadmap.
10. Chốt domain glossary, curriculum version, sourcing/license và business-model hypotheses.

### 8.4 Artifact

- Research plan/findings, competitor matrix và opportunity map.
- Product vision, PRD, story map và traceability matrix.
- Roadmap P0/P1/P2, KPI tree và measurement plan.
- Domain glossary, curriculum/content strategy, license questions.
- Stakeholder map, decision log và risk register cập nhật.

### 8.5 Kiểm thử/kiểm tra

- Prototype/concept test với task và success threshold định trước.
- Requirement review với product, design, engineering, data, content và legal.
- Kiểm tra mọi P0 map được tới user outcome, API/schema owner và metric.

### 8.6 Exit criteria

- P0 có persona, outcome, acceptance criteria, owner, metric và dependency.
- HSK 1–9, đặc biệt 7/8/9, có quyết định curriculum/data rõ.
- Nguồn dictionary/content/media có licensing path.
- Roadmap không cam kết feature thiếu data/operation readiness.

---

## 9. Phase 2 — UX/UI, Design System và Handoff

### 9.1 Mục tiêu

Thiết kế trải nghiệm user/admin đầy đủ trạng thái và kiểm chứng usability trước khi implementation.

### 9.2 Công nghệ/công cụ

- Figma/FigJam cho IA, flow, wireframe, prototype và component library.
- Design tokens dưới dạng JSON/CSS variables để chuyển sang code.
- WCAG 2.x target được chốt trong requirement; axe/Lighthouse là automated support, không thay manual test.
- Storybook có thể dùng khi component runtime bắt đầu; không cần ở mockup-only stage.

### 9.3 Các bước

1. Kiểm kê chức năng trong [FUNCTIONAL_HIERARCHY.md](../product/functional-hierarchy.md) và content objects.
2. Tạo sitemap, route map và permission matrix cho guest/user/admin.
3. Vẽ flow cho auth/onboarding, lesson, dictionary, SRS, exam, profile và CMS.
4. Với mỗi flow, thiết kế loading, empty, partial, error, retry, offline, unauthorized, expired và destructive state.
5. Tạo low-fidelity wireframe bằng content thật đại diện: Hanzi, Pinyin, tiếng Việt, audio, timer và bảng admin.
6. Test prototype các task có rủi ro cao; phân loại issue theo severity/frequency.
7. Xây design tokens: color, typography, spacing, radius, elevation, motion và breakpoint.
8. Xây component matrix gồm normal/hover/focus/disabled/loading/error/selected/locked/premium.
9. Thiết kế responsive/mobile-first behavior, keyboard, screen reader, zoom và reduced motion.
10. Chuẩn hóa microcopy, terminology, localization, date/time/score và validation.
11. Map screen/component tới story, API, analytics event và acceptance criteria.
12. Tổ chức handoff và design QA trên implementation.

### 9.4 Artifact

- IA/sitemap, user flow, wireframe/prototype và usability report.
- Design token, component inventory và responsive/accessibility annotations.
- Screen-state matrix, content guide, localization keys và asset manifest.
- Design-to-requirement/API/analytics traceability.

### 9.5 Kiểm thử/kiểm tra

- Usability task success/time/error và qualitative evidence.
- Contrast, keyboard order, screen-reader label, touch target và timer accommodation.
- Kiểm tra text expansion, Hanzi/Pinyin line height và font fallback.
- So sánh design với schema/API thực; không chấp nhận field/action vô chủ.

### 9.6 Exit criteria

- Không còn usability blocker critical cho luồng P0.
- Mọi màn hình P0 có state/permission/error.
- Component/accessibility/responsive spec đủ để code không phải đoán.
- Design change có version và owner.

---

## 10. Phase 3 — Architecture, ADR và Threat Model

### 10.1 Mục tiêu

Chốt boundary, data ownership, contract, NFR, deployment topology và security control trước khi mở rộng schema/runtime.

### 10.2 Công nghệ/công cụ

- C4 + Mermaid/PlantUML cho context/container/component/sequence.
- ADR Markdown cho quyết định khó đảo ngược.
- OpenAPI cho REST contract; JSON Schema khi cần event/schema validation.
- STRIDE/abuse-case cho threat modeling.
- PostgreSQL `EXPLAIN ANALYZE` cho access pattern quan trọng.

### 10.3 Các bước

1. Lập C4 baseline và target cho frontend, core API, AI, database, Redis, storage và provider.
2. Chốt modular monolith cho core; định nghĩa module public API và dependency direction.
3. Chốt AI service/database độc lập và authenticated gateway contract.
4. Định nghĩa API conventions: auth, envelope/error code, pagination, filtering, idempotency, concurrency và versioning.
5. Xác định transaction boundary, consistency và event/outbox requirement.
6. Xây data ownership/lifecycle/retention matrix.
7. Threat-model trust boundary: browser, mobile, admin, API, DB, storage, AI và webhook.
8. Định nghĩa NFR: latency, availability, throughput, RPO/RTO, privacy và accessibility.
9. Viết ADR tối thiểu cho frontend framework, package manager, AI runtime, storage, Redis/queue, analytics, cloud và mobile framework.
10. Chạy spike cho rủi ro: dictionary search, exam concurrency, speech upload, RAG retrieval và offline sync.

### 10.4 Artifact

- C4/sequence diagrams, module/context map.
- ADR log và technology decision matrix.
- API/error/event conventions.
- Threat model/security control matrix.
- NFR/SLO/capacity assumptions và spike results.

### 10.5 Kiểm thử/kiểm tra

- Architecture review với owner liên quan.
- Fitness rule chống cyclic dependency/module boundary violation.
- Contract examples được consumer/provider review.
- Threat high/critical có control/test/owner.

### 10.6 Exit criteria

- Không có service/bảng/dataset vô owner.
- Không có integration critical thiếu timeout/retry/idempotency/fallback.
- ADR critical approved hoặc có decision date.
- Implementation có thể chia vertical slices không phá boundary.

---

## 11. Phase 4 — Repository, Toolchain và Local Development

### 11.1 Mục tiêu

Biến monorepo scaffold thành môi trường phát triển tái tạo được, có một chuẩn package/toolchain và feedback loop nhanh.

### 11.2 Công nghệ/công cụ

- Node.js LTS được pin bằng `.nvmrc`, Volta hoặc mise.
- Một package manager duy nhất: giữ npm trước mắt hoặc chuyển có kiểm soát sang pnpm workspace.
- Turborepo chỉ thêm sau khi frontend/AI/package dùng chung có task thật.
- Docker Compose cho PostgreSQL, Redis, MinIO và mail catcher local.
- ESLint, Prettier, TypeScript strict, EditorConfig và Git hooks nhẹ.
- GitHub Actions cho build/test/check ngay từ sớm.

### 11.3 Các bước

1. Chốt ADR package manager và monorepo layout; không giữ nhiều lockfile không kiểm soát.
2. Pin Node/npm/pnpm và ghi engine trong manifest.
3. Khởi tạo package runtime frontend; khởi tạo AI runtime theo ADR thay vì giữ file rỗng.
4. Tạo shared package chỉ cho contract/token thực sự dùng chung; tránh “shared dumping ground”.
5. Chuẩn hóa scripts: `dev`, `build`, `lint`, `format:check`, `typecheck`, `test`, `test:e2e`.
6. Tạo Docker Compose với healthcheck, named volume và seed/bootstrap.
7. Hoàn thiện `.env.example` cho từng service và validation startup.
8. Tạo one-command bootstrap/check; tài liệu hóa prerequisite và troubleshooting.
9. Cấu hình pre-commit hoặc lint-staged chỉ cho check nhanh; full test chạy CI.
10. Tạo CODEOWNERS/PR template/issue template nếu workflow yêu cầu.

### 11.4 Cấu trúc đích đề xuất

```text
HSK-3.0-APP/
  backend/                  # NestJS core API
  frontend/                 # Next.js user + admin web
  mobile/                   # React Native/Expo khi P2 bắt đầu
  ai/                       # AI API, worker, pipeline, eval
  packages/
    api-client/             # generated typed client
    contracts/              # schema thật sự dùng chung
    design-tokens/          # token từ design system
    config/                 # lint/tsconfig shared có kiểm soát
  infra/                    # IaC, container, deployment config
  docs/                     # source of truth
```

### 11.5 Artifact

- ADR/package manifests/lockfile thống nhất.
- Docker Compose và bootstrap command.
- Tooling config, CI baseline và contribution guide.
- Environment matrix và `.env.example` hoàn chỉnh.

### 11.6 Kiểm thử/kiểm tra

- Clone sạch → bootstrap → migrate → seed → start → smoke không cần bước ẩn.
- `format:check`, lint, typecheck, build và test chạy cùng cách local/CI.
- Secret scan và check generated artifacts.

### 11.7 Exit criteria

- Developer mới chạy core system bằng tài liệu.
- Frontend/AI không còn package/entry point rỗng khi phase tương ứng bắt đầu.
- CI baseline xanh trên default branch.
- Toolchain version được pin và reproducible.

---

## 12. Phase 5 — Hoàn thiện Database Schema và Migration

### 12.1 Mục tiêu

Hoàn thiện schema theo từng capability, bảo toàn dữ liệu/lịch sử và cho phép deploy/rollback an toàn. Trình tự chi tiết phải đồng bộ với [DATABASE_SCHEMA_COMPLETION_PLAN.md](./DATABASE_SCHEMA_COMPLETION_PLAN.md).

### 12.2 Công nghệ/công cụ

- PostgreSQL cho core transactional database.
- Prisma schema/client/migrations cho backend.
- SQL review và `EXPLAIN ANALYZE` cho query/index.
- Transaction/advisory lock khi cần; batch backfill idempotent.
- ERD bằng Prisma visualization/Mermaid/diagram tool nhưng schema/migration là authority.

### 12.3 Trình tự capability

#### Bước 5.1 — Baseline và convention

1. Chốt ID strategy, timestamp/timezone, soft delete, status, money và JSON usage.
2. Chốt HSK 1–9 representation và curriculum version.
3. Chốt naming/index/unique/FK/onDelete convention.
4. Kiểm kê data hiện có và migration đã áp dụng.

#### Bước 5.2 — Identity, onboarding và privacy [P0]

- Mở rộng profile, preferences, learning goal và timezone.
- Thêm session/refresh token/revocation hoặc session table theo ADR.
- Thêm OAuthAccount nếu OAuth nằm trong scope.
- Thêm ConsentRecord, DataExportRequest và DataDeletionRequest.
- Thêm PlacementTest/PlacementAttempt và learning plan ban đầu.

#### Bước 5.3 — CMS, revision, import và audit [P0]

- ContentRevision/Review/PublishSchedule.
- ImportJob/ImportRowError/ImportArtifact.
- DataSource/License/Provenance/ContentVersion.
- AuditLog với actor/action/target/before/after/request ID.
- Media metadata, checksum, scan status và lifecycle.

#### Bước 5.4 — Learning activity và progress [P0]

- Activity/ActivityItem/Attempt/Answer/Feedback nếu model hiện tại chưa đủ generic.
- Progress theo lesson/objective cùng completion rule/version.
- LearningEvent bất biến cho analytics/recompute khi cần.
- Access policy/entitlement reference thay vì chỉ `isPremium`.

#### Bước 5.5 — Dictionary và SRS [P0]

- Pronunciation/meaning/example/source metadata đủ ngôn ngữ.
- ReviewItem/ReviewEvent/ReviewSchedule hoặc cấu trúc tương đương.
- Due date, interval, ease/difficulty, lapse và scheduler version.
- Index cho Hanzi/Pinyin/normalized Vietnamese/English và due queue.

#### Bước 5.6 — Exam attempt/snapshot [P0]

- TestRevision/TestSection/QuestionGroup/QuestionRevision.
- ExamAttempt/ExamAnswer/ExamSnapshot/SectionScore.
- `in_progress/submitted/timed_out/invalidated` lifecycle.
- Unique `(attemptId, questionId)` cho autosave idempotent.
- Snapshot answer/explanation/scoring version tại attempt.

#### Bước 5.7 — P1/P2 data

- Reader progress, pronunciation detail, stroke/radical/handwriting asset.
- XP ledger, achievement, streak, notification, device token, support ticket.
- Product/Plan/Subscription/Entitlement/PaymentEvent/Coupon.
- Analytics aggregate nếu query thực tế cần.

#### Bước 5.8 — AI database riêng [P2]

- KnowledgeDocument, DocumentChunk, Embedding.
- IngestionJob, ChatSession/Message, RagRun/Citation.
- AiEvaluation/AiFeedback, prompt/model/index version và retention.

### 12.4 Quy trình bắt buộc cho từng migration

1. Cập nhật requirement/domain/ERD.
2. Thêm schema, constraint và index theo access pattern.
3. Tạo migration tên nghiệp vụ.
4. Review SQL: table rewrite, lock, default, nullable, unique và index build.
5. Nếu dữ liệu lớn: thêm nullable → deploy → backfill batch → verify → enforce constraint.
6. Chạy Prisma generate/validate, migration trên DB rỗng và integration test.
7. Rehearse trên staging data shape đại diện.
8. Backup/checkpoint và xác định rollback hoặc forward-fix.
9. Cập nhật API, seed, docs, metrics và runbook.

### 12.5 Artifact

- Schema, migration SQL, ERD và data dictionary.
- Backfill/reconciliation/rollback plan.
- Migration test report và query/index evidence.
- Data owner/lifecycle/retention matrix.

### 12.6 Kiểm thử/kiểm tra

- Fresh bootstrap và migrate từ mọi supported baseline.
- FK/unique/check constraint và transaction concurrency.
- Historical integrity cho exam/content/SRS/payment.
- `EXPLAIN ANALYZE` dictionary, due queue, active exam và dashboard.
- Backup/restore trước production migration rủi ro cao.

### 12.7 Exit criteria

- P0 schema hoàn chỉnh và migration tái tạo được.
- Không có data model thiếu owner/lifecycle/retention.
- Exam history không phụ thuộc content live.
- Index được chứng minh bằng query thật, không thêm theo cảm tính.

---

## 13. Phase 6 — Curriculum, Content Operations và Seed Pipeline

### 13.1 Mục tiêu

Tạo dữ liệu HSK 1–9 đúng nguồn, có bản quyền/provenance, kiểm định được và có thể import/publish/rollback lặp lại.

### 13.2 Công nghệ/công cụ

- Pipeline TypeScript hiện có trong `backend/scripts/dictionary/`.
- JSON/CSV/TXT raw immutable; manifest SHA-256, source version và license metadata.
- Prisma/PostgreSQL cho normalized/seeding.
- Object storage cho audio/image/PDF/video.
- Validation schema bằng Zod/Joi/JSON Schema hoặc TypeScript validator thống nhất.
- FFmpeg/ffprobe cho media normalization/metadata nếu audio/video nằm trong scope.

### 13.3 Các bước

1. Chốt curriculum authority/version, HSK 1–9 taxonomy và objective map.
2. Lập dataset/content/media inventory cùng owner/license/attribution.
3. Bảo vệ `raw/` bất biến; lưu hash, received date, encoding và source URL.
4. Parse thành canonical intermediate format; lưu reject record và reason.
5. Normalize Hanzi/traditional/Pinyin/tone/whitespace/Unicode/ngôn ngữ.
6. Deduplicate theo rule có version; không merge dữ liệu mơ hồ tự động.
7. Validate completeness, uniqueness, relation, HSK coverage và license.
8. Tạo preview diff: insert/update/skip/reject/delete impact.
9. Seed/import theo batch idempotent, có transaction/chunk và audit.
10. Reconcile input/output count, sample content và referential integrity.
11. Human review cho nghĩa Việt, example, answer/explanation và AI-assisted content.
12. Publish bằng workflow; rollback batch/revision khi phát hiện lỗi.

### 13.4 Content quality rubric

- Linguistic correctness: Hanzi, Pinyin, tone, nghĩa và ví dụ.
- Pedagogical fit: level, objective, difficulty, distractor và explanation.
- Media quality: format, duration, loudness, transcript, speaker/license.
- Accessibility: transcript/caption/alt text.
- Provenance: source, license, version, attribution, reviewer.
- Operational readiness: status, slug, relation, search index và rollback.

### 13.5 Artifact

- Curriculum/objective/coverage map.
- Source/license manifest và canonical schemas.
- Pipeline scripts, run report, reject report và reconciliation.
- Content style guide, review checklist và publish/rollback procedure.

### 13.6 Kiểm thử/kiểm tra

- Golden fixtures và snapshot cho parser/normalizer.
- Same input → same output; rerun không tạo duplicate.
- Property/edge tests cho Unicode/Pinyin/encoding.
- DB constraint/relation và sample linguistic review.
- Media validation và malware/MIME check.

### 13.7 Exit criteria

- P0 content coverage đạt threshold theo level/skill/objective.
- Không có published asset thiếu source/license/reviewer/version.
- Pipeline chạy lại an toàn và có rollback.
- Data-quality blocker bằng 0 trước release content.

---

## 14. Phase 7 — Backend Foundation, Auth và Platform Controls

### 14.1 Mục tiêu

Chuẩn hóa core API và hoàn thiện identity/security/platform primitives trước khi thêm nhiều domain.

### 14.2 Công nghệ/công cụ

- NestJS 11, TypeScript, Prisma/PostgreSQL.
- Passport JWT, Argon2id, secure cookies/session strategy theo ADR.
- `class-validator`, `class-transformer`, Joi env validation.
- `@nestjs/throttler`; Redis-backed ở multi-instance.
- OpenAPI/Swagger cho contract; structured JSON logging và OpenTelemetry.
- Jest/Supertest cho unit/integration/e2e.

### 14.3 Các bước

1. Củng cố `main.ts`: global prefix, validation pipe, error filter, request ID và graceful shutdown.
2. Chuẩn hóa response/error code, pagination, sorting, filtering và correlation ID.
3. Hoàn thiện user profile/update/password change/account status.
4. Thiết kế access token ngắn hạn, refresh rotation, revocation và device/session list.
5. Giữ Argon2id; quản lý pepper/key rotation qua secret manager.
6. Hoàn thiện RBAC/policy: user ownership, admin action và deny-by-default.
7. Thêm login audit, failed-attempt lockout, rate limit và suspicious activity metric.
8. Thêm account export/deletion/consent flow theo privacy policy.
9. Tạo health/readiness/liveness; readiness kiểm tra dependency cần thiết nhưng không gây cascade.
10. Tích hợp OpenAPI, API version và deprecation rule.
11. Thêm audit service, cache/queue/storage/provider abstraction.
12. Viết integration/e2e cho auth, authorization và error boundary.

### 14.4 Security checklist

- Password policy và breached/weak password control phù hợp.
- Không log password/token/secret/PII nhạy cảm.
- JWT `kid`, issuer, audience, expiry và clock skew được validate.
- Refresh reuse detection/revocation.
- CORS/CSRF/cookie flags theo auth transport.
- Input size, content type, upload limit và rate limit.
- Admin endpoints có explicit role/policy và audit.

### 14.5 Artifact

- Auth/session/RBAC APIs và OpenAPI.
- Security/threat-control tests.
- Audit/error/logging conventions.
- Runbook key rotation, account lock và privacy request.

### 14.6 Kiểm thử/kiểm tra

- Register/login/logout/refresh/revoke/session expiry/concurrency.
- Horizontal/vertical privilege escalation và object ownership.
- Brute force/rate limit/error leakage.
- Password hash/pepper rotation strategy.
- API contract và database transaction failure.

### 14.7 Exit criteria

- Auth/RBAC P0 end-to-end pass.
- Không có protected endpoint thiếu policy test.
- Logs/metrics/audit cho critical security events hoạt động.
- OpenAPI/error contract đủ cho frontend client.

---

## 15. Phase 8 — CMS, Media, Dictionary và Search

### 15.1 Mục tiêu

Cho phép admin vận hành content an toàn và người học tra cứu dữ liệu từ điển chất lượng cao.

### 15.2 Công nghệ/công cụ

- NestJS domain modules + Prisma/PostgreSQL.
- S3-compatible object storage, signed upload/download và CDN.
- Redis/BullMQ cho import/media background jobs.
- PostgreSQL normalized columns/index; `pg_trgm`/full-text extension chỉ sau spike/query plan.
- CSV/JSON parsers có streaming và schema validation.
- Malware scanning/provider hoặc sandbox process cho upload production.

### 15.3 Các bước

1. Xây media service: initiate upload, validate MIME/size/checksum, finalize, scan và lifecycle.
2. Xây CMS CRUD cho level/lesson/topic/story/word/sentence/activity/media.
3. Thêm draft/review/publish/archive/revision và scheduled publish nếu cần.
4. Xây import job: upload → parse → preview → validate → approve → commit → reconcile.
5. Ghi audit actor/action/before/after/batch/request ID.
6. Hoàn thiện dictionary search Hanzi/Pinyin/không dấu/Việt/Anh và filter HSK.
7. Hoàn thiện word detail: simplified/traditional, meanings, part of speech nếu có, examples, audio, image và source.
8. Thêm save/unsave word và link tới SRS item.
9. Đặt cache cho published read; invalidate theo revision/publish event.
10. Tạo content-quality dashboard: thiếu nghĩa/audio/example/source và duplicate.

### 15.4 API nhóm chính

- Admin content CRUD/import/review/publish/archive.
- Media create/finalize/list/delete/attach.
- Dictionary search/detail/save/progress.
- Public learning content chỉ trả `published`, chưa soft-delete và được entitlement cho phép.

### 15.5 Artifact

- CMS/import/media/dictionary APIs và OpenAPI.
- Import schemas, job/audit models và operator runbook.
- Search benchmark/query plan và cache policy.
- Content-quality dashboard/query.

### 15.6 Kiểm thử/kiểm tra

- Import duplicate/invalid/partial/large/retry/rollback.
- Upload MIME spoof, oversize, malware, orphan cleanup và unauthorized access.
- Search Unicode/Pinyin/diacritic/empty/pagination/performance.
- Publish permission, stale cache và revision history.

### 15.7 Exit criteria

- Admin publish content mới theo SLA mà không can thiệp DB.
- Import lỗi không làm hỏng batch đang published.
- Dictionary P0 trả đủ ngôn ngữ/metadata đã cam kết.
- Search P95 và data-quality threshold đạt trên dữ liệu đại diện.

---

## 16. Phase 9 — Learning, Activity, Progress và SRS

### 16.1 Mục tiêu

Hoàn thiện core learning loop: chọn lộ trình → học → làm activity → nhận feedback → lưu progress → ôn đúng hạn.

### 16.2 Công nghệ/công cụ

- NestJS/Prisma/PostgreSQL cho business state.
- Redis cache cho published lesson read và due count khi đo được lợi ích.
- BullMQ cho recompute/recommendation/notification nền.
- Versioned scheduler service cho SRS; clock/timezone được inject để test.
- OpenTelemetry spans cho lesson/attempt/review flow.

### 16.3 Các bước

1. Chốt completion rule theo lesson/objective/activity và version rule.
2. Xây activity types: MCQ, fill blank, arrange sentence, listening choice và speaking repeat.
3. Bắt đầu attempt với content/version snapshot đủ cần thiết.
4. Validate answer server-side; trả feedback/explanation theo publish/access policy.
5. Ghi attempt/answer/score/detail và learning event idempotent.
6. Cập nhật progress transactionally hoặc qua event có reconciliation.
7. Xây learning plan và next lesson rule-based trước personalization phức tạp.
8. Tạo SRS item khi save/học từ theo rule.
9. Xây daily due queue theo user timezone và stable ordering.
10. Ghi review grade/event và cập nhật schedule bằng scheduler version.
11. Hiển thị/đo new-learning-review balance, lapse và overdue.
12. Tạo admin/debug view giải thích vì sao item due hoặc lesson được gợi ý.

### 16.4 Invariant quan trọng

- Repeat request không tạo attempt/review event trùng ngoài ý muốn.
- Progress không giảm hoặc tăng sai do retry/concurrency.
- Scheduler có version; lịch sử grade không bị sửa.
- Timezone/DST được xử lý rõ; lưu timestamp UTC.
- Content sửa sau attempt không làm thay đổi lịch sử đã ghi.

### 16.5 Artifact

- Learning/activity/progress/SRS APIs và state diagrams.
- Scheduler specification/version và test vectors.
- Event/analytics catalog cho learning loop.
- Reconciliation/debug queries và dashboards.

### 16.6 Kiểm thử/kiểm tra

- Mỗi activity type với valid/invalid/boundary.
- Concurrent/retry submit và transaction rollback.
- Timezone/DST, due boundary, lapse và scheduler regression.
- Content revision, entitlement và permission.
- Load due queue/progress dashboard trên dữ liệu đại diện.

### 16.7 Exit criteria

- User hoàn thành lesson và progress cập nhật đúng.
- Daily review queue ổn định, giải thích được và không duplicate.
- Core loop có analytics/metric và error monitoring.
- Rule/scheduler có regression suite trước thay đổi version.

---

## 17. Phase 10 — Exam Engine hoàn chỉnh

### 17.1 Mục tiêu

Xây luồng thi đáng tin cậy, chịu retry/mất mạng, bảo toàn snapshot và kết quả lịch sử.

### 17.2 Công nghệ/công cụ

- NestJS/Prisma/PostgreSQL transaction và constraint.
- Redis cho ephemeral timer/session/cache chỉ khi cần; database là authority.
- BullMQ cho timeout/finalization/report nền nếu kiến trúc yêu cầu.
- Server clock là authority; client timer chỉ hiển thị.
- Jest/Supertest/Playwright và k6/Artillery cho concurrency/load.

### 17.3 Các bước

1. Hoàn thiện question bank taxonomy: HSK, skill, topic, difficulty, source và revision.
2. Thiết kế test/section/group/order/timing/scoring version.
3. Publish immutable test revision.
4. Start attempt idempotent, kiểm tra entitlement và tạo snapshot.
5. Trả question payload không làm lộ đáp án.
6. Autosave answer bằng unique key và optimistic concurrency/version.
7. Hỗ trợ flag/review/navigation/resume và active attempt recovery.
8. Kiểm soát timer/timeout phía server; grace policy rõ.
9. Submit/finalize transactionally; chống double submit.
10. Chấm score theo section/skill/version; lưu answer/explanation snapshot.
11. Trả result/history/analytics theo quyền và publish policy.
12. Cho admin invalidate/regrade bằng workflow/audit thay vì sửa trực tiếp.

### 17.4 Invariant quan trọng

- Một active-attempt rule được định nghĩa rõ.
- Autosave cùng request/key không tạo đáp án trùng.
- Result chỉ final sau submit/timeout hoàn tất.
- Result cũ không đổi khi admin sửa question/test.
- Scoring version và snapshot đủ để audit/regrade.
- Client không quyết định thời gian hoặc điểm cuối cùng.

### 17.5 Artifact

- Exam domain/state machine, APIs và OpenAPI.
- Scoring/snapshot specification, test vectors và admin workflow.
- Load model, performance report và monitoring dashboard.
- Incident/regrade/invalidation runbook.

### 17.6 Kiểm thử/kiểm tra

- Start/autosave/resume/review/submit/result happy path.
- Retry, out-of-order save, double submit, timeout race và stale client.
- Content revision sau attempt và regrade workflow.
- Authorization và answer leakage.
- Concurrent submission/load/soak, DB lock và queue lag.

### 17.7 Exit criteria

- E2E exam P0 pass trên staging với network interruption.
- Historical integrity/snapshot/regrade được chứng minh.
- Load target đạt; error/latency/submit-success có dashboard/alert.
- Support có request ID và runbook điều tra attempt.

---

## 18. Phase 11 — Frontend Web cho người học

### 18.1 Mục tiêu

Xây web app user kết nối API thật, có state đầy đủ, accessible, performant và quan sát được.

### 18.2 Công nghệ/công cụ

- Next.js App Router, React và TypeScript.
- Tailwind CSS/design tokens + accessible primitive đã chọn.
- OpenAPI typed client, Zod, React Hook Form.
- TanStack Query cho client server-state cần thiết; Next server fetching/cache cho route phù hợp.
- Vitest, React Testing Library, Playwright, axe/Lighthouse.
- OpenTelemetry web/Sentry-compatible error tracking theo ADR.

### 18.3 Trình tự vertical slices

1. App shell, routing, auth/session, error boundary và telemetry.
2. Register/login/onboarding/placement/profile.
3. Home/learning path/level/lesson/topic/story.
4. Activity player và feedback/progress.
5. Dictionary search/detail/save.
6. Review Center/flashcard/due queue/history.
7. Exam list/instructions/player/autosave/resume/review/result/history.
8. User dashboard/settings/privacy/export/delete.
9. P1 reader/pronunciation/engagement.
10. P2 AI/premium/offline nếu gate tương ứng đạt.

### 18.4 Quy tắc implementation

- Server state không duplicate vào global store.
- Auth secret không lưu plain localStorage nếu kiến trúc cookie/session được chọn.
- Mọi screen có loading/empty/error/permission/offline state.
- URL chứa state cần share/back; form state ở form; transient UI state ở component.
- Cache key chứa user/scope; xóa cache khi logout/switch account.
- Exam autosave có status rõ, retry idempotent và unload/reconnect behavior.
- Không chỉ ẩn nút để bảo mật; backend luôn enforce.

### 18.5 Artifact

- Runtime app, route map, component library và typed API client.
- Story/component/unit/e2e tests.
- Analytics mapping, performance/a11y report.
- Error handling/offline/session behavior docs.

### 18.6 Kiểm thử/kiểm tra

- Component states, keyboard và screen reader.
- Auth expiry/revoke/role/permission.
- Slow/offline/retry/duplicate action.
- Responsive browser/device matrix.
- Web Vitals/bundle/image/font/hydration và cache/privacy.

### 18.7 Exit criteria

- P0 user flows pass Playwright trên staging/API thật.
- Không còn accessibility critical/high.
- Performance budget và error rate đạt target.
- Analytics events đúng trigger/schema/consent.

---

## 19. Phase 12 — Admin Console và Content Operations

### 19.1 Mục tiêu

Cho đội vận hành quản lý user/content/exam/media/import/report an toàn mà không truy cập DB trực tiếp.

### 19.2 Công nghệ/công cụ

- Dùng cùng Next.js app với route group/admin shell hoặc app riêng nếu ADR chứng minh boundary cần thiết.
- React Hook Form + Zod, typed API client và table virtualization khi dữ liệu lớn.
- Server-side pagination/filter/sort; không tải toàn bộ dataset về browser.
- Signed upload, background job status và polling/SSE nếu cần.
- RBAC/policy phía backend; audit log và admin telemetry.

### 19.3 Các bước

1. Admin layout, route guard và permission-aware navigation.
2. User list/detail/lock/unlock/role với confirmation và audit reason.
3. CMS list/editor/revision/preview/review/publish/archive.
4. Dictionary bulk edit và data-quality issue queue.
5. Media library/upload/attach/transcript/cleanup.
6. Import wizard: upload → map → preview → validate → approve → progress → report.
7. Question bank editor, group/section/test builder và publish preview.
8. Exam attempt/result investigation/regrade/invalidate theo policy.
9. Content report/support triage và assignee/status/note.
10. Dashboard operational: publishing SLA, import errors, content gap và exam health.

### 19.4 Safety controls

- Destructive/bulk action có preview, impact count, typed confirmation khi cần.
- Optimistic concurrency/version conflict, không silent overwrite.
- Least privilege và audit cho export, role, publish, delete và regrade.
- PII masking và export watermark/log theo policy.
- Background job có retry/idempotency/cancel/rollback hoặc explicit no-rollback warning.

### 19.5 Artifact

- Admin app, permission matrix và operation runbooks.
- CMS/import/exam/media workflows và e2e tests.
- Audit dashboard và data-quality/support queues.

### 19.6 Kiểm thử/kiểm tra

- Role/permission/PII leakage.
- Concurrent edit/version conflict.
- Bulk/import partial failure/retry/rollback.
- Keyboard/a11y cho form/table/dialog.
- Large dataset pagination/virtualization/performance.

### 19.7 Exit criteria

- Admin vận hành P0 không dùng SQL/manual file copy.
- Mọi critical admin action có permission/audit/confirmation.
- Import/publish/regrade có evidence và recovery path.
- Operational dashboard phản ánh nguồn dữ liệu rõ.

---

## 20. Phase 13 — Analytics, Engagement, Notification và Support

### 20.1 Mục tiêu

Đo outcome sản phẩm, tạo nhắc học có consent và đóng vòng feedback/support mà không làm sai privacy hoặc gây spam.

### 20.2 Công nghệ/công cụ

- Versioned analytics event schema từ frontend/backend.
- PostHog hoặc provider tương đương theo ADR; PostgreSQL aggregate/Metabase cho BI ban đầu.
- Redis + BullMQ cho scheduling/delivery/retry.
- Email provider adapter; FCM/APNs khi có push.
- Structured support ticket/content report trong core database.
- OpenTelemetry và dashboard/alert cho pipeline/delivery.

### 20.3 Các bước

1. Tạo event catalog: naming, trigger, actor, properties, consent, version và owner.
2. Instrument activation, lesson/activity/review/exam/retention và admin workflow.
3. Validate event client/server; chống duplicate và PII leakage.
4. Tạo metric layer/SQL definitions cho DAU, completion, retention và score distribution.
5. Reconcile dashboard với transactional source.
6. Xây XP ledger, streak và achievement bằng transaction/event idempotent.
7. Xây notification preference, timezone, quiet hours và channel consent.
8. Schedule/deliver/retry notification; dedupe bằng idempotency key.
9. Quản lý device token revoke/refresh và email bounce/unsubscribe.
10. Xây support ticket/content report/AI feedback workflow.
11. Tạo admin/support dashboard, SLA và product feedback loop.

### 20.4 Guardrails

- Analytics không chứa answer/audio/chat/PII nếu không có purpose rõ.
- Engagement không dùng dark pattern hoặc gây hại learning outcome.
- Notification tuân quiet hours/timezone/unsubscribe.
- XP ledger bất biến; tổng XP có thể recompute.
- Dashboard ghi freshness, definition, owner và limitation.

### 20.5 Artifact

- Event/metric catalog, schemas và dashboards.
- Notification/support domain, templates và runbooks.
- Consent/retention/PII review và reconciliation report.
- Experiment design và guardrail nếu chạy A/B test.

### 20.6 Kiểm thử/kiểm tra

- Event trigger/schema/duplicate/identity/consent.
- Timezone/quiet-hours/dedupe/retry/bounce/token revoke.
- XP/streak concurrency và recomputation.
- Ticket permission/SLA/escalation/audit.
- Dashboard freshness và transaction reconciliation.

### 20.7 Exit criteria

- KPI P0 đo được bằng event đã validate.
- Notification preference và delivery đáng tin cậy.
- Support/content report có owner/status/SLA.
- Không có event/template vi phạm privacy/consent.

---

## 21. Phase 14 — Interactive Reader, Pronunciation và Hanzi [P1/P2]

### 21.1 Mục tiêu

Mở rộng trải nghiệm đọc, nghe-nói và Hán tự sau khi core learning loop P0 ổn định và có baseline metric.

### 21.2 Công nghệ/công cụ

- Web Audio API/MediaRecorder cho web recording/playback sau browser compatibility test.
- Native audio APIs qua Expo/React Native khi có mobile.
- S3-compatible storage + signed URL + lifecycle cho recording.
- Speech provider adapter cho STT/pronunciation; không khóa domain vào một provider.
- Forced alignment/timestamp metadata cho audio-highlight nếu nội dung có dữ liệu.
- SVG/Lottie/canvas cho stroke animation; OCR/handwriting provider hoặc on-device model cần ADR.
- FFmpeg/ffprobe cho normalize/transcode/metadata audio.

### 21.3 Interactive Reader

1. Chuẩn hóa story document thành block/sentence/token mapping.
2. Map token tới `Word` nhưng giữ text snapshot/version.
3. Xây tap-to-lookup, save-to-review và context example.
4. Đồng bộ audio timestamp với sentence/segment; có transcript fallback.
5. Lưu reading position/progress per content revision.
6. Xử lý text selection, font size, line height, simplified/traditional và screen reader.
7. Đo read completion, lookup, save và abandonment có consent.

### 21.4 Pronunciation/Speaking

1. Thiết kế practice target: word/sentence/tone/shadowing/scenario.
2. Xin microphone permission theo thời điểm; giải thích purpose/retention.
3. Record locally, validate duration/format/size và cho playback trước upload.
4. Upload signed, scan/transcode và tạo scoring job idempotent.
5. Gọi speech provider với timeout/retry/circuit breaker.
6. Lưu score/detail/provider/model version nhưng không trình bày score như chân lý tuyệt đối.
7. Trả actionable feedback về tone/segment và comparison audio.
8. Xóa recording theo retention hoặc theo yêu cầu user.

### 21.5 Hanzi/Handwriting/OCR

1. Lưu radical/component/stroke-order asset cùng source/license/version.
2. Render stroke animation accessible; hỗ trợ reduced motion.
3. Canvas luyện viết với sampling/normalization và local feedback nếu có.
4. Nếu dùng recognition/OCR, upload tối thiểu dữ liệu, có consent và provider policy.
5. Hiển thị confidence/candidate và cho user sửa; không tự động ghi dữ liệu sai.

### 21.6 Artifact

- Reader document/token/audio model và APIs.
- Speech recording/job/provider contract và retention policy.
- Hanzi asset/recognition model cùng license registry.
- UX/evaluation/performance/cost reports.

### 21.7 Kiểm thử/kiểm tra

- Browser/device microphone permission, interruption và format.
- Audio slow network/retry/duplicate/cleanup/retention.
- Reader tokenization/version/progress và accessibility.
- Speech evaluation theo accent/noise/device; kiểm tra bias và confidence.
- Stroke/OCR accuracy, privacy và fallback manual search.

### 21.8 Exit criteria

- P1 metric chứng minh tính năng cải thiện learning outcome/engagement.
- Recording có consent, encryption, access control, retention và deletion.
- Provider failure không làm mất core learning flow.
- Cost/latency/quality có guardrail và dashboard.

---

## 22. Phase 15 — AI/RAG Assistant [P2]

### 22.1 Mục tiêu

Cung cấp giải thích từ vựng/ngữ pháp/bài học có nguồn tham khảo, được đánh giá và vận hành trong giới hạn an toàn/chi phí.

### 22.2 Điều kiện bắt đầu

- Core content có provenance/version và chất lượng đủ tốt.
- Use case cụ thể có baseline không-AI và success metric.
- Provider/DPA/privacy/retention/legal review hoàn tất.
- AI service runtime/database/owner/on-call được chốt.
- Có evaluation dataset đại diện tiếng Trung/Pinyin/tiếng Việt.

### 22.3 Công nghệ/công cụ

- Python + FastAPI + Pydantic mặc định đề xuất; ADR bắt buộc vì scaffold hiện rỗng.
- PostgreSQL AI riêng + pgvector; Alembic/SQLAlchemy nếu dùng Python.
- Provider adapters cho LLM/embedding/reranker.
- Redis + worker queue cho ingest/evaluation nền nếu cần.
- OpenTelemetry cho backend gateway → AI → provider.
- pytest + golden/evaluation dataset; prompt/model/index version registry.
- Content safety/redaction/allowlist policy ở gateway và AI service.

### 22.4 Ingestion pipeline

1. Nhận content ID/version/permission/source từ core hoặc export contract.
2. Tính content hash; ingest idempotent theo document/version/hash.
3. Parse/clean nhưng giữ source locator và semantic structure.
4. Chunk theo content type; lưu chunk metadata, token count và source location.
5. Tạo embedding theo model/version; batch/retry/rate limit.
6. Index trong pgvector/vector store; validate count/dimension/duplicate.
7. Chạy retrieval regression trước promote index version.
8. Archive/xóa version cũ theo retention; không silent replace index.

### 22.5 Chat/RAG runtime

1. Backend xác thực user, kiểm tra entitlement/quota và truyền permission context tối thiểu.
2. AI service validate input, size, language và safety.
3. Rewrite/classify query nếu evaluation chứng minh cần thiết.
4. Retrieve theo filter permission/level/content version; optional hybrid/rerank.
5. Build prompt có system rules, evidence và instruction separation.
6. Gọi provider với timeout, retry có kiểm soát và cost cap.
7. Validate output/citation; nếu evidence yếu, trả fallback trung thực.
8. Lưu RagRun: input hash/redacted text theo policy, retrieved chunks, score, prompt/model/index version, latency, token/cost và citation.
9. Trả streaming response nếu UX/API đã thiết kế cancellation/error.
10. Thu feedback/report và nối với evaluation/admin operations.

### 22.6 Security và safety

- Chống prompt injection từ user và retrieved content.
- Không để model tự quyết định authorization/filter.
- Redact secret/PII; không gửi data vượt provider policy.
- Rate limit/quota/budget per user/plan.
- Tách tool allowlist; không cho AI write core data nếu chưa có explicit workflow/confirmation.
- Human review cho AI-generated learning content trước publish.
- Có kill switch và fallback sang search/content thường.

### 22.7 Evaluation

- Retrieval: recall@k, precision/relevance, citation coverage và source correctness.
- Answer: factuality/groundedness, completeness, pedagogical usefulness và language quality.
- Safety: prompt injection, harmful content, privacy leakage và refusal correctness.
- Operations: P50/P95 latency, error, token/cost và provider fallback.
- Regression: golden set theo level/use case; compare trước promote model/prompt/index.

### 22.8 Artifact

- AI service/database/migrations và API contract.
- Ingest/index pipeline, manifests và evaluation dataset/report.
- Prompt/model/index registry, RagRun/citation/feedback schema.
- Safety/privacy/cost policy, dashboard/alerts và runbook.

### 22.9 Kiểm thử/kiểm tra

- Unit/contract/integration cho adapter/retrieval/filter/citation.
- Ingest idempotency/version/retry/delete.
- Permission leakage và cross-user/content access.
- Prompt injection/red-team/privacy/safety.
- Load/soak/provider timeout/rate-limit/cost cap.

### 22.10 Exit criteria

- Evaluation đạt ngưỡng đã chốt trên dataset đại diện.
- Mỗi answer có citation hoặc fallback rõ.
- Permission/privacy/retention/quota được enforce.
- Cost/latency/error có dashboard/alert/kill switch.
- Beta rollout nhỏ trước mở rộng toàn bộ user.

---

## 23. Phase 16 — Subscription, Entitlement và Payment [P2]

### 23.1 Mục tiêu

Monetize sản phẩm bằng quyền phía server và payment lifecycle có thể reconcile, refund và audit.

### 23.2 Công nghệ/công cụ

- Core PostgreSQL models: Product, Plan, Subscription, Entitlement, PaymentEvent và optional Coupon/Redemption.
- Payment provider SDK/API qua adapter; provider cần ADR theo thị trường, currency, tax và app-store rule.
- Webhook signature verification, idempotency và queue/retry.
- Feature flag chỉ điều khiển rollout; entitlement quyết định quyền.
- BI/reconciliation SQL và financial audit logs.

### 23.3 Các bước

1. Chốt customer/payer, package, price/currency, trial, renewal, cancel, grace và refund.
2. Review terms/privacy/tax/invoice/app-store requirements với người có thẩm quyền.
3. Thiết kế product/plan/version và entitlement matrix.
4. Tạo checkout session server-side; không nhận amount tin từ client.
5. Xác minh webhook signature; lưu external event ID unique và raw payload theo retention/security policy.
6. Xử lý event idempotent/out-of-order; cập nhật subscription/entitlement transactionally.
7. Kiểm tra entitlement ở use-case/resource/quota phía backend.
8. Xây manage subscription/cancel/refund/restore purchase.
9. Reconcile provider transaction với database định kỳ.
10. Theo dõi conversion, churn, MRR/ARPU/refund nhưng không lưu card data.

### 23.4 Artifact

- Pricing/packaging và entitlement matrix.
- Payment/subscription domain, APIs, webhook/runbook.
- Terms/refund/privacy sign-off.
- Reconciliation/revenue dashboards và incident procedure.

### 23.5 Kiểm thử/kiểm tra

- Success/fail/abandon/retry/duplicate/out-of-order webhook.
- Renewal/cancel/grace/expire/refund/dispute.
- Entitlement bypass và client tampering.
- Provider sandbox-to-production config separation.
- Reconciliation delta và audit completeness.

### 23.6 Exit criteria

- Không có access premium dựa duy nhất vào UI hoặc `isPremium`.
- Webhook idempotent và reconciliation chạy được.
- Refund/cancel/support/terms sẵn sàng.
- Security/legal/finance sign-off trước charge thật.

---

## 24. Phase 17 — Mobile App và Offline Sync [P2]

### 24.1 Mục tiêu

Đưa core learning loop lên mobile với secure session, offline content/review và sync conflict có thể giải thích.

### 24.2 Công nghệ/công cụ

- React Native + Expo + TypeScript mặc định; Flutter là alternative cần ADR.
- Expo Router/navigation tương đương, secure storage và SQLite.
- Typed API client/contracts, design tokens chia sẻ có kiểm soát.
- Expo EAS/build/signing/OTA nếu chọn Expo.
- FCM/APNs push và deep link.
- Maestro/Detox và real-device test matrix.

### 24.3 Các bước

1. Chốt mobile-specific use case; không sao chép toàn bộ admin/web.
2. Thiết kế navigation, lifecycle, background/foreground và deep link.
3. Lưu refresh/session secret trong Keychain/Keystore; xử lý device revoke.
4. Thiết kế local DB schema/version/migration.
5. Xây content download manifest, checksum, quota và cleanup.
6. Xác định dữ liệu offline: lesson published, media selected, due review; không cache PII không cần.
7. Ghi offline action vào sync queue với idempotency key/device/time/version.
8. Sync theo retry/backoff và conflict policy; server vẫn là authority cho sensitive state.
9. Hiển thị offline/syncing/failed/conflict/last-synced rõ ràng.
10. Tích hợp push preference/token, microphone/camera permission khi cần.
11. Test upgrade/local migration, low storage, process kill, clock drift và network switch.
12. Chuẩn bị store metadata, privacy labels, screenshots, reviewer notes và phased rollout.

### 24.4 Conflict policy ví dụ

- Published content: server version thắng; local giữ snapshot tới khi download mới hoàn tất.
- Review event: append-only với idempotency key; server recompute schedule.
- Exam: không hỗ trợ full offline ở P2 đầu trừ khi threat/integrity design riêng.
- User preference: last-write hoặc field-level merge có server version.
- Download/media: manifest/checksum, không coi file local là authority.

### 24.5 Artifact

- Mobile architecture/ADR, app runtime và secure-session flow.
- Offline data/sync/conflict specification.
- Device test report, store package và rollout/rollback runbook.

### 24.6 Kiểm thử/kiểm tra

- OS/device/network/lifecycle/permission/accessibility.
- Offline-first/reconnect/retry/duplicate/conflict.
- Secure storage/jailbroken or compromised-device risk review.
- Local DB/OTA/native upgrade migration.
- Push/deep link/token revoke và analytics consent.

### 24.7 Exit criteria

- Core mobile task pass trên device matrix.
- Không mất/duplicate user action qua offline sync.
- Store/privacy/signing/support/rollback sẵn sàng.
- Crash-free/performance/battery/network metrics có baseline.

---

## 25. Phase 18 — Testing, Security, Performance và Accessibility Hardening

### 25.1 Mục tiêu

Chứng minh hệ thống đáp ứng requirement/risk production trên artifact và môi trường đại diện.

### 25.2 Công nghệ/công cụ

- Backend: Jest, Supertest, database integration tests.
- Frontend: Vitest, React Testing Library, Playwright.
- Mobile: Jest + Maestro/Detox theo ADR.
- API contract: OpenAPI diff/generated-client tests.
- Load: k6 hoặc Artillery; chọn một và version script.
- Security: dependency/container/IaC/secret scanning; DAST có kiểm soát; manual threat review.
- Accessibility: axe, Lighthouse, keyboard, screen reader và real-device manual test.
- Chaos/fault injection ở mức phù hợp cho provider/Redis/DB/network.

### 25.3 Test strategy

1. Map requirement/invariant/risk tới test level và owner.
2. Unit test domain rule/state transition/scheduler/scoring.
3. Integration test database, migration, Redis, storage, queue và provider adapter.
4. Contract test frontend-backend-AI/webhook/event.
5. E2E test luồng P0 user/admin trên staging.
6. Performance baseline/load/stress/soak/recovery cho search, lesson, due queue, exam và AI.
7. Security test authz, upload, injection, SSRF, webhook, prompt injection, data leakage và dependency.
8. Accessibility automated + manual cho keyboard/screen reader/zoom/motion/audio transcript.
9. Exploratory test theo locale, timezone, network và content edge case.
10. Regression suite chạy trên artifact release; quản lý flaky/quarantine có SLA.

### 25.4 Performance budget ban đầu

Các số cụ thể phải chốt bằng NFR/load model. Tối thiểu phải đặt và đo:

- API read/write P50/P95/P99, error rate và throughput.
- Dictionary query trên full dataset.
- Exam autosave/submit success dưới concurrency mục tiêu.
- Frontend LCP/INP/CLS, JS bundle và API waterfall.
- Queue lag/retry/dead-letter.
- AI latency/token/cost/retrieval quality.
- Database connection, slow query, lock và storage growth.

### 25.5 Security hardening

- OWASP threat/abuse checklist theo capability.
- Least privilege IAM/DB/service accounts.
- TLS, encryption at rest, secret rotation và key inventory.
- CSP, CORS, CSRF/cookie controls, security headers.
- Rate limit/bot/WAF, upload scanning và signed URL expiry.
- PII redaction/log retention/audit integrity.
- Dependency/SBOM/license/vulnerability SLA.
- Backup access, restore environment isolation và incident evidence.

### 25.6 Artifact

- Master test plan và risk-requirement-test matrix.
- Automated suites, fixtures và reports.
- Performance/security/accessibility evidence.
- Defect/waiver register và release quality sign-off.

### 25.7 Kiểm thử/kiểm tra

- Chạy đầy đủ suite trên release candidate và environment đại diện.
- Đối chiếu requirement-risk-test matrix, không chỉ dựa vào coverage phần trăm.
- Tái chạy defect critical/high và regression test tương ứng.
- Review false positive/negative của security/a11y tooling bằng kiểm tra thủ công.
- Lưu artifact, config, seed/data shape và report để kết quả có thể tái hiện.

### 25.8 Exit criteria

- P0/high-risk requirements có test evidence.
- Không còn critical/high security/accessibility defect chưa được xử lý hoặc accept đúng thẩm quyền.
- Load/SLO target đạt trên environment/data representative.
- Flaky test nằm dưới threshold và có owner.
- Release candidate pass smoke/regression mà không rebuild khác artifact.

---

## 26. Phase 19 — Infrastructure, CI/CD và Observability

### 26.1 Mục tiêu

Tạo con đường build → test → deploy → observe → rollback lặp lại, bảo mật và có audit.

### 26.2 Công nghệ/công cụ

- Docker/Compose, multi-stage image và non-root runtime.
- GitHub Actions với OIDC/short-lived cloud credentials.
- Terraform hoặc OpenTofu; remote state, locking và review plan.
- Managed PostgreSQL/Redis/object storage/CDN/WAF theo provider ADR.
- OpenTelemetry, Prometheus-compatible metrics, Grafana, structured logs và tracing.
- Sentry hoặc managed equivalent cho error/release tracking.
- Secret manager và cloud KMS.

### 26.3 Infrastructure steps

1. Tạo Dockerfile cho backend/frontend/AI/worker; pin base image và healthcheck.
2. Scan image/SBOM/license; ký/attest artifact khi supply-chain policy yêu cầu.
3. Tạo IaC module cho network, IAM, compute, DB, Redis, storage, CDN, DNS/TLS và observability.
4. Tách environment/state; dùng tag/label owner/cost/data-classification.
5. Thiết kế private DB/Redis, controlled egress và least-privilege service identity.
6. Thiết lập backup, PITR, retention, encryption và cross-account/region strategy theo RPO/RTO.
7. Thiết lập autoscaling/resource requests/limits và graceful shutdown.

### 26.4 CI pipeline

1. Checkout/restore dependency cache có checksum.
2. Secret/license/dependency scan.
3. Format check, lint, typecheck và build.
4. Unit/integration/contract tests với ephemeral services.
5. Prisma validate/fresh migrate/seed test.
6. Build immutable image/artifact, attach commit/version/SBOM.
7. Push registry và deploy development/staging bằng artifact đó.
8. Run migration rehearsal, smoke/e2e/performance subset.
9. Approval/gate production; promote cùng digest.
10. Post-deploy smoke/SLI check và auto-pause/rollback khi phù hợp.

### 26.5 Observability steps

1. Chuẩn hóa service/environment/version/request/user-pseudonymous correlation attributes.
2. Instrument inbound/outbound HTTP, DB, Redis, queue, storage và AI provider.
3. Tạo SLI: availability, latency, error, exam correctness, event freshness và queue delay.
4. Chốt SLO/error budget cho user-facing capability.
5. Tạo dashboard theo user journey và dependency.
6. Alert theo burn rate/user impact; mỗi alert có owner/runbook.
7. Thiết lập log/trace retention, sampling và PII redaction.

### 26.6 Artifact

- Docker/IaC/CI source và environment manifests.
- SBOM/scan/attestation và release artifact registry.
- SLO/SLI/dashboard/alert/runbook.
- Backup/restore, scaling và cost-allocation configuration.

### 26.7 Kiểm thử/kiểm tra

- Infrastructure plan/security/drift.
- Container shutdown/readiness/resource/secret behavior.
- Pipeline failure/rollback và credential scope.
- Staging parity/migration/release rehearsal.
- Alert fire/runbook và telemetry correlation.

### 26.8 Exit criteria

- Không có production change cần thao tác console bí mật ngoài break-glass.
- Artifact build một lần và promote qua môi trường.
- SLO có telemetry/dashboard/alert/runbook.
- Backup/restore và rollback đã được diễn tập.

---

## 27. Phase 20 — Production Readiness và Go-Live

### 27.1 Mục tiêu

Đưa release candidate vào production với blast radius kiểm soát, dữ liệu an toàn và tổ chức sẵn sàng hỗ trợ.

### 27.2 Công nghệ/công cụ

- Release manifest từ CI/artifact registry.
- Feature flag/remote config có owner/expiry.
- Canary/phased/blue-green/rolling deployment theo platform.
- Dashboard/alert/status page và incident communication channel.
- Database backup/PITR và migration runbook.

### 27.3 Checklist readiness theo workstream

#### Product/content

- P0 scope/known limitations/release notes được duyệt.
- Published content coverage/quality/license/provenance đạt gate.
- Pricing/terms/support message đúng nếu có payment.

#### Engineering/data

- Code freeze hoặc change-control window phù hợp.
- Migration/backfill/reconciliation/rollback đã rehearsal.
- Seed/config/feature flag và provider quota đúng production.
- Performance/capacity/load target đạt.

#### Security/privacy/legal

- Threat/penetration findings critical/high đã xử lý.
- Terms/privacy/cookie/consent/data export/delete hoạt động.
- Secret/IAM/DPA/subprocessor/license inventory được duyệt.
- Incident/breach escalation và evidence handling sẵn sàng.

#### Operations/support

- Dashboard/alert/on-call/runbook/status communication.
- Support ticket taxonomy/macros/escalation và request ID lookup.
- Backup/restore/DR contact và provider support path.
- Business owner và technical rollback authority online trong window.

### 27.4 Go-live steps

1. Chốt go/no-go bằng evidence; ghi waiver và người chấp thuận.
2. Freeze release manifest: commit, image digest, migration, config, content batch và flags.
3. Tạo/verify backup và pre-migration health/invariant.
4. Deploy migration theo expand-safe order.
5. Deploy services cùng artifact đã promote.
6. Chạy technical smoke: health/auth/database/cache/storage/queue/AI/provider.
7. Chạy business smoke: register/login/lesson/dictionary/review/exam/admin publish.
8. Mở canary/internal cohort; theo dõi SLI/business/support.
9. Mở rộng rollout theo checkpoint; pause khi vượt trigger.
10. Xác nhận post-deploy, gửi release communication và bắt đầu hypercare.

### 27.5 Rollback/forward-fix rule

- Code/config/flag: rollback về artifact/config đã biết tốt.
- Database: ưu tiên forward-fix sau expand migration; không rollback destructive SQL mù quáng.
- Content: rollback batch/revision/publish state.
- AI model/prompt/index: chuyển active version hoặc kill switch.
- Payment: không xóa event; sửa bằng compensating workflow và reconciliation.

### 27.6 Artifact

- Release manifest, signed-off readiness checklist và go/no-go record.
- Migration/content/config/feature-flag plan và execution timeline.
- Backup verification, smoke evidence và rollout dashboard snapshot.
- Rollback/forward-fix decision tree, support brief và release notes.

### 27.7 Kiểm thử/kiểm tra

- Staging rehearsal dùng cùng artifact/migration/config shape.
- Technical và business smoke trước/sau deploy.
- Canary checkpoint theo SLI, business metric, data invariant và support signal.
- Rollback/kill-switch exercise cho code, content và AI version phù hợp.

### 27.8 Exit criteria

- Smoke/business invariant pass.
- SLI/error/business metric nằm trong guardrail qua observation window.
- Support/on-call không có blocker chưa xử lý.
- Release manifest/timeline/decision được lưu để audit.

---

## 28. Phase 21 — Production Operations, SRE và Continuous Improvement

### 28.1 Mục tiêu

Duy trì hệ thống sau go-live: đáp ứng SLO, xử lý sự cố, phục hồi dữ liệu, hỗ trợ người dùng, kiểm soát chi phí và cải tiến dựa trên bằng chứng.

### 28.2 Công nghệ/công cụ

- OpenTelemetry/APM, Prometheus/Grafana, logs/traces/error tracking.
- Incident management/on-call và status page.
- PostgreSQL monitoring/PITR/restore tooling.
- Cloud cost explorer/budget/anomaly alerts.
- Support/ticket system và product analytics/BI.
- Feature flags/canary cho safe iteration.

### 28.3 Daily operations

- Review availability/latency/error/queue/DB/storage/provider/AI cost.
- Triage incident, content issue, payment discrepancy và support high-severity.
- Kiểm tra failed job/dead-letter/import/notification/webhook.
- Kiểm tra backup success nhưng không coi đó là restore proof.

### 28.4 Weekly operations

- SLO/error-budget và top slow/error endpoints.
- Data quality/event freshness/dashboard reconciliation.
- Content publishing/quality/support trends.
- Security vulnerability/dependency/secret/IAM findings.
- Cost by service/environment/feature và anomaly.
- Capacity, connection pool, queue lag và storage growth.

### 28.5 Monthly/quarterly operations

- Restore drill và incident/tabletop exercise theo lịch.
- Privacy retention/deletion audit và subprocessor/license review.
- Access review, secret/key rotation và backup permission review.
- Dependency/Node/PostgreSQL/provider lifecycle review.
- Load/capacity test trước peak hoặc campaign.
- Product outcome/retention/learning-quality review.
- Technical debt, stale flag và documentation freshness review.

### 28.6 Incident response

1. Detect và phân severity theo user/data/revenue/safety impact.
2. Chỉ định incident commander, operations, communication và scribe.
3. Giảm impact: disable flag, rollback, rate limit, isolate hoặc failover.
4. Bảo toàn evidence/log/timeline; không sửa dữ liệu bừa để “hết alert”.
5. Khôi phục và xác minh business invariant.
6. Communicate status trung thực theo cadence.
7. Postmortem blameless: root/contributing factors, detection/recovery gap.
8. Action có owner/date/test; verify trước đóng.

### 28.7 Backup, DR và Business Continuity

- Phân tier dữ liệu/service; chốt RPO/RTO thực tế.
- Backup encrypted, immutable/independent khi phù hợp; access tối thiểu.
- Restore vào môi trường cô lập, chạy migration/app/business verification.
- Kịch bản: DB corruption, region/provider outage, credential compromise, object loss, queue replay và AI provider outage.
- Manual workaround cho learning/support/payment critical nếu service gián đoạn.
- Contact tree, authority, status communication và alternate provider path.

### 28.8 Continuous improvement

1. So sánh metric với hypothesis/baseline.
2. Phân tích funnel/cohort và qualitative feedback.
3. Ưu tiên experiment/debt/reliability theo outcome và cost of delay.
4. Release nhỏ qua flag/canary; đo guardrail.
5. Xóa flag/code/path cũ sau experiment.
6. Cập nhật roadmap, ADR, runbook và context.

### 28.9 Artifact

- SLO/error-budget report, incident/postmortem và operational review.
- Backup/restore/DR drill evidence cùng remediation backlog.
- Capacity/cost/security/privacy/content review reports.
- Support/product feedback insights và continuous-improvement roadmap.

### 28.10 Kiểm thử/kiểm tra

- Alert/runbook/on-call drill và incident tabletop.
- Restore/PITR/application verification trong RPO/RTO.
- Failover/provider-outage/credential-compromise scenarios theo risk.
- Data retention/deletion, access review và vulnerability remediation audit.

### 28.11 Exit criteria

Production operations không có “kết thúc” cố định. Hệ thống được coi là vận hành trưởng thành khi:

- SLO/error budget được quản lý và dẫn tới quyết định.
- MTTR, change failure và defect escape có xu hướng kiểm soát.
- Restore drill đạt RPO/RTO.
- Security/privacy/content/license review diễn ra theo lịch.
- Support/product feedback tạo action và đóng vòng bằng evidence.
- Chi phí có owner, budget và unit metric.

---

## 29. Thứ tự dependency và kế hoạch phát hành theo wave

### 29.1 Dependency bắt buộc

```text
Product decisions + HSK/license
        |
        +--> UX flows/state/content model
        |
        +--> Domain/Architecture/Threat model
                 |
                 +--> Schema + migration + seed/content pipeline
                 |        |
                 |        +--> CMS/Dictionary
                 |        +--> Learning/Progress/SRS
                 |        +--> Exam snapshot/attempt
                 |
                 +--> API contracts + platform/auth
                          |
                          +--> Web user vertical slices
                          +--> Admin vertical slices
                          +--> Analytics/operations
                                   |
                                   +--> Production hardening/go-live
                                   +--> P1 Reader/Speech/Engagement
                                   +--> P2 AI/Payment/Mobile/Hanzi
```

AI, payment và mobile không được dùng để trì hoãn Web MVP P0. Chúng chỉ bắt đầu khi boundary/data/operational prerequisites của từng phase đạt gate.

### 29.2 Wave triển khai đề xuất

Thời gian dưới đây là khung planning, không phải cam kết. Phải re-estimate sau discovery, team sizing và technical spikes.

| Wave | Phạm vi | Kết quả phát hành | Ước lượng định hướng |
|---|---|---|---|
| 0 | Phase 0–3 | Product/UX/architecture baseline và quyết định critical | 2–4 tuần |
| 1 | Phase 4–8 | Toolchain, schema P0, content pipeline, auth, CMS/dictionary | 4–6 tuần |
| 2 | Phase 9–10 | Learning/progress/SRS và exam engine | 4–6 tuần |
| 3 | Phase 11–13 | Web user, admin, analytics/support P0 | 4–6 tuần |
| 4 | Phase 18–20 | Hardening, infra, staging và Web MVP go-live | 3–5 tuần |
| 5 | Phase 14 | Reader, pronunciation, engagement P1 | 4–8 tuần |
| 6 | Phase 15–17 | AI, payment, mobile/offline và Hanzi P2 | Chia thành nhiều release 8–20+ tuần |

Với đội nhỏ, tổng thời gian tăng do content, design, backend, frontend và operations phụ thuộc cùng người. Full P0+P1+P2 không nên bị ép vào một mốc 12–14 tuần nếu chưa giảm phạm vi hoặc tăng đội/ngân sách.

### 29.3 Milestone P0 gợi ý

| Milestone | Demo bắt buộc | Exit signal |
|---|---|---|
| M0 — Baseline | Repo bootstrap/build/test/migrate | G0–G2 đạt |
| M1 — Content Ready | Admin import/review/publish + dictionary search | Data/license/content gates đạt |
| M2 — Learn Ready | User học activity và progress/SRS cập nhật | Learning E2E + analytics pass |
| M3 — Exam Ready | Start/autosave/resume/submit/result | Snapshot/integrity/load pass |
| M4 — Web MVP | User/admin P0 trên staging | Accessibility/performance/security pass |
| M5 — Production | Canary/go-live/support/restore | G6–G7 đạt |

---

## 30. Team tối thiểu và mô hình trách nhiệm

### 30.1 Team tối thiểu thực tế

| Vai trò | Số lượng tham khảo | Trách nhiệm |
|---|---:|---|
| Product Owner/PM | 1 | Outcome, scope, decision, roadmap và stakeholder |
| Tech Lead/Architect | 1 | Boundary, ADR, quality/security/release review |
| Backend Engineer | 1–2 | Core domains, API, schema, jobs và integration |
| Frontend Engineer | 1–2 | Web user/admin, accessibility và performance |
| UX/UI Designer | 1 | Research, flow, prototype, design system và QA |
| Curriculum/Content Lead | 1 | HSK, sourcing, editorial/academic QA và CMS operation |
| QA/Automation | 1 | Strategy, automation, exploratory và release evidence |
| DevOps/SRE | 0.5–1 | CI/CD, IaC, observability, backup và incident readiness |
| Data/Analytics | 0.5–1 | Event/metric, data quality và dashboard |
| Legal/Privacy/Finance | Theo gate | License, data, terms, payment và sign-off |

Một người có thể kiêm nhiều vai trò ở giai đoạn đầu, nhưng quyền phê duyệt product, legal/security risk và go-live phải được ghi rõ; không giả định “mọi người đều chịu trách nhiệm”.

### 30.2 RACI rút gọn

| Quyết định/công việc | A | R | C | I |
|---|---|---|---|---|
| Product scope/P0 | Product Owner | PM/Lead | Design, Tech, Content | Team |
| HSK curriculum/content quality | Content Lead | Editors | Product, Data | Tech/QA |
| Architecture/ADR | Tech Lead | Engineers | Security, DevOps, Data | Product |
| Schema/migration production | Tech Lead | Backend/DB owner | DevOps, QA | Product/Support |
| UX/accessibility | Design Lead | Design/Frontend | QA, Product | Team |
| Security/privacy risk | Security/Privacy owner | Engineering | Legal, Product | Leadership |
| Production go-live | Release owner | DevOps/Engineering | Product, QA, Support | Stakeholders |
| Payment/legal terms | Business/Legal owner | Product/Engineering | Finance, Support | Team |
| Incident | Incident Commander | On-call responders | Product/Support/Security | Stakeholders |

---

## 31. Chuẩn backlog và work package

### 31.1 Mỗi epic phải có

- Problem/outcome và persona.
- Scope/out-of-scope và priority.
- Requirement/acceptance criteria.
- UX flow/state và content dependency.
- Domain/API/schema/event/analytics impact.
- Security/privacy/accessibility/NFR.
- Rollout/feature flag/migration/rollback.
- Owner, dependency, estimate/confidence và risk.

### 31.2 Mỗi implementation task phải có

- Kết quả cụ thể, không chỉ “làm backend” hoặc “làm UI”.
- File/module/interface dự kiến bị ảnh hưởng.
- Test/evidence cần bổ sung.
- Definition of Done và reviewer/owner.
- Dependency/blocker và dữ liệu/fixture cần thiết.

### 31.3 Vertical-slice template

```text
Capability: <tên capability>
User outcome: <kết quả quan sát được>
API/contract: <endpoint/event/error>
Data: <model/migration/index/retention>
UI states: <loading/empty/error/permission/offline>
Security/privacy: <policy/data class/consent>
Analytics: <event/metric>
Tests: <unit/integration/contract/e2e/performance/security/a11y>
Operations: <log/metric/alert/runbook>
Rollout: <flag/cohort/migration/rollback>
Done: <exit criteria>
```

---

## 32. Definition of Ready và Definition of Done

### 32.1 Definition of Ready cho feature

- [ ] Problem/persona/outcome và priority được chốt.
- [ ] Acceptance criteria và edge/error/permission paths rõ.
- [ ] Design/state/content đã review hoặc feature không cần UI.
- [ ] API/schema/domain impact và data owner rõ.
- [ ] Security/privacy/accessibility/NFR được đánh giá.
- [ ] Dependency/fixture/environment/owner có sẵn.
- [ ] Analytics/rollout/rollback được xác định.
- [ ] Không còn decision blocker chưa có owner/date.

### 32.2 Definition of Done cho code

- [ ] Code đúng boundary/convention, không còn debug/dead code/secret.
- [ ] Format/lint/typecheck/build pass.
- [ ] Unit/integration/contract/e2e theo risk pass.
- [ ] Migration/seed/backfill/reconciliation pass nếu liên quan.
- [ ] Authz/security/privacy/a11y/error states được test.
- [ ] OpenAPI/docs/context/runbook cập nhật.
- [ ] Logs/metrics/traces/audit không lộ PII và đủ điều tra.
- [ ] Feature flag/rollout/rollback/cleanup owner rõ.
- [ ] Staging design/QA/product acceptance pass.

### 32.3 Definition of Done cho release

- [ ] Release manifest và artifact digest cố định.
- [ ] Quality/security/privacy/content/legal gates đạt.
- [ ] Migration/content batch/config rehearsal pass.
- [ ] Dashboard/alert/runbook/on-call/support ready.
- [ ] Backup/rollback/kill switch được xác minh.
- [ ] Go/no-go có người phê duyệt.
- [ ] Post-deploy smoke/SLI/business check pass.
- [ ] Release note/known issues/decision timeline được lưu.

---

## 33. Ma trận kiểm thử theo module

| Module | Unit | Integration | Contract | E2E | Performance | Security/A11y |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Auth/session/RBAC | Có | DB/token | API | login/revoke/role | brute/rate | authz/session/privacy |
| CMS/import/media | parser/rule | DB/storage/queue | API/job | import-publish | large batch | upload/admin/a11y |
| Dictionary | normalize/search rule | DB/index | API | search-save | full dataset | injection/data/license |
| Learning/activity | scoring/completion | DB/event | API | lesson flow | concurrent attempts | owner/content/accessibility |
| SRS | scheduler vectors | DB/time | API | review flow | due queue | privacy/timezone |
| Exam | scoring/state | DB/snapshot | API | complete exam | submit concurrency/soak | answer leak/authz/timer |
| Analytics | schema/metric | event pipeline | event | funnel smoke | volume/freshness | consent/PII |
| Notification | template/schedule | queue/provider | webhook | preference-delivery | throughput/retry | unsubscribe/data |
| AI/RAG | retrieval/prompt guards | vector/provider | gateway API | chat/citation | latency/cost/load | injection/leak/safety |
| Payment | entitlement/state | provider/webhook | webhook/API | checkout-manage | event spikes | signature/tamper/PII |
| Mobile/offline | reducer/sync | SQLite/API | API | offline-reconnect | sync volume | secure storage/a11y |

---

## 34. Security, Privacy và Compliance master checklist

### 34.1 Identity và access

- [ ] Password hashing Argon2id và pepper/key management.
- [ ] Access/refresh/session lifecycle, revoke và rotation.
- [ ] RBAC/policy/ownership deny-by-default.
- [ ] Admin high-risk action có audit/reason/step-up nếu cần.
- [ ] Service-to-service identity và least privilege.

### 34.2 Application/API

- [ ] Input/schema/size/content-type validation.
- [ ] CORS/CSRF/cookie/security headers/CSP theo architecture.
- [ ] Rate limit/WAF/bot/abuse controls.
- [ ] Error không lộ stack/secret/internal data.
- [ ] Idempotency/concurrency cho write quan trọng.

### 34.3 Data

- [ ] Data classification, owner, purpose, region và retention.
- [ ] Encryption transit/at rest và key/secret rotation.
- [ ] Export/delete/anonymize/consent được test.
- [ ] Backup access/retention/restore isolation.
- [ ] Logs/analytics không lộ PII/token/answer/audio/chat trái policy.

### 34.4 Content/license

- [ ] Source/version/hash/license/attribution/reviewer.
- [ ] Quyền commercial/modification/distribution.
- [ ] Audio/speaker/recording consent và retention.
- [ ] Không coi public internet content là tự do sử dụng.
- [ ] AI-assisted content có human review và provenance.

### 34.5 Provider/supply chain

- [ ] DPA/subprocessor/region/deletion/export review.
- [ ] Dependency/SBOM/license/vulnerability scan.
- [ ] Image/IaC/secret scan và signed artifact khi áp dụng.
- [ ] Webhook signature và provider credential scope.
- [ ] Provider outage/quota/exit strategy.

### 34.6 AI/payment/mobile specific

- [ ] AI permission filter không giao cho model.
- [ ] Prompt injection/data leakage/red-team/evaluation.
- [ ] Payment không lưu card, webhook idempotent/reconcile.
- [ ] Mobile secure storage, permission và compromised-device review.
- [ ] Store privacy/subscription disclosure được phê duyệt.

---

## 35. Observability catalog tối thiểu

### 35.1 Technical signals

- HTTP request count/latency/error/status theo service/route.
- Database query latency/error/connection/lock/storage.
- Redis hit/miss/latency/memory/eviction.
- Queue enqueue/process/retry/fail/dead-letter/lag.
- Storage upload/download/error/orphan/scan.
- Provider latency/error/rate-limit/quota.
- Deployment version, restart, CPU, memory và saturation.

### 35.2 Business/correctness signals

- Register/login success/failure/lockout.
- Lesson start/complete/activity correctness/progress failure.
- Review due/complete/lapse/overdue và scheduler error.
- Exam start/autosave/submit/timeout/result/regrade; submit-success là critical SLI.
- Content import/publish/reject/rollback và data-quality blocker.
- Notification sent/delivered/read/bounce/unsubscribe.
- Payment checkout/webhook/subscription/entitlement/reconcile delta.
- AI retrieval/answer/citation/feedback/latency/token/cost/safety.

### 35.3 Log fields tối thiểu

- Timestamp UTC, level, service, environment, version.
- Request/trace/span ID.
- Route/use case và result/error code.
- Pseudonymous user ID khi policy cho phép; không log email/token/raw answer tùy tiện.
- Resource/attempt/job/event ID cần điều tra.
- Duration/retry/provider/version và structured context.

### 35.4 Alert rule

Chỉ alert khi có hành động cụ thể. Mỗi alert phải có severity, threshold/window, owner, runbook, dashboard link, silence/escalation và test. Ưu tiên burn-rate/user-impact thay vì cảnh báo mọi spike kỹ thuật.

---

## 36. Cost và capacity management

### 36.1 Cost centers

- Compute/container/serverless.
- PostgreSQL storage/IO/backup/replica.
- Redis/cache/queue.
- Object storage/CDN/egress/media processing.
- Logs/metrics/traces/error tracking.
- Email/push/SMS nếu có.
- AI LLM/embedding/reranking/speech.
- Payment fee/refund/dispute.
- Content creation/license/review/support.

### 36.2 Unit metrics

- Cost per monthly active learner.
- Cost per completed lesson/exam.
- Storage/egress per active learner.
- AI cost per answer/active AI user.
- Speech cost per scored minute.
- Content cost per approved lesson/question/word.
- Support cost per ticket/active learner.

### 36.3 Quy trình

1. Tag resource theo service/environment/owner.
2. Đặt budget/anomaly alert và forecast.
3. Đo cost theo capability trước tối ưu.
4. Tối ưu query/cache/batch/compression/retention/sampling.
5. Đặt AI quota/cache/model routing khi quality vẫn đạt.
6. Không hy sinh backup/security/SLO để giảm chi phí không có phân tích.

---

## 37. Lệnh và quality checks chuẩn

Các lệnh dưới đây phản ánh backend hiện tại hoặc mục tiêu sau khi frontend/AI được khởi tạo. Phải giữ scripts trong manifest làm interface chính; CI không nên chứa logic khác hoàn toàn local.

### 37.1 Backend hiện tại

```bash
cd backend
npm ci
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run build
npm run test
npm run test:e2e
```

Lệnh `lint` hiện dùng `--fix`; CI nên bổ sung script check không sửa file, ví dụ `lint:check`, và script `format:check` dùng Prettier `--check`.

### 37.2 Database development

```bash
cd backend
npx prisma migrate dev --name <capability-name>
npx prisma validate
npx prisma generate
```

Không chạy `migrate dev` trên staging/production. Production dùng migration đã review qua `migrate deploy` và runbook.

### 37.3 Frontend mục tiêu

```bash
cd frontend
<package-manager> install --frozen-lockfile
<package-manager> run lint
<package-manager> run typecheck
<package-manager> run test
<package-manager> run build
<package-manager> run test:e2e
```

### 37.4 AI mục tiêu

Nếu chọn Python/FastAPI, pin dependency bằng công cụ được ADR chốt và cung cấp scripts tương đương:

```bash
<env-runner> lint
<env-runner> typecheck
<env-runner> test
<env-runner> migrate
<env-runner> start
```

Không hard-code một package manager Python trong tài liệu trước ADR; yêu cầu bắt buộc là lockfile, reproducible environment, lint/type/test/migrate/start interface và vulnerability scan.

### 37.5 CI required checks

- Format check.
- Lint và typecheck.
- Build.
- Unit/integration/contract tests.
- Prisma validate + fresh migration + seed smoke.
- Secret/dependency/license/container/IaC scan theo scope.
- OpenAPI diff và documentation link check.
- E2E/smoke trên artifact/staging theo branch/release gate.

---

## 38. Documentation artifacts và quy tắc đồng bộ

| Artifact | Nguồn/đường dẫn | Khi cập nhật |
|---|---|---|
| Project context | `docs/PROJECT_CONTEXT_FOR_AI.md` | Khi trạng thái/stack/boundary đổi |
| Functional hierarchy | `docs/FUNCTIONAL_HIERARCHY.md` | Khi thêm/đổi module/priority/role |
| Product master plan | File hiện tại | Khi sequence/stack/gate/production model đổi |
| API contract | `docs/api.md` + OpenAPI runtime | Khi endpoint/DTO/error/auth đổi |
| Schema plan | `docs/DATABASE_SCHEMA_COMPLETION_PLAN.md` | Khi capability/model/migration order đổi |
| Roadmap | `docs/roadmap.md` | Khi outcome/milestone/priority đổi |
| ADR | `docs/adr/` khi được tạo | Mọi quyết định khó đảo ngược |
| Runbooks | `docs/runbooks/` khi được tạo | Mỗi alert/operation/recovery critical |
| Process | `docs/implementation-process/` | Khi workflow/gate thay đổi |
| Reports | `docs/reports/` | Sau khi hoàn thiện/đánh giá từng nhóm |

Quy tắc: code/schema/runtime là bằng chứng cho trạng thái “đã có”; roadmap/mockup chỉ thể hiện mục tiêu. Một PR làm đổi contract/schema/operation phải cập nhật tài liệu liên quan trong cùng change.

---

## 39. Master Production Acceptance Checklist

### 39.1 Product và UX

- [ ] P0 scope/outcome/metric/owner được duyệt.
- [ ] Guest/user/admin flows và mọi state được triển khai.
- [ ] Usability, responsive, localization và accessibility đạt gate.
- [ ] Known limitations và support messaging rõ.

### 39.2 Content/curriculum/data

- [ ] HSK 1–9/version/coverage và objective map đã chốt.
- [ ] Content/dictionary/media có source/license/version/reviewer.
- [ ] Import/seed/reconciliation/rollback được kiểm thử.
- [ ] Data quality blocker bằng 0.
- [ ] Retention/export/delete/anonymize hoạt động.

### 39.3 Backend/API/schema

- [ ] Auth/session/RBAC/audit/rate limit P0 hoàn chỉnh.
- [ ] CMS/dictionary/learning/SRS/exam vertical slices pass.
- [ ] OpenAPI/client/docs đồng bộ runtime.
- [ ] Migration fresh DB và representative DB pass.
- [ ] Exam/content/history/payment invariant được bảo toàn.

### 39.4 Frontend/admin/mobile

- [ ] Web user/admin E2E P0 pass API thật.
- [ ] Loading/empty/error/permission/offline state đầy đủ.
- [ ] Performance/a11y/error monitoring đạt target.
- [ ] Nếu mobile: secure storage/sync/store release/rollback pass.

### 39.5 AI/payment nếu nằm trong release

- [ ] AI evaluation/citation/permission/safety/cost/kill switch đạt gate.
- [ ] Payment terms/webhook/idempotency/entitlement/reconcile/refund đạt gate.
- [ ] Provider quota/outage/fallback và DPA/privacy đã review.

### 39.6 Quality/security

- [ ] Risk-requirement-test traceability đầy đủ.
- [ ] Unit/integration/contract/e2e/performance/security/a11y pass.
- [ ] Không còn critical/high defect chưa được xử lý hoặc accept đúng thẩm quyền.
- [ ] SBOM/dependency/license/secret/container/IaC scan đạt policy.

### 39.7 Infrastructure/operations

- [ ] Immutable artifact, CI/CD, IaC và environment parity.
- [ ] SLO/SLI/dashboard/alert/runbook/on-call sẵn sàng.
- [ ] Backup/PITR/restore/DR đạt RPO/RTO thực đo.
- [ ] Release manifest/migration/rollback/canary rehearsal pass.
- [ ] Support/status/incident/privacy communication ready.
- [ ] Cost/budget/anomaly/unit metrics có owner.

### 39.8 Go-live closure

- [ ] Go/no-go có đủ sign-off.
- [ ] Production smoke và business invariant pass.
- [ ] Observation window ổn định trước full rollout.
- [ ] Release note/known issue/timeline/evidence được lưu.
- [ ] Post-release review và action có owner/date.

---

## 40. Việc cần làm ngay với repository hiện tại

### Tuần làm việc kế tiếp — không mở rộng phạm vi

1. Chốt ADR cho frontend framework/package manager và AI runtime; frontend/AI hiện đang là file rỗng.
2. Chạy lại backend baseline: install, Prisma validate/generate, build, unit/e2e và fresh migration.
3. Chốt HSK 7/8/9, nguồn/license và quy trình QA nghĩa tiếng Việt/audio/example.
4. Chuyển [DATABASE_SCHEMA_COMPLETION_PLAN.md](./DATABASE_SCHEMA_COMPLETION_PLAN.md) thành migration backlog theo capability; chưa tạo tất cả migration một lần.
5. Ưu tiên schema/API P0: profile/onboarding/privacy → CMS/import/audit → learning/SRS → exam attempt/snapshot.
6. Khởi tạo frontend runtime tối thiểu và kết nối health/auth/levels bằng typed contract.
7. Tạo CI baseline cho backend trước khi tăng số module.
8. Tạo Docker Compose local cho PostgreSQL; thêm Redis/storage chỉ khi capability bắt đầu dùng.
9. Tạo OpenAPI runtime và contract diff gate.
10. Chọn staging/production provider bằng ADR dựa trên region, DPA, managed services, cost và năng lực vận hành.

### Thứ tự feature đầu tiên

1. **Content readiness:** CMS Lite + import + provenance/license + dictionary detail.
2. **Learning readiness:** activity attempt + progress + SRS.
3. **Exam readiness:** attempt + autosave + snapshot + scoring/result.
4. **Web readiness:** user/admin end-to-end, analytics P0 và accessibility.
5. **Production readiness:** CI/CD + staging + observability + backup/restore + support.
6. **Sau MVP:** reader/pronunciation → AI/payment/mobile theo evidence và gate.

---

## 41. Definition of Product Complete

“Product hoàn thiện” không có nghĩa chỉ đủ màn hình hoặc endpoint. HSK System chỉ được coi là hoàn thiện cho phạm vi đã cam kết khi:

1. Người học hoàn thành toàn bộ learning loop và exam flow trên production ổn định.
2. Admin vận hành content/user/exam/support không cần can thiệp database thủ công.
3. Nội dung có curriculum mapping, source, license, version, review và rollback.
4. API/schema/UI/analytics/test/documentation không mâu thuẫn.
5. Dữ liệu có owner, integrity, lifecycle, retention, export/delete và backup/restore.
6. Security/privacy/accessibility/performance đạt các gate đã duyệt.
7. Deployment lặp lại bằng immutable artifact/IaC, có monitoring/alert/runbook/rollback.
8. Support/incident/DR/business continuity đã được diễn tập.
9. Outcome sản phẩm được đo, cost có owner và roadmap cải tiến dựa trên bằng chứng.
10. Mọi capability P1/P2 chưa triển khai được ghi rõ là deferred, không bị mô tả như đã hoàn thành.

Tài liệu này phải được coi là tài liệu sống: cập nhật sau mỗi ADR, milestone, schema/API change, production incident hoặc thay đổi phạm vi sản phẩm quan trọng.
