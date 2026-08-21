---
name: information-architecture
description: "Thiết kế và kiểm tra cấu trúc nội dung, navigation, taxonomy và URL của HSK 3.0. Sử dụng khi thêm module/page, thay đổi menu, phân quyền hiển thị, tìm kiếm hoặc tổ chức nội dung user/admin."
---

# Information Architecture

## Mục tiêu

Giúp user/admin tìm đúng nội dung bằng cấu trúc ổn định, có thể deep-link, mở rộng mà không làm phình navigation.

## Quy trình

1. Đọc phân cấp chức năng, persona, quyền và ảnh mẫu đúng module trong `docs/ui_image`.
2. Lập content inventory; gắn mỗi đối tượng với owner, lifecycle, permission và nguồn dữ liệu.
3. Vẽ sitemap user/admin riêng; xác định global, local, contextual navigation và search.
4. Chốt taxonomy HSK1–HSK6, HSK7_9, skill, topic, status và provenance; tránh hai thuật ngữ cho một khái niệm.
5. Chốt URL bền vững, canonical, filter/query, breadcrumb, back behavior và deep link.
6. Map từng route tới ảnh mẫu, page/component, API và analytics event.
7. Kiểm tra card sorting/tree testing với tác vụ thật; sửa theo bằng chứng, không theo sở thích.

## Quality gate

- Mọi destination có tên theo ngôn ngữ người dùng, không lộ thuật ngữ nội bộ.
- Admin và user không nhìn thấy action ngoài quyền; server vẫn là nơi enforce authorization.
- Navigation tối đa hóa khả năng tìm thấy nhưng không trùng cấp hay tạo ngõ cụt.
- Mobile giữ core navigation và back stack; URL desktop vẫn chia sẻ được.
- Sitemap, permission matrix và route inventory được cập nhật cùng thay đổi.
