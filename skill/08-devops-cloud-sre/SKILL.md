---
name: 08-devops-cloud-sre
description: "Handle HSK environment, infrastructure, CI/CD, technical staging/promotion, observability, incidents and database operations. Use for platform/runtime delivery, not cross-functional release communication."
---

# DevOps, Cloud & SRE

1. Infrastructure/config qua code và review; environment parity, secret manager và least privilege.
2. Build artifact một lần, scan/sign/provenance rồi promote; migration job tách và backward-compatible.
3. Deploy progressive với readiness, SLO/abort threshold, automated/manual rollback đã rehearsal.
4. Runtime correctness không phụ thuộc một process; multi-AZ/shared service/autoscaling chỉ khi SLO, failure boundary hoặc tải đo được yêu cầu.
5. Telemetry/runbook và restore evidence tỷ lệ với criticality của release.
6. Đọc đúng playbook và phần liên quan tại `../hsk-production-delivery/references/production-quality-baseline.md`.

## Playbook theo nhu cầu

- Platform: [Environment](78-environment-configuration.md), [Containers](79-docker-containers.md), [Cloud/IaC](80-cloud-infrastructure.md).
- Delivery: [CI/CD](81-ci-cd.md), [Staging/release](82-staging-release-management.md).
- Reliability: [Observability](83-observability-monitoring.md), [Incident](84-incident-response.md), [Database ops](85-database-operations.md), [Scale/cost](86-scaling-cost-optimization.md).

Không thao tác protected environment khi thiếu phạm vi/phê duyệt; diagnostic read-only không mở rộng thành mutation.
