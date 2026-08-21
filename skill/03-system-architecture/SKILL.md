---
name: 03-system-architecture
description: "Make HSK architecture decisions for boundaries, cross-system contracts, NFRs or difficult-to-reverse choices. Do not use for routine backend/frontend implementation within an established boundary."
---

# System Architecture

## Quy trình

1. Đọc context, capability map và phần liên quan trong `../hsk-production-delivery/references/production-quality-baseline.md`.
2. Chốt quality attributes thật sự ảnh hưởng quyết định; không bắt SLO, capacity hoặc RPO/RTO nếu boundary/risk không yêu cầu.
3. Dùng modular monolith cho core cho tới khi ownership/failure/scale chứng minh cần tách; AI giữ boundary riêng.
4. Chốt data owner, synchronous API, asynchronous event, idempotency, concurrency và failure policy.
5. Threat-model trust boundary; lập capacity model và chứng minh runtime stateless để scale ngang.
6. Ghi ADR cho quyết định khó đảo ngược; chọn test/benchmark/failure rehearsal tỷ lệ với claim và risk.

## Định tuyến

- Nền tảng quyết định: [Architecture](26-system-architecture.md), [ADR](27-architecture-decision-records.md), [Modular monolith](28-modular-monolith-architecture.md).
- Contract và dữ liệu: [API](29-api-contract-design.md), [Database schema](30-database-schema-design.md), [Migration](31-data-migration-strategy.md).
- Tích hợp: [Service boundary](32-service-boundary-integration.md), [Event-driven](33-event-driven-integration.md).
- Client/platform: [Frontend](34-frontend-architecture.md), [Mobile](35-mobile-architecture.md).
- Cross-cutting: [Security](36-security-architecture.md), [AI/RAG](37-ai-rag-architecture.md).

## Cổng kiến trúc

Không tạo distributed monolith, shared database không owner, cross-service transaction ẩn, unbounded queue/retry, local state cản scale, single point of failure không được chấp nhận hoặc diagram không khớp code/runtime.
