# ADR-008: Chốt công nghệ cho các hạng mục còn bỏ ngỏ

Status: Proposed — chờ Product Owner/Tech Lead duyệt. Ngày: 04/09/2026. Baseline: branch macdev, HEAD 3211bf8.

## Context

Review ngày 04/09/2026 cho thấy lõi web đã được chốt bằng code và ADR-003/ADR-005
(NestJS 11, Prisma 5, PostgreSQL, Next.js 16 App Router, CSS variables, Zod,
Vitest, Playwright, S3-compatible storage, ClamAV). Tuy nhiên
`docs/archive/PRODUCT_IMPLEMENTATION_MASTER_PLAN.md` §4, `PROJECT_CONTEXT_FOR_AI.md`
(nay đã gộp vào `docs/architecture/overview.md`) và `docs/README.md` cũ nói ba kiểu khác nhau về Redis, Cloudinary, Tailwind,
AI runtime, mobile, error tracking, IaC và analytics. Không có chính sách pin phiên
bản chung: backend dùng caret, frontend pin exact, TypeScript 5.9 và 6.0 lệch
nhau, Node không có `.nvmrc`.

Bằng chứng dùng để quyết định:

- Toàn bộ mã nguồn là TypeScript; không có Python trong repo.
- Port `ObjectStoragePort` và `MediaMalwareScannerPort` đã tách provider; endpoint
  S3 cấu hình được.
- `.env.example` dùng `ap-southeast-1`; `UserProfile.timezone` mặc định
  `Asia/Ho_Chi_Minh`; người dùng mục tiêu ở Việt Nam.
- Roadmap §3.2 và §6 M7+: Redis/queue, CDN, service extraction chỉ thêm khi có
  bằng chứng tải; AI/RAG và mobile là P2.
- Mẫu rate limit Postgres `MediaUploadRateLimit` (INSERT ... ON CONFLICT) đã
  chứng minh được trong e2e.

## Decision

### 1. Mobile (quyết định của Product Owner)

- **React Native + Expo + TypeScript.** Expo Router, `expo-secure-store` cho
  token, `expo-sqlite` cho offline (P2), Expo Updates cho OTA không chứa native
  breaking change. E2E: Maestro. Flutter loại bỏ.
- Hệ quả: khi tạo package mobile, chuyển sang **npm workspaces** (giữ npm, không
  Turborepo, đúng ADR-003) và tách `packages/contracts` chứa Zod schema dùng chung
  cho web, BFF và mobile. Trước thời điểm đó giữ lockfile riêng từng service.

### 2. Cache và queue: PostgreSQL trước, Redis hoãn có điều kiện

- **Không cài Redis/BullMQ trong Web MVP (M1–M4).**
- Rate limit: nginx/WAF `limit_req` theo IP cho lưu lượng ẩn danh; trong ứng dụng
  đếm theo `userId` bằng bảng Postgres theo mẫu `MediaUploadRateLimit`.
  ThrottlerGuard toàn cục theo `req.ip` hiện tại phải được thay vì không sống sót
  sau proxy/BFF (review A-02).
- Background job (privacy export/delete, import lớn, email): **pg-boss** trên
  chính PostgreSQL (SKIP LOCKED, retry, schedule). Chỉ thêm khi M1 cần worker.
- Điều kiện xem lại Redis: hơn 2 replica backend có tranh chấp ghi trên bảng rate
  limit đo được, hoặc cần pub/sub thời gian thực, hoặc job throughput vượt ngưỡng
  pg-boss đã benchmark.

### 3. Styling và UI primitives

- **Giữ CSS variables theo ADR-003. Không thêm Tailwind.** Master plan §4.2 sửa
  lại theo ADR-003; hai hệ styling song song bị cấm.
- Primitives: **native HTML trước** (`<dialog>`, `<details>`, Popover API,
  `<select>`). Khi learner UI cần tương tác composite (arrange_sentence kéo thả,
  combobox tra từ, listbox flashcard, tabs có roving focus) thì dùng **React
  Aria Components**, bọc trong `components/ui`, một thư viện duy nhất. Radix
  không dùng. Lý do: không mang opinion styling, có i18n/locale sẵn cho vi/zh,
  ngữ nghĩa bàn phím và screen reader đầy đủ theo yêu cầu WCAG của DESIGN.md.

