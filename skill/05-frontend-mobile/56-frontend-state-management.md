---
name: frontend-state-management
description: "Thiết kế server/client/URL/form state cho React frontend HSK. Sử dụng khi thêm filter, pagination, optimistic UI, multi-step form, cache hoặc shared client state."
---

# Frontend State Management

1. Phân loại: server state, URL state, form state, local UI state và cross-session preference.
2. URL là source cho shareable filter/page/sort; server là source business data; tránh duplicate cache/store.
3. Giữ state gần consumer; context chỉ cho stable cross-tree concern; không đưa mọi thứ vào global store.
4. Mutation có pending/disabled/error/retry; optimistic chỉ khi rollback/identity/concurrency rõ.
5. Dùng idempotency key cho critical submit; stale response/cancel/route change không overwrite state mới.
6. Persist tối thiểu, version/migrate storage; không lưu bearer/PII nhạy cảm trong localStorage.
7. Test back/forward, deep link, refresh, concurrent response, double click, offline và session expiry.

**Gate:** deterministic state ownership, không race/flicker/lost form, accessible announcement và debug telemetry phù hợp.
