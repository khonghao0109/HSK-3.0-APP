---
name: user-stories-acceptance-criteria
description: "Tách requirement thành user story nhỏ, độc lập và acceptance criteria theo hành vi có thể kiểm thử. Sử dụng khi refinement backlog, chuẩn bị sprint, viết test case hoặc làm rõ các trạng thái user/admin của module HSK."
---

# User Stories & Acceptance Criteria

## Mục tiêu

Biến phạm vi sản phẩm thành lát cắt giá trị có thể hoàn thành, demo và kiểm thử độc lập mà không mất liên kết tới outcome.

## Quy trình

1. Chọn một persona và một kết quả người dùng cho mỗi story.
2. Viết story: “Là [persona], tôi muốn [khả năng] để [giá trị]”.
3. Tách theo workflow hoặc rule, không tách máy móc theo frontend/backend/database.
4. Giữ story nhỏ nhưng end-to-end; dùng enabler story riêng cho nền tảng cần thiết.
5. Viết acceptance criteria dạng Given/When/Then cho happy path và boundary chính.
6. Bổ sung loading, empty, invalid, unauthorized, conflict, timeout, retry và recovery khi áp dụng.
7. Gắn requirement ID, priority, dependency, analytics event và test level.
8. Xác định Definition of Ready trước khi đưa vào sprint và Definition of Done trước khi đóng.

## Checklist INVEST

- Independent: giảm phụ thuộc tuần tự không cần thiết.
- Negotiable: mô tả outcome, không khóa giải pháp sớm.
- Valuable: tạo giá trị cho user/admin hoặc giảm rủi ro rõ ràng.
- Estimable: rule và dependency đủ rõ để ước lượng.
- Small: có thể hoàn thành trong một sprint.
- Testable: có tiêu chí pass/fail quan sát được.

## Trường hợp HSK bắt buộc bao phủ

- User chỉ xem nội dung `published` và có entitlement phù hợp.
- Autosave exam idempotent; resume không mất đáp án; submit tạo snapshot ổn định.
- Review queue tính đúng theo timezone và không phát sinh item trùng.
- Dictionary xử lý Hanzi, Pinyin có/không dấu, tiếng Việt/Anh và empty result.
- Admin import có preview, validation, duplicate report và rollback an toàn.
- Account deletion/export tôn trọng retention và dữ liệu phụ thuộc.

## Đầu ra bắt buộc

- Story có ID, persona, value, priority và dependency.
- Acceptance criteria Given/When/Then.
- Test notes và dữ liệu mẫu cần thiết.
- Definition of Ready/Done áp dụng cho story.

## Quality gate

- Không viết story kiểu “Là developer, tôi muốn làm API” trừ enabler có outcome/risk rõ.
- Không gộp nhiều persona hoặc nhiều outcome độc lập trong một story.
- Acceptance criteria không lặp lại UI mockup; phải mô tả hành vi và kết quả.
- Mọi P0 đều có negative/permission path tối thiểu.

## Điều kiện dừng hoặc chuyển cấp

Đưa story về refinement nếu không thể xác định dữ liệu, quyền, result state hoặc cách kiểm thử mà không tự tạo thêm requirement.
