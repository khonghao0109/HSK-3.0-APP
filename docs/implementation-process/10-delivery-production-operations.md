# Quy trình 10 — Delivery & Production Operations

## 1. Mục tiêu

Điều phối từ kế hoạch đến production, phát hành có kiểm soát, tiếp nhận feedback/support, bảo vệ trust & safety và duy trì khả năng phục hồi kinh doanh.

## 2. Phạm vi skill

Gồm 5 skill từ `94-project-management-delivery` đến `98-disaster-recovery-business-continuity` trong `skill/10-delivery-production-operations/`.

## 3. Điều kiện đầu vào

- Roadmap/release scope, dependency, capacity, risk, quality evidence và SLO.
- Product/engineering/content/support/operations owner rõ ràng.
- Release pipeline, observability, runbook và communication channel hoạt động.

## 4. Trình tự thực hiện

### Giai đoạn 1 — Delivery planning

1. Chuyển roadmap thành milestone theo outcome, không chỉ task/layer.
2. Lập dependency/critical path, capacity, assumption và risk buffer.
3. Gán owner, Definition of Ready/Done và review cadence.
4. Theo dõi blocker, scope change và decision; không che rủi ro bằng phần trăm cảm tính.

**Gate P1:** Milestone có outcome, exit criteria, owner, dependency và release target khả thi.

### Giai đoạn 2 — Release readiness

1. Chốt release manifest gồm code, migration, config, content, flag và dependency version.
2. Tổng hợp quality/security/privacy/legal/content/operations sign-off.
3. Chạy staging rehearsal, smoke, migration và rollback test.
4. Chuẩn bị support brief, status communication, dashboard và on-call.
5. Ra quyết định go/no-go bằng evidence; ghi waiver và người chấp thuận.

**Gate P2:** Không release khi rollback, monitoring, owner hoặc blocker critical chưa xử lý.

### Giai đoạn 3 — Production rollout

1. Chọn canary/phased/blue-green/rolling theo blast radius.
2. Thực hiện migration theo runbook và kiểm tra health/data invariant.
3. Bật flag theo cohort; theo dõi SLI, business metric, error và support signal.
4. Pause/rollback khi vượt trigger; ghi timeline và decision.
5. Xác nhận post-deploy và thông báo trạng thái.

### Giai đoạn 4 — Customer support và feedback loop

1. Phân loại ticket/feedback: account, content, learning, exam, payment, AI, abuse và incident.
2. Gán severity/SLA/owner; liên kết request ID, user consent và reproduction evidence.
3. Tạo knowledge base/macro nhưng không che trường hợp cần điều tra riêng.
4. Chuyển signal lặp lại thành product/content/quality backlog và đo closure.

**Gate P3:** Ticket high-impact có escalation và user communication phù hợp.

### Giai đoạn 5 — Content moderation, trust & safety

1. Định nghĩa policy cho user content, feedback, AI output, harassment, spam và harmful content.
2. Thiết kế report, triage, evidence, action, appeal và audit.
3. Hạn chế quyền moderator, bảo vệ người báo cáo và dữ liệu nhạy cảm.
4. Review false positive/negative, bias, response time và policy update.

### Giai đoạn 6 — DR và business continuity

1. Thực hiện business impact analysis; phân tier service/data/process.
2. Chốt RPO/RTO, backup/restore, alternate provider và manual workaround.
3. Viết disaster communication, authority, contact và decision tree.
4. Chạy table-top/technical drill; ghi evidence, gap và remediation.
5. Review plan sau kiến trúc/provider/team thay đổi.

**Gate P4:** DR drill chứng minh recovery trong mục tiêu và business process quan trọng có workaround.

### Giai đoạn 7 — Post-release review

1. So sánh outcome/guardrail với baseline và hypothesis.
2. Review incident, support, content quality, cost và operational toil.
3. Chốt keep/iterate/rollback/deprecate và cập nhật roadmap.
4. Đóng action có evidence hoặc chuyển owner/date rõ ràng.

## 5. Artifact bắt buộc

- Delivery plan, milestone/dependency/risk/status log.
- Release manifest, readiness checklist, go/no-go và rollback evidence.
- Support runbook, ticket taxonomy, feedback insight report.
- Trust & safety policy, moderation/appeal/audit flow.
- BIA, DR/BCP plan, contact tree và drill report.
- Post-release outcome review.

## 6. Chỉ số kiểm soát

- Milestone predictability, blocker age và scope churn.
- Deployment success/change failure/rollback/MTTR.
- Ticket volume, first response, resolution, reopen và satisfaction.
- Moderation SLA, appeal overturn và harm recurrence.
- DR drill pass, RPO/RTO thực đo và continuity gap closure.

## 7. Definition of Done

Nhóm 10 hoàn tất khi release được triển khai và quan sát an toàn, support/trust workflow tiếp nhận được vấn đề thật, outcome được review, DR/BCP được diễn tập và mọi action sau production có owner, deadline và bằng chứng đóng.
