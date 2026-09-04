> **ARCHIVED 04/09/2026.** Tài liệu này đã bị thay thế và không phản ánh trạng thái hiện tại. Xem `docs/archive/README.md` và `docs/PLAN.md`. Liên kết tương đối bên trong có thể đã lỗi thời.

# Báo cáo Nhóm 10 — Delivery & Production Operations

> Cập nhật: 13/08/2026
>
> Baseline kiểm tra: branch macdev, commit a86b6224b53b840373d697f9f45509cf47e7eb6f
>
> Trạng thái tổng thể: IN PROGRESS — NOT PRODUCTION READY

## 1. Kết luận điều hành

File này trước đây chỉ là placeholder “chưa thực hiện”. Trạng thái đó không còn đúng:

- Bộ skill/playbook Nhóm 10 đã đủ 5/5 và sẵn sàng sử dụng.
- Repository đã delivery nhiều vertical slice và có release controls đáng kể cho Media.
- Tuy nhiên năng lực production operations toàn dự án chưa đạt Definition of Done Nhóm 10.

Trạng thái chính xác:

| Phạm vi                 | Trạng thái                 |
| ----------------------- | -------------------------- |
| Skill/playbook Nhóm 10  | READY — 5/5                |
| Project delivery        | PARTIAL                    |
| Media release readiness | INTERNAL CLOSEOUT REQUIRED |
| Live infrastructure     | BLOCKED_EXTERNAL           |
| Production rollout      | NOT STARTED                |
| Customer support        | NOT IMPLEMENTED            |
| Trust & Safety          | PARTIAL FOUNDATION         |
| DR/BCP                  | NOT IMPLEMENTED            |
| Post-release review     | NOT APPLICABLE             |

Không được suy rộng Media CODE_READY thành project-wide PRODUCTION_READY.

## 2. Phạm vi và phương pháp

Đánh giá theo năm skill:

1. Project Management & Delivery.
2. Release Management.
3. Customer Support & Feedback.
4. Content Moderation & Trust & Safety.
5. Disaster Recovery & Business Continuity.

Evidence được lấy từ runtime/source, Git history, migration, ops artifacts, ADR và runbook tại baseline. Test count/checksum cũ không được dùng làm bằng chứng cho release mới nếu chưa chạy trên current HEAD.

CodeGraph tại baseline:

- 316 files.
- 3.480 nodes.
- 7.132 edges.
- 8,32 MB.
- Index up to date.

## 3. Project Management & Delivery — PARTIAL

### 3.1 Đã có

Git history cho thấy delivery theo vertical slice tương đối rõ:

1. P0 schema và integrity.
2. Auth hardening.
3. Onboarding Goal & Learning Plan.
4. CMS Lesson/Topic workflow.
5. Lesson Activity & Progress.
6. Exercise Authoring & Import.
7. Frontend Admin foundation.
8. Media Admin Library.
9. Secure Media Ingestion.
10. Media provenance, telemetry và operations hardening.

Mỗi slice quan trọng đã có một phần đáng kể của code, test, migration/ADR và documentation.

### 3.2 Khoảng trống

- Roadmap cũ không phản ánh trạng thái runtime và dependency thật; đã được thay bằng roadmap capability-based.
- Chưa có một milestone register sống với outcome, owner, dependency, range estimate, confidence và exit criteria.
- Chưa thấy project-wide RACI/DACI, risk register, decision log và change-control cadence được vận hành.
- Chưa có release train/capacity plan hoặc product KPI được Product Owner phê duyệt.
- Frontend learner, SRS, Exam, Analytics, Support và AI dễ bị hiểu nhầm từ schema/mockup là đã gần hoàn thành.

### 3.3 Gate tiếp theo

- Dùng docs/product/roadmap.md làm sequencing source.
- Tạo owner/risk/decision/milestone register trước khi cam kết timeline.
- Mỗi milestone phải là vertical slice end-to-end và có Definition of Done production theo mức rủi ro.

## 4. Release Management — PARTIAL, MEDIA-FOCUSED

### 4.1 Đã có

Media hiện là capability có release artifacts đầy đủ nhất:

- Forward migration và database integrity/concurrency harness.
- Kill switch cho ingestion.
- Nginx signed-media/security configuration.
- Prometheus rules, Grafana dashboard và Alertmanager configuration.
- Kubernetes topology artifacts.
- Media release runbook, rollback/forward-recovery guidance.
- Machine-readable local JSON/JUnit/sanitized logs cho ops harness.
- Boundary rõ giữa CODE_READY, BLOCKED_EXTERNAL và production release.

### 4.2 Trạng thái thực của evidence

- Bảy internal Media validators đã từng PASS trên Darwin ARM64.
- production-runbook-url trả BLOCKED_EXTERNAL.
- Overall ops gate exit code là 2.
- Evidence nằm ở local ignored artifacts; chưa phải immutable CI attestation.
- Vòng review hiện tại đã phát hiện P1 về runtime deadline, cleanup recovery, secret scan, SLO truthfulness, migration deployment, Linux AMD64 và topology. Vì vậy không ghi Internal Ops PASS cho tới khi closeout mới đạt.

