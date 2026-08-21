---
name: dependency-management
description: "Quản trị npm/runtime/tool/provider dependencies, vulnerability, license và upgrade. Sử dụng khi thêm/nâng/hạ package, image, action hoặc external service."
---

# Dependency Management

1. Chứng minh nhu cầu; ưu tiên platform/đã có, đánh giá maintenance, security, size/performance, license và lock-in.
2. Pin direct dependency/action/image phù hợp, commit lockfile; không floating production artifact.
3. Đọc changelog/migration/security advisory của primary source; test compatibility đúng runtime/framework.
4. CI SCA/license/SBOM/provenance; severity policy xét exploitability/reachability, patch SLA và exception expiry.
5. Renovation batching nhỏ, canary/rollback; major upgrade có ADR/impact/performance/bundle review.
6. Remove unused/transitive risk, dedupe; secret/provider credential rotation khi compromise.
7. Audit định kỳ Node/OS/DB/provider EOL.

**Gate:** no critical exploitable unresolved, build/test/audit evidence, license approved và rollback/version support rõ.
