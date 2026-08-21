---
name: test-strategy
description: "Lập chiến lược kiểm thử risk-based cho feature/release HSK. Sử dụng khi bắt đầu epic, thay đổi architecture/schema hoặc chuẩn bị beta/production."
---

# Test Strategy

1. Map requirement/NFR → risk → control → test level → environment → owner/evidence.
2. Ưu tiên auth/privacy/integrity/history/concurrency/payment/exam; xác định blast radius và regression set.
3. Pyramid: unit nhiều, integration/contract có mục tiêu, DB/concurrency cho invariant, E2E cho critical journey.
4. Bao phủ các chiều thực sự bị ảnh hưởng; accessibility chỉ cho UI, performance/capacity/reliability/DR chỉ khi acceptance hoặc risk yêu cầu, security/integrity không được bỏ khi boundary tương ứng thay đổi.
5. Test data synthetic/minimal, deterministic, seed-independent; môi trường disposable/ephemeral và production-like config.
6. Đặt entry/exit criteria, flaky budget, coverage có ý nghĩa, triage/stop-the-line.
7. Trace matrix cập nhật khi scope/contract thay đổi.

**Gate:** không chỉ dựa coverage %, no critical risk không test/accept; rollback/monitoring cũng có verification.
