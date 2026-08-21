---
name: 06-data-analytics
description: "Design or review HSK data ingestion, provenance, analytics, privacy lifecycle, reporting and recovery. Use when the data product or lifecycle is the primary boundary."
---

# Data & Analytics

1. Mọi dataset có owner, license, provenance, version/hash, schema contract và quality threshold.
2. Pipeline raw → parsed → normalized → validated → preview → commit phải idempotent/reproducible và audit được.
3. Analytics event/metric có taxonomy/version/privacy; không dùng production PII cho test.
4. Retention/delete/anonymize/export phải map tới mọi storage, log, analytics, AI và object.
5. Backup chỉ đạt khi restore drill chứng minh RPO/RTO và integrity.
6. Đọc đúng playbook và phần liên quan tại `../hsk-production-delivery/references/production-quality-baseline.md`.

## Playbook theo nhu cầu

- Ingest/chất lượng: [Seed pipeline](63-seed-data-pipeline.md), [Quality/provenance](64-data-quality-provenance.md).
- Analytics/BI: [Event design](65-analytics-event-design.md), [Reporting](66-reporting-bi.md).
- Lifecycle/recovery: [Privacy/retention](67-data-privacy-retention.md), [Backup/recovery](68-backup-recovery.md).
