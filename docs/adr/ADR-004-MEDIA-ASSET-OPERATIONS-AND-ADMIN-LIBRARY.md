# ADR-004: Media Asset Operations API & Admin Library V1

- Status: Accepted
- Date: 2026-08-12
- Owners: Product, Backend, Frontend, Security, Operations
- Scope: Admin inventory, inspection, quarantine and soft archive of existing media

## Context

`Media` is already the shared asset record for audio, image, PDF and video. It
contains processing state, provenance, operator IDs, storage identity and links to
content. Listening Exercise publication already requires live, ready audio. The
project did not, however, have an admin inventory or a safe operational boundary
for inspecting and retiring assets.

The repository has no production object-storage adapter, multipart ingestion
contract, magic-byte validator, malware/quarantine worker or horizontally shared
upload staging area. Treating the local application filesystem as storage would
make replicas stateful and would create a false production capability.

## Decision

V1 adds an admin-only operational slice over the existing `Media` model:

- paginated inventory with URL-driven `type`, `processingStatus`, `lifecycle`,
  `dataSourceId`, `page` and `limit` filters;
- detail with safe technical metadata, provenance and bounded content references;
- idempotent quarantine and soft archive mutations with safe `AuditLog` facts;
- responsive Next.js admin pages and same-origin allowlisted BFF handlers;
- no upload, restore, hard delete, binary delivery, URL signing or transcoding.

No schema change is required. `Media` already owns every field and relation needed
for this slice. A new migration solely for the UI/API would duplicate state.

## Security boundary

Admin responses deliberately exclude `url`, `storageProvider`, `storageKey`,
`checksum` and raw `metadata`. `originalFilename` is reduced to a bounded NFKC
basename after path/control-character removal. The browser receives neither bearer
token nor provider credential.

Both the JWT strategy and controller require the current database role. Lifecycle
transactions then lock the active admin row `FOR SHARE` and the target Media row
`FOR UPDATE`, rechecking role/account state before mutation. Concurrent retries
therefore converge on one state transition and one audit fact. Archive is a
soft-delete only; quarantine is immediate and cannot be applied to an archived
asset. Audit summaries contain identifiers, enum states and usage counts only.

Browser mutations are exact-origin `POST` requests through a fixed allowlist. They
use the existing HttpOnly session cookie and `no-store` backend client. There is no
generic proxy and no raw provider error/body reflection.

## Threat and control decisions

| Threat | V1 control |
| --- | --- |
| Unauthorized enumeration / stale role | JWT + admin guard; current DB role checked again under transaction lock |
| Public URL, storage key, checksum or metadata leakage | Explicit safe projection and response-contract parsing; no delivery URL in admin response |
| Filename/path traversal or control characters | Basename-only NFKC normalization, control removal and 160-character bound |
| CSRF | Exact canonical same-origin check before every BFF mutation |
| Concurrent retry / duplicate audit | `User FOR SHARE → Media FOR UPDATE`; idempotent decision after lock |
| Incomplete or unsafe processing | Processing state is visible; quarantine/archive are available; public listening policy already hides non-ready/deleted media |
| Orphaned media | Detail exposes aggregate use plus bounded Exercise references so operators can identify zero-use assets |
| Log/error leakage | Safe audit summaries and classified HTTP errors; no raw Prisma/provider payload |
| MIME spoofing, oversized files, malicious SVG/HTML or executable upload | Upload is not exposed in V1; these remain mandatory gates for the future ingestion service |
| Duplicate content hash | Hash stays internal; deduplication belongs to the future ingestion transaction, not a UI-side comparison |
| Cross-tenant access | The current product has no tenant domain; all access remains admin-only. Tenant ownership must be added before multitenancy. |

## UI decision

`docs/ui_image/06-admin-cms-operations.png` is the source of truth. The existing
navy/jade AdminShell, light operations canvas, dense filter/table hierarchy, status
badges and responsive record-list pattern are reused. Routes are:

- `/admin/media`: inventory, filters, pagination, empty/loading/error/retry;
- `/admin/media/:mediaId`: safe detail, references, not-found/loading and lifecycle
  actions.

The Media navigation item becomes active. No upload button is rendered. Detail and
mobile layouts are reasoned extensions of the same Admin/CMS visual language because
the reference contains no dedicated media-detail or narrow-screen frame.

## Horizontal scaling and operations

The runtime is stateless: database state is authoritative and no asset bytes are
written to an application replica. Pagination is bounded to 100 records; detail
returns at most 50 Exercise references plus aggregate relation counts. Requests use
the existing finite BFF timeout and `no-store` policy.

The future ingestion slice must use shared object storage, stream with a hard byte
limit, derive type from magic bytes, reject active content, isolate SVG/HTML, compute
a server-side hash, scan before `ready`, and publish only immutable object identity.
Its worker/retry/metrics/retention design requires a separate ADR and forward schema
change only if the current model proves insufficient.

## Consequences and rollback

- Operators can find and safely retire existing assets without receiving storage
  secrets.
- Quarantine or archive can hide a currently published listening Exercise; historical
  immutable attempt snapshots are retained by the established policy.
- V1 cannot create an asset. This is intentional rather than a missing button.
- Rollback disables the Media BFF/pages and backend routes. Existing Media and audit
  history remain; no data rollback or migration reversal is required.
