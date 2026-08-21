---
name: data-migration-strategy
description: "Lập và kiểm chứng migration PostgreSQL/Prisma forward-only, zero/low-downtime. Sử dụng khi đổi schema, backfill, constraint/index hoặc deploy nhiều phiên bản ứng dụng."
---

# Data Migration Strategy

1. Không sửa migration đã áp dụng; tạo forward migration mới và checksum bất biến.
2. Inventory dữ liệu legacy; preflight fail-safe cho trạng thái không backfill chắc chắn.
3. Dùng expand → dual-compatible deploy/backfill → validate → contract; giữ old/new version cùng chạy khi rolling.
4. Backfill bounded batch, resumable/idempotent, có progress, throttle và reconciliation.
5. Dùng concurrent/index/NOT VALID/validate phù hợp; đo lock/time/disk/WAL và tránh table rewrite ngoài cửa sổ.
6. Test fresh deploy, upgrade fixture, negative preflight atomic rollback, drift, backup/restore và rollback/roll-forward.
7. Chạy write test chỉ trên DB disposable có guard; không `db push/reset` vào protected DB.

**Gate:** runbook exact command, owner/go-no-go, monitoring, abort threshold, checksum và evidence; migration không phá app phiên bản trước trong rollout.
