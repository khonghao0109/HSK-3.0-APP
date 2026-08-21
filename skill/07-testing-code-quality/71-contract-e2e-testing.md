---
name: contract-e2e-testing
description: "Thiết kế API contract và end-to-end test cho critical user/admin journeys. Sử dụng khi thêm endpoint, BFF/session, vertical slice hoặc release regression."
---

# Contract & E2E Testing

1. Contract test schema/status/header/error/idempotency/compatibility ở provider và consumer boundary.
2. E2E chỉ cover critical journey/risk: auth, learning, review, exam, CMS/media; thao tác bằng UI thật khi cần.
3. Destructive/fresh-migration E2E chỉ chạy disposable DB có guard. Non-destructive synthetic smoke/E2E được phép trên staging khi được ủy quyền; production chỉ chạy approved smoke không gây dữ liệu nguy hiểm.
4. Browser listener gắn trước interaction; assert final URL, cookie, network, console/hydration/CSP và accessibility.
5. Test direct + client navigation, refresh/back, expired session, forbidden, retry và long/empty/error state.
6. Không thay click bằng `goto` nếu cần chứng minh client behavior; không suppress console.
7. Thu screenshot/trace chỉ khi safe, scrub secret và lưu artifact retention.

**Gate:** deterministic/pass trên production build, no skipped/focused critical test và contract docs đồng bộ.
