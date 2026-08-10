# Quy trình 04 — Backend & Core Domains

## 1. Mục tiêu

Hiện thực capability backend theo lát cắt nghiệp vụ an toàn, có contract ổn định, dữ liệu nhất quán, phân quyền đúng và kiểm thử đủ để frontend/mobile/admin tích hợp.

## 2. Phạm vi skill

Gồm 17 skill từ `38-nestjs-backend-development` đến `54-ai-gateway-integration` trong `skill/04-backend-core-domains/`.

## 3. Điều kiện đầu vào

- Requirement, user story, domain model, API/schema draft và threat model đã approved.
- Migration plan, seed/data source và test data có owner.
- Definition of Done, performance target và rollout strategy rõ ràng.

## 4. Nguyên tắc triển khai

- Triển khai vertical slice: DTO/guard → use case → persistence → event → test → docs.
- Giữ controller mỏng; đặt nghiệp vụ trong service/domain và bảo vệ invariant ở transaction boundary.
- Không trả Prisma model trực tiếp nếu làm lộ field hoặc khóa contract vào persistence.
- Mọi write quan trọng có authorization, validation, audit/idempotency phù hợp.

## 5. Trình tự thực hiện

### Giai đoạn 1 — Nền tảng NestJS và persistence

1. Chuẩn hóa module, dependency injection, config validation, exception và response contract.
2. Thiết kế Prisma model/constraint/index; tạo migration có tên nghiệp vụ.
3. Review SQL, bootstrap database rỗng, backfill và rollback/forward-fix.
4. Thiết lập transaction boundary và repository/query pattern khi cần.

**Gate B1:** Build, schema validate, migration fresh DB và seed tối thiểu đều pass.

### Giai đoạn 2 — Identity, auth và RBAC

1. Hoàn thiện register/login/me, password policy, token lifecycle và session/revocation.
2. Thực thi owner/admin permission ở backend; không tin role từ client.
3. Bổ sung lockout/rate limit/audit và account export/deletion flow.
4. Test horizontal/vertical privilege escalation và revoked/expired token.

**Gate B2:** Endpoint protected có guard, policy test và không rò field nhạy cảm.

### Giai đoạn 3 — Contract, validation và operational controls

1. Chuẩn hóa DTO, pagination, sorting, validation và error code.
2. Tạo OpenAPI/example và contract test cho consumer.
3. Thiết kế cache key/invalidation, rate limit và idempotency.
4. Tích hợp structured log, request ID, metric và audit event.

### Giai đoạn 4 — Media, dictionary và search

1. Thiết kế upload signed/local abstraction, MIME/size scan, checksum và lifecycle.
2. Hoàn thiện dictionary detail: Hanzi, Pinyin, Việt/Anh, example, audio, HSK, simplified/traditional.
3. Thiết kế normalization và index theo access pattern; đo query bằng dữ liệu đại diện.
4. Bảo toàn provenance/license và version trong import/publish.

**Gate B3:** Search P95 đạt target, upload an toàn, content chỉ trả bản published/authorized.

### Giai đoạn 5 — Learning, personalization và SRS

1. Hiện thực lesson activity/attempt/answer/feedback và learning event.
2. Cập nhật progress idempotent theo activity completion.
3. Thiết kế review item/event/schedule, due queue theo timezone và grade history.
4. Tạo rule-based recommendation trước model phức tạp; lưu reason/explanation.
5. Test repeat submit, concurrent update, timezone boundary và historical integrity.

### Giai đoạn 6 — Exam engine

1. Hiện thực question bank, section/group/test revision và publish workflow.
2. Khi bắt đầu attempt, tạo snapshot đủ để chấm độc lập với content live.
3. Autosave answer bằng upsert idempotent; hỗ trợ resume, flag, timeout và review.
4. Submit trong transaction; chấm theo scoring version và lưu score per skill.
5. Chống double submit, stale client và thay đổi question sau attempt.

**Gate B4:** Luồng start → autosave → resume → submit → result ổn định và truy vết được.

### Giai đoạn 7 — Speech, notification và admin CMS

1. Thiết kế recording upload, consent/retention, provider job và feedback result.
2. Hiện thực preference, quiet hours, device token, notification idempotency/retry.
3. Xây CMS draft/review/publish/archive, revision, audit và import preview/rollback.
4. Giới hạn admin action bằng role/policy và audit immutable.

### Giai đoạn 8 — Payment entitlement và AI gateway

1. Mô hình plan/subscription/entitlement/payment event; webhook idempotent.
2. Kiểm tra entitlement phía server cho feature/resource/quota.
3. Giữ backend AI module là gateway: auth, quota, context, timeout, trace và redaction.
4. Không đặt retrieval/embedding lõi hoặc vector data trong core backend.

**Gate B5:** Payment/AI failure có retry/fallback, audit và không làm lộ dữ liệu/secret.

### Giai đoạn 9 — Verification và phát hành

1. Chạy format/lint/build/unit/integration/e2e/contract/security test theo risk.
2. Verify migration trên DB rỗng và DB có dữ liệu đại diện.
3. Cập nhật OpenAPI, API docs, context, runbook và monitoring.
4. Release qua feature flag/canary khi capability rủi ro cao; theo dõi metric và rollback trigger.

## 6. Artifact bắt buộc

- Source, migration, seed/backfill và test data.
- API/OpenAPI, error catalog và contract tests.
- Unit/integration/e2e/security/performance evidence.
- Dashboard/alert, audit model và runbook.
- Release/rollback plan và post-release verification.

## 7. Chỉ số kiểm soát

- Build/test critical pass; coverage theo risk, không chạy theo số tuyệt đối.
- P95/error rate theo endpoint mục tiêu.
- Tỷ lệ autosave/submit success và duplicate/idempotency violation.
- Migration duration/lock và data-quality error.
- Authz/audit coverage cho admin/write endpoint.

## 8. Definition of Done

Backend hoàn tất khi capability chạy end-to-end bằng database thật, contract/documentation đồng bộ, migration tái tạo được, authorization và failure path được test, observability sẵn sàng và frontend có môi trường/fixture để tích hợp.
