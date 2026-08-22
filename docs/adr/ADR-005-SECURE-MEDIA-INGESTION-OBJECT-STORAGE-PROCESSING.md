# ADR-005: Secure Media Ingestion, Object Storage & Processing Pipeline V1

- Status: Accepted
- Date: 2026-08-12
- Owners: Product, Backend, Security, Data, Operations
- Scope: Admin ingestion and authorized private delivery of JPEG, PNG, MP3 and WAV

## Context

ADR-004 intentionally exposed only inventory, inspection and safety lifecycle for
existing `Media`. The application still needed a horizontally scalable, fail-closed
way to create a ready asset. A replica-local filesystem, client MIME/filename trust,
or a `Media.ready` row written before durable object validation would create spoofing,
orphan and operational recovery risks.

## Decision

The API owns a bounded multipart ingestion boundary with a default 30-second absolute
request-body deadline (production configuration is bounded to 1–120 seconds). It authenticates and rechecks
an active admin, requires licensed `DataSource` provenance, hashes the idempotency key
and request fingerprint, validates bytes, scans the trusted processed representation,
writes a private shared object and only then commits a ready `Media` plus completed
`MediaIngestion` and redacted audit atomically.

The V1 allowlist is JPEG, PNG, MP3 and PCM WAV, maximum 10 MiB. Image decode/re-encode
uses Sharp with a 40-million-pixel cap. WAV structure and length are parsed locally;
MP3 duration/metadata use `music-metadata`. Active formats and executable/polyglot
signatures fail closed. Larger/streaming video and PDF are not inferred into V1.

Production object storage uses the provider-independent port and S3-compatible
adapter with private writes, AES256 server-side encryption, SHA-256 metadata, one
absolute 8-second deadline across request and streamed response body, and
workload-identity credentials. Only tests use the in-memory adapter.
Production malware scanning uses ClamAV INSTREAM with one absolute 10-second deadline
covering connect, backpressure-aware upload, response and parsing;
unavailable or ambiguous scan never produces ready content.

Storage reads expose a fixed typed taxonomy across the port: unavailable, not found,
provider mismatch, malformed response and integrity violation. Signed reads and
completed replay never collapse corruption into provider outage. ClamAV likewise
separates transport unavailability from invalid protocol responses without matching
raw error messages. Both taxonomies expose only safe fixed text.

## Identity, state and concurrency

`MediaIngestion` records actor/source, hashed idempotency identity, request hash,
sanitized filename, MIME decisions, size/checksum/object identity and attempts.
The state machine is:

```text
pending -> processing -> completed
                   |--> rejected
                   |--> failed
                   `--> cleanup_required -> cleanup_required (settling) -> failed
