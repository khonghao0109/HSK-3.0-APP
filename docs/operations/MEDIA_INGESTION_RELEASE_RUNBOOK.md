# Media Ingestion Release Runbook

Owner: Media Platform. Security partner: Security Platform. Severity: cleanup,
scanner and coherence pages are SEV-2 until triage proves lower impact.

## Release boundary

Code readiness and production readiness are separate. Production stays blocked until
the exact deployment identity has passed private S3-compatible, ClamAV, reverse-proxy
redaction, alert delivery and rollback rehearsals. Never substitute an in-memory
adapter for provider evidence.

Before migration 17, every legacy completed ingestion requires an immutable AuditLog
action `media.ingestion.provenance_audited` whose summary exactly binds ingestion,
media and source IDs plus all six source snapshot fields. Data/Content owner must
approve it from retained licensing evidence. Never manufacture the marker merely to
pass preflight; unresolved history blocks deployment.

Before migration 18, disable ingestion and quiesce every worker. In a restricted
operator session, run count-only checks proving zero `processing` rows and audit the
cleanup status/code/timestamp history; never print object keys, checksums, filenames,
actor identity or other PII. Deploy migration 18 only after those counts and the
immutable history agree. A `P0001` abort means preflight rejected inconsistent live
state: the transaction rolls back and leaves the schema unchanged. Keep ingestion
disabled, preserve the count-only evidence and reconcile forward; do not bypass the
guard or edit migration bytes.

Before migration 19, keep ingestion and cleanup workers quiesced. Count every
cleanup-related immutable audit and reject malformed target IDs, summary/status/code
tuples, timestamp drift or future `cleanupRequiredAt`; never print row payloads or
identifiers. The migration takes bounded locks on `MediaIngestion` and `AuditLog` in
that order. Rehearse exact lock-timeout rollback and both audit-first/lifecycle-first
races on a disposable upgrade database. A `P0001` or `55P03` leaves the migration
transaction unapplied: keep writers disabled, reconcile the immutable history
forward, and rerun the guarded aggregate database harness rather than editing applied
migration bytes.

Provisional beta objectives, measured over a rolling 28-day window after a seven-day
staging observation period:

- successful valid ingestion availability >= 99.5%;
- p95 synchronous processing latency <= 8 seconds for <= 10 MiB assets;
- signed content availability >= 99.9%;
- cleanup backlog oldest age <= 5 minutes;
- stuck processing and coherence violations = 0.

Metrics labels are closed enums only. Never add actor, media, object, file, email,
query, token, checksum, bucket or endpoint identity as a label.

The signed-content 99.9% SLI counts only requests eligible after excluding terminal
`invalid_grant` attempts from its started denominator. Invalid, tampered or expired
public grants remain visible in security telemetry but cannot consume the service
error budget. `unavailable`, `provider_mismatch`, `integrity_error` and a started
request without any terminal outcome are availability failures.

The ingestion 99.5% SLI likewise excludes terminal `rejected` and `disabled`
attempts from its valid-request denominator and counts only terminal `failed` and
`cleanup_required` outcomes as eligible failures. Rejected or disabled attempts stay
in outcome telemetry. A started ingestion request with no terminal outcome still
consumes availability budget through the all-started/all-terminal deficit, regardless
of eligibility.

Storage reads use typed outcomes: real provider transport failure is `unavailable`;
missing objects, malformed responses and checksum/size/MIME/body mismatches are
integrity/coherence failures. ClamAV transport/timeout/reset is `unavailable`, while
invalid framing, oversized, ambiguous and `ERROR` responses are `invalid_response`.
Neither branch may be inferred from attacker-controlled error text.

## Safe rollout and kill switch

1. Deploy with `MEDIA_INGESTION_ENABLED=false`. Metrics, signed reads and cleanup
   remain available.
2. Validate exact `GET /metrics` on the dedicated private port 9464 through the
   monitoring identity with the secret-managed bearer token. Confirm public edge
   `/metrics` and the legacy metrics namespace both return 404. A rejected scrape
   must not echo the token.
