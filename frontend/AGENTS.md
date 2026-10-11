<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Quy tắc frontend

- Module có Zod (kể cả gián tiếp) không được nằm trong đồ thị import runtime của component `'use client'`: Zod 4 thử `Function("")` khi khởi tạo, vi phạm CSP không có `unsafe-eval`. Giá trị client cần dùng thì đặt trong module không kéo Zod (ví dụ `src/features/onboarding/onboarding-values.ts`). Test chốt chặn: `src/client-bundle-guard.spec.ts`.
