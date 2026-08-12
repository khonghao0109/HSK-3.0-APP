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

The API owns a bounded multipart ingestion boundary. It authenticates and rechecks
an active admin, requires licensed `DataSource` provenance, hashes the idempotency key
and request fingerprint, validates bytes, scans the trusted processed representation,
writes a private shared object and only then commits a ready `Media` plus completed
`MediaIngestion` and redacted audit atomically.

The V1 allowlist is JPEG, PNG, MP3 and PCM WAV, maximum 10 MiB. Image decode/re-encode
uses Sharp with a 40-million-pixel cap. WAV structure and length are parsed locally;
MP3 duration/metadata use `music-metadata`. Active formats and executable/polyglot
signatures fail closed. Larger/streaming video and PDF are not inferred into V1.

Production object storage uses the provider-independent port and S3-compatible
adapter with private writes, AES256 server-side encryption, SHA-256 metadata, finite
timeouts and workload-identity credentials. Only tests use the in-memory adapter.
Production malware scanning uses ClamAV INSTREAM with a finite response/timeout;
unavailable or ambiguous scan never produces ready content.

## Identity, state and concurrency

`MediaIngestion` records actor/source, hashed idempotency identity, request hash,
sanitized filename, MIME decisions, size/checksum/object identity and attempts.
The state machine is:

```text
pending -> processing -> completed
                   |--> rejected
                   |--> failed
                   `--> cleanup_required -> failed (cleanup completed)
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
Claim, rejection, finalize and cleanup use a request-owned token plus authoritative
row reread to reconcile lost transaction commit acknowledgements without replaying
object side effects or duplicating audit. An unreadable outcome returns a safe 503
and requires reconciliation rather than guessing.
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

## Verification and release boundary

The frozen migration SHA-256 is
`a5bb8bdd6f8408b3360fe987e8d4fb7bf15f22c94f84e3fdac03dc4e93ebfe2e`.
On 2026-08-12 a fresh guarded disposable database deployed all 16 migrations;
media SQL acceptance rolled back cleanly, fencing passed 10/10, Media E2E passed
20/20, the full backend E2E suite passed 155/155 and both live/schema and
migration-history/schema diffs were empty. The no-DB gate passed 40 suites and
393 tests; targeted security/adapter contracts passed 8 suites and 58 tests; the
production dependency audit reported zero vulnerabilities.

This is sufficient for a code commit, not production release. Production S3 and
ClamAV behavior is covered by deterministic adapter contracts, but no live provider
rehearsal was available in this closeout. Infra/Release owns a private bucket,
workload-identity, encryption/retention, access-log redaction and ClamAV availability
rehearsal before beta deployment.
