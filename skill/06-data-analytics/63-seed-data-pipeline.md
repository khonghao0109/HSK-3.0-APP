---
name: seed-data-pipeline
description: "Xây seed/import pipeline idempotent và tái lập cho level, lesson, dictionary và content HSK. Sử dụng khi thêm nguồn dữ liệu, normalization, seed hoặc fixture."
---

# Seed Data Pipeline

1. Giữ raw immutable; ghi source URL/version/license/receivedAt/content hash và creator.
2. Parse/normalize deterministic: Unicode NFKC, whitespace, pinyin, enum và stable source key.
3. Validate schema, referential rule, duplicate/collision, bounds và publish readiness trước write.
4. Preview zero-write tạo canonical checksum/counter/error; commit bind idempotency + source + checksum.
5. Upsert stable identity hoặc insert version mới; không delete/recreate parent đã có reference/history.
6. Transaction/batch bounded, resumable, audit/reconcile; không seed vào production ngoài runbook/phê duyệt.
7. Test rerun, changed checksum, duplicate source, partial invalid, legacy reference và fresh migration-only DB.

**Gate:** same input → same normalized output/hash/state; license/provenance đầy đủ; rollback/recovery và row error deterministic.
