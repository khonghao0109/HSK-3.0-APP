---
name: frontend-architecture
description: "Thiết kế kiến trúc Next.js App Router/React frontend HSK an toàn, nhanh và dễ mở rộng. Sử dụng khi thêm route, RSC/client boundary, BFF/session, cache, state hoặc shared component."
---

# Frontend Architecture

1. Đọc `frontend/AGENTS.md` và docs local của đúng Next.js 16.3 trước convention/API.
2. Tổ chức feature/route theo capability; Server Component mặc định, Client Component chỉ cho interaction/browser API.
3. Browser gọi same-origin BFF; token HttpOnly/Secure/SameSite, backend URL/server secret không vào bundle.
4. Chốt cache/revalidation per data sensitivity; user-specific response không dùng shared cache.
5. URL là source of truth cho filter/pagination/shareable state; client state local, không duplicate server state.
6. Route có loading/error/not-found/forbidden/session-expired; redirect/cookie theo canonical validated origin.
7. CSP nonce, security headers, bundle/code split, streaming và Web Vitals có test production.

**Gate:** hydration/console/CSP sạch, typed contract, accessible responsive UI đúng ảnh, auth server-side và E2E client navigation.
