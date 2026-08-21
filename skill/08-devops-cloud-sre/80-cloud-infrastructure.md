---
name: cloud-infrastructure
description: "Thiết kế cloud infrastructure/IaC cho HSK đạt HA, security và recoverability. Sử dụng khi chọn provider/service, tạo network/compute/database/storage hoặc review topology."
---

# Cloud Infrastructure

1. Từ SLO/RPO/RTO/workload/cost chọn managed service; ghi ADR cho trade-off/vendor lock-in.
2. IaC module/version/state remote locked/encrypted; plan review, policy-as-code và drift detection.
3. Network private-by-default, ingress allowlist/WAF/TLS, egress control, IAM role least privilege và separate account/env.
4. App stateless sau load balancer, multi-AZ; DB HA/PITR, object version/encryption, cache/queue failure policy.
5. Autoscale/capacity/headroom, quota và dependency limits; no single NAT/DNS/secret dependency không được đánh giá.
6. Central logs/metrics/traces/audit, backup/DR và cost allocation/tag/budget alert.
7. Test IaC, failover, restore, instance/AZ loss và least-privilege access.

**Gate:** diagram/IaC/runtime khớp, no public data plane ngoài nhu cầu, recovery evidence và cost forecast.
