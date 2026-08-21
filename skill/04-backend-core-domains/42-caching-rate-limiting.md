---
name: caching-rate-limiting
description: "Thiết kế cache, invalidation và distributed rate limiting cho HSK. Sử dụng khi tối ưu read, chống abuse, dùng Redis/CDN hoặc triển khai nhiều replica."
---

# Caching & Rate Limiting

1. Phân loại public, private, sensitive và mutable data; mặc định không cache auth/user-specific response dùng chung.
2. Chốt key gồm version/locale/filter/permission scope; TTL + invalidation/source event và stampede protection.
3. Cache-aside chỉ là projection; database vẫn source of truth; negative cache ngắn và có chủ đích.
4. Rate limit dùng shared store, key theo actor/IP/device phù hợp, route cost/burst/window và trusted proxy chain.
5. Login/reset/AI/upload/search có policy riêng; trả 429 + retry hint, không khóa user thật bởi NAT quá thô.
6. Redis outage có fail-open/closed theo threat, timeout/circuit breaker và metric hit/miss/eviction/latency.
7. Test multi-instance, invalidation race, stampede, clock/window và privacy key leakage.

**Gate:** không stale authorization/content publish, không local-memory correctness, capacity và fallback đã đo.
