---
name: prisma-postgresql
description: "Làm việc an toàn với Prisma 5 và PostgreSQL cho schema, query, transaction, lock và migration HSK. Sử dụng khi thay đổi data access, constraint/index hoặc điều tra integrity/performance."
---

# Prisma & PostgreSQL

1. Đọc Prisma schema cùng toàn bộ migration liên quan; SQL migration là nguồn invariant DB thực tế.
2. Chọn transaction isolation và explicit row-lock order theo race; không giữ transaction khi gọi network.
3. Dùng unique/composite FK/check/trigger cho invariant; bắt đúng SQLSTATE/Prisma code, fail-closed với lỗi hạ tầng.
4. Query select tối thiểu, pagination bounded, chống N+1. Bắt đầu bằng plain `EXPLAIN`; `EXPLAIN (ANALYZE, BUFFERS)` thực thi statement nên chỉ dùng cho SELECT an toàn/read replica hoặc rollback transaction có timeout và approval.
5. Pool budget = replica × pool; timeout, PgBouncer mode và graceful drain có chủ đích.
6. Migration forward-only, fresh/upgrade/drift/preflight; database test disposable guard.

**Gate:** Prisma format/validate, deploy/status, acceptance SQL/concurrency, drift rỗng; index phục vụ plan thật; không query raw interpolate.
