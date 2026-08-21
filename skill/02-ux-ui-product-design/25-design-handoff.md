---
name: design-handoff
description: "Bàn giao thiết kế sang engineering với spec, assets, state và acceptance evidence đầy đủ. Sử dụng trước implementation, khi giải đáp design QA hoặc khi chốt UI release."
---

# Design Handoff

## Gói bàn giao

- Bảng route/page → ảnh `docs/ui_image` → component → API/data/permission.
- Spec layout/grid/breakpoint, token, typography, icon/asset, state và interaction.
- Responsive behavior cho 1440/768/390, long content, keyboard và reduced motion.
- State matrix: loading, empty, error, retry, forbidden, disabled, validation, success.
- Acceptance criteria và analytics event; link prototype/version/quyết định khác mẫu.

## Quy trình

1. Walkthrough cùng product, design, frontend, backend và QA cho flow rủi ro.
2. Chốt contract/data realistic; không dùng mock che field/status chưa có.
3. Kiểm tra asset license, format, kích thước, alt/caption và optimization.
4. Engineering lập impact/dependency; design trả lời bằng spec cập nhật, không chỉ chat.
5. Sau implementation, visual QA trên production build và screenshot ba viewport.
6. Đóng diff hoặc ghi exception có owner/deadline.

## Definition of done

Design, code, token, accessibility tree và behavior cùng một contract; console sạch, không visual regression và mọi khác biệt có phê duyệt truy vết được.
