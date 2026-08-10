# Quy trình 09 — Engineering Governance & Developer Experience

## 1. Mục tiêu

Thiết lập cách làm việc kỹ thuật nhất quán: Git, documentation, API contract, dependency, technical debt, feature flag và tooling để đội ngũ thay đổi nhanh nhưng vẫn truy vết và kiểm soát rủi ro.

## 2. Phạm vi skill

Gồm 7 skill từ `87-git-workflow` đến `93-developer-experience-tooling` trong `skill/09-engineering-governance-dx/`.

## 3. Điều kiện đầu vào

- Repo ownership, branching/release model, CI checks và môi trường phát triển.
- Architecture decision process, documentation source of truth và security policy.
- Danh sách pain point về setup, review, build, test và release.

## 4. Trình tự thực hiện

### Giai đoạn 1 — Git workflow và ownership

1. Chọn trunk-based hoặc short-lived branch; giới hạn long-lived divergence.
2. Đặt convention commit/PR, scope, issue link và change summary.
3. Bảo vệ branch bằng review/check theo risk; định nghĩa CODEOWNERS khi cần.
4. Cấm secret/generated artifact lớn và destructive history rewrite ngoài quy trình.

**Gate E1:** Mọi thay đổi production truy được về PR, review, test và release.

### Giai đoạn 2 — Documentation management

1. Phân loại docs: context, product, architecture, API, operations, process và report.
2. Gán owner, source of truth, review date và trạng thái.
3. Cập nhật docs trong cùng change khi contract/schema/operation đổi.
4. Kiểm tra link, duplicate, stale statement và secret/PII.

### Giai đoạn 3 — API documentation/OpenAPI

1. Duy trì schema request/response/error/auth/pagination và example thực tế.
2. Version breaking change; lập deprecation/migration window.
3. Sinh/kiểm tra client contract và diff OpenAPI trong CI.
4. Đồng bộ endpoint runtime, DTO, test và docs.

**Gate E2:** Không merge breaking contract vô tình hoặc endpoint thiếu auth/error/example.

### Giai đoạn 4 — Dependency management

1. Lập policy version, lockfile, registry, license và provenance.
2. Chạy update định kỳ theo batch nhỏ; review changelog/breaking/security.
3. Scan vulnerability và xử lý theo SLA; không auto-merge major không test.
4. Loại dependency không dùng và đo bundle/image impact.

### Giai đoạn 5 — Technical debt

1. Ghi debt với evidence, impact, interest, owner và affected capability.
2. Phân biệt debt chủ động, defect, missing feature và architecture risk.
3. Ưu tiên theo cost of delay/risk; dành capacity thường kỳ.
4. Đóng debt bằng metric/test/removed workaround, không chỉ refactor xong.

### Giai đoạn 6 — Feature flag và experimentation

1. Định nghĩa flag owner, audience, default, dependencies và expiry.
2. Tách release control, ops kill switch, entitlement và experiment assignment.
3. Evaluate server-side cho security/premium; log exposure đúng thời điểm.
4. Có cleanup task và kiểm tra stale flag định kỳ.

**Gate E3:** Không có permanent flag vô chủ hoặc dùng client flag thay authorization.

### Giai đoạn 7 — Developer Experience

1. Đo setup time, feedback loop, build/test duration và lỗi môi trường.
2. Tạo một lệnh bootstrap/check phù hợp repo; validate dependency/config sớm.
3. Chuẩn hóa formatter/linter/typecheck/test hook nhưng tránh hook quá chậm.
4. Cung cấp fixture, local service, debugging, observability và troubleshooting.
5. Theo dõi adoption và loại automation không tạo giá trị.

## 5. Artifact bắt buộc

- Git/PR/review/release policy và ownership matrix.
- Documentation map, owner/review schedule và link check.
- OpenAPI contract/diff policy và client generation strategy.
- Dependency/security/license report và update cadence.
- Debt register, flag registry/cleanup và DX baseline/improvement backlog.

## 6. Chỉ số kiểm soát

- PR cycle/review time, change size và failed-check rework.
- Docs freshness/link failure và API contract drift.
- Vulnerability/dependency update SLA.
- Debt interest/closure, stale flag count.
- Setup time, build/test duration và developer satisfaction.

## 7. Definition of Done

Nhóm 9 hoàn tất khi workflow có thể audit, docs/API không drift, dependency/debt/flag có owner và lifecycle, setup/feedback loop được đo và automation giúp thành viên mới chạy/test/đóng góp mà không cần kiến thức truyền miệng.