3. Rehearse a disabled upload and expect safe `503 MEDIA_INGESTION_DISABLED`.
4. Enable one staging replica, upload synthetic allowlisted fixtures, then expand.
5. To stop new writes, set the flag false and roll/reload replicas. Do not disable
   cleanup: forward recovery must remain possible.
6. Application rollback never rolls back migrations 16–19 or deletes ingestion history.

Prometheus and Alertmanager V1 deliberately use one replica, a `ReadWriteOnce` PVC
and `Recreate` strategy until HA clustering/deduplication is designed. Expect a brief
monitoring gap during replacement. Abort if either workload is not Ready within five
minutes, a PVC does not bind, an alert delivery is lost, a scrape target disappears,
or the real HTTPS runbook is unreachable. Roll back the image/config digest, retain
the PVC, and keep ingestion disabled.

The public Nginx edge must deny the complete `/metrics` and legacy metrics namespaces
and return `404` before generic proxy.
Prometheus uses the headless private service/NetworkPolicy and scrapes each backend
replica directly. Do not point the job at a load balancer; any production replica
count uses the validated pod service-discovery/relabeling contract. Bearer rotation
must preserve overlap because Prometheus hot-refreshes projected `current`, while
backend `current`/`previous` environment values change only on rollout:

1. Keep `current=OLD`; stage `previous=NEW`, then roll every backend so it accepts
   both tokens while Prometheus still sends OLD.
2. Atomically swap to `current=NEW`, `previous=OLD`. Prometheus flips to NEW through
   the projected file while the already-rolled backend accepts either token.
3. Roll every backend again with `current=NEW`, `previous=OLD`; verify every `up`
   target remains continuously healthy.
4. Remove `previous`, retain `current=NEW`, roll once more, and verify every target.

Abort and restore the preceding overlap phase on any scrape gap. Never overwrite
`current` with NEW before a backend rollout accepts NEW as `previous`; this is not
backend hot reload. Authorization headers must not enter logs.

## Cleanup and unknown PUT reconciliation

An unknown PUT owns one opaque key permanently. Never reuse it and never automatically
take over `processing`. Cleanup uses HEAD, DELETE and another HEAD. The first verified
absence records `cleanupAbsentObservedAt` and remains `cleanup_required`. Only a later
absence at least 60 seconds afterward may record `OBJECT_CLEANED`. If a late object is
seen, delete it and restart the 60-second window.

For `HskMediaCleanupBacklog` or `HskMediaProcessingStuck`:

1. Disable new ingestion and identify records by database ID only in the restricted
   operator session; never paste keys into tickets or chat.
2. Confirm current `processingToken`, provider and state under row lock.
3. Inspect storage with the workload identity; do not use public ACLs or signed URLs.
4. Use the admin cleanup endpoint for `cleanup_required`. For a stuck `processing`
   record, quiesce all workers and follow an approved database change to transition
   to explicit reconciliation; age alone is not ownership proof.
5. Confirm two absence observations, zero `Media`, one completion audit and cleared
   alert. Escalate any incoherence without mutating history.

## Scanner, storage and coherence alerts

- Scanner unavailable: keep ingestion disabled, verify ClamAV health/resources and
  exact INSTREAM responses. Ambiguous scans fail closed; never bypass scanning.
- Scanner invalid response: page Security immediately, preserve bounded protocol
  evidence without raw payload/response, verify ClamAV version/proxy framing, and
  keep ingestion disabled until exact OK/FOUND framing is restored.
- Storage spike: verify TLS, private bucket policy, workload identity, encryption,
  versioning and provider status. Permission errors stay fail-closed.
- Integrity error: disable affected reads/ingestion, preserve object and database
  evidence without copying keys/checksums into tickets, and page Media + Security.
- Coherence violation: disable ingestion immediately; preserve database/object
  evidence and involve Security + Data. Do not rename/delete keys or edit terminal
  facts manually.

## Live rehearsal checklist

