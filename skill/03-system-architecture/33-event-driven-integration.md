---
name: event-driven-integration
description: "Thiết kế event/outbox/queue đáng tin cậy cho side effect và tích hợp bất đồng bộ. Sử dụng khi thêm background job, notification, analytics, ingest hoặc tách service."
---

# Event-driven Integration

1. Phân biệt domain event, integration event và command; schema có eventId, type/version, occurredAt, aggregate và correlation.
2. Ghi business state + outbox cùng transaction; publisher retry; consumer at-least-once và idempotent inbox/dedup.
3. Chốt ordering key, partition, max payload, retention, retry/backoff, DLQ và poison-message workflow.
4. Không đưa PII/secret/large binary vào event; dùng reference có authorization/expiry.
5. Version schema backward-compatible; consumer không phụ thuộc field mới bắt buộc ngay.
6. Đo lag, throughput, retry, DLQ, age và saturation; autoscale theo backlog/processing time.
7. Test duplicate, reorder, loss/replay, consumer crash trước/sau commit và recovery DLQ.

**Gate:** không dual-write gap, replay an toàn, operator có công cụ quan sát/reprocess và event ownership rõ.
