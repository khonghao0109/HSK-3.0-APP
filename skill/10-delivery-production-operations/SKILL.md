---
name: 10-delivery-production-operations
description: "Coordinate cross-functional HSK go/no-go, release communication, support, trust/safety and business continuity. Use when multiple owners must make a production decision; technical staging/promotion belongs to group 08."
---

# Delivery & Production Operations

1. Plan theo outcome/vertical slice, dependency/risk/capacity và Definition of Done production.
2. Release immutable/progressive, go/no-go dựa evidence, observation và rollback.
3. Support/feedback nối với telemetry/bug/product discovery, bảo vệ PII và SLA.
4. Trust/safety có policy, moderation/audit/appeal và human escalation.
5. BCP/DR theo business impact; chỉ đặt RPO/RTO/rehearsal khi continuity risk nằm trong scope.
6. Dùng template `../hsk-production-delivery/references/evidence-and-release-template.md` cho release/handoff cần evidence.

## Playbook theo nhu cầu

- Delivery/release: [Project delivery](94-project-management-delivery.md), [Release management](95-release-management.md).
- Production feedback/safety: [Customer support](96-customer-support-feedback.md), [Trust & safety](97-content-moderation-trust-safety.md).
- Continuity: [Disaster recovery/BCP](98-disaster-recovery-business-continuity.md).
