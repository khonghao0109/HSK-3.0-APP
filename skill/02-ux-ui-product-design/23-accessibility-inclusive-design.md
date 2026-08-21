---
name: accessibility-inclusive-design
description: "Thiết kế, triển khai và kiểm thử accessibility WCAG 2.2 AA cho HSK 3.0. Sử dụng khi tạo/review page, form, navigation, media, learning activity, exam hoặc shared component."
---

# Accessibility & Inclusive Design

## Quy trình

1. Xác định semantic structure, landmark, heading, label/name/role/value và focus order từ thiết kế.
2. Chọn native element trước ARIA; mọi action dùng được bằng keyboard và touch.
3. Cung cấp focus-visible, skip link, error summary, focus restoration cho modal/route và live region có kiểm soát.
4. Kiểm tra contrast 4.5:1 text, 3:1 large/UI; không truyền nghĩa chỉ bằng màu.
5. Hỗ trợ zoom 200–400%, reflow 320px, reduced motion, high contrast và text dài.
6. Media có transcript/caption; audio learning có điều khiển accessible và không autoplay gây hại.
7. Chạy static rule/axe, keyboard manual và screen reader smoke trên flow trọng yếu.

## Release gate

- Không critical/serious automated violation chưa xử lý.
- Login, onboarding, lesson, review, exam và CMS primary flows hoàn tất không dùng chuột.
- Validation nêu lỗi cụ thể và liên kết field; timeout không lấy mất dữ liệu.
- Known exception có owner, severity, workaround và deadline; không dùng overlay để thay sửa code.
