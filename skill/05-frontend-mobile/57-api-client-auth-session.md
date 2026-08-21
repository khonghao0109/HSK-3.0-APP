---
name: api-client-auth-session
description: "Thiết kế typed API client, BFF, admin session và redirect an toàn cho frontend. Sử dụng khi thêm API route handler, login/logout, session recovery, CSRF/origin hoặc error mapping."
---

# API Client, Auth & Session

1. Browser chỉ gọi same-origin allowlisted BFF; backend token trong HttpOnly/Secure/SameSite cookie, server-only module.
2. APP_ORIGIN validate canonical; không tạo absolute redirect từ Host/request URL chưa tin cậy.
3. Missing/invalid/expired session dẫn page login reason=session; clear invalid cookie tại server boundary, không redirect RSC qua API payload.
4. POST logout/mutation bắt exact same-origin/CSRF policy và luôn clear cookie với cùng attributes/path.
5. Typed parser validate backend response, bounded body/timeouts; giữ 400 transport/DTO khác 422 domain semantic, cùng safe mapping cho 401/403/409/503 và correlation ID.
6. Không log token/cookie/password; proxy/header không forward tùy ý.
7. Test direct + client navigation, Return to platform, invalid cookie, origin mismatch, redirect loop và console.

**Gate:** no RSC fallback/hydration error, final origin đúng config, session revocation/cookie clearing và security headers được chứng minh production.
