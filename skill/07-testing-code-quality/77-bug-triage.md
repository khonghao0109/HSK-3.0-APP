---
name: bug-triage
description: "Tiếp nhận, phân loại, ưu tiên và điều phối bug/incident product. Sử dụng khi có report lỗi, regression, flaky test hoặc production symptom."
---

# Bug Triage

1. Xác nhận report: version/env/actor/data/time, expected/actual, reproduction và evidence đã scrub.
2. Phân biệt incident đang diễn ra với backlog bug; nếu user/data/security impact, kích hoạt incident trước RCA.
3. Xếp severity theo impact, reach, data loss/security, workaround và urgency; không theo người báo lớn tiếng.
4. Tìm regression range/owner/component; tạo minimal safe reproduction, không chạm protected data.
5. Gắn duplicate, dependency, SLA và communication; workaround không được che security/integrity risk.
6. Fix có RED regression test, root cause và adjacent risk review; verify đúng environment.
7. Đóng khi evidence GREEN, release/monitoring xác nhận và docs/runbook cập nhật.

**Gate:** không “cannot reproduce” nếu thiếu dữ liệu; flaky test là defect có owner; reopen signal rõ.
