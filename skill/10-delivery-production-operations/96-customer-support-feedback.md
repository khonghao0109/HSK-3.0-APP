---
name: customer-support-feedback
description: "Thiết kế customer support, escalation và feedback loop cho learner/admin. Sử dụng khi xây help/contact, xử lý ticket, release support hoặc tổng hợp insight product."
---

# Customer Support & Feedback

1. Xác định channel, hours, SLA/severity, language và accessibility; in-app help gắn đúng context.
2. Ticket thu tối thiểu account/reference/build/device/time/correlation, không yêu cầu password/token/raw sensitive data.
3. Xác minh identity trước account/data action; role/least privilege, audit và redaction cho support tool.
4. Triage incident/security/privacy/payment/content/bug/how-to theo runbook và escalation owner.
5. Macro/knowledge base versioned, không hứa behavior chưa có; status update rõ cadence/workaround an toàn.
6. Tag feedback taxonomy, dedup và kết hợp telemetry/research; không để volume đơn thuần quyết roadmap.
7. Đo FRT/TTR/reopen/CSAT và root cause; closed-loop báo user khi fix.

**Gate:** no PII leak/unsafe workaround, SLA/escalation rehearsal và recurring issue chuyển thành product/test/runbook action.
