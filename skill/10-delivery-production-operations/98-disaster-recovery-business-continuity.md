---
name: disaster-recovery-business-continuity
description: "Xây Business Continuity và Disaster Recovery cho HSK gồm BIA, dependency, RPO/RTO, failover/restore và crisis communication. Sử dụng trước production và trong rehearsal/sự cố diện rộng."
---

# Disaster Recovery & Business Continuity

1. Business Impact Analysis xếp critical journey/data/provider, MTPD, legal/financial/reputation impact và manual workaround.
2. Chốt RPO/RTO per capability; map dependency graph gồm identity, DNS/CDN, compute, DB, object, queue/cache, secrets, provider và people.
3. Chọn backup/PITR/replication/multi-AZ/region/account phù hợp; tránh correlated failure và credential cùng blast radius.
4. Runbook declare/failover/restore/reconfigure/reconcile/failback, owner/break-glass/contact và communication template.
5. Diễn tập tabletop + technical: DB loss, region/account, provider, credential compromise, ransomware/data corruption.
6. Verify user journey, data checksum/invariant, backlog/replay, privacy deletion/legal hold và actual RPO/RTO.
7. Ghi gap/action/owner/deadline, cập nhật architecture/capacity/support/status page.

**Gate:** backup restore/failover evidence trong review window; không tự động failover nếu có nguy cơ split-brain/data loss chưa kiểm soát; executive go/no-go rõ.
