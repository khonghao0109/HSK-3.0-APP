---
name: scaling-cost-optimization
description: "Thiết kế horizontal scaling, capacity và cost optimization dựa trên SLO. Sử dụng khi traffic/data tăng, thêm replica/cache/queue/CDN hoặc tối ưu cloud spend."
---

# Scaling & Cost Optimization

1. Đo baseline workload/cost per active user/request/job/GB; tìm bottleneck bằng latency/saturation, không đoán.
2. Loại state local: session/cache/job/file/lock chuyển shared durable service; idempotency và distributed coordination rõ.
3. Scale app theo concurrency/latency/queue lag; DB theo query/index/pool/read replica/partition khi chứng minh.
4. Cache/CDN/object lifecycle/batch/async giúp giảm cost nhưng không phá freshness/auth/integrity.
5. Autoscaling min/max/cooldown/headroom và provider quota; load/soak test trước tăng trần.
6. FinOps tag/allocation, budget/anomaly alert, commitment/rightsizing theo dữ liệu; không giảm redundancy dưới SLO.
7. Test replica addition/removal, rolling deploy, cache/queue/DB failure và thundering herd.

**Gate:** before/after SLO + capacity + cost, saturation point và rollback; optimization không chuyển chi phí thành rủi ro ẩn.
