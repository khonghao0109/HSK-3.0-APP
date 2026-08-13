# ADR-006: Hermetic Media Operations and Private Metrics

Status: Accepted for code; live environment approval remains external.

## Decision

Media metrics use a dedicated listener on port 9464 with exact `GET /metrics` and
current/previous bearer authentication. The public API and Nginx edge deny `/metrics`
and the legacy metrics namespace. Prometheus discovers ready backend pods, scrapes
each replica directly, and is authorized by NetworkPolicy plus Istio STRICT mTLS and
workload identity. No public Nest controller exposes metrics.

Prometheus and Alertmanager V1 are single-replica with explicit RWO PVCs and
`Recreate` rollout. This avoids duplicate notifications and multi-attach deadlock at
the cost of a brief declared monitoring gap. HA requires a later clustering/dedup ADR.

Operational tools are selected from a typed Darwin-arm64/Linux-amd64 manifest,
checksum-verified before safe extraction, exact-version probed, and functionally
exercised. Validators report independent `PASS`, `FAIL_INTERNAL`, or
`BLOCKED_EXTERNAL` outcomes and write sanitized JSON/JUnit evidence.

Alert and dashboard sources contain `__MEDIA_RUNBOOK_URL__`; deployment must use the
deterministic renderer with a real credential-free HTTPS URL. Source artifacts with
the marker are not deploy-ready. Reachability is an external gate and is never
inferred from a placeholder.

## Consequences

- Token rotation requires backend rollout because secrets enter through environment
  variables; it is not projected-file hot reload.
- Application readiness remains owned by the backend Deployment. The metrics patch
  adds only a TCP startup probe and must be locally strategic-merged and reviewed.
- The internal gate proves disposable Grafana query execution and Prometheus-to-
  Alertmanager page/ticket firing/resolved delivery using repository configs. SRE
  must separately prove PVC binding, deployed service-mesh policy, real runbook
  reachability and production notification delivery in the target environment.
- No historical migration is changed. Migration 18 supplies stable lifecycle
  timestamps; immutable history and cleanup evidence remain retained.
