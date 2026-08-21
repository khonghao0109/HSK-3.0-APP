---
name: release-management
description: "Điều phối release production end-to-end từ candidate, approval, rollout, monitoring tới rollback/post-release. Sử dụng cho beta, production, hotfix hoặc emergency change."
---

# Release Management

1. Freeze scoped release manifest: requirement, commit tree, artifact digest, provenance, migration, flag, config và docs.
2. Thu gate evidence thực: unit/integration/DB/concurrency/E2E/build/security/a11y/performance/restore theo risk.
3. Review staged bytes trước commit nếu cần, nhưng release gate phải xác minh artifact thực được build từ frozen commit tree; staged bytes không thay thế artifact evidence.
4. Go/no-go có owner/risk acceptance; on-call/support/status communication và change window.
5. Progressive rollout với cohort/%/SLI/business/integrity abort; build once/promote same artifact.
6. Rollback app/flag hoặc roll-forward data; rehearsal và post-rollback reconciliation.
7. Theo dõi observation window, incident/support signal; release note và retrospective/metric outcome.

**Gate:** no known critical blocker/console error, no false PASS, production data action authorized và audit đầy đủ.
