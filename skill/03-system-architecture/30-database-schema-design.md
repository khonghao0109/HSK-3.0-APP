---
name: database-schema-design
description: "Thiết kế PostgreSQL/Prisma schema bảo toàn invariant, lịch sử và hiệu năng HSK. Sử dụng khi thêm entity, relation, constraint, index, lifecycle, soft-delete hoặc schema review."
---

# Database Schema Design

1. Xác định aggregate/data owner, source of truth, lifecycle, retention và query/write workload.
2. Chọn type PostgreSQL chính xác; enum/check/not-null/unique/FK enforce invariant có thể enforce.
3. FK action phù hợp lịch sử: RESTRICT immutable fact; soft-delete/anonymize identity; CASCADE chỉ khi child thật sự phụ thuộc.
4. Dùng UTC timestamps, stable key, provenance/version/audit; snapshot dữ liệu cần tái hiện lịch sử.
5. Thiết kế index từ query/EXPLAIN, gồm composite order, partial public rows và uniqueness; không “index mọi field”.
6. Xem xét concurrency/MVCC, lock order, deferred constraint và append-only trigger.
7. Đồng bộ Prisma schema với SQL-only invariant/comment; test migration fresh và drift.

**Gate:** acceptance SQL gồm positive/negative/concurrency/lifecycle; PII/retention rõ; không orphan/history loss; query trọng yếu có plan/budget.
