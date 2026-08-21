---
name: 09-engineering-governance-dx
description: "Manage HSK Git workflow, documentation, OpenAPI, dependencies, technical debt and developer tooling. Use for governance or docs-only work; review does not authorize stage, commit, amend, rebase or push."
---

# Engineering Governance & DX

1. Mọi thay đổi có owner, scope, acceptance, ADR/docs/test và traceability phù hợp risk.
2. Bảo toàn worktree người dùng. Chỉ stage/commit khi hành động đó được ủy quyền; review cached bytes trước commit được phép.
3. Contract/schema/runbook/docs cập nhật cùng code; không ghi PASS/count/checksum trước evidence thật.
4. Dependency/flag/debt có inventory, owner, SLA/expiry và automation; không để “tạm thời” vĩnh viễn.
5. Tooling one-command, deterministic, safe-by-default và dùng environment disposable.

## Playbook theo nhu cầu

- Change governance: [Git](87-git-workflow.md), [Documentation](88-documentation-management.md), [OpenAPI](89-api-documentation-openapi.md).
- Lifecycle: [Dependencies](90-dependency-management.md), [Technical debt](91-technical-debt-management.md), [Feature flags](92-feature-flags-experimentation.md).
- Productivity: [Developer tooling](93-developer-experience-tooling.md).
