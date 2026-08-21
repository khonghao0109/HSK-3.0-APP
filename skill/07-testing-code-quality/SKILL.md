---
name: 07-testing-code-quality
description: "Plan or execute HSK testing, QA, security/reliability checks, code review and bug triage. Use when verification is requested or a changed risk needs evidence; review remains read-only unless implementation is authorized."
---

# Testing & Code Quality

1. Bắt đầu risk/acceptance matrix; defect/invariant có RED evidence trước fix khi khả thi.
2. Chọn tầng thấp nhất chứng minh behavior, bổ sung contract/DB/concurrency/E2E cho boundary rủi ro.
3. Harness fail-closed; timeout/deadlock/connection không được tính là expected domain rejection.
4. Destructive/fresh-migration database tests chỉ dùng disposable DB có guard. Non-destructive synthetic smoke/E2E có thể chạy staging khi được phép; production chỉ chạy approved smoke.
5. UI phải có browser visual/a11y/console QA trên production build theo ảnh mẫu.
6. Đọc đúng playbook; báo PASS chỉ theo exact evidence đã chạy.

## Playbook theo nhu cầu

- Kế hoạch và tự động hóa: [Test strategy](69-test-strategy.md), [Unit/integration](70-unit-integration-testing.md), [Contract/E2E](71-contract-e2e-testing.md).
- NFR: [Performance/reliability](72-performance-reliability-testing.md), [Security](73-security-testing.md), [Accessibility](74-accessibility-testing.md).
- Quality workflow: [Manual QA](75-qa-manual-testing.md), [Code review](76-code-review.md), [Bug triage](77-bug-triage.md).
