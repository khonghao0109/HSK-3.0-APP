---
name: qa-manual-testing
description: "Thực hiện exploratory/manual QA có cấu trúc cho HSK web/mobile/admin. Sử dụng trước beta/release hoặc khi cần kiểm behavior/visual khó tự động hóa."
---

# QA Manual Testing

1. Tạo charter theo risk/persona/device/data/network; ghi build/env/time và phạm vi.
2. Đi critical happy path rồi permission/session/error/offline/retry/back/refresh/multi-tab/device.
3. UI map ảnh mẫu và kiểm 1440/768/390: proportions, type, token, spacing, state, overflow, focus.
4. Quan sát console/network/CSP/hydration/log; không bỏ qua warning có thể che defect.
5. Dữ liệu synthetic và teardown an toàn; không sửa production record.
6. Bug có expected/actual, reproducible steps, evidence, severity/impact và environment.
7. Retest fix + adjacent regression; cập nhật automation cho defect lặp/rủi ro cao.

**Gate:** session note/coverage rõ, không “looks good” không evidence và release blocker được owner xử lý.
