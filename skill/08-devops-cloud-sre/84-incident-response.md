---
name: incident-response
description: "Điều phối incident response và blameless postmortem cho outage, data/security hoặc severe degradation. Sử dụng khi production symptom vượt threshold hoặc rehearsal."
---

# Incident Response

1. Detect/declare severity theo user/data/security impact; mở incident channel/timeline và phân Incident Commander, Ops, Comms, Scribe.
2. Ưu tiên containment/mitigation an toàn: flag, rollback, rate/load shed, isolate credential; bảo toàn evidence.
3. Theo dõi hypothesis bằng data; không chạy destructive command/prod query rộng khi chưa peer-check/backup.
4. Communication cadence nêu impact, phạm vi, mitigation, next update; security/privacy theo breach/legal path.
5. Xác nhận recovery bằng SLI + business/data reconciliation, không chỉ service “up”.
6. Postmortem timeline/root/systemic contributors, what worked, action owner/deadline; không đổ lỗi cá nhân.
7. Chuyển action thành test/automation/runbook/architecture và rehearsal.

**Gate:** MTTA/MTTR/impact ghi được, credential/data follow-up đóng, action priority theo recurrence/blast radius.
