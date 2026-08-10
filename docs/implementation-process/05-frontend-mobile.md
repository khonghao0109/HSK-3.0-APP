# Quy trình 05 — Frontend & Mobile

## 1. Mục tiêu

Triển khai trải nghiệm web/mobile theo design và API contract với state đầy đủ, bảo mật session, performance/accessibility đạt mục tiêu và có chiến lược offline/release phù hợp.

## 2. Phạm vi skill

Gồm 8 skill từ `55-nextjs-react-frontend` đến `62-mobile-release-publishing` trong `skill/05-frontend-mobile/`.

## 3. Điều kiện đầu vào

- Handoff UI có version, component/state/responsive/accessibility spec.
- API contract, auth flow, error catalog và test environment ổn định.
- Analytics plan, feature flag, browser/device matrix và performance budget.

## 4. Trình tự thực hiện

### Giai đoạn 1 — Frontend architecture baseline

1. Chốt Next.js route groups cho public/account/admin và ownership theo feature.
2. Xác định server/client component, fetch boundary, cache/revalidation và error boundary.
3. Đặt convention cho component, hook, service, schema, test và asset.
4. Tạo typed environment validation và không đưa secret vào client bundle.

**Gate F1:** Route/feature boundary rõ, build baseline pass và config sai fail sớm.

### Giai đoạn 2 — API client, auth session và error model

1. Sinh hoặc duy trì typed client từ OpenAPI/contract.
2. Xử lý token/cookie theo threat model; tránh localStorage cho secret nếu không được duyệt.
3. Chuẩn hóa loading, retry, cancellation, 401/403/409/422/429/5xx và offline.
4. Ngăn refresh race, redirect loop và data leak khi đổi user/session.

**Gate F2:** Auth/session test bao phủ login/logout/expiry/revocation/role change.

### Giai đoạn 3 — State management và component library

1. Phân biệt server state, URL state, form state và local UI state.
2. Chỉ dùng global store cho state thực sự chia sẻ; tránh duplicate cache.
3. Hiện thực design token và primitive accessible trước feature component.
4. Viết story/test cho variant, focus, keyboard, error và responsive state.

### Giai đoạn 4 — Vertical feature slices

Triển khai theo thứ tự ưu tiên:

1. Auth/onboarding/placement và account.
2. Level/lesson/activity/progress.
3. Dictionary, save word và Review Center/SRS.
4. Exam start/autosave/resume/review/submit/result.
5. Admin CMS/import/question bank/user management.
6. P1/P2: reader, pronunciation, engagement, AI, premium.

Mỗi slice gồm route, UI state, API integration, analytics, accessibility, test và feature flag.

**Gate F3:** Slice demo được end-to-end trên staging, không dùng mock cho acceptance cuối.

### Giai đoạn 5 — Performance, SEO và accessibility

1. Đo bundle, LCP/INP/CLS, API waterfall, image/font và hydration.
2. Chọn prefetch/cache phù hợp; không cache dữ liệu cá nhân sai scope.
3. Thiết lập metadata/robots/sitemap cho trang public; chặn index trang account/admin.
4. Test keyboard, screen reader, zoom, contrast, focus restore và live region.

**Gate F4:** Performance budget và accessibility critical/high đều đạt.

### Giai đoạn 6 — PWA/offline sync

1. Chốt capability được offline và dữ liệu không được cache.
2. Thiết kế local store schema/version, download manifest và quota cleanup.
3. Xây sync queue idempotent, retry/backoff và conflict resolution.
4. Hiển thị trạng thái online/offline/sync/conflict rõ ràng.

### Giai đoạn 7 — Mobile app và store release

1. Chọn native/cross-platform dựa trên speech, camera, offline và team capability.
2. Thiết kế secure storage, deep link, push, permission và background task.
3. Test device/OS matrix, network condition, lifecycle và upgrade migration.
4. Chuẩn bị signing, privacy label, screenshot, review note, phased rollout và rollback.

## 5. Artifact bắt buộc

- Route/feature map, typed API client và state convention.
- Component library, responsive/accessibility evidence.
- Feature implementation, unit/component/e2e tests và analytics events.
- Performance report, PWA sync design hoặc mobile release package khi áp dụng.

## 6. Chỉ số kiểm soát

- Core Web Vitals và bundle budget theo route.
- Crash-free/session error rate và API retry rate.
- Task completion, form error và exam autosave success.
- Accessibility violations critical/high.
- Mobile crash-free users, ANR, store rejection và rollout health.

## 7. Definition of Done

Nhóm 5 hoàn tất khi các luồng trong phạm vi chạy end-to-end trên thiết bị mục tiêu, mọi state và quyền được xử lý, contract/analytics/test đồng bộ, performance/accessibility đạt gate và có release/rollback plan thực thi được.
