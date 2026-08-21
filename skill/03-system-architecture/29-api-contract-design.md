---
name: api-contract-design
description: "Thiết kế REST/BFF API contract ổn định, an toàn và evolvable cho HSK 3.0. Sử dụng khi thêm/sửa endpoint, DTO, pagination, error, idempotency, auth hoặc versioning."
---

# API Contract Design

1. Bắt đầu từ use case/resource và authorization matrix; đọc `docs/api.md` cùng implementation.
2. Dùng `/api/v1`, typed request/response, canonical enum, UTC ISO time và pagination/sort/filter có allowlist.
3. Validate/normalize tại boundary; reject unknown field; error có stable code, safe message, correlation ID và field path không phản chiếu secret.
4. POST critical có idempotency key/scope/payload binding; optimistic concurrency hoặc lock policy cho mutation xung đột.
5. Chốt timeout, rate limit, cache semantics, ETag nếu phù hợp và max payload/batch.
6. Thay đổi backward-compatible trước; deprecate có telemetry/window; breaking change qua version mới.
7. Sinh OpenAPI/contract test và kiểm thử 400 cho DTO/path/query/unknown-field/transport validation; 422 chỉ cho domain semantic hoặc authoring shape đã ghi trong `docs/api.md`; cùng 401/403/404/409/429/5xx theo route.

**Gate:** không lộ internal/PII, không mass assignment, auth server-side, retry an toàn, docs/example/test cùng contract.
