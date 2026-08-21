---
name: component-library
description: "Xây shared React component library theo design system và ảnh mẫu HSK. Sử dụng khi tạo/chỉnh button, form, table, modal, navigation, feedback hoặc pattern tái sử dụng."
---

# Component Library

1. Đọc ảnh module, DESIGN.md và token; audit component có thể reuse trước khi tạo mới.
2. Component API typed/semantic/composable, controlled/uncontrolled rõ; không nhúng business fetch/permission vô generic primitive.
3. Dùng primitive→semantic→component token; variant/size/state có naming nhất quán.
4. Bao phủ hover/focus/active/disabled/loading/error/read-only và keyboard/touch ≥44px.
5. Modal quản focus/escape/restore/scroll; form label/error/aria; table sort/pagination/responsive strategy.
6. Giữ bundle/tree-shaking và Server Component compatibility; client directive chỉ nơi cần.
7. Unit interaction/a11y + visual/browser regression ở 1440/768/390.

**Gate:** không duplicate, raw style drift hay prop explosion; docs/example/consumer migration và deprecation rõ.
