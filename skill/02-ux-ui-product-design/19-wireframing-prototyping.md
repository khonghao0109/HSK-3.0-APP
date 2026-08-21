---
name: wireframing-prototyping
description: "Tạo wireframe/prototype để kiểm chứng cấu trúc và interaction trước khi code. Sử dụng cho flow mới, thay đổi IA đáng kể, modal/form phức tạp hoặc khi ảnh mẫu chưa mô tả đủ trạng thái."
---

# Wireframing & Prototyping

## Quy trình

1. Map màn hình tới ảnh chính thức; không thay bố cục đã chốt bằng wireframe tùy ý.
2. Chọn fidelity theo rủi ro: low-fi cho flow/IA, high-fi cho interaction/visual/accessibility.
3. Dùng dữ liệu HSK thực tế và trường hợp dài/rỗng/lỗi; không chỉ lorem ipsum.
4. Prototype happy path cùng validation, retry, forbidden, destructive confirmation và resume.
5. Thể hiện keyboard focus, screen-reader label, touch target và reduced motion.
6. Kiểm tra 1440, 768, 390; table có chiến lược scroll/priority/card rõ.
7. Ghi annotation cho state, token, component, API và hành vi không nhìn thấy trong ảnh.

## Cổng handoff

- Prototype trả lời được câu hỏi rủi ro đã đặt ra.
- Link/phiên bản cố định, có owner và quyết định đã duyệt.
- Không dùng prototype như source of truth duy nhất; acceptance criteria và design spec phải đồng bộ.
- Khác biệt với ảnh mẫu được phê duyệt và ghi lý do.
