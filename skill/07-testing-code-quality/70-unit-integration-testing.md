---
name: unit-integration-testing
description: "Viết unit và integration test deterministic cho TypeScript/NestJS/React/Prisma. Sử dụng khi triển khai logic, validator, service, component hoặc adapter."
---

# Unit & Integration Testing

1. Unit test pure rule/state/error classifier với boundary/table/property cases; không mock implementation detail.
2. Integration test real boundary quan trọng: database, HTTP adapter, serializer, cookie/header; fake external provider deterministic.
3. Arrange dữ liệu qua public fixture builder, unique key và clock/ID injectable; không phụ thuộc order/seed/timezone.
4. Test positive, invalid, permission, retry/idempotency, timeout/error mapping và invariant final state.
5. UI test semantics/interaction/accessibility, không assert CSS internals trừ contract visual.
6. Cleanup transaction/fresh DB; không truncate/reset protected DB; no shared mutable fixture giữa test.
7. Mutation/coverage chỉ để tìm lỗ, không chạy theo phần trăm.

**Gate:** test fail đúng khi production logic bị phá, không false-green catch quá rộng và chạy lặp ổn định.