- S3-compatible: private/public-block, TLS, encryption, versioning, lifecycle,
  least privilege; real PUT/HEAD/GET/DELETE, checksum/byte verification, >10 MiB
  streamed rejection, denied/missing/timeout/reset cases and unknown-PUT settling.
- ClamAV: clean JPEG/PNG/MP3/WAV, EICAR `FOUND`, unavailable/reset/timeout/malformed/
  oversized responses, concurrent scans and resource backpressure.
- Proxy: use `ops/nginx/media-security.conf`; confirm logs contain path only, never
  query/signature/full URL, and content stays `private, no-store` outside shared cache.
- Alerts: inject one synthetic counter/gauge condition per rule, verify routing,
  ownership and recovery notification. Retain sanitized outputs as CI/staging artifact.

Alert ownership: `media-platform` pages Media Platform, `platform-sre` pages SRE,
and `security-platform` pages Security. A page unacknowledged for five minutes
escalates to the incident commander; tickets enter the next business-day queue.
Resolved notifications are mandatory evidence.

Set `MEDIA_RUNBOOK_URL` to the real, credential-free HTTPS operator page and run
`npm run render:ops:media` before applying the observability overlay. Deploy only
the rendered directory; unresolved `__MEDIA_RUNBOOK_URL__` source markers are an
abort condition. Run `cd backend && npm run test:ops:media`. It uses pinned
versions/checksums from
`ops/observability/media-toolchain.json`, a complete Nginx wrapper and promtool rule
tests. Disposable Grafana must provision the exact rendered dashboard and fixed
datasource UID, then execute all panel queries before its gate can pass. Missing
artifacts/network/runbook/provider is `BLOCKED_EXTERNAL`; static
Jest artifact checks never
upgrade that result to PASS.

The observability overlay does not own the environment backend Deployment. Apply the
reviewed patch without replacing its application readiness contract:

```bash
umask 077
MEDIA_PATCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hsk-media-patch.XXXXXX")"
trap 'rm -rf "$MEDIA_PATCH_DIR"' EXIT
kubectl -n hsk get deployment hsk-backend -o yaml > "$MEDIA_PATCH_DIR/before.yml"
kubectl patch --local --type=strategic \
  -f "$MEDIA_PATCH_DIR/before.yml" \
  --patch-file ops/observability/media-backend-deployment.patch.yml \
  -o yaml > "$MEDIA_PATCH_DIR/preview.yml"
diff -u "$MEDIA_PATCH_DIR/before.yml" "$MEDIA_PATCH_DIR/preview.yml"
kubectl -n hsk patch deployment hsk-backend --type=strategic \
  --patch-file ops/observability/media-backend-deployment.patch.yml
kubectl -n hsk rollout status deployment/hsk-backend --timeout=5m
```

Before `apply`, review the diff and prove all pre-existing readiness, liveness and
startup probes remain byte-for-byte unchanged while only the private
`media-metrics` port, token secret refs and Istio injection are added. The portable
patch must never create a startup probe or combine `exec`, `httpGet`, `tcpSocket` or
`grpc` handlers. Abort on any unrelated diff, missing secret, failed app readiness or
failed metrics startup. Keep `sidecar.istio.io/rewriteAppHTTPProbers: "true"` on the
backend patch and every Prometheus/Alertmanager/Grafana pod template; STRICT mTLS
without probe rewriting is an abort condition. Restore the
previous application revision with `kubectl -n hsk rollout undo
deployment/hsk-backend` and wait for rollout only if the application rollout fails;
keep migrations 16–19 and immutable facts forward-only. The trap removes the
mode-0700 temporary directory; retain only a sanitized diff in the release evidence
store and never attach the live Deployment object or Secret values.

Run the release profile only in approved Linux x86_64 CI:

