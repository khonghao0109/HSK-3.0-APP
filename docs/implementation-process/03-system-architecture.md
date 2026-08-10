# Quy trình 03 — System Architecture

## 1. Mục tiêu

Chuyển product/UX requirements thành kiến trúc có boundary, contract, data ownership, security và khả năng mở rộng rõ ràng; ưu tiên modular monolith cho core và service AI độc lập.

## 2. Phạm vi skill

Gồm 12 skill từ `26-system-architecture` đến `37-ai-rag-architecture` trong `skill/03-system-architecture/`.

## 3. Điều kiện đầu vào

- Requirement/NFR, domain map, UX flow và volume assumption đã được review.
- Baseline code/schema/infrastructure được xác minh bằng repo và test.
- Ràng buộc ngân sách, đội ngũ, SLA/SLO, privacy, provider và deadline.

## 4. Trình tự thực hiện

### Giai đoạn 1 — Baseline và architecture drivers

1. Lập C4 context/container cho frontend, backend, AI, PostgreSQL, storage và provider.
2. Xác định architecture drivers: security, consistency, latency, scale, cost và delivery speed.
3. Ghi constraint/assumption cùng confidence và validation plan.
4. Xác định failure domain và dữ liệu quan trọng.

**Gate A1:** Driver đo được, constraint có nguồn và baseline khớp runtime.

### Giai đoạn 2 — Boundary và ADR

1. Map bounded context thành module owner trong modular monolith.
2. Chọn boundary transaction; tránh shared business logic tùy tiện.
3. Viết ADR cho quyết định khó đảo ngược: auth, storage, event, vector DB, offline và payment.
4. Ghi alternatives, trade-off, consequence và review trigger.

**Gate A2:** Mỗi module có owner, public contract và dependency direction hợp lệ.

### Giai đoạn 3 — API và data architecture

1. Thiết kế REST/event contract từ use case và error model thống nhất.
2. Định nghĩa authentication, authorization, pagination, idempotency, versioning và compatibility.
3. Thiết kế schema theo aggregate/lifecycle/invariant; bổ sung constraint/index từ access pattern.
4. Lập migration/backfill/rollback plan và kiểm tra dữ liệu lịch sử.
5. Snapshot các domain cần bất biến như exam/content revision.

**Gate A3:** Contract có test strategy; schema có owner, lifecycle, integrity và migration path.

### Giai đoạn 4 — Integration và event flow

1. Chọn synchronous hoặc asynchronous theo consistency/failure need.
2. Định nghĩa event schema, producer/consumer, ordering, retry, idempotency và dead-letter.
3. Dùng outbox/inbox khi cần bảo đảm giữa DB và message delivery.
4. Thiết kế timeout, circuit breaker, fallback và observability.

**Gate A4:** Không có remote call quan trọng thiếu timeout/retry/idempotency/trace.

### Giai đoạn 5 — Frontend/mobile architecture

1. Chốt route/module boundary, data fetching, cache, state ownership và auth session.
2. Xác định SSR/CSR/static strategy và performance budget.
3. Với mobile/offline, thiết kế local store, sync queue, conflict resolution và migration.
4. Đồng bộ typed contract và error state với backend.

### Giai đoạn 6 — Security architecture

1. Threat model theo asset, actor, trust boundary và abuse case.
2. Thiết kế identity, RBAC/ABAC, secret, encryption, rate limit và audit.
3. Phân loại dữ liệu; map retention/deletion và least privilege.
4. Đặt security control vào CI/CD và runtime monitoring.

**Gate A5:** Threat high/critical có control, owner, test và residual-risk approval.

### Giai đoạn 7 — AI/RAG architecture

1. Giữ AI service/database độc lập; core truyền identity/permission context qua API.
2. Thiết kế ingest theo hash/version, chunk, embedding, retrieval và citation.
3. Version model/prompt/index; lưu run trace, latency, cost và feedback.
4. Thiết kế guardrail, evaluation set, deletion/anonymization và fallback.

**Gate A6:** Mỗi câu trả lời có citation/trace; không có embedding hoặc chat data không có owner/retention.

### Giai đoạn 8 — Architecture review và handoff

1. Review C4, sequence, ERD, ADR, threat model và capacity assumptions.
2. Chạy spike cho rủi ro cao; cập nhật quyết định bằng kết quả đo.
3. Lập implementation slices, dependency và architecture fitness checks.
4. Bàn giao cho backend, frontend/mobile, data và DevOps.

## 5. Artifact bắt buộc

- C4 context/container/component và sequence diagram cho luồng P0.
- Context map, module dependency rules và ADR log.
- API/event contracts, data model, migration/backfill/rollback plan.
- Threat model, privacy/data flow và security controls.
- AI/RAG boundary, evaluation/observability/cost model.
- Capacity model, SLO và deployment topology sơ bộ.

## 6. Chỉ số kiểm soát

- Không có cyclic dependency giữa module domain.
- 100% external call có timeout và failure policy.
- 100% bảng/dataset có owner/lifecycle/retention.
- 100% ADR critical có status và review trigger.
- P0 có contract test, migration test và threat coverage.

## 7. Definition of Done

Nhóm 3 hoàn tất khi kiến trúc đủ chi tiết để các nhóm triển khai độc lập theo contract, các quyết định khó đảo ngược có ADR, mọi dữ liệu có owner/lifecycle, rủi ro high có control và implementation plan có thể phát hành theo lát cắt end-to-end.
