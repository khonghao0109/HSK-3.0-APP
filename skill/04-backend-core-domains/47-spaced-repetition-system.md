---
name: spaced-repetition-system
description: "Thiết kế và triển khai SRS ReviewCard/Session/Event chính xác, retry-safe. Sử dụng khi lập lịch ôn, chấm review, tạo session hoặc thay scheduler."
---

# Spaced Repetition System

1. ReviewEvent immutable là fact; ReviewCard là scheduler source of truth; UserWordProgress chỉ projection compatibility.
2. Version thuật toán, rating semantics, timezone/day boundary, learning/relearning/graduate và lapse cap.
3. Tạo session snapshot card/order; event phải cùng owner card/session, enforce DB + transaction.
4. Lock User/Card theo order deterministic; idempotency key chống double tap/retry; due date tính từ server time.
5. Archived word/content không vào session mới nhưng history/snapshot giữ được.
6. Golden vectors kiểm thuật toán; property test interval bounds/monotonic rules; race test same/different card.
7. Rebuild/reconcile scheduler có dry-run, audit và rollback version.

**Gate:** không mất/nhân review, deterministic across replicas, due queue P95/capacity và fairness/timezone evidence.
