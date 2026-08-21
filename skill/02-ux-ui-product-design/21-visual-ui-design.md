---
name: visual-ui-design
description: "Triển khai hoặc review visual UI HSK 3.0 theo ảnh mẫu chính thức và token hiện hữu. Sử dụng khi thay đổi layout, typography, màu, spacing, icon, state hoặc tạo page/component mới."
---

# Visual UI Design

## Quy trình bắt buộc

1. Liệt kê `docs/ui_image`, chọn đúng ảnh theo module và mở ảnh ở độ phân giải gốc.
2. Lập bảng route/page → ảnh → component hiện tại → thay đổi; ghi phần suy luận nếu thiếu ảnh.
3. Đọc `frontend/DESIGN.md`, shared component và token; dùng các skill frontend-design/design-system/ui-ux-pro-max.
4. Giữ IA, hierarchy, action placement, density, palette, type, border/radius/shadow theo mẫu.
5. Xây UI thật bằng semantic HTML/component/token; không dùng ảnh mẫu làm background.
6. Bổ sung production states nhưng giữ cùng visual language.
7. Chụp UI thật ở 1440×900, 768×1024, 390×844 và so sánh trực tiếp.

## Quality gate

- Không generic redesign, emoji icon hoặc raw hex rải rác.
- Long Chinese/Vietnamese content không vỡ layout; số liệu dùng tabular figures khi phù hợp.
- Focus/hover/active/disabled rõ, không layout shift; motion 150–200ms và reduced-motion.
- Không horizontal overflow, text/body đủ contrast và zoom 200% vẫn dùng được.
- Báo cáo nêu điểm khớp, khác biệt, lý do và screenshot evidence.
