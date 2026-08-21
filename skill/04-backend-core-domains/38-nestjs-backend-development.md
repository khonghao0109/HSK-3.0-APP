---
name: nestjs-backend-development
description: "Phát triển NestJS module/controller/service chuẩn production cho HSK backend. Sử dụng khi thêm endpoint, provider, guard, interceptor, transaction hoặc background workflow."
---

# NestJS Backend Development

1. Chia theo capability module; controller mỏng, application service điều phối, domain invariant rõ, infrastructure qua interface khi có giá trị.
2. DTO whitelist/forbid unknown, normalize NFKC/canonical field và limit depth/size; error filter trả stable safe contract.
3. Guard authenticate rồi authorize role/owner/state; không tin actor/object từ client.
4. Transaction boundary ở use case; timeout, idempotency, lock order và retry classification rõ.
5. Provider stateless; config validate lúc startup; connection pool/graceful shutdown/health readiness phù hợp nhiều replica.
6. Structured log/correlation/metrics/traces nhưng không secret/PII.
7. Unit test business branches, integration persistence, E2E HTTP/auth và concurrency khi có race.

**Gate:** build/lint/format/test GREEN; no circular dependency; OpenAPI/docs đồng bộ; operation có observability và runbook nếu critical.
