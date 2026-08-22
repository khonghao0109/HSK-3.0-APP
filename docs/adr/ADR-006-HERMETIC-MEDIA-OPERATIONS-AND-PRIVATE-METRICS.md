# ADR-006: Hermetic Media Operations and Private Metrics

Status: Accepted for code; live environment approval remains external.

## Decision

Media metrics use a dedicated listener on port 9464 with exact `GET /metrics` and
current/previous bearer authentication. The public API and Nginx edge deny `/metrics`
and the legacy metrics namespace. Prometheus discovers ready backend pods, scrapes
each replica directly, and is authorized by NetworkPolicy plus Istio STRICT mTLS and
workload identity. No public Nest controller exposes metrics.

Prometheus, Alertmanager and Grafana V1 are single-replica with explicit RWO PVCs
and `Recreate` rollout. This avoids duplicate notifications and multi-attach
deadlock at the cost of a brief declared monitoring gap. HA requires a later
clustering/dedup ADR. Prometheus retains 32 days on a 50 GiB PVC so 28-day SLI
queries are possible, but this is local retention rather than a durable backup.

Operational tools are selected from a typed Darwin-arm64/Linux-amd64 manifest,
checksum-verified before safe extraction, exact-version probed, and functionally
exercised. Validators report independent `PASS`, `FAIL_INTERNAL`, or
`BLOCKED_EXTERNAL` outcomes and write sanitized JSON/JUnit evidence.

Only the `release-linux-amd64` profile is release-authoritative, and it must run on
an actual Linux x86_64 kernel. Darwin arm64 is a reference profile, never an
equivalent release proof. OCI indexes and Linux amd64 children are pinned
separately. The release profile hashes exact registry index bytes and requires a
cosign signature plus a signed SPDX JSON attestation bound to the child digest.
Until an exact approved workflow identity and corresponding attestations exist for
all three images, this supply-chain gate is `BLOCKED_EXTERNAL` and production
release is not approved.

Alert and dashboard sources contain `__MEDIA_RUNBOOK_URL__`; deployment must use the
deterministic renderer with a real credential-free HTTPS URL. Source artifacts with
the marker are not deploy-ready. Reachability is an external gate and is never
inferred from a placeholder.

Signed-content request counters begin at the public service boundary so invalid-grant
volume remains observable. The availability SLI excludes terminal `invalid_grant`
from its eligible denominator and failure numerator; otherwise an anonymous caller
could consume the 99.9% error budget with forged or expired grants. Provider outage,
provider mismatch, integrity failure and started-without-terminal deficits still burn
the SLO. Promtool fixtures cover invalid-grant spray, eligible failures, no traffic,
multiple replicas, pod replacement and recovery.

Ingestion availability has the same eligibility boundary: terminal `rejected` and
`disabled` outcomes remain observable but are removed from the valid-ingestion
denominator and failure numerator. Only terminal `failed` and `cleanup_required`
outcomes burn this SLO, while a positive all-started-minus-all-terminals deficit still
burns it. Promtool fixtures cover rejected/disabled spray and eligible
failed/cleanup-required burns.

## Consequences

- Token rotation requires backend rollout because secrets enter through environment
  variables; it is not projected-file hot reload.
- Application readiness, liveness and startup remain owned by the backend
  Deployment. The portable metrics patch adds none of those handlers; local
  strategic-merge rehearsal must prove every existing startup handler is preserved
  exactly and never combined with a second handler. Because backend and monitoring
  workloads use STRICT mTLS, all pod templates explicitly enable Istio HTTP probe
  rewriting; removing that annotation is a validation failure.
- Grafana is deliberately a private authenticated API-only artifact in V1. The
  allowlisted `hsk-media-operator` workload identity may use health, dashboard and
  datasource APIs; no browser UI path is claimed. Human browser access requires a
  separately designed authenticated access gateway and a later policy change.
- Dashboard panels bind the fixed provisioned datasource UID
  `hsk-media-prometheus`; the validator provisions and reads back that exact UID
  without rewriting a template variable.
- Capacity must be measured before rollout: `required GiB = ingest bytes/day × 32 ×
1.25`. Abort when projected use exceeds 80% of 50 GiB. PVC binding, snapshot
  backup, restore rehearsal and StorageClass expansion remain live gates; loss of
  this single PVC can erase the retained SLI history. The Linux release profile
  accepts only fresh, release-bound machine evidence for those live facts; absent
  evidence is a non-green external block.
- The internal gate proves disposable Grafana query execution and Prometheus-to-
  Alertmanager page/ticket firing/resolved delivery using repository configs. SRE
  must separately prove PVC binding, deployed service-mesh policy, real runbook
  reachability and production notification delivery in the target environment.
- No historical migration is changed. Migration 18 supplies stable lifecycle
  timestamps and migration 19 hardens cleanup audit integrity; immutable history
  and cleanup evidence remain retained.
