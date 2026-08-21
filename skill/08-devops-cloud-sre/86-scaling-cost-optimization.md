---
name: scaling-cost-optimization
description: "Thiết kế horizontal scaling, capacity và cost optimization dựa trên SLO. Sử dụng khi traffic/data tăng, thêm replica/cache/queue/CDN hoặc tối ưu cloud spend."
---

# Scaling & Cost Optimization

1. Đo baseline workload/cost per active user/request/job/GB; tìm bottleneck bằng latency/saturation, không đoán.
2. Chỉ correctness-critical session/job/file/lock state mới bắt buộc external/shared durability và coordination. Correctness-independent cache được phép local/ephemeral khi invalidation, freshness và failure behavior an toàn. Không tự thêm Redis hoặc shared service nếu chưa có evidence về correctness, failure isolation hay tải.
3. Scale app theo concurrency/latency/queue lag; DB theo query/index/pool/read replica/partition khi chứng minh.
4. Cache/CDN/object lifecycle/batch/async giúp giảm cost nhưng không phá freshness/auth/integrity.
5. Autoscaling min/max/cooldown/headroom và provider quota; load/soak test trước tăng trần.
6. FinOps tag/allocation, budget/anomaly alert, commitment/rightsizing theo dữ liệu; không giảm redundancy dưới SLO.
7. Test replica addition/removal, rolling deploy, cache/queue/DB failure và thundering herd.

**Gate:** before/after SLO + capacity + cost, saturation point và rollback; optimization không chuyển chi phí thành rủi ro ẩn.
