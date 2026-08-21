---
name: hsk-production-delivery
description: "Route cross-functional HSK 3.0 epics and release decisions across product, engineering, quality and operations. Use for work spanning multiple production groups; do not use for a routine single-domain review or implementation."
---

# HSK Production Delivery

## Chọn task mode trước

- **REVIEW:** thu evidence và báo finding; mặc định read-only, không tự stage/commit hay bắt full build/release matrix.
- **IMPLEMENT:** chọn nhóm nhỏ nhất sở hữu code/contract bị thay đổi và gate theo affected scope.
- **RELEASE:** xác minh frozen commit tree, artifact digest, provenance, manifest, promotion và rollback; staged bytes không chứng minh artifact đã phát hành.

Chỉ dùng router này cho công việc xuyên nhiều nhóm. Công việc đơn domain dùng trực tiếp group tương ứng.

## Routing tối thiểu

1. `01-product-strategy`: outcome, requirement, roadmap, domain/curriculum và product risk.
2. `02-ux-ui-product-design`: IA, flow, visual, responsive hoặc accessibility khi có UI thật.
3. `03-system-architecture`: boundary, NFR hoặc quyết định khó đảo ngược; không dùng cho implementation thường lệ.
4. `04-backend-core-domains`: NestJS/PostgreSQL và nghiệp vụ backend.
5. `05-frontend-mobile`: Next.js/React/mobile implementation và client runtime.
6. `06-data-analytics`: seed, provenance, analytics, privacy lifecycle và recovery dữ liệu.
7. `07-testing-code-quality`: test/reliability/security QA, code review và bug triage khi được yêu cầu hoặc risk cần chứng minh.
8. `08-devops-cloud-sre`: environment, CI/CD, technical staging/promotion, observability và infrastructure.
9. `09-engineering-governance-dx`: Git, docs, OpenAPI, dependency và tooling; review không cấp quyền commit.
10. `10-delivery-production-operations`: cross-functional go/no-go, support, trust/safety và release communication.

Không kéo UI group vào schema/backend review. Không kéo implementation group vào ADR thuần kiến trúc. Docs-only không chạy full production matrix. Security, privacy và data integrity không được hạ gate để giảm scope.

## Reference theo nhu cầu

- [Production baseline](references/production-quality-baseline.md): chỉ đọc phần liên quan risk/mode hiện tại.
- [UI source of truth](references/ui-source-of-truth.md): chỉ đọc khi task thay đổi hoặc review UI.
- [Evidence template](references/evidence-and-release-template.md): dùng cho release hoặc handoff cần machine evidence.
- [Skill inventory and quarantine](references/skill-inventory-and-provenance.md): canonical/discovery/provenance contract.

## Authorization

Review không tự cho phép mutation. Stage, commit, amend, rebase, push, protected-environment mutation và external upload cần authorization phù hợp với hành động đó. Dừng khi acceptance và required risk gates đã đạt; không tiếp tục platform hóa hoặc hardening không có evidence.

## Validation

Chạy validator không dependency bằng `node skill/hsk-production-delivery/scripts/skill-system-validator.mjs --portable-copy`. Chạy mutation/trigger regressions bằng `node --test skill/hsk-production-delivery/scripts/skill-system-validator.test.mjs`.
