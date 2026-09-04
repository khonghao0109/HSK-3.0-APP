# Media Ingestion Release Runbook

Owner: Media Platform. Security partner: Security Platform. Severity: cleanup,
scanner and coherence pages are SEV-2 until triage proves lower impact.

Hosted runbook instances must preserve these machine-verifiable metadata lines and
the recovery marker. The deployment must replace the revision placeholder with the
exact tag and 40-character commit being released; a date or parent commit is invalid:

```text
HSK_MEDIA_INGESTION_RUNBOOK_V1
service: media-ingestion
runbook-id: media-ingestion-production
owner: platform-sre
revision: v3.0.0@<40-lowercase-release-commit>
HSK_MEDIA_RECOVERY_ROLLBACK_V1
```

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

### Bounded production migration and failed-row recovery

The only primary production deploy command is repository-owned and accepts no caller
arguments:

```bash
cd backend
npm run migrate:deploy:production
```

Inject `DATABASE_URL` from the production workload identity/secret manager without
printing it. The command resolves the repository-local Prisma CLI, replaces both a
caller-supplied URL `options` value and `PGOPTIONS`, and enforces `lock_timeout=2s`,
`statement_timeout=30s`, `idle_in_transaction_session_timeout=35s` and a 45-second
process deadline. Exit `75` means an exact database lock timeout; exit `124` means the
outer command deadline elapsed; exit `3` is used only when Prisma actually surfaces
both `P3018` and database preflight `P0001`. Prisma 5.22 can instead retain an
unfinished migration row with `logs IS NULL` while returning exit `1` and only
`current transaction is aborted`; that diagnostic must remain an abort and must not
be relabelled as `P3018`. Every result is an abort unless the exit is zero. The wrapper
never runs `reset`, `db push` or `migrate resolve`.

If Prisma records migration 19 as failed, keep every writer quiesced and preserve only
sanitized count/boolean/checksum evidence. Verify one unfinished, unrolled-back row for
`20260813193000_media_cleanup_audit_integrity` with checksum
`c4a772f832cba6b5dd02385727e17153ec1cf672dd3f67ec90da83dba5026252`, exactly 18
successful migrations and zero migration-19 functions/triggers. A second deploy must
remain blocked by `P3009`. A retained Prisma log may be absent, so do not infer a
SQLSTATE from an empty field. Corroborate the exact source checksum, preflight
predicate, atomic schema state and sanitized operator evidence before reconciling
forward; never update/delete immutable audit history merely to pass the preflight.

Only after the exact failed row, full transaction rollback and reconciled invariant are
independently confirmed may an operator mark that attempt rolled back:

```bash
cd backend
export NODE_ENV=production
# Inject DATABASE_URL and the approved target fingerprint from the secret/change system.
export MEDIA_MIGRATION_EXPECTED_TARGET_SHA256='<sha256-of-host-port-database-public>'
npm run migrate:resolve:media-cleanup-audit:production
npm run migrate:deploy:production
./node_modules/.bin/prisma migrate status --schema prisma/schema.prisma
```

The compiled resolve command accepts no arguments, uses the repository-local Prisma
Client, overwrites URL `options` and `PGOPTIONS` with the same 2/30/35-second database
timeouts, applies the same 45-second command deadline and can only mark
`20260813193000_media_cleanup_audit_integrity` rolled back. In one bounded transaction
it acquires Prisma's advisory lock plus `SHARE ROW EXCLUSIVE` locks on
`_prisma_migrations`, `MediaIngestion` and `AuditLog`; verifies the production target,
one exact unfinished/unrolled-back row and checksum, no other unresolved row, exactly
18 successful migrations, the immutable source checksum, zero migration-19
functions/triggers and zero authoritative lifecycle/audit violations; conditionally
updates that exact row; and verifies the postcondition before commit. The update must
affect exactly one row. Cancellation, deadline, zero-row update, query failure or
postcondition failure detected before the callback returns rejects and rolls back the
transaction. Returning the exact commit decision begins an irrevocable phase: the
wrapper waits for Prisma to acknowledge the transaction and a confirmed commit wins
over a signal or deadline that arrived while `COMMIT` was in flight. Exit `78` means
the target or precondition was rejected without mutation; exit `70` means the guarded
query/mutation/postcondition failed internally; exit `124` means the deadline elapsed
before a committed outcome. It never forwards raw database diagnostics and has no
external resolve child or advisory-lock bypass. If the wrapper is forcibly terminated
during the commit phase, rerun the same guarded command to reconcile the authoritative
row before any deploy. Production preflight, deploy and retained-log inspection remain
under the detached process-group supervisor; resolve does not spawn a process group.

