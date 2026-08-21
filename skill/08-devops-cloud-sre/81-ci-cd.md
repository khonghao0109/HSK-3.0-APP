---
name: ci-cd
description: "Thiết kế CI/CD secure, reproducible và progressive cho monorepo HSK. Sử dụng khi tạo/chỉnh pipeline build/test/scan/deploy, release artifact hoặc environment promotion."
---

# CI/CD

1. Trigger PR/merge/tag rõ, path filter không bỏ sót dependency; concurrency cancel chỉ job an toàn.
2. Pin action/tool/image version/digest; ephemeral least-privilege token qua OIDC, protected environment approval; fork không nhận secret.
3. Required PR gates theo affected workspace và repository policy; generated/drift/DB/E2E/security/performance chỉ khi boundary/risk tương ứng bị ảnh hưởng. Secret scan và integrity/security guard không được bỏ khi applicable.
4. Cache key lockfile/tool/OS, không cache secret/poisonable artifact; test result/artifact có retention.
5. Build once, tạo SBOM/provenance/signature/checksum; promote cùng artifact qua staging→production.
6. Migration preflight/job tách khi có migration; deploy backward-compatible. Chọn canary/blue-green, SLO abort và rollback rehearsal theo release risk/topology thay vì bắt buộc cho mọi thay đổi.
7. Post-deploy smoke, observability annotation, audit actor/version và pipeline failure runbook.

**Gate:** branch protection không bypass tùy ý, no mutable latest, supply-chain threat reviewed và rollback rehearsal.
