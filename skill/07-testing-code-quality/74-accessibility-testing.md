---
name: accessibility-testing
description: "Kiểm thử accessibility WCAG 2.2 AA tự động và thủ công cho web/mobile HSK. Sử dụng khi thêm UI/component/flow hoặc trước release."
---

# Accessibility Testing

1. Map critical flows và component/state; dùng ảnh mẫu để kiểm visual focus/hierarchy.
2. Chạy lint/axe nhưng bổ sung keyboard-only, screen reader, zoom/reflow, contrast và reduced motion.
3. Verify name/role/value, landmark/heading, focus order/visible/restore, live region và error association.
4. Test 390/768/1440, 200–400% zoom, long localized text, high contrast và touch targets.
5. Media caption/transcript/control; exam/timer không gây barrier; timeout cho phép extend theo policy.
6. Finding ghi WCAG criterion, severity, user impact, reproduction và fix/retest evidence.
7. Browser production build, không chỉ component DOM.

**Gate:** no critical/serious unresolved; primary journey keyboard/screen-reader complete; exception có owner/deadline.
