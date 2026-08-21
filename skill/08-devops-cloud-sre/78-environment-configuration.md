---
name: environment-configuration
description: "Quản trị local/test/staging/production config và secret an toàn. Sử dụng khi thêm env var, provider credential, runtime config hoặc guard môi trường."
---

# Environment & Configuration

1. Có schema validate type/range/URL/origin lúc startup; missing/invalid fail-fast, không silent default production.
2. Tách config không nhạy cảm và secret; secret manager/KMS, rotation/revocation/audit, không commit/log/bake image.
3. Mỗi environment có account/project/database/bucket/key riêng; staging không dùng production data/credential.
4. Test DB guard yêu cầu NODE_ENV=test, allowlisted disposable name/host/schema; reject protected/mismatch/Prisma-only URL param khi dùng psql.
5. Config versioned, immutable per deploy; dynamic config/flag có validation, owner, audit và safe default.
6. Document owner/purpose/example non-secret/required/rotation/restart impact.
7. Test startup positive/negative, redaction và canonical origin/proxy trust.

**Gate:** no secret in Git/artifact/client bundle, parity known, break-glass controlled và config drift detectable.
