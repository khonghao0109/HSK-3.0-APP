---
name: offline-sync-pwa
description: "Thiết kế PWA/offline cache và đồng bộ dữ liệu học an toàn. Sử dụng khi thêm service worker, download lesson/media, offline attempt/review hoặc background sync."
---

# Offline Sync & PWA

1. Chốt offline capability/non-goal và data sensitivity/quota/expiry; không cache admin/auth/API sensitive mặc định.
2. Version service worker/cache, atomic activate/rollback; asset precache bounded, runtime strategy theo loại dữ liệu.
3. Offline write dùng client operation ID/idempotency, durable queue và explicit state pending/synced/conflict/failed.
4. Conflict rule theo domain; server time/version là authority; không silent last-write-wins cho progress/exam.
5. Encrypt/minimize local PII/token; logout/delete account purge cache/indexed storage.
6. Download media có checksum, quota/eviction và license/retention; UI báo offline/stale.
7. Test upgrade, corrupted cache, reconnect, duplicate/reorder, multi-device, low storage và rollback SW.

**Gate:** no stale auth/data loss, deterministic recovery, background limits và offline telemetry/kill switch.
