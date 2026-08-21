---
name: observability-monitoring
description: "Thiết kế logs, metrics, traces, SLI/SLO, dashboard và alert cho HSK. Sử dụng khi thêm service/critical flow, điều tra reliability hoặc chuẩn bị production."
---

# Observability & Monitoring

1. Định nghĩa SLI availability/latency/correctness/freshness theo user journey; SLO/window/error budget và owner.
2. Structured logs có timestamp/level/service/version/env/correlation, redaction và sampling; không PII/token/answer.
3. Metrics RED/USE, business/integrity/queue/pool/cache/DB/provider; label cardinality bounded.
4. Distributed trace propagate safe context qua BFF/backend/AI/queue; sample error/slow, protect payload.
5. Dashboard theo service + journey + deploy annotation; alert symptom/error-budget, actionable, dedup và severity.
6. Mỗi alert có runbook, owner, escalation và silence policy; test synthetic alert/routing.
7. Retention/access/cost và privacy cho telemetry; monitor observability pipeline itself.

**Gate:** critical failure detectable trong MTTD target, no noisy unactionable page và on-call có đủ context/recovery.
