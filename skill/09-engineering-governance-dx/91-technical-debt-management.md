---
name: technical-debt-management
description: "Nhận diện, định lượng và trả technical debt có chủ đích. Sử dụng khi có workaround, flaky test, stale dependency/docs, scale bottleneck hoặc refactor proposal."
---

# Technical Debt Management

1. Ghi debt cụ thể: location, root cause, user/engineering/risk impact, evidence và owner.
2. Phân loại deliberate/prudent hay accidental/reckless; severity theo security/integrity/reliability/velocity/cost.
3. Đặt repayment trigger/SLA/expiry, không dùng backlog vô hạn; link metric/incident/bug.
4. Chọn fix incremental có characterization test và compatibility; tránh “big rewrite” không đo được.
5. Dành capacity theo risk/error budget, gắn debt vào roadmap/release nếu là blocker.
6. Đo before/after lead time, defect, latency, cost, complexity hoặc coverage mutation.
7. Đóng khi code/test/docs/telemetry sạch, không chỉ đổi tên ticket.

**Gate:** debt register được review, temporary flag/TODO có owner/date và critical debt không bị che bởi feature velocity.
