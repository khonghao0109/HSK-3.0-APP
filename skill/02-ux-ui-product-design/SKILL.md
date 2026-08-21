---
name: 02-ux-ui-product-design
description: "Design or review visible HSK web/mobile/admin interfaces using the matching docs/ui_image references, responsive behavior and accessibility. Do not use for schema, backend or ops-only work."
---

# UX/UI Product Design

## Nguồn sự thật bắt buộc

1. Đọc yêu cầu, `docs/FUNCTIONAL_HIERARCHY.md` và contract nghiệp vụ liên quan.
2. Chỉ với route/UI thuộc scope, map route/page → ảnh tương ứng trong `docs/ui_image` → component hiện tại → thay đổi dự kiến; không tải toàn bộ module không liên quan.
3. Mở ảnh đúng route ở độ phân giải gốc; ảnh mẫu quyết định IA, bố cục, thứ bậc, action và visual language.
4. Đọc `frontend/DESIGN.md`, token, component dùng chung và breakpoint hiện tại.
5. Dùng component/token hiện có; chỉ dùng support skill ngoài hệ thống khi người dùng gọi rõ và skill đó thực sự được cài đặt.

Không redesign khi ảnh mẫu đã chốt. Nếu thiếu ảnh, suy luận từ màn hình cùng module và ghi rõ; dừng xin quyết định nếu suy luận làm đổi flow hoặc layout đáng kể.

## Mode và evidence tỷ lệ thuận

- REVIEW là read-only mapping/finding; không bắt build, browser hoặc screenshot khi không có implementation hay yêu cầu runtime confirmation.
- IMPLEMENT chạy affected UI states và production browser QA, gồm console/accessibility/overflow và ảnh route tương ứng.
- Responsive matrix lấy từ `frontend/DESIGN.md`; bao phủ boundary cần thiết gồm 320, 390, 768, 1024 và 1440 khi applicable, không nhân mọi viewport cho thay đổi không ảnh hưởng layout.

## Định tuyến

- IA và navigation: [Information architecture](16-information-architecture.md), [User flow](17-user-flow-design.md).
- Research và prototype: [UX research](18-ux-research-usability.md), [Wireframing](19-wireframing-prototyping.md).
- Token, component và visual: [Design system](20-design-system.md), [Visual UI](21-visual-ui-design.md).
- Responsive và accessibility: [Responsive/mobile](22-responsive-mobile-design.md), [Accessibility](23-accessibility-inclusive-design.md).
- Copy/localization và handoff: [Content/localization](24-content-design-localization.md), [Design handoff](25-design-handoff.md).

## Cổng hoàn thành khi IMPLEMENT

- Có đủ loading, empty, error/retry, forbidden, disabled, validation, success và long-content.
- Test thật tại các boundary affected trong 320/390/768/1024/1440 theo `frontend/DESIGN.md`; không overflow, không mất primary action.
- Keyboard, screen reader semantics, focus, contrast và reduced motion đạt WCAG 2.2 AA.
- Visual QA bằng browser trên production build, có screenshot và console sạch.
- UI, API contract, analytics event và acceptance criteria truy vết hai chiều.