```

Claim lock order is active admin `User FOR SHARE`, licensed `DataSource FOR SHARE`,
then existing `MediaIngestion FOR UPDATE`. Network processing/scanning/storage calls
never run while those transaction locks are held. A concurrent exact retry either
observes the completed fact or receives conflict while processing; it cannot create
another ingestion/media/object identity.

Every processing attempt owns a random `processingToken`. Reserve, reject, failure,
finalize, compensation and cleanup compare this fence with the current row. V1 does
not automatically take over an old `processing` row based on application time: age
alone cannot prove the previous network side effect stopped. Recovery is explicit
and is not an automatic API takeover. Operations must quiesce ingestion workers,
reconcile the tracked key against private storage, then use a controlled row-locked
transaction to move the row to `cleanup_required` (object exists or is uncertain) or
`failed` (absence proved) before the cleanup/retry lifecycle. Clock skew between
replicas therefore cannot transfer ownership or let a stale loser delete/finalize the
winner's object.

Filename is NFKC bounded metadata only. Object keys are opaque UUID paths and do not
contain user input. The hashed idempotency key is unique per actor. Exact request fingerprint binds actor, source, normalized name,
declared MIME, raw size and raw checksum. A completed replay verifies current object
bytes/checksum/MIME/size and coherent ready Media/provenance before success.

## Failure and compensation

Database is not marked ready before storage succeeds. The S3 adapter classifies an
explicit pre-write provider rejection as `definite_not_written` and timeout/transport
or other ambiguous outcomes as `unknown`. A definite rejection transitions directly
to `failed`. An unknown PUT outcome is never auto-deleted because the provider may
commit after the client timeout; the tracked key remains `cleanup_required` until
explicit reconciliation. Deterministic finalize failure deletes the object. If that
deletion cannot be confirmed, state is `cleanup_required` and
an admin-only retry performs cleanup; it is never silently classified as clean.
Post-commit hardening requires HEAD/DELETE/HEAD and two verified absence observations
at least 60 seconds apart before `OBJECT_CLEANED`. A late PUT is deleted and restarts
the settling window; an ambiguous/cleaned key is never reused.
Claim, rejection, finalize and cleanup use a request-owned token plus authoritative
row reread to reconcile lost transaction commit acknowledgements without replaying
object side effects or duplicating audit. An unreadable outcome returns a safe 503
and requires reconciliation rather than guessing.
The first cleanup transition and its immutable audit are committed together. The audit
reuses the exact `cleanupRequiredAt` returned by PostgreSQL; later cleanup facts use a
timestamp read from the same database transaction, avoiding process/session timezone
inference while refusing old, future or invented history.
S3 reads stream with an actual-byte 10 MiB cap independent of provider-declared
`ContentLength`. ClamAV accepts only exact NUL-terminated `OK`/`FOUND` responses;
missing, extra, oversized or ambiguous protocol responses fail closed. Processing,
scan, storage, database, rejection and cleanup outcomes create bounded
audit summaries with no filename, raw payload, object key, checksum, token or signed
URL.

SQL backstops reject ingestion hard-delete, identity changes and terminal mutation.
Completed ingestion must match a ready/live Media across actor, licensed source,
provider/key, MIME/type, size/checksum and access URL. Ingested storage identity is
immutable, while safety `processingStatus` and `deletedAt` remain mutable so existing
quarantine/archive workflows continue to work.

Migration 17 snapshots source code, version, license, attribution, reference URL and
content hash into each ingestion. Referenced provenance becomes immutable; corrections
create a new DataSource version. Claim/finalize hold source locks and require an exact
snapshot match. The V1 deployment has one configured storage adapter: access, replay,
cleanup and retry require exact provider equality before storage I/O.

## Private access

`GET /media/:id/access` requires JWT. Admin can inspect any live ready ingested asset;
a learner needs a published/live LessonExercise reference. The result is a same-origin
HMAC capability URL valid 60–600 seconds. Content serving verifies expiry/signature,
ready/live Media and object checksum/bytes/MIME/size, returns `nosniff`, and never
reveals the raw provider key. The response uses `Cache-Control: private, no-store`;
reverse proxies/CDNs must not cache it and access logs must redact `signature` plus
the full signed query URL. CSP stays same-origin; no broad storage origin is added.

## Consequences, operations and rollback

- Replicas remain stateless and scale horizontally against PostgreSQL, S3-compatible
  storage and ClamAV.
- Rate limit state is PostgreSQL-backed (5 attempts/admin/minute); multi-region global
  rate limiting and asynchronous large-file workers are deferred.
- Buffers are bounded to 10 MiB. Streaming/chunked multipart is required before adding
  larger video/PDF rather than raising this cap.
- Operations must configure a private bucket, workload identity, encryption,
  versioning/retention/lifecycle, scanner availability and dashboards for failure
  codes/cleanup backlog/latency.
- Rollback disables ingestion/access routes but retains migration/history/objects.
  Repair is forward-only; do not hard-delete facts or edit an applied migration.
- UI is not in scope; no Admin Library redesign or upload button is implied.
- `MEDIA_INGESTION_ENABLED=false` disables only new ingestion. Cleanup, signed reads
  and private bounded-cardinality metrics remain available for forward recovery.
- Operations artifacts are `ops/observability/*`, `ops/nginx/media-security.conf` and
  `docs/operations/MEDIA_INGESTION_RELEASE_RUNBOOK.md`.
- Metrics counters are replica-local and scraped directly per pod; database gauges
  use one aggregate query per scrape. Public ingress denies the metrics path, while
  a headless service plus NetworkPolicy admits only the trusted edge and monitoring
  identities; direct scrape still requires a bearer token. Rotation uses a bounded
  current/previous overlap.
- Production CORS is an exact HTTPS allowlist. API security headers are applied in
  the Nest bootstrap; HSTS remains solely at the TLS edge. Production startup rejects
  placeholder, weakly encoded, low-diversity or cross-purpose reused secrets.

## Verification and release boundary

Migration 16 remains frozen at SHA-256
`a5bb8bdd6f8408b3360fe987e8d4fb7bf15f22c94f84e3fdac03dc4e93ebfe2e`.
The forward-only provenance/provider hardening migration 17 is frozen at
`e333c0b0f265138e7c9ba16d17fc77d9586933bdd21ba70fda33f6fffe515773`.
The forward-only lifecycle telemetry truthfulness migration 18 is frozen at
SHA-256
`1a7ceb056e71b46ed05d2c42139bcc3db6c9b5412e788c4a3800c3fa9f27dcca`.
The forward-only cleanup audit integrity migration 19 is frozen at SHA-256
`c4a772f832cba6b5dd02385727e17153ec1cf672dd3f67ec90da83dba5026252`.

The earlier database rehearsal is a historical, superseded baseline and is not
current release evidence. Current guarded aggregate evidence deployed all 19/19
migrations on a fresh disposable PostgreSQL 16 database, upgraded a first-17 catalog
through migrations 18–19 with exact legacy backfill, and rejected malformed/future
immutable audit fixtures atomically. Media integrity, bounded lock abort/recovery and
both audit/lifecycle race orders passed; both the live-database-to-datamodel and
migration-history-to-datamodel drift checks were empty. Full backend E2E passed 11/11
suites and 163/163 tests. The machine-readable artifact is local evidence under
`backend/test-results/media-lifecycle-migration-validation/`; it is ignored and is not
an immutable CI attestation.

Negative preflight rehearsals proved atomic failure for a completed legacy ingestion
without the exact immutable provenance audit and for an ambiguous whitespace source
license. A positive synthetic fixture with the exact six-field immutable audit
backfilled the expected snapshot. This validates migration behavior, not the
legitimacy of real licensing evidence.

This is sufficient for a code commit, not production release. Deterministic adapter
contracts do not replace a real S3-compatible provider, ClamAV, proxy redaction and
alert-routing rehearsal. Infra/Release owns those live checks plus private-bucket,
workload-identity, encryption and retention verification; until their evidence is
attached, production release status is `BLOCKED_EXTERNAL`.

The observability/edge closeout adds a real executable artifact gate rather than
promoting string inspection to operational evidence. The gate runs Nginx config and
HTTP behavior, promtool rules/tests and guarded disposable Grafana import using
pinned artifacts. Missing `nginx`, `promtool`, `grafana-server` or live platform
identity remains `BLOCKED_EXTERNAL` and does not weaken the accepted release boundary.
