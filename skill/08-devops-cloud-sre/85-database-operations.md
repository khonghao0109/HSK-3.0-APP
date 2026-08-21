---
name: database-operations
description: "Vận hành PostgreSQL production an toàn: HA, pool, migration, backup, performance và incident. Sử dụng khi deploy schema, điều tra query/lock, failover hoặc capacity planning."
---

# Database Operations

1. Giám sát connections/pool, transaction age, locks/deadlocks, replication lag, WAL/disk, vacuum/bloat, query latency/error.
2. Capacity budget theo replica app; timeout `statement/lock/idle transaction`, pool queue và connection reserve cho ops.
3. Migration runbook preflight/checksum/lock estimate/abort/monitor; forward-only và app compatibility.
4. Slow query dùng pg_stat_statements rồi plain `EXPLAIN`. `EXPLAIN (ANALYZE, BUFFERS)` thực thi statement: chỉ dùng cho SELECT an toàn/read replica hoặc rollback transaction có timeout và approval; index phải có evidence.
5. PITR backup/restore drill, HA failover/reconnect, replica consistency và post-failover reconciliation.
6. Least privilege role, TLS/encryption/audit, credential rotation và protected DB guard.
7. Incident query/kill session/change config cần scoped target, peer review và recovery plan.

**Gate:** RPO/RTO/restore evidence, no unresolved saturation/long tx và DB changes truy vết/audit.
