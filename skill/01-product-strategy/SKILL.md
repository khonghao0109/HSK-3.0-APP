---
name: 01-product-strategy
description: "Define HSK product outcomes, requirements, priorities, curriculum and business/legal constraints. Use for product decisions before design or engineering; do not use for routine implementation."
---

# Product Strategy

## Quy trình

1. Onboard bằng `01`–`03`: mục tiêu, repo/context và CodeGraph/repository evidence.
2. Discovery/research bằng `04`–`05`; tách fact, hypothesis và decision.
3. Chuyển thành requirement/story/acceptance bằng `06`–`07`, gồm NFR production.
4. Ưu tiên roadmap/stakeholder/risk bằng `08`–`10`; outcome và dependency thay vì feature count.
5. Chốt domain/curriculum/content bằng `11`–`13`, giữ HSK7_9 là một level với band 7–9.
6. Review business/legal bằng `14`–`15`; không ingest/publish/monetize khi quyền và privacy chưa rõ.
7. Handoff sang UX/architecture bằng measurable acceptance, owner, risk và evidence.

## Playbook theo nhu cầu

- Khởi động/context/repository: [Project onboarding](01-project-onboarding.md), [Context management](02-project-context-management.md), [CodeGraph intelligence](03-codegraph-repository-intelligence.md).
- Discovery/specification: [Product discovery](04-product-discovery.md), [Market research](05-market-competitor-research.md), [Requirements](06-requirements-specification.md), [Stories & acceptance](07-user-stories-acceptance-criteria.md).
- Ưu tiên/điều hành: [Roadmap](08-roadmap-prioritization.md), [Stakeholder](09-stakeholder-communication.md), [Risk](10-risk-management.md).
- Domain/nội dung: [Domain modeling](11-domain-modeling.md), [HSK curriculum](12-hsk-curriculum-design.md), [Content strategy](13-content-strategy.md).
- Kinh doanh/tuân thủ: [Monetization](14-business-model-monetization.md), [Legal & licensing](15-legal-compliance-licensing.md).

## Reference production

Đọc `../hsk-production-delivery/references/production-quality-baseline.md` khi requirement có thể đi production. Chỉ đặt NFR liên quan risk/outcome hiện tại; security, privacy và integrity bắt buộc khi boundary tương ứng bị ảnh hưởng.

## Cổng hoàn thành

- Problem/outcome/persona và success/guardrail metric rõ.
- Scope, assumption, dependency, decision owner và rủi ro có traceability.
- Requirement không mâu thuẫn functional hierarchy, schema/API/UI hiện tại.
- Legal/license/content provenance và data lifecycle được chốt hoặc ghi blocker.
- Không gọi roadmap là cam kết nếu chưa có capacity/dependency/risk evidence.