```bash
cd backend
MEDIA_OPS_TOOL_CACHE=/secure/ci-cache/media-ops \
MEDIA_RUNBOOK_URL=https://runbooks.example.internal/media-ingestion \
MEDIA_OPS_DB_EVIDENCE_JSON="$PWD/test-results/media-lifecycle-migration-validation/evidence.json" \
MEDIA_OPS_CAPACITY_BACKUP_EVIDENCE_JSON=/secure/ci/media-capacity-backup-evidence.json \
npm run test:ops:media:linux-amd64
```

Darwin arm64 may run `npm run test:ops:media:reference`, but that evidence is not a
release substitute. The Linux profile fails closed unless every non-DB quality gate,
the guarded aggregate DB evidence, OCI index/child digest, approved cosign workflow
identity, signed SPDX attestation and all operations validators pass. An external
block is a non-green release result.

The capacity/backup artifact is a secret-free, release-bound JSON record. It binds
the current commit/tree/content digest and a hashed cluster identity; proves the 50
GiB Prometheus PVC is bound, at most 80% used and safely expandable; records measured
compressed GiB/day and the exact `GiB/day × 32 × 1.25` projection at or below 40
GiB; and proves an encrypted >=32-day backup, a snapshot no older than 24 hours and a
successful restore rehearsal no older than 90 days. Missing, stale or unbound bytes
block the release profile.

Prometheus retains 32 days on a 50 GiB RWO PVC. Before apply, calculate measured
compressed ingest `GiB/day × 32 × 1.25`; abort above 40 GiB or without safe volume
expansion. Attach encrypted snapshot/export retention and a successful disposable
restore rehearsal. Local PVC retention alone is not backup. `Recreate` is required
for Prometheus, Alertmanager and Grafana and intentionally creates a brief monitoring
gap; abort if the workload is not Ready within five minutes.

Grafana is private API-only in this overlay. Approved automation uses the
`hsk-media-operator` workload identity for health/dashboard/datasource APIs. The
browser UI is not exposed. Do not broaden NetworkPolicy or add `/`, `/login`, `/d/*`
or `/public/*` until an authenticated access-gateway design and path matrix have a
separate review.

## Current evidence status

Deterministic adapter/database tests are reproducible locally. Live provider,
scanner, proxy and alert delivery evidence must be attached by Infra/Release before
production approval; absent credentials or endpoints means `BLOCKED_EXTERNAL`, not
PASS.

The 2026-08-13 observability/edge closeout added typed storage/scanner outcomes, one
aggregate database query per scrape, replica-aware discovery topology, private metrics
NetworkPolicy, exact credentialed CORS, API security headers, strong separated secret
validation and bearer overlap rotation. Detailed matrices are in
`MEDIA_OBSERVABILITY_EDGE_SECURITY_CLOSEOUT.md`. Read the current sanitized JSON/
JUnit evidence for actual per-validator status; this runbook does not copy an old
tool inventory or claim a release PASS.

The frozen migration 17 SHA-256 is
`e333c0b0f265138e7c9ba16d17fc77d9586933bdd21ba70fda33f6fffe515773`.
Migration 16 remains byte-identical at
`a5bb8bdd6f8408b3360fe987e8d4fb7bf15f22c94f84e3fdac03dc4e93ebfe2e`.
Migration 18 is forward-only and carries stable lifecycle timestamps used by current
cleanup/processing age metrics. Migration 19 validates cleanup audit authority and
installs the future-write lifecycle guards. The release profile independently
recomputes the entire 19-migration source catalog and exact latest checksums, then
accepts only a current release-bound aggregate database artifact covering fresh and
upgrade deploys, negative fixtures, bounded lock abort, both lifecycle race orders,
integration, concurrency, status, checksum, two-way drift and full E2E. This runbook
does not copy a pre-run PASS count; read the current JSON/JUnit evidence.

Migration preflight rehearsals were fail-safe. A completed legacy row without an
exact immutable provenance audit and a source with an ambiguous whitespace license
both stopped with `P0001` before any migration 17 column or trigger remained. A
synthetic completed row with an exact six-field provenance audit migrated
successfully and produced the expected immutable snapshot. These disposable
fixtures validate migration mechanics only; they are not evidence for real source
licensing or live infrastructure.