### 4.3 Khoảng trống project-wide

- Không có tracked .github workflow/CI pipeline.
- Không có project-wide Docker image build/promotion.
- Không có immutable release manifest gắn requirement → commit → artifact digest → migration → config/flag.
- Chưa có SBOM, signature/provenance policy và registry promotion.
- Chưa có production-like staging rehearsal toàn dự án.
- Chưa có canary/cohort rollout, observation window, go/no-go authority và production smoke evidence.
- Chưa có release tag hoặc production deployment evidence.

### 4.4 Gate tiếp theo

1. Đóng toàn bộ Media P0/P1 nội bộ.
2. Chạy full gate trên Linux AMD64 và validate exact rendered artifact.
3. Chạy Live Media Infrastructure Rehearsal với provider/hạ tầng thật.
4. Sau đó xây release engineering project-wide trước Web MVP Beta.

## 5. Production Rollout — NOT STARTED

Không tìm thấy bằng chứng:

- Production release tag/candidate được promote.
- Canary hoặc phased rollout.
- Production observation window.
- Status communication và hypercare.
- Post-deploy business/integrity verification.
- Rollback/roll-forward đã rehearsal trên production-like environment toàn dự án.

Production chỉ được chuyển khỏi NOT STARTED khi cùng immutable artifact đã qua staging và go/no-go có owner.

## 6. Customer Support & Feedback — NOT IMPLEMENTED

### 6.1 Foundation hiện có

- Alertmanager có page/ticket receiver contract và send_resolved.
- Runbook Media có owner/escalation cho một số alert.

Đây chỉ là technical alert routing, không phải customer support readiness.

### 6.2 Thiếu

- SupportTicket/SupportMessage hoặc domain tương đương.
- Help/contact/report flow cho learner/admin.
- Support API và admin queue.
- Identity verification trước account/data action.
- Ticket taxonomy cho account, content, learning, exam, privacy, payment, AI, abuse và incident.
- Severity/SLA/escalation, macro/knowledge base và privacy-safe evidence contract.
- FRT, TTR, reopen, CSAT và feedback-to-product loop.
- Live webhook/provider delivery evidence.

### 6.3 Gate hoàn thành V1

- User gửi ticket/report và nhận reference an toàn.
- Support xác minh quyền, triage, cập nhật và đóng case có audit.
- High-severity/security/privacy case có escalation rehearsal.
- Không yêu cầu password, token hoặc raw sensitive payload.
- Recurring issue được nối tới backlog/test/runbook.

## 7. Trust & Safety — PARTIAL FOUNDATION

### 7.1 Đã có

- ContentRevision/ContentReview append-only.
- AuditLog.
- Publish readiness và provenance/license controls.
- Malware scan cho upload.
- Media quarantine và soft archive.
- Fail-closed content/media visibility khi dependency không còn ready.

### 7.2 Thiếu

- Policy tổng quát theo loại harm/content/user/AI.
- Content report và moderation case.
- Enforcement reason taxonomy.
- Appeal/review workflow.
- Moderator/support role tách biệt; role runtime hiện chủ yếu user/admin.
- Queue SLA, quality sampling, fairness/false-positive review.
- User notification, evidence retention và legal escalation path.

### 7.3 Gate hoàn thành V1

- Report → triage → action → notification → appeal → final audit chạy end-to-end.
- High-severity queue luôn có owner và SLA.
- Moderator least privilege và separation of duties.
- Malware/content/license/PII/AI cases có policy và runbook phù hợp.

## 8. Disaster Recovery & Business Continuity — NOT IMPLEMENTED

### 8.1 Foundation hiện có

- Một số Media failure có forward-recovery guidance.
- Database migration policy là forward-only và protected DB guard đã có.

Đây không thay thế backup/restore hoặc BCP.

### 8.2 Thiếu

- Business Impact Analysis và service/data tier.
- RPO/RTO được phê duyệt.
- PostgreSQL backup/PITR configuration.
- Object-storage recovery/versioning/retention strategy.
- Independent/off-site copy và credential/blast-radius design.
- Restore automation và isolated restore evidence.
- Dependency map cho DNS/CDN, identity, compute, DB, object storage, secret manager và people.
- Incident commander/contact tree, break-glass, crisis communication.
- Provider/region/account failure, data corruption và credential compromise rehearsal.
- Failover/failback và post-restore reconciliation.

### 8.3 Gate hoàn thành V1

- Restore tạo hệ thống dùng được, không chỉ tạo file backup.
- Actual RPO/RTO được đo và nằm trong mục tiêu.
- Core journey, migration catalog, immutable fact và privacy lifecycle được reconciliation.
- Tabletop + technical drill có gap, owner và deadline đóng.

## 9. Post-release Review — NOT APPLICABLE

