---
name: system-architecture
description: "Thiết kế kiến trúc tổng thể và NFR cho HSK 3.0. Sử dụng khi khởi tạo capability, thay đổi topology, đánh giá scale/reliability hoặc lập architecture review."
---

# System Architecture

1. Chuyển mục tiêu sản phẩm thành workload, data classification và quality attributes đo được.
2. Lập context/container/component diagram; ghi owner, trust/failure/scale boundary và dependency.
3. Giữ core NestJS modular monolith + PostgreSQL; Next.js là presentation/BFF; AI service tách theo compute/data policy.
4. Thiết kế stateless instances sau load balancer; session/cache/queue/object dùng durable shared service.
5. Chọn timeout/retry/idempotency/backpressure theo failure path thật; chỉ thêm circuit breaker hoặc distributed component khi evidence cho thấy cần.
6. Lập capacity/HA/backup/DR model khi quyết định hoặc NFR hiện tại phụ thuộc vào chúng.
7. Threat model/privacy/observability/runbook theo trust boundary và criticality bị thay đổi.

**Gate:** claim về boundary, security, scale hoặc recovery có evidence tương ứng; không bắt SLO/capacity/RPO/RTO/chaos test cho thay đổi không ảnh hưởng các thuộc tính đó.
