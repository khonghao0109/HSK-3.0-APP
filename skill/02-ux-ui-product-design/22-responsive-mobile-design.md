---
name: responsive-mobile-design
description: "Thiết kế responsive/adaptive cho web và mobile HSK 3.0. Sử dụng khi page/component phải hoạt động trên desktop, tablet, mobile, orientation khác nhau hoặc dữ liệu dài/dense."
---

# Responsive & Mobile Design

## Quy trình

1. Giữ hierarchy/visual identity từ ảnh mẫu desktop; xác định core content và primary action.
2. Lấy breakpoint từ `frontend/DESIGN.md`; kiểm tra boundary affected gồm 320, 390, 768, 1024 và 1440 khi applicable, thêm landscape khi rủi ro.
3. Dùng fluid layout, min/max/clamp và breakpoint hệ thống; không chèn breakpoint chữa cháy theo từng thiết bị.
4. Chọn chiến lược table: priority columns, labelled cards hoặc container scroll có affordance.
5. Giữ touch target ≥44px, safe area, keyboard viewport, zoom và dynamic text.
6. Tối ưu image/media bằng size/aspect ratio; tránh CLS và tải asset desktop cho mobile.
7. Test dữ liệu rỗng, dài, lỗi, loading và localization ở mọi breakpoint.

## Quality gate

- Không page-level horizontal overflow hoặc content bị sticky chrome che.
- Navigation/back/primary action luôn tiếp cận được.
- Không ẩn thông tin quan trọng chỉ để vừa màn hình; dùng progressive disclosure có chủ đích.
- Keyboard, screen reader và orientation không tạo đường cụt.
- Sau implementation, browser screenshot và overflow assertion có evidence; review read-only không tự kéo build/browser gate.
