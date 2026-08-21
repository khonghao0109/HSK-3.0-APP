---
name: mobile-release-publishing
description: "Chuẩn bị, ký, phát hành và giám sát iOS/Android app an toàn. Sử dụng khi tạo build production, store submission, staged rollout, hotfix hoặc rollback."
---

# Mobile Release & Publishing

1. Version/build number tự động, reproducible signed artifact; signing key trong secure CI, least privilege/rotation.
2. Environment/API/feature flag production rõ; debug menu/log/test endpoint tắt; symbol/source map upload bảo mật.
3. Privacy labels, permission rationale, age/content rating, subscription/refund và store assets được review.
4. Chạy full unit/UI/device/a11y/security/performance/upgrade test trên release candidate.
5. Internal → beta → staged percentage; monitor crash-free, ANR, startup, auth/payment và support signal.
6. Kill switch/remote config/server backward compatibility; rollback store chậm nên chuẩn bị forward hotfix.
7. Release note, owner/on-call, go/no-go và post-release observation window.

**Gate:** artifact checksum/sign-off, no critical finding, store credential audit và rollout abort criteria đã diễn tập.
