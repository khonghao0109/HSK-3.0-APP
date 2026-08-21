---
name: security-testing
description: "Thực hiện security test theo threat model cho web/API/mobile/infrastructure. Sử dụng trước release hoặc khi thay auth, upload, AI, payment, admin và trust boundary."
---

# Security Testing

1. Từ threat model/OWASP ASVS/API Top 10 lập abuse cases và scope được ủy quyền.
2. Test authentication/session, RBAC/IDOR, CSRF/CORS/origin, injection/XSS/CSP, SSRF, upload, rate/DoS và error leak.
3. Test secret/config/IAM/network/storage encryption, dependency/container/IaC/SBOM và CI supply chain.
4. Mobile test secure storage, deep link, backup, logging và transport; AI test prompt injection/data exfiltration/tool abuse.
5. Dùng synthetic account/data, giới hạn traffic; không pentest production nếu chưa có phê duyệt rõ.
6. Finding có reproduction, impact, likelihood, affected asset, remediation và verification; redact exploit/secret.
7. Retest fix và regression automation cho invariant quan trọng.

**Gate:** critical/high đóng hoặc formal risk acceptance có expiry; scans không thay manual threat-driven testing.
