---
name: risk-management
description: "Nhận diện, định lượng, phân công và theo dõi rủi ro sản phẩm, kỹ thuật, dữ liệu, nội dung, pháp lý và vận hành. Sử dụng khi lập kế hoạch, review kiến trúc/schema, chuẩn bị release hoặc khi một giả định quan trọng có thể làm trễ hay làm sai sản phẩm."
---

# Risk Management

## Mục tiêu

Biến rủi ro thành tín hiệu có owner, trigger và phương án ứng phó trước khi chúng trở thành sự cố hoặc nợ không kiểm soát.

## Phân loại

- Product/market: sai vấn đề, adoption thấp, metric không đo được.
- Curriculum/content: sai chuẩn HSK, thiếu chất lượng, thiếu nguồn hoặc license.
- Technical/data: schema sai, migration mất dữ liệu, hiệu năng hoặc integration thất bại.
- Security/privacy/legal: lộ dữ liệu, consent, retention, payment hoặc quyền nội dung.
- Delivery/operations: dependency, capacity, release, backup, monitoring hoặc support.
- AI: hallucination, citation sai, prompt injection, chi phí, latency và data leakage.

## Quy trình

1. Nhận diện rủi ro từ discovery, architecture, data, dependency và pre-mortem.
2. Viết theo dạng nguyên nhân → sự kiện → hậu quả; tránh nhãn mơ hồ.
3. Chấm xác suất và tác động theo thang thống nhất; ghi horizon và confidence.
4. Chọn response: avoid, reduce, transfer, accept hoặc exploit cho opportunity.
5. Gán owner, trigger, mitigation, contingency, deadline và residual risk.
6. Đưa mitigation vào backlog/roadmap nếu cần công việc thực tế.
7. Review định kỳ và tại gate: design freeze, migration, beta, go-live.
8. Đóng risk chỉ khi trigger không còn hoặc residual risk đã được chấp thuận.

## Rủi ro ưu tiên của HSK System

- Nội dung, schema, UI hoặc scoring lệch contract `HSK7_9` và awarded/target band 7–9.
- Nguồn từ điển/nội dung thiếu license, provenance hoặc nghĩa tiếng Việt đạt chuẩn.
- Exam dùng dữ liệu live, làm thay đổi kết quả lịch sử sau khi admin sửa câu hỏi.
- Frontend/AI scaffold bị hiểu nhầm là runtime hoàn chỉnh.
- OAuth, role, premium, offline hoặc OCR xuất hiện trên UI nhưng thiếu owner/schema.
- Local upload, thiếu retention/backup hoặc AI giữ dữ liệu người dùng quá lâu.

## Đầu ra bắt buộc

- Risk register có ID, category, score, owner và status.
- Heatmap hoặc danh sách top risks theo critical path.
- Mitigation/contingency có trigger và due date.
- Risk acceptance ghi người có thẩm quyền và thời hạn xem lại.

## Quality gate

- Không có risk mức cao thiếu owner hoặc action.
- Mitigation phải giảm xác suất/tác động đo được, không chỉ “theo dõi”.
- Contingency phải khả thi trong thời gian phục hồi cho phép.
- Risk pháp lý/bảo mật không do kỹ thuật tự chấp thuận.

## Điều kiện dừng hoặc chuyển cấp

Chặn release khi có rủi ro dữ liệu, bảo mật, bản quyền, payment hoặc exam integrity mức không chấp nhận được và chưa có người đủ thẩm quyền ký chấp nhận.
