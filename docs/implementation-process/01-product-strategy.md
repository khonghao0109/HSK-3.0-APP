# Quy trình 01 — Khởi tạo & Product Strategy

## 1. Mục tiêu

Chuyển một ý tưởng hoặc yêu cầu kinh doanh thành phạm vi sản phẩm HSK có bằng chứng, mô hình domain, chiến lược nội dung, thứ tự ưu tiên và ràng buộc pháp lý đủ rõ để bàn giao cho UX/UI và kiến trúc hệ thống.

## 2. Phạm vi skill

Nhóm này sử dụng 15 skill từ `01-project-onboarding` đến `15-legal-compliance-licensing` trong `skill/01-product-strategy/`.

## 3. Điều kiện đầu vào

- Có người chịu trách nhiệm quyết định sản phẩm.
- Có mô tả vấn đề, nhóm người dùng hoặc mục tiêu kinh doanh ban đầu.
- Truy cập được repo, tài liệu, stakeholder và dữ liệu nghiên cứu hiện có.
- Mọi nguồn nội dung/dataset có thông tin nguồn ban đầu để kiểm tra license.

## 4. Vai trò

| Vai trò | Trách nhiệm chính |
|---|---|
| Product owner | Chốt outcome, ưu tiên, phạm vi và quyết định kinh doanh |
| Tech lead | Xác minh hiện trạng, feasibility, dependency và rủi ro kỹ thuật |
| UX researcher/designer | Kiểm chứng nhu cầu, hành trình và usability |
| Curriculum/content lead | Chốt chuẩn HSK, taxonomy, chất lượng và workflow nội dung |
| Data/analytics | Xác định baseline, event và metric thành công |
| Legal/privacy | Review license, dữ liệu cá nhân, consent và provider |

## 5. Trình tự thực hiện

### Giai đoạn 1 — Onboarding và xác lập nguồn sự thật

1. Dùng `project-onboarding` để chốt mục tiêu, phạm vi và baseline kỹ thuật.
2. Dùng `project-context-management` để phân loại hiện trạng, mục tiêu, quyết định và câu hỏi mở.
3. Dùng `codegraph-repository-intelligence` để xác minh capability đã nối runtime, dependency và vùng ảnh hưởng.
4. Ghi lại mọi mâu thuẫn giữa code, schema, UI, API và roadmap.

**Gate G1:** Có baseline được kiểm chứng, nguồn sự thật và danh sách quyết định mở có owner.

### Giai đoạn 2 — Discovery và nghiên cứu thị trường

1. Viết problem statement riêng cho user và admin.
2. Lập opportunity map cho onboarding, learning, review, exam và retention.
3. Thu thập bằng chứng từ phỏng vấn, feedback, analytics hoặc prototype.
4. Nghiên cứu đối thủ theo tiêu chí cố định; ghi nguồn và ngày xác minh cho dữ liệu biến động.
5. Kết luận `proceed`, `iterate`, `defer` hoặc `stop` cho từng opportunity.

**Gate G2:** Mỗi capability đề xuất có persona, outcome, bằng chứng và metric kiểm chứng.

### Giai đoạn 3 — Đặc tả và backlog có thể kiểm thử

1. Viết requirement chức năng, phi chức năng, dữ liệu, quyền và lifecycle.
2. Bao phủ loading, empty, error, retry, permission, offline và destructive state khi liên quan.
3. Tách thành user story end-to-end; viết Given/When/Then cho happy path và boundary.
4. Lập traceability requirement → design → API → schema → test → analytics.

**Gate G3:** P0 có acceptance criteria, owner, dependency và Definition of Done.

### Giai đoạn 4 — Ưu tiên, giao tiếp và quản trị rủi ro

1. Chấm ưu tiên bằng một khung nhất quán; ghi confidence và nguồn assumption.
2. Vẽ dependency, critical path và capacity dành cho quality/data/operations.
3. Xác lập RACI/DACI, nhịp báo cáo và decision log.
4. Lập risk register cho product, curriculum, data, legal, security, AI và delivery.
5. Chốt roadmap P0/P1/P2 theo outcome và exit criteria.

**Gate G4:** Không có P0 thiếu metric, dependency, risk owner hoặc người quyết định.

### Giai đoạn 5 — Domain, curriculum và content strategy

1. Tạo ubiquitous language, bounded context, aggregate, lifecycle và invariant.
2. Chốt framework/version HSK và cách biểu diễn riêng cấp 1–9.
3. Tạo competency map, objective, prerequisite và assessment blueprint.
4. Kiểm kê content; chốt taxonomy, metadata, source, license, version và workflow.
5. Thiết kế QA học thuật, import/validation, revision, publish và archive.

**Gate G5:** Mọi lesson/activity/question truy được về objective và source; published content có owner, review và version.

### Giai đoạn 6 — Business model và legal readiness

1. Chốt user/customer/payer, value metric và giả thuyết free/premium.
2. Mô hình unit economics gồm content, AI, speech, storage, payment và support.
3. Thiết kế entitlement phía server cùng lifecycle trial/renew/cancel/refund.
4. Lập data map, retention schedule, license registry và subprocessor registry.
5. Nhận legal sign-off cho các vấn đề cần chuyên gia.

**Gate G6:** Không có dữ liệu/content/payment flow thiếu owner, lawful basis/license, retention và đường xóa.

### Giai đoạn 7 — Product Strategy Sign-off

1. Tổng hợp product brief, roadmap, domain map, curriculum/content plan và risk register.
2. Tổ chức review với product, engineering, design, content, data và legal.
3. Ghi quyết định, ngoại lệ, người phê duyệt và ngày xem lại.
4. Bàn giao package đã version cho nhóm UX/UI và System Architecture.

## 6. Bộ artifact bắt buộc

- Product/context brief và baseline repo.
- Discovery brief, competitor matrix và opportunity map.
- Requirement specification, story map và traceability matrix.
- Roadmap P0/P1/P2, stakeholder map, decision log và risk register.
- Domain glossary/context map.
- Curriculum map HSK 1–9, content model, sourcing và quality workflow.
- Business model, entitlement matrix, compliance/data/license registry.

## 7. Chỉ số kiểm soát

- 100% P0 có outcome, owner, acceptance criteria và metric.
- 100% content source có license/provenance trước ingest hoặc publish.
- 100% quyết định critical có decider, rationale và review date.
- Không có UI capability P0 thiếu API/schema/feature owner.
- Không có risk mức cao thiếu mitigation hoặc acceptance có thẩm quyền.

## 8. Definition of Done

Nhóm 1 hoàn tất khi package chiến lược được phê duyệt, traceability không có khoảng trống P0, các quyết định HSK/data/legal quan trọng đã chốt hoặc có owner/date, và hai nhóm tiếp theo có đủ đầu vào để thiết kế mà không phải tự phát minh requirement.

## 9. Bàn giao

- Cho UX/UI: persona, problem, journey, requirement, priority, content model và accessibility constraints.
- Cho Architecture: domain map, NFR, data ownership, integration, security/privacy và volume assumption.
- Cho Delivery: milestone, dependency, risk, metric, owner và decision cadence.
