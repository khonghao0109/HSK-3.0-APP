---
name: performance-reliability-testing
description: "Kiểm thử load, capacity, soak, concurrency, failure và recovery. Sử dụng khi đặt SLO, chuẩn bị scale ngang, thêm queue/cache/provider hoặc release workload lớn."
---

# Performance & Reliability Testing

1. Xây workload model từ traffic, concurrency, payload, read/write mix, burst và growth; định nghĩa SLO/budget.
2. Baseline single instance, rồi load/step/spike/soak; đo latency percentile, error, throughput và saturation mọi dependency.
3. Verify horizontal scale, connection pool, cache hit, queue lag/backpressure, autoscaling và graceful deploy.
4. Concurrency harness xác nhận B thật sự blocked đúng lock, A commit, exact domain outcome và final invariant.
5. Inject timeout/connection/deadlock/provider/cache/replica failure; classifier fail-closed.
6. Test backup restore/failover/restart/replay, recovery time và data correctness.
7. Chạy isolated, rate/cost guard; lưu version/config/result để tái lập.

**Gate:** có saturation point/headroom, bottleneck/fix evidence, abort threshold và capacity/runbook cập nhật.