Do not run the resolve command for an unknown error, a checksum mismatch, any partial
DDL, an unreconciled lifecycle/audit invariant or a row already finished/rolled back.
After recovery, require the exact 19-migration catalog, an up-to-date status and empty
migration-history-to-datamodel plus live-to-datamodel drift before enabling writers.

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

The six live checks are accepted only as a signed V2 package from the independently
approved `live-rehearsal` producer. The package must bind the protected collector run
ID/attempt and hash every bounded raw S3, ClamAV, mesh, alert, replica and workload-
identity artifact. A PASS summary without those readable raw bytes is invalid. The
checked-in producer policy remains `HOST_ACCEPTANCE_REQUIRED` until Security, SRE and
Release Engineering approve real collector identities and commands.

Alert ownership: `media-platform` pages Media Platform, `platform-sre` pages SRE,
and `security-platform` pages Security. A page unacknowledged for five minutes
escalates to the incident commander; tickets enter the next business-day queue.
Resolved notifications are mandatory evidence.

Set `MEDIA_RUNBOOK_URL` to the real, credential-free HTTPS operator page and set
`MEDIA_RUNBOOK_APPROVED_HOSTNAME` to its one exact public DNS hostname. The protected
validator resolves the complete A/AAAA answer once, rejects every non-global answer,
pins a validated address and preserves hostname/SNI certificate verification. Then
run `npm run render:ops:media` before applying the observability overlay. Deploy only
the rendered directory; unresolved `__MEDIA_RUNBOOK_URL__` source markers are an
abort condition. Run `cd backend && npm run test:ops:media`. It uses pinned
versions/checksums from
`ops/observability/media-toolchain.json`, a complete Nginx wrapper and promtool rule
tests. Disposable Grafana must provision the exact rendered dashboard and fixed
datasource UID, then execute all panel queries before its gate can pass. Missing
external evidence/provider/runbook reachability is `BLOCKED_EXTERNAL`;
missing/wrong tools, verifier/parser defects, registry defects and retention failures
are `FAIL_INTERNAL`. Static Jest artifact checks never upgrade either result to PASS.

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
export MEDIA_RUNBOOK_APPROVED_HOSTNAME='<approved-public-runbook-hostname>'
export MEDIA_RUNBOOK_URL="https://${MEDIA_RUNBOOK_APPROVED_HOSTNAME}/media-ingestion"
MEDIA_OPS_TOOL_CACHE=/secure/ci-cache/media-ops \
MEDIA_OPS_PRODUCTION_PREREQUISITE_EVIDENCE_JSON=/secure/ci/media-production-prerequisites.json \
MEDIA_OPS_PRODUCTION_PREREQUISITE_EVIDENCE_BUNDLE=/secure/ci/media-production-prerequisites.sigstore.json \
MEDIA_OPS_DB_EVIDENCE_JSON="$PWD/test-results/media-lifecycle-migration-validation/evidence.json" \
MEDIA_OPS_DB_EVIDENCE_BUNDLE=/secure/ci/media-database-release-evidence.sigstore.json \
MEDIA_OPS_OCI_RELEASE_EVIDENCE_JSON=/secure/ci/media-oci-release-acceptance.json \
MEDIA_OPS_OCI_RELEASE_EVIDENCE_BUNDLE=/secure/ci/media-oci-release-acceptance.sigstore.json \
MEDIA_OPS_OCI_RELEASE_EVIDENCE_ROOT=/secure/ci/media-oci-release \
MEDIA_OPS_OCI_WAIVER_APPROVAL_JSON=/secure/ci/media-oci-waiver-approvals.json \
MEDIA_OPS_OCI_WAIVER_APPROVAL_BUNDLE=/secure/ci/media-oci-waiver-approvals.sigstore.json \
MEDIA_OPS_CAPACITY_BACKUP_EVIDENCE_JSON=/secure/ci/media-capacity-backup-evidence.json \
MEDIA_OPS_CAPACITY_BACKUP_EVIDENCE_BUNDLE=/secure/ci/media-capacity-backup-evidence.sigstore.json \
MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_JSON=/secure/ci/media-live-rehearsal/manifest.json \
MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_BUNDLE=/secure/ci/media-live-rehearsal.sigstore.json \
MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_ROOT=/secure/ci/media-live-rehearsal \
MEDIA_OPS_LIVE_COLLECTOR_RUN_ID='<protected-collector-run-id>' \
MEDIA_OPS_LIVE_COLLECTOR_RUN_ATTEMPT='<positive-run-attempt>' \
MEDIA_OPS_LIVE_EXPECTED_CLUSTER_IDENTITY_SHA256='<64-lowercase-hex>' \
MEDIA_OPS_LIVE_EXPECTED_NAMESPACE_IDENTITY_SHA256='<64-lowercase-hex>' \
MEDIA_OPS_LIVE_EXPECTED_DEPLOYMENT_REVISION='sha256:<64-lowercase-hex>' \
MEDIA_OPS_LIVE_EXPECTED_WORKLOAD_AUDIENCE='<protected-provider-audience>' \
MEDIA_OPS_LIVE_EXPECTED_WORKLOAD_SUBJECT='system:serviceaccount:<namespace>:<service-account>' \
npm run test:ops:media:linux-amd64
```

The two runbook variables above are placeholders, not an approved endpoint. Replace
them from the protected environment only after the public hostname serves the exact
current marker/revision contract. Leaving either placeholder in place is
`HOST_ACCEPTANCE_REQUIRED`; it is never production evidence.

Darwin arm64 may run `npm run test:ops:media:reference`, but that evidence is not a
release substitute. The Linux profile fails closed unless every non-DB quality gate,
the guarded aggregate DB evidence, OCI index/child digest, approved tag-scoped HSK
release-acceptance identity, hash-bound SPDX/vulnerability/license reports and all
operations validators pass. This HSK signature accepts the exact inspected bytes for
the release; it is not an upstream publisher signature. An external block is a
non-green release result.

Before parsing any producer JSON, Cosign must verify the detached bundle against the
exact accepted record for that evidence type in
`ops/observability/media-evidence-producers.json`. This pins issuer, producer workflow
identity and display name, repository, immutable tag ref, workflow SHA and trigger.
The final `media-release-evidence.yml` verifier identity is explicitly forbidden as
an input producer at every ref; an empty, wildcard, branch or wrong-repository
identity is invalid. Every signed payload also repeats the accepted command, semantic
version, environment, evidence types, raw evidence set, freshness and verifier as its
exact `producerExecution` contract. A mismatch is rejected before evidence can PASS.
The checked-in producer records remain `HOST_ACCEPTANCE_REQUIRED` until the protected
owners provide real collector identities and executable commands atomically. The
policy root and all six producer entries must become `ACCEPTED` together; a
waiver-free OCI manifest does not permit the release profile to ignore a pending
`oci-risk-approval` producer.

The OCI manifest must name all three exact
index and Linux amd64 child digests in ADR-006 and bind exact Syft SPDX, Grype and
license report/policy hashes. Security Platform owns policy and waivers; Release
Engineering owns the protected tag workflow and 90-day retained evidence. Rotate by
reviewing a new exact tag identity and producing fresh current-release evidence;
never broaden the regex or relabel HSK acceptance as upstream provenance.

OCI `observedAt`, `expiresAt` and validation time must remain inside one five-day
freshness window. A vulnerability waiver identifies exactly the vulnerability ID,
package, version, artifact type and severity in addition to its release, image and
report binding. Critical waivers are limited to 24 hours; High and license waivers are
limited to seven days, but no waiver may outlive the signed five-day OCI evidence
expiry. A changed severity or artifact type requires a new signed waiver.
Each non-empty waiver additionally requires an exact entry in a separate signed
`hsk-media-oci-waiver-approvals` payload from the accepted `oci-risk-approval`
producer. That producer must be distinct from the OCI evidence producer. Its approval
bytes bind every waiver field and the exact release, image, report and finding, are
consumed one-to-one, and are retained after trust verification. The signed approval
also carries canonical `observedAt` and `expiresAt`: its active window is at most five
days and cannot outlive the OCI evidence. Every approved waiver must already be issued
within clock skew and cannot outlive that approval. Missing, stale, changed,
cross-release or unused approvals are rejected. A waiver-free OCI release does not
require an approval payload, but still requires the complete producer policy to be
accepted.

The release verifier consumes both payload and pre-existing bundle paths from the
protected runner and has no `id-token: write` permission. It must never call
`cosign sign` or `sign-blob` on supplied evidence. A signing collector is acceptable
only when it directly executes the pinned scanner/live rehearsal and signs the
result after those commands succeed. No such collector run is part of this closeout,
so missing bundles are expected `BLOCKED_EXTERNAL` rather than something the
verifier repairs or self-signs.

For the six live-environment prerequisites, provide one pre-signed package and its
protected collector identity through all variables below; do not provide only a
subset. Supply the three expected production-environment values independently from
the deployment/change system, never by copying them out of the signed manifest:

```text
MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_JSON=/protected/input/live-package/manifest.json
MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_BUNDLE=/protected/input/live-package.sigstore.json
MEDIA_OPS_LIVE_REHEARSAL_EVIDENCE_ROOT=/protected/input/live-package
MEDIA_OPS_LIVE_COLLECTOR_RUN_ID=<protected-collector-run-id>
MEDIA_OPS_LIVE_COLLECTOR_RUN_ATTEMPT=<positive-run-attempt>
MEDIA_OPS_LIVE_EXPECTED_CLUSTER_IDENTITY_SHA256=<64-lowercase-hex>
MEDIA_OPS_LIVE_EXPECTED_NAMESPACE_IDENTITY_SHA256=<64-lowercase-hex>
MEDIA_OPS_LIVE_EXPECTED_DEPLOYMENT_REVISION=sha256:<64-lowercase-hex>
MEDIA_OPS_LIVE_EXPECTED_WORKLOAD_AUDIENCE=<protected-provider-audience>
MEDIA_OPS_LIVE_EXPECTED_WORKLOAD_SUBJECT=system:serviceaccount:<namespace>:<service-account>
```

The cluster hash is SHA-256 over the exact UTF-8 immutable provider cluster resource
ID recorded by the approved deployment/change system. The namespace hash is SHA-256
over `cluster-resource-id`, a NUL byte, the exact namespace name, a NUL byte and the
immutable namespace UID. The protected host derives these values from that approved
record; operators must not copy hashes from the evidence being verified. Audience and
subject come from the same approved workload-identity configuration and must match
the deployed service account exactly.

The protected workflow validates the corresponding secret-backed paths before
exporting these runner variables. The manifest must use schema version 2 and ID
`hsk-media-live-production-evidence-v2`; repeat the exact approved issuer and identity;
bind the current commit, tree and release-content digest; use canonical fresh
`observedAt`/`expiresAt` values; and bind one production environment through cluster
and namespace identity hashes, an exact `sha256:<64>` deployment revision and the
derived `hsk-media-live-environment-v1` fingerprint. The verifier recomputes that
fingerprint and requires the entire signed environment to equal the independently
configured production environment. Observation may be no more than 60 seconds in the
future, and observation, expiry and validation time must fit within the seven-day live
freshness window.

The manifest has two exact six-entry registries, `rawArtifacts` and `artifacts`, with
one entry for each prerequisite below:

- `media-live-s3-provider`;
- `media-live-clamav`;
- `media-deployed-proxy-mesh-policy`;
- `media-production-alert-delivery`;
- `media-backend-replica-discovery`;
- `media-secret-manager-workload-identity`.

Every `rawArtifacts` entry has an explicit raw ID, prerequisite ID, safe relative JSON
path, `application/json` media type, byte size and SHA-256. Each referenced raw file is
limited to 256 KiB; the verifier opens those stable bytes below the evidence root,
recomputes the size and digest, and only then parses the domain semantics. Every
`artifacts` entry uses its tracked evidence type, a distinct safe relative JSON path
and exact summary SHA-256. The summary is also limited to 256 KiB and repeats the exact
producer, release, environment, collector run and freshness binding from the signed
manifest. It contains `status: PASS`, a credential-free production HTTPS evidence URI,
explicit raw artifact IDs and hashes for sanitized command provenance, logs and every
semantic check. Evidence URIs must be distinct across the six summaries. Each check
has only `{id, status, evidenceArtifactId, evidenceSha256}`, must be `PASS`, and
missing, extra or duplicate IDs are rejected. One raw artifact may prove multiple
checks only through this explicit repeated ID/digest mapping; raw reuse is otherwise
forbidden. The exact check IDs remain:

- `media-live-s3-provider`: `private-access-policy`, `tls-transport`,
  `encryption-at-rest`, `versioning-lifecycle`, `put-head-get-delete`,
  `checksum-byte-readback`, `oversize-stream-rejected`,
  `denied-missing-timeout-reset`, `unknown-put-settled`;
- `media-live-clamav`: `engine-database-version`, `clean-formats-accepted`,
  `eicar-found`, `transport-failures-rejected`, `malformed-oversized-rejected`,
  `concurrent-scan-backpressure`;
- `media-deployed-proxy-mesh-policy`: `nginx-policy-deployed`,
  `private-no-store-enforced`, `query-signature-redaction`,
  `strict-mtls-enforced`, `network-policy-deny-by-default`,
  `authorized-workload-allowed`;
- `media-production-alert-delivery`: `production-alert-fired`,
  `owner-route-matched`, `firing-notification-delivered`,
  `resolved-notification-delivered`, `escalation-path-verified`;
- `media-backend-replica-discovery`: `minimum-two-ready-replicas`,
  `headless-service-discovery`, `distinct-pod-targets`,
  `each-replica-metrics-scrape`, `replacement-reconverged`;
- `media-secret-manager-workload-identity`: `workload-identity-authenticated`,
  `static-credential-absent`, `secret-manager-read-authorized`,
  `short-lived-token`, `rotation-overlap-rehearsed`,
  `provider-audit-event-retained`.

The ClamAV raw semantics must report exactly the four clean MIME formats
`audio/mpeg`, `audio/wav`, `image/jpeg` and `image/png`, plus EICAR `FOUND` and the
documented failure/backpressure outcomes. The alert raw semantics must name
`HskMediaValidationSyntheticPage`, route it to `platform-sre`, observe firing, and
retain pairwise-distinct firing, resolved and escalation receipt IDs. The workload
identity raw semantics must equal the independently protected audience and exact
`system:serviceaccount:<namespace>:<service-account>` subject. The verifier does not
invent or infer those values from the signed package; a different service, namespace,
audience or subject is not equivalent.

The runner reads the manifest (maximum 1 MiB), bundle (maximum 4 MiB) and reports
through stable canonical-root boundaries. It verifies the bundle with the exact
GitHub issuer/identity and certificate workflow/repository/ref/SHA/trigger claims
before parsing any JSON, then verifies every raw report hash and semantic contract.
Accepted bytes are retained as the live manifest and bundle, every exact raw file,
and one normalized `live-rehearsals/artifacts/<prerequisite-id>.json` summary per ID
in the protected evidence tree. Missing package variables or referenced files are
`BLOCKED_EXTERNAL`; stale, malformed, tampered, path-unsafe,
release/environment-mismatched or semantically incomplete externally supplied input
is also rejected as `BLOCKED_EXTERNAL` and can never register PASS. A missing or
incorrect internal verifier registration is `FAIL_INTERNAL`.

This is verifier support, not production evidence. The current workflow still does
not collect or sign the six live rehearsals, and no real package is supplied by this
closeout. The external owners must implement and authorize that collector separately;
until then all six prerequisite statuses remain `BLOCKED_EXTERNAL`.

After signature and semantic checks pass, the verifier retains exact copies of
each accepted primary JSON and Sigstore bundle under
`backend/test-results/media-operations/trusted-inputs/`. These copies, command
logs, structured summaries and their hashes are frozen into the protected CI tar.
Do not substitute a temporary verification directory or ignored local tar for that
retained artifact.

The local reference profile may hash stable dirty source bytes only as diagnostic
evidence. The protected `release-linux-amd64` workflow requires `.github/workflows`,
`backend`, `docs` and `ops` to match exact HEAD before any repository script runs. It
also rechecks `HEAD` and the release tag against protected `GITHUB_SHA` at that
boundary, then passes the same expected commit/tag ref into the runner. The runner
resolves both at initial binding and before publication, rejects tracked
modifications, untracked release content or deletions, and rechecks the same content.
Dirty reference evidence is never a tagged release substitute.

`media-immutable-evidence-attestation` is a post-gate output, not an input to the
same archive. The runner sets `postGateAttestationReady=true` only when that exact
item is the sole `BLOCKED_EXTERNAL` result. The workflow may then attest the frozen
tar; any other external block or internal failure keeps the validation job
non-green, and the final enforce job requires a successful attestation.

Database evidence follows the same trust-before-parse rule: the signed JSON binds
its sanitized command logs, JUnit, migration catalog and current release, and the
runner verifies its detached bundle over a private snapshot before reading those
claims. A local JSON result without that producer bundle remains
`BLOCKED_EXTERNAL` even when the disposable harness itself passed.

The capacity/backup artifact is a secret-free, release-bound JSON record. Its
detached Sigstore bundle is verified before JSON parsing. It binds the current
commit/tree/content digest and a derived hashed cluster identity; proves the 50
GiB Prometheus PVC is bound, at most 80% used and safely expandable; records measured
compressed GiB/day and the exact `GiB/day × 32 × 1.25` projection at or below 40
GiB; and proves an encrypted >=32-day backup, a snapshot no older than 24 hours and a
successful restore rehearsal no older than 90 days. The cluster fingerprint is
recomputed from the signed provider/PVC/snapshot/restore provenance digests rather
than trusted as a self-declared string. Missing, unsigned, stale, tampered or unbound
bytes block the release profile; a self-declared `restoreSucceeded` is insufficient.

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
`../archive/MEDIA_OBSERVABILITY_EDGE_SECURITY_CLOSEOUT.md` (archived 2026-09-04). Read the current sanitized JSON/
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