### 4. Client state, form và data fetching

- **Không cài TanStack Query, Zustand, React Hook Form.**
- Server state: Server Components + `revalidatePath`/`router.refresh`; mutation
  qua route handler BFF có kiểm Origin như hiện tại, hoặc Server Actions khi
  cùng ràng buộc Origin.
- Form: `<form>` native + `useActionState` (React 19) + Zod hai phía.
- State cục bộ của activity player/exam: `useReducer` trong feature.
- Xem lại tại M4 nếu exam autosave/resume cần cache và optimistic update mà
  `useReducer` không đủ.

### 5. API contract: OpenAPI sinh từ code

- Cài `@nestjs/swagger` (plugin CLI để suy DTO), xuất `openapi.json` trong CI
  như artifact. `docs/api/api.md` Part B là danh sách "dự kiến" và trỏ tới spec sinh.
- Frontend: `openapi-typescript` sinh type; Zod contract giữ nguyên vai trò
  validate tại trust boundary; thêm check CI để type suy từ Zod khớp type sinh.
- Không sinh fetch client; allowlist path trong `backend-client.ts` là chủ ý
  bảo mật (ADR-003).
- Điều kiện tiên quyết: chốt một envelope response toàn cục (review A-03) trước
  khi publish spec.

### 6. AI/RAG runtime: TypeScript, service riêng, pgvector, provider adapter

- **NestJS + TypeScript** trong `ai/services/rag-api`, dùng chung eslint/prettier/
  jest và CI với backend. Python/FastAPI loại bỏ vì đội không có Python và AI là
  P2.
- Database AI tách riêng: **PostgreSQL + pgvector**, không dùng core DB.
- LLM/embedding qua **provider adapter** với ít nhất hai provider ngay từ đầu.
  Provider đầu tiên chọn tại M7 bằng golden eval, DPA, chi phí và khả năng
  không lưu dữ liệu; không chốt tên provider trong ADR này vì chưa có ba bằng
  chứng đó.
- Không dùng LangChain/LlamaIndex định nghĩa domain; chỉ dùng thành phần tiện
  ích nếu có giới hạn rõ.
- Xóa bốn file 0 byte trong `ai/` cho tới khi M7 bắt đầu.

### 7. Observability, error tracking và logging

- Instrumentation trong ứng dụng bằng **OpenTelemetry SDK** (vendor-neutral).
- Error tracking: **Sentry** (managed), tách environment/release, `beforeSend`
  scrub PII, không gửi body request. Trace xuất qua OTLP sang Sentry giai đoạn
  beta; chuyển Tempo/managed APM khi cần.
- Logs: **pino** (`nestjs-pino`) JSON có `requestId`, echo `x-request-id` ra
  response; ship theo platform.
- Metrics: giữ Prometheus-compatible như ADR-006; runtime dùng managed
  Prometheus/Grafana của cloud (mục 8) thay vì tự vận hành.

### 8. Hosting, IaC, edge và secret

- **Điều kiện pháp lý bắt buộc trước khi mua hạ tầng:** xác nhận với pháp chế
  nghĩa vụ lưu trữ dữ liệu cá nhân trong nước theo Luật An ninh mạng 2018 Điều 26
  và Nghị định 53/2022 Điều 26, cùng Nghị định 13/2023. Nếu bắt buộc lưu trong
  nước, mọi lựa chọn dưới đây chuyển sang nhà cung cấp trong nước có S3-compatible
  storage, managed PostgreSQL và container runtime; kiến trúc port/adapter hiện
  có đủ để đổi mà không sửa domain.
- Mặc định khi không có ràng buộc trên: **AWS `ap-southeast-1`** (khớp
  `.env.example`), **ECS Fargate** cho backend, frontend (Next standalone) và
  ClamAV; **RDS PostgreSQL 16** có PITR; **S3** private bucket; **CloudFront +
  AWS WAF** trước cả Next.js và API (rate limit và bot control ở đây);
  **Secrets Manager** cấp secret qua task role, không phân phối `.env`; **SES**
  cho email; **Amazon Managed Prometheus + Managed Grafana** cho metrics.
- IaC: **Terraform**, remote state S3 + lock, plan review trong PR, drift check
  định kỳ. OpenTofu không chọn để giữ hệ sinh thái module/provider chuẩn.
