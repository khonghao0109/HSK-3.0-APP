---
name: security-architecture
description: "Threat-model và thiết kế control bảo mật end-to-end cho HSK 3.0. Sử dụng khi thêm trust boundary, auth, upload/media, AI, payment, admin flow, provider hoặc trước production."
---

# Security Architecture

1. Lập asset/data-flow/trust-boundary và attacker goals; dùng STRIDE/abuse case, xếp hạng impact/likelihood.
2. Identity: Argon2, short-lived token/session rotation/revocation, MFA cho admin khi production, rate-limit và audit.
3. Authorization server-side deny-by-default theo role/owner/state; chống IDOR/mass assignment.
4. Boundary: schema validation/normalization, parameterized query, output encoding, CSP/CSRF/CORS/same-origin, SSRF egress.
5. Upload/media: type/signature/size, quarantine/scan, random key, private bucket/signed URL và no execute.
6. Secret/KMS rotation, least-privilege IAM/network, encrypted transport/storage, tamper-resistant audit và retention.
7. CI SAST/SCA/secret/IaC/container scan, pentest risk-based, incident/breach runbook.

**Gate:** critical/high threat có control + test/evidence hoặc formal acceptance; log/error không lộ secret/PII; recovery/revocation đã diễn tập.
