---
name: 02-ux-ui-product-design
description: "Design or review visible HSK web/mobile/admin interfaces using the matching docs/ui_image references, responsive behavior and accessibility. Do not use for schema, backend or ops-only work."
---

# UX/UI Product Design

## Nguồn sự thật bắt buộc

1. Đọc yêu cầu, `docs/FUNCTIONAL_HIERARCHY.md` và contract nghiệp vụ liên quan.
2. Liệt kê `docs/ui_image`, map route/page → ảnh mẫu → component hiện tại → thay đổi dự kiến.
3. Mở ảnh liên quan ở độ phân giải gốc; ảnh mẫu quyết định IA, bố cục, thứ bậc, action và visual language.
4. Đọc `frontend/DESIGN.md`, token, component dùng chung và breakpoint hiện tại.
5. Dùng component/token hiện có; chỉ dùng support skill ngoài hệ thống khi người dùng gọi rõ và skill đó thực sự được cài đặt.

Không redesign khi ảnh mẫu đã chốt. Nếu thiếu ảnh, suy luận từ màn hình cùng module và ghi rõ; dừng xin quyết định nếu suy luận làm đổi flow hoặc layout đáng kể.

## Định tuyến

- IA và navigation: [Information architecture](16-information-architecture.md), [User flow](17-user-flow-design.md).
- Research và prototype: [UX research](18-ux-research-usability.md), [Wireframing](19-wireframing-prototyping.md).
- Token, component và visual: [Design system](20-design-system.md), [Visual UI](21-visual-ui-design.md).
- Responsive và accessibility: [Responsive/mobile](22-responsive-mobile-design.md), [Accessibility](23-accessibility-inclusive-design.md).
- Copy/localization và handoff: [Content/localization](24-content-design-localization.md), [Design handoff](25-design-handoff.md).

## Cổng hoàn thành

- Có đủ loading, empty, error/retry, forbidden, disabled, validation, success và long-content.
- Test thật tại 1440×900, 768×1024 và 390×844; không overflow, không mất primary action.
- Keyboard, screen reader semantics, focus, contrast và reduced motion đạt WCAG 2.2 AA.
- Visual QA bằng browser trên production build, có screenshot và console sạch.
- UI, API contract, analytics event và acceptance criteria truy vết hai chiều.
