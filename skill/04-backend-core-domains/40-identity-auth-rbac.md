---
name: identity-auth-rbac
description: "Thiết kế và triển khai identity, authentication, session, RBAC và account lifecycle. Sử dụng cho login/logout/token, admin authorization, consent, account deletion hoặc security review."
---

# Identity, Auth & RBAC

1. Hash password bằng Argon2 tham số được benchmark; generic login error, rate-limit và audit abuse.
2. Access/session token ngắn hạn, hash/rotate/revoke server-side; cookie HttpOnly, Secure production, SameSite, exact path/domain.
3. Browser dùng same-origin BFF; POST state-changing enforce CSRF/exact-origin; canonical origin từ config validate.
4. Authorization deny-by-default theo role + owner + resource state trong transaction; admin action recheck DB actor active/admin.
5. Account deletion soft-delete/anonymize identity, revoke mọi session/reset token; giữ fact lịch sử không định danh theo policy.
6. MFA/recovery/credential change gửi notification và audit; secret/token không log/URL/client storage.
7. Test missing/expired/forged token, role downgrade, IDOR, session fixation/replay, cookie clear và redirect loop.

**Gate:** auth state nhất quán nhiều replica, revocation có hiệu lực, OWASP ASVS controls/evidence và privacy lifecycle hoàn chỉnh.
