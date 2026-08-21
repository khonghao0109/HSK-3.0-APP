---
name: developer-experience-tooling
description: "Xây local tooling, generator, validation và onboarding workflow an toàn/deterministic. Sử dụng khi giảm setup time, chuẩn hóa command hoặc tạo automation cho developer."
---

# Developer Experience & Tooling

1. Đo pain point/setup/feedback time trước automation; giữ một canonical command trong package/task runner.
2. Tool safe-by-default, validate environment/target, dry-run cho mutation và error actionable không lộ secret.
3. Pin runtime/dependency, cross-platform shell khi cần, output deterministic và exit code chuẩn CI.
4. Local parity qua container/disposable dependency; seed synthetic/idempotent; không cần production credential.
5. Generator tạo code theo architecture/test/docs nhưng không overwrite file/user changes.
6. Telemetry opt-in/privacy-safe; tool có owner/version/deprecation và self-test.
7. Onboarding smoke từ clean checkout, time-to-first-test đo được.

**Gate:** automation giảm thời gian/lỗi thực, docs minimal/executable, CI dùng cùng logic local và failure recovery rõ.
