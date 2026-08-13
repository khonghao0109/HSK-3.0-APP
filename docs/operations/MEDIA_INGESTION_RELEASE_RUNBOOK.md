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

Provisional beta objectives, measured over a rolling 28-day window after a seven-day
staging observation period:

- successful valid ingestion availability >= 99.5%;
- p95 synchronous processing latency <= 8 seconds for <= 10 MiB assets;
- signed content availability >= 99.9%;
- cleanup backlog oldest age <= 5 minutes;
- stuck processing and coherence violations = 0.

Metrics labels are closed enums only. Never add actor, media, object, file, email,
query, token, checksum, bucket or endpoint identity as a label.

## Safe rollout and kill switch

1. Deploy with `MEDIA_INGESTION_ENABLED=false`. Metrics, signed reads and cleanup
   remain available.
2. Validate `/api/v1/internal/metrics/media` through the private monitoring network
   with the secret-managed bearer token. A rejected scrape must not echo the token.
3. Rehearse a disabled upload and expect safe `503 MEDIA_INGESTION_DISABLED`.
4. Enable one staging replica, upload synthetic allowlisted fixtures, then expand.
5. To stop new writes, set the flag false and roll/reload replicas. Do not disable
   cleanup: forward recovery must remain possible.
6. Application rollback never rolls back migration 17 or deletes ingestion history.

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
- Storage spike: verify TLS, private bucket policy, workload identity, encryption,
  versioning and provider status. Permission errors stay fail-closed.
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

## Current evidence status

Deterministic adapter/database tests are reproducible locally. Live provider,
scanner, proxy and alert delivery evidence must be attached by Infra/Release before
production approval; absent credentials or endpoints means `BLOCKED_EXTERNAL`, not
PASS.

The frozen migration 17 SHA-256 is
`e333c0b0f265138e7c9ba16d17fc77d9586933bdd21ba70fda33f6fffe515773`.
Migration 16 remains byte-identical at
`a5bb8bdd6f8408b3360fe987e8d4fb7bf15f22c94f84e3fdac03dc4e93ebfe2e`.
On 2026-08-13, two independent fresh disposable databases deployed all 17
migrations. The media integrity SQL passed and rolled back with zero ingestion rows;
both live-database-to-datamodel and migration-history-to-datamodel drift checks
reported no difference. The final catalog inventory was 60 tables, 147 foreign keys,
512 catalog check rows and 61 trigger-event rows. Full backend E2E passed 11 suites
and 160 tests; the no-database gate passed 45 suites and 411 tests; the production
dependency audit reported zero vulnerabilities.

Migration preflight rehearsals were fail-safe. A completed legacy row without an
exact immutable provenance audit and a source with an ambiguous whitespace license
both stopped with `P0001` before any migration 17 column or trigger remained. A
synthetic completed row with an exact six-field provenance audit migrated
successfully and produced the expected immutable snapshot. These disposable
fixtures validate migration mechanics only; they are not evidence for real source
licensing or live infrastructure.
