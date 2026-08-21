---
name: data-privacy-retention
description: "Thiết kế data inventory, consent, retention, export, deletion/anonymization và privacy operations. Sử dụng khi thu dữ liệu mới, tích hợp provider hoặc xử lý privacy request."
---

# Data Privacy & Retention

1. Lập data map theo category, purpose, lawful basis/consent, owner, region, processor, sensitivity và retention.
2. Data minimization/default private; field/telemetry/provider mới cần privacy review trước collection.
3. Consent versioned, granular và revocable; core service không bị buộc vào marketing consent.
4. Retention job idempotent, auditable, legal hold aware; cover DB, cache, object, log, analytics, backup và AI provider.
5. Account deletion anonymize identity/revoke access nhưng giữ immutable fact không định danh theo ADR.
6. Export portable, authenticated, time-limited và không lộ user khác; request lifecycle/SLA rõ.
7. Test access/deletion/export, retry/partial failure, restored backup re-deletion và subprocessor purge.

**Gate:** no orphan PII, retention schedule thực thi được, DPA/legal sign-off khi cần và privacy incident runbook.
