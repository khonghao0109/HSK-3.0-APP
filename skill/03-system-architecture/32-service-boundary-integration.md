---
name: service-boundary-integration
description: "Thiết kế tích hợp đồng bộ giữa frontend/BFF, backend, AI và provider ngoài. Sử dụng khi thêm service call, webhook, provider hoặc tách boundary."
---

# Service Boundary Integration

1. Ghi producer/consumer, owner dữ liệu, trust boundary, SLA/SLO và data classification.
2. Contract versioned; authenticate service, authorize scope, TLS, secret rotation và allowlist egress.
3. Đặt connect/request/overall timeout theo budget; retry chỉ operation idempotent với exponential jitter.
4. Dùng circuit breaker, concurrency limit, bulkhead, backpressure và degraded fallback.
5. Không tạo chain dài hoặc synchronous call trong DB transaction; không chia sẻ database credential/schema owner.
6. Propagate correlation/trace context nhưng không token/PII; metric latency/error/saturation theo dependency.
7. Contract/failure/chaos test timeout, duplicate, out-of-order, malformed và provider outage.

**Gate:** failure không cascade, recovery deterministic, runbook/kill switch có thật và provider data policy được phê duyệt.
