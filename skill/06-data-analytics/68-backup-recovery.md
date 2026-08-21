---
name: backup-recovery
description: "Thiết kế backup, PITR, restore verification và data recovery cho PostgreSQL/object/config. Sử dụng khi chuẩn bị production, đổi storage/schema hoặc diễn tập DR."
---

# Backup & Recovery

1. Phân loại data/service, dependency và chốt RPO/RTO với product/business.
2. PostgreSQL base backup + WAL/PITR, object version/replication và config/IaC/secret recovery tách biệt.
3. Backup encrypted, immutable khi phù hợp, cross-account/region, least privilege và retention lifecycle.
4. Monitor job/age/size/checksum; alert missed backup và capacity.
5. Restore vào isolated disposable environment, verify migration, constraints, row/sample checksum, app smoke và privacy controls.
6. Diễn tập point-in-time, region/account loss và partial object/database consistency; ghi actual RPO/RTO.
7. Runbook exact command, credentials break-glass, decision owner, communication và post-restore reconciliation.

**Gate:** backup chưa restore không tính PASS; evidence mới trong review window, no production overwrite và deletion/legal-hold policy rõ.
