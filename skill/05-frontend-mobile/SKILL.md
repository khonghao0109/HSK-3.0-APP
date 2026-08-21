---
name: 05-frontend-mobile
description: "Implement or review HSK Next.js/React client runtime, web UI or explicitly scoped mobile work. Use for frontend behavior, session, responsive/accessibility or performance—not backend/schema-only tasks."
---

# Frontend & Mobile

1. Trước UI, đọc `../hsk-production-delivery/references/ui-source-of-truth.md`; map route → ảnh → component và mở ảnh gốc.
2. Trước Next.js, đọc `frontend/AGENTS.md` và tài liệu local đúng version trong `frontend/node_modules/next/dist/docs`.
3. Dùng RSC/server-first, typed same-origin BFF và HttpOnly session; client component/state tối thiểu.
4. Bao phủ loading/empty/error/forbidden/session-expired, responsive 1440/768/390 và WCAG 2.2 AA.
5. Đặt performance/bundle/cache budgets, CSP/security headers, observability và E2E client navigation.
6. Mobile/offline phải có secure storage, sync conflict/idempotency và staged store rollout.

## Playbook theo nhu cầu

- Web runtime: [Next.js/React](55-nextjs-react-frontend.md), [State](56-frontend-state-management.md), [API/auth/session](57-api-client-auth-session.md).
- UI/platform quality: [Component library](58-component-library.md), [Performance/SEO](59-web-performance-seo.md), [PWA/offline](60-offline-sync-pwa.md).
- Mobile: [Development](61-mobile-app-development.md), [Release](62-mobile-release-publishing.md).

Không tuyên bố visual PASS nếu chưa browser QA production build và screenshot.
