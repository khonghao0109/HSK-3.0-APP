---
name: 04-backend-core-domains
description: "Implement or review HSK NestJS, Prisma/PostgreSQL and backend domain behavior. Use for API, persistence, CMS, learning, exam, media, payment or AI-gateway work; do not use for UI-only or release-management tasks."
---

# Backend & Core Domains

1. Đọc schema/migration, `docs/api.md`, module/test liên quan; xác định source of truth và immutable history.
2. Thiết kế route → DTO normalize/validate → authorization → transaction/lock → invariant → audit/event.
3. Enforce invariant quan trọng ở DB và service; mutation retry-safe/idempotent; lock order nhất quán.
4. Không giữ correctness-critical state instance-local. Chỉ thêm outbox/queue khi side effect retryable cần durability; timeout/backpressure/rate limit theo bề mặt thực.
5. Public read luôn enforce published/not-deleted/parent/media visibility; admin read theo RBAC.
6. Test unit, integration, DB negative/concurrency và E2E trên database disposable.
7. Đọc guide đúng domain và phần liên quan tại `../hsk-production-delivery/references/production-quality-baseline.md`.

## Playbook theo nhu cầu

- Nền backend: [NestJS](38-nestjs-backend-development.md), [Prisma/PostgreSQL](39-prisma-postgresql.md), [Identity/RBAC](40-identity-auth-rbac.md), [Validation/error](41-api-validation-error-handling.md), [Cache/rate limit](42-caching-rate-limiting.md).
- Nội dung/tra cứu: [Media](43-file-media-storage.md), [Dictionary](44-search-dictionary.md), [CMS](52-admin-cms-workflow.md).
- Học tập: [Progress](45-learning-progress-engine.md), [Personalization](46-recommendation-personalization.md), [SRS](47-spaced-repetition-system.md), [Lesson activity](48-lesson-activity-engine.md), [Exam](49-exam-engine.md), [Speech](50-speech-pronunciation.md).
- Tích hợp kinh doanh: [Notification](51-notification-delivery.md), [Payment](53-payment-entitlement.md), [AI gateway](54-ai-gateway-integration.md).

**Release gate:** API/schema/docs/test/telemetry/runbook đồng bộ; không history loss, IDOR, secret/PII leak, duplicate side effect hoặc scale phụ thuộc một process.