Chưa có production release nên chưa thể có:

- Outcome/KPI review.
- Incident/support/cost/toil analysis.
- Error-budget review.
- Release retrospective.
- Post-release action closure.

Không tạo báo cáo post-release giả từ local test.

## 10. Ma trận readiness tổng hợp

| Gate                           | Trạng thái               | Bằng chứng cần thêm                                               |
| ------------------------------ | ------------------------ | ----------------------------------------------------------------- |
| Scoped vertical-slice delivery | PARTIAL PASS             | Milestone/owner/KPI/capacity register                             |
| Media code implementation      | PASS cho commit hiện tại | Closeout các P1 mới phát hiện                                     |
| Media internal ops             | FAIL/IN PROGRESS         | Linux AMD64 + deadline/recovery/SLO/migration/topology evidence   |
| Live Media rehearsal           | BLOCKED_EXTERNAL         | Real HTTPS runbook, S3, ClamAV, mesh, replicas, alerts, rollback  |
| Learner Web MVP                | NOT READY                | Onboarding/Learning/Dictionary/SRS/Exam frontend end-to-end       |
| Project CI/CD                  | NOT IMPLEMENTED          | Required workflow, immutable build/promote, security supply chain |
| Project observability          | NOT READY                | Journey SLI/SLO, logs/traces/dashboard/alert/runbook              |
| Support                        | NOT IMPLEMENTED          | Ticket/report workflow và SLA                                     |
| Trust & Safety                 | PARTIAL                  | Policy/report/action/appeal                                       |
| Backup/restore/DR              | NOT IMPLEMENTED          | BIA, RPO/RTO, restore/failover drill                              |
| Production go-live             | BLOCKED                  | Tất cả critical gate và risk approval                             |

## 11. Critical path tới production

1. Media Runtime & Ops internal closeout.
2. Live Media Infrastructure Rehearsal.
3. Content/license/data readiness.
4. Identity/session/privacy completion.
5. Learner learning loop.
6. SRS và Exam loop.
7. Admin operations, analytics, support và trust/safety.
8. Project-wide CI/CD, observability, backup/DR.
9. Production-like staging rehearsal.
10. Progressive Web MVP Beta.
11. Production go/no-go và observation window.

## 12. Ownership cần chốt

| Area                          | Decision owner cần có                                     |
| ----------------------------- | --------------------------------------------------------- |
| Scope/KPI/roadmap             | Product Owner                                             |
| Curriculum/content/license    | Curriculum + Content/Legal owner                          |
| Architecture/backend/frontend | Tech Lead + domain owner                                  |
| Security/privacy/trust        | Security/Privacy owner; legal khi cần                     |
| Data/migration/backup         | Data/DB owner                                             |
| Release/infrastructure/SLO    | Release Owner + SRE                                       |
| Support/moderation            | Operations/Support/T&S owner                              |
| Go/no-go                      | Product, Engineering, QA, Security, Data và SRE theo RACI |

Không tự gán người cụ thể khi chưa được tổ chức phê duyệt.

## 13. Definition of Done Nhóm 10

Nhóm 10 chỉ DONE khi:

- Một release production thực đã được triển khai progressive và quan sát an toàn.
- Release manifest/artifact/migration/config/flag có traceability và rollback/roll-forward evidence.
- Support tiếp nhận và xử lý được vấn đề thật với SLA, privacy và audit.
- Trust & Safety có policy, report/action/appeal và escalation.
- Backup restore và DR/BCP drill đạt RPO/RTO.
- Production outcome, incident, support, cost và toil được review.
- Mọi action còn lại có owner, deadline và evidence đóng.

Hiện chưa thỏa các điều kiện này.

## 14. Hành động kế tiếp

### Ngay bây giờ

- Thực hiện Media Runtime Deadlines, Lifecycle Recovery & Production Operations Truthfulness Closeout.
- Giữ live release BLOCKED cho tới khi internal P0/P1 bằng 0.
- Chốt milestone/owner/risk/decision register theo roadmap mới.

### Sau internal closeout

- Live Media Infrastructure Rehearsal.
- Release engineering baseline: CI, container, immutable artifact, SBOM/provenance và staging.
- Content/license + Identity/Privacy readiness.

### Trước Web MVP Beta

- Learner learning/SRS/exam flows.
- Product-wide observability.
- Support/T&S V1.
- Backup/restore/DR V1.
- Staging/go-no-go/progressive rollout rehearsal.

## 15. Tài liệu liên quan

- Quy trình kỹ thuật (đã gộp): ../../process/engineering-process.md
- Roadmap hiện hành: ../../product/roadmap.md
- Production master plan: ../PRODUCT_IMPLEMENTATION_MASTER_PLAN.md
- Media release runbook: ../../operations/MEDIA_INGESTION_RELEASE_RUNBOOK.md
- Media closeout: ../MEDIA_OBSERVABILITY_EDGE_SECURITY_CLOSEOUT.md
