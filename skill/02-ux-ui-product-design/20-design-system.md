---
name: hsk-design-system
description: "Xây dựng và quản trị design token, component, pattern và governance của HSK 3.0. Sử dụng khi thêm/chỉnh token, shared component, theme, state, responsive rule hoặc review tính nhất quán UI."
---

# Design System

## Nguồn sự thật

Ảnh `docs/ui_image` quyết định visual language; `frontend/DESIGN.md`, token runtime và component dùng chung quyết định implementation. Không phụ thuộc support skill local ngoài canonical discovery.

## Quy trình

1. Audit primitive, semantic và component token; component không dùng raw color/spacing tùy tiện.
2. Định nghĩa typography, grid, spacing 4/8, radius, elevation, icon, z-index và motion.
3. Mỗi component có anatomy, variants, size, interactive states, content constraints và accessibility contract.
4. Bao phủ default, hover, focus-visible, active, disabled, loading, error, success, empty và read-only.
5. Kiểm tra composition trong form, table/list, modal/drawer và responsive shell.
6. Thay đổi token breaking phải có impact inventory, migration plan và visual regression evidence.

## Governance

- Tái sử dụng trước khi tạo mới; không nhân bản component theo page.
- API component typed, semantic HTML trước ARIA, không khóa consumer vào layout cứng.
- Contrast WCAG AA, target ≥44px, focus 3px rõ, reduced motion.
- Version/release note cho breaking change; owner và deprecation window rõ.
- Screenshot/browser QA trên production build đối chiếu ảnh mẫu.