- CI/CD: **GitHub Actions** với OIDC sang AWS, build-once/promote-many theo digest,
  SBOM bằng `anchore/sbom-action`, quét bằng `anchore/scan-action`, ký bằng cosign
  keyless, attest bằng `actions/attest-build-provenance`. Secret scanning: gitleaks
  action thay scanner tự viết.
- Kubernetes/EKS và Istio: **hoãn**. Manifest trong `ops/observability` giữ làm
  tài liệu tham chiếu. Điều kiện xem lại: hơn một team vận hành, hơn năm service,
  hoặc yêu cầu policy mạng cấp Istio có bằng chứng.

### 9. Email

- Port `MailerPort` theo mẫu `ObjectStoragePort`; adapter production **SES**,
  adapter dev **Mailpit** trong docker-compose; gửi qua pg-boss có idempotency.
  Template verify/reset dùng token đã có trong schema (`EmailVerificationToken`,
  `PasswordResetToken`).

### 10. Product analytics và BI

- **Không dùng analytics bên thứ ba trong MVP.** Sự kiện sản phẩm P0
  (activation, lesson completion) lấy từ bảng first-party đã có
  (`LearningEvent`, `Progress`) cộng bảng `ProductEvent` nhỏ có `consentVersion`.
- BI: **Metabase** self-hosted đọc replica/read-only role. Warehouse không thêm.
- PostHog xem lại khi cần funnel/session replay và consent UX đã có (M5).

### 11. Container và môi trường local

- Dockerfile multi-stage, non-root cho backend và frontend (Next `output:
  'standalone'`).
- `docker-compose.yml`: PostgreSQL 16, MinIO, ClamAV, Mailpit; profile `test`
  tạo DB tên đúng regex disposable và chạy `prisma migrate deploy` trong
  `pretest:e2e`.

### 12. Chính sách phiên bản và toolchain

- Node: **24 LTS**, pin trong `.nvmrc` và `engines` cả hai package; workflow dùng
  cùng giá trị. Node 26 chỉ chuyển khi thành LTS và CI xanh.
- Pin **exact** ở cả backend và frontend (`.npmrc` với `save-exact=true`); bỏ
  caret trong `backend/package.json` ở lần cập nhật lockfile kế tiếp.
- TypeScript: cả hai package về **6.x** trong M1, backend nâng sau khi `tsc`,
  jest và ts-jest xanh trong CI; cấm hai major song song sau M1.
- Prisma: giữ 5.22 hết M1; nâng Prisma 6 là task riêng sau khi CI và
  docker-compose tồn tại; Prisma 7 chưa xét.
- Renovate: PR nhóm theo tuần, auto-merge patch cho devDependencies khi CI xanh.
- Backend giữ Jest; không chuyển Vitest cho backend.

### 13. Giữ nguyên trạng thái hoãn (không chốt trong ADR này)

- Payment/subscription, pronunciation/STT provider, Hanzi/OCR, CDN riêng cho
  media, Redis: chỉ mở khi có điều kiện ghi ở roadmap §5.6 và mục 2 trên.

## Consequences

- Một stack, một ngôn ngữ (TypeScript) trên web, BFF, mobile và AI; giảm chi phí
  tuyển dụng, review và công cụ.
- Ít stateful service hơn ở beta: PostgreSQL gánh queue, rate limit và analytics
  first-party; đổi lại phải theo dõi tải ghi trên các bảng này và có ngưỡng xem
  lại rõ ràng.
- Bộ harness release-evidence hiện tại được thay phần lớn bằng action chuẩn
  (mục 8); phần alert unit test, nginx fragment và wrapper migrate rút gọn giữ
  lại.
- Quyết định hosting phụ thuộc kết luận pháp lý; nếu phải lưu trong nước, chi
  phí và năng lực managed service sẽ khác và cần cập nhật ADR này.
- Tài liệu đã cập nhật theo ADR này ngày 04/09/2026: master plan chuyển vào
  `docs/archive/`, PROJECT_CONTEXT gộp vào `docs/architecture/overview.md`,
  `docs/README.md` viết lại. Còn phải sửa `docs/product/roadmap.md` §3.2 khi ADR được
  Accepted.
