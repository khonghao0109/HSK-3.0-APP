---
name: reporting-bi
description: "Thiết kế reporting/BI đáng tin cậy cho learning, content và operations. Sử dụng khi tạo KPI, dashboard, export hoặc báo cáo admin."
---

# Reporting & BI

1. Chốt audience, decision, cadence và certified metric definition/owner.
2. Xây semantic model từ fact/dimension có grain rõ; SCD/timezone/currency/HSK band rule nhất quán.
3. Pipeline incremental/idempotent, late data/watermark/backfill và reconciliation với source.
4. Dashboard hiển thị freshness, filter, denominator và uncertainty; không dùng chart gây hiểu sai.
5. Row/column-level security, export permission, masking và retention; không lộ learner PII cho admin không cần.
6. Tối ưu aggregate/partition/cache theo workload; query/cost budget và concurrency limit.
7. Test metric bằng fixture/golden SQL, access control, empty/partial/stale state và visual accessibility.

**Gate:** certified number có lineage, freshness/accuracy SLA, audit export và owner/on-call.
