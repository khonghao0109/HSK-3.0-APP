# Quy trình 08 — DevOps, Cloud & SRE

## 1. Mục tiêu

Tạo môi trường, pipeline, hạ tầng, quan sát và vận hành tin cậy để phát hành lặp lại, phục hồi được và kiểm soát chi phí từ local đến production.

## 2. Phạm vi skill

Gồm 9 skill từ `78-environment-configuration` đến `86-scaling-cost-optimization` trong `skill/08-devops-cloud-sre/`.

## 3. Điều kiện đầu vào

- Architecture/deployment topology, service dependency, data classification và SLO.
- Build/test command, migration strategy, secret inventory và cloud budget.
- Owner/on-call/escalation, domain/DNS/TLS và environment promotion policy.

## 4. Trình tự thực hiện

### Giai đoạn 1 — Environment và configuration

1. Chuẩn hóa local/dev/test/staging/prod parity và version pinning.
2. Duy trì `.env.example`; validate required variable và fail fast.
3. Lưu secret trong secret manager; phân quyền/rotate/audit, không commit secret.
4. Tách config khỏi build artifact và ghi matrix theo environment.

**Gate O1:** Môi trường có thể bootstrap từ tài liệu, không cần secret truyền tay hoặc thao tác ẩn.

### Giai đoạn 2 — Container và supply chain

1. Tạo multi-stage image, non-root user, minimal base và healthcheck.
2. Pin dependency/image digest khi cần; tạo SBOM và scan vulnerability/license.
3. Không bake secret/data vào layer; đặt resource limit và graceful shutdown.
4. Test image bằng cùng command sẽ chạy production.

### Giai đoạn 3 — Infrastructure as Code

1. Mô hình network, compute, database, cache, queue, storage, CDN và IAM bằng IaC.
2. Tách state/environment; review plan trước apply và chống drift.
3. Thiết kế encryption, private access, backup, quota và tagging/cost allocation.
4. Test restore và disaster dependency, không chỉ provision.

**Gate O2:** Production change có plan/review/audit và không cần console mutation ngoài break-glass.

### Giai đoạn 4 — CI/CD

1. Chạy format/lint/build/unit/integration/schema/security trên commit/PR phù hợp.
2. Tạo artifact/image một lần, ký/version và promote cùng artifact qua môi trường.
3. Gate migration, contract, smoke và approval theo risk.
4. Dùng OIDC/short-lived credential; giới hạn permission của runner.

### Giai đoạn 5 — Staging và release management

1. Duy trì staging gần production về topology/config/data shape nhưng không chứa PII thật.
2. Chạy migration rehearsal, e2e, load/smoke và rollback drill.
3. Chọn rolling, blue-green hoặc canary; dùng feature flag cho capability phù hợp.
4. Ghi release manifest, change, owner, dashboard và rollback trigger.

**Gate O3:** Artifact, migration, config và rollback đều được xác minh trước production.

### Giai đoạn 6 — Observability và SRE

1. Thiết kế structured log, metric, trace và correlation/request ID.
2. Định nghĩa SLI/SLO cho availability, latency, correctness và freshness.
3. Alert theo user impact/burn rate; tránh alert không hành động được.
4. Tạo dashboard và runbook gắn với mỗi alert quan trọng.

### Giai đoạn 7 — Incident response

1. Phân severity, commander, communication, escalation và evidence retention.
2. Ưu tiên giảm impact, sau đó mới điều tra root cause.
3. Ghi timeline, decision, recovery và customer update.
4. Postmortem blameless với action có owner/date và verification.

**Gate O4:** Dịch vụ critical có on-call/runbook/alert và đã diễn tập incident chính.

### Giai đoạn 8 — Database operations, scaling và cost

1. Theo dõi connection, slow query, lock, replica lag, storage và backup.
2. Rehearse migration/backfill/restore; đặt guard cho destructive change.
3. Scale từ measurement: cache/index/queue/read replica trước khi tăng hạ tầng tùy tiện.
4. Gắn cost theo service/environment/feature; đặt budget/anomaly alert.
5. Tối ưu nhưng không phá SLO, security hoặc recovery posture.

## 5. Artifact bắt buộc

- Environment/config/secret matrix và bootstrap guide.
- Dockerfile/image/SBOM/scan report.
- IaC, architecture diagram và change plan.
- CI/CD pipeline, release manifest và rollback/runbook.
- SLO/SLI, dashboard/alert, incident/postmortem template.
- DB operations, capacity và cost report.

## 6. Chỉ số kiểm soát

- Deployment frequency, lead time, change failure rate và MTTR.
- Availability/latency/error budget và alert precision.
- Backup/restore success, RPO/RTO và migration failure.
- Vulnerability SLA, secret age và IAM findings.
- Cost theo active user/request/AI interaction và budget variance.

## 7. Definition of Done

Nhóm 8 hoàn tất khi artifact được build/promote lặp lại, production change có audit/rollback, SLO có telemetry/alert/runbook, restore/incident drill đạt mục tiêu và chi phí có owner cùng guardrail.
