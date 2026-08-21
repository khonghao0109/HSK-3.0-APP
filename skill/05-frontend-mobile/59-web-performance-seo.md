---
name: web-performance-seo
description: "Tối ưu Core Web Vitals, bundle, rendering, caching và SEO cho Next.js HSK. Sử dụng khi thêm page/asset/script, điều tra chậm hoặc chuẩn bị production."
---

# Web Performance & SEO

1. Chốt budget theo route/device/network: LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 ở p75 mục tiêu; TTFB/bundle cụ thể theo baseline.
2. Đo production build bằng field/RUM + lab; phân tích server waterfall, JS bundle, image/font và third-party.
3. RSC/stream/code split; preload chỉ critical; image responsive dimensions/AVIF/WebP; font subset/swap.
4. Cache public đúng version, private no-store; CDN/BFF headers và invalidation kiểm thử.
5. Metadata canonical/robots/sitemap/structured data đúng visibility; admin/auth/private không index.
6. Không hy sinh CSP/a11y cho điểm số; script third-party có owner, consent và budget.
7. Regression test bundle/header/Lighthouse hoặc Web Vitals threshold và no layout shift.

**Gate:** before/after số đo trên thiết bị đại diện; không claim SEO cho private app; alert performance regression và rollback.
