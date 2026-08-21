---
name: staging-release-management
description: "Quản trị staging, release candidate, progressive rollout và rollback. Sử dụng trước mỗi beta/production release hoặc hotfix."
---

# Staging & Release Management

1. Staging production-like về topology/config nhưng dùng isolated synthetic/sanitized data và credential.
2. Release candidate là immutable artifact/checksum đã qua CI; freeze scope và tạo traceability requirement→commit→artifact.
3. Destructive migration rehearsal dùng disposable environment; staging chạy synthetic non-destructive smoke/E2E và các security/performance/a11y/DR gate thật sự liên quan risk.
4. Go/no-go checklist có product/engineering/QA/security/SRE/data/legal owner; rủi ro mở có formal acceptance.
5. Rollout canary/percentage/cohort; monitor SLI/business/integrity/support với observation window và abort thresholds.
6. Rollback app/flag hoặc roll-forward DB theo compatibility; không down-migrate phá dữ liệu nếu chưa rehearsal.
7. Release note, change calendar, on-call/communication và post-release review.

**Gate:** no config/data drift không biết, rollback/kill switch hoạt động và production smoke không tạo dữ liệu nguy hiểm.
