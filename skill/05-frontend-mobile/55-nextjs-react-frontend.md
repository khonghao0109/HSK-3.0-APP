---
name: nextjs-react-frontend
description: "Phát triển Next.js 16 App Router/React 19 frontend production cho HSK. Sử dụng khi thêm route, RSC/client component, data fetch, action, BFF, metadata hoặc page state."
---

# Next.js & React Frontend

1. Đọc `frontend/AGENTS.md` và docs local Next.js 16.3 cho API/convention liên quan; không dựa convention cũ.
2. Map UI tới ảnh mẫu và `frontend/DESIGN.md`; Server Component mặc định, client boundary nhỏ và serializable props.
3. Fetch server-side qua typed adapter/BFF; cache/revalidate rõ theo public/private data, không cache user response dùng chung.
4. Route có loading/error/not-found/forbidden/session recovery; redirect dùng canonical validated origin, cookie ở server boundary.
5. Semantic HTML, token/shared component, no raw secret/backend URL trong client bundle.
6. CSP nonce/security header, image/font/script optimization, streaming và bundle split theo route.
7. Test unit/RTL, generated types, production build và Playwright click/navigation/console.

**Gate:** hydration/CSP/console sạch; responsive/a11y đúng ảnh; type/lint/format/test/build/E2E/audit GREEN.
