# ADR-007: Media Evidence Producer Trust and Fail-Closed Recovery

Status: Accepted for code; protected-host producer acceptance remains required.

## Context

ADR-006 established a hermetic final verifier, but its signed inputs were pinned to
the identity of that same verifier. The workflow did not collect or sign those
inputs, so no independent producer could satisfy the trust policy. Live rehearsal
summaries also carried hash-shaped assertions without requiring the referenced raw
bytes. Separately, the production migration-19 resolve command relied on an operator
to perform the decisive database-state checks before invoking Prisma.

The closeout must make these boundaries executable without inventing a collector,
identity or production artifact that the protected host has not accepted.

## Decision

### Independent producer policy

The final verifier never signs caller-supplied input. It accepts detached payload and
Sigstore bundle pairs only from a producer in
`ops/observability/media-evidence-producers.json`. The policy has six exact keys:

| Policy key                          | Owner                | Evidence covered                                     | Raw evidence set                                                                  | Freshness | Retention | Verifier                           |
| ----------------------------------- | -------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- | --------- | --------- | ---------------------------------- |
| `production-prerequisite-inventory` | Release Engineering  | Aggregate prerequisite inventory                     | Specialized prerequisite results                                                  | 7 days    | 90 days   | Prerequisite inventory verifier    |
| `oci-release`                       | Release Engineering  | OCI digest, SBOM, vulnerability and license evidence | OCI index, SPDX SBOM, Grype report and license report                             | 5 days    | 90 days   | OCI release evidence verifier      |
| `oci-risk-approval`                 | Security Platform    | Independent vulnerability/license waiver approval    | Exact waiver approval records                                                     | 5 days    | 90 days   | OCI risk-approval verifier         |
| `capacity-backup`                   | Platform SRE         | Capacity, encrypted backup and restore rehearsal     | Capacity query and backup/restore log                                             | 7 days    | 90 days   | Capacity/backup evidence verifier  |
| `database-release`                  | Database Reliability | Migration/recovery rehearsal                         | Migration catalog, recovery command logs and schema drift                         | 7 days    | 90 days   | Database release evidence verifier |
| `live-rehearsal`                    | Platform SRE         | Six deployed live prerequisites                      | Command provenance/log plus S3, ClamAV, mesh, alert, replica and identity results | 7 days    | 90 days   | Live rehearsal evidence verifier   |

An accepted producer must define all of the following as exact values: GitHub OIDC
issuer, workflow identity, workflow display name, repository, tag ref, immutable
workflow SHA, trigger, protected environment, collector command and semantic
collector version. Wildcards are forbidden. The final verifier identity is forbidden
as an input producer identity. Cosign verification pins every corresponding GitHub
certificate claim before JSON parsing.

Every producer payload contains a signed `producerExecution` object. The verifier
compares its policy key, command, version, environment, evidence types, raw evidence
set, freshness and verifier name byte-for-value with the accepted producer record.
Consequently an `ACCEPTED` record has a positive executable interface, while metadata
that merely names an unexecuted or different collector cannot authorize evidence.

The checked-in policy is deliberately `HOST_ACCEPTANCE_REQUIRED`: the actual
protected collectors, commands and identities have not been supplied or approved.
Null producer facts are not an allowlist. Host acceptance must update the policy root
and all six producers atomically to `ACCEPTED`; partially populated records are
invalid. Selecting one accepted producer cannot bypass a pending policy, including for
a waiver-free release. Until then the release runner exits non-green and no production
prerequisite is upgraded to PASS.

The protected host must ensure that each accepted collector runs its declared
command against the declared environment, writes bounded raw outputs, builds the
manifest from those outputs, and signs that exact manifest itself. Uploading and
signing a JSON path supplied by a caller is not an accepted collector design.

### Raw live-rehearsal evidence

The live package uses `hsk-media-live-production-evidence-v2`. It binds the release
commit, tree, release-content digest, environment, observation/expiry, collector run
ID and run attempt. Its registry contains six bounded canonical raw artifacts with an
ID, media type, path, size and SHA-256. The verifier opens the accepted bytes through
the stable file boundary, recomputes size and digest, then parses distinct semantic
contracts for:

- S3-compatible provider behavior;
- ClamAV protocol and scan outcomes;
- deployed reverse-proxy and service-mesh policy;
- alert firing, routing, delivery and resolution;
- backend replica discovery;
- secret-manager workload identity.

The protected runner supplies the expected cluster identity hash, namespace identity
hash and deployment revision independently from the signed package. Those hashes are
derived from the immutable provider cluster resource ID and the exact namespace
name/UID recorded by the protected deployment/change system. The verifier
recomputes both manifest and expected fingerprints and requires the full environment
bindings to match. A producer therefore cannot select another internally consistent
cluster/namespace/deployment and authorize it by signing that selection itself.

The ClamAV contract accepts exactly clean JPEG, PNG, MP3 and WAV MIME observations
(`image/jpeg`, `image/png`, `audio/mpeg`, `audio/wav`). The protected alert rehearsal
is `HskMediaValidationSyntheticPage`, owned by `platform-sre`, and its firing,
resolved and escalation receipt IDs must be pairwise distinct. The secret-manager
audience and exact `system:serviceaccount:<namespace>:<service-account>` subject come
from independently protected workload configuration and must equal the raw evidence;
arbitrary or evidence-selected strings are invalid.

Each PASS summary names the raw artifact ID and digest that proves it. Reuse of one
raw artifact by multiple checks is allowed only when the mapping is explicit. Zero
digests, missing/path-unsafe files, hash mismatch, malformed semantics, replayed run
identity, stale evidence or wrong release/environment binding are rejected. Raw,
summary and bundle bytes enter the retained evidence tree only after signature,
binding and semantic validation.

### Error taxonomy

Only `ExternalEvidenceMissing` and `ExternalEvidenceInvalid` produce
`BLOCKED_EXTERNAL`. `InternalToolFailure`, `InternalVerifierFailure`,
`InternalRetentionFailure` and unknown exceptions produce `FAIL_INTERNAL`.

Cosign exit behavior is explicit: a healthy verifier rejecting a signature or exact
certificate claim is invalid external evidence; missing binary, wrong version, spawn
error, timeout, signal, unsupported CLI flag or an unavailable tool boundary is an
internal failure. Registry/verifier defects and evidence-retention failures are also
internal. A checked-in real Cosign V3 fixture proves successful verification and
rejection of tampered payload and wrong-key cases without retaining a private key.

### Release-content and final evidence binding

Release-content SHA-256 covers every tracked file under `.github/workflows`,
`backend`, `docs` and `ops`, plus in-scope untracked files, with explicit concurrent
document exclusions recorded by the release contract. Dependency/build/test output
is not traversed. Symlinks and special files are rejected. Deletions are bound as
deletion records. The reference profile may hash stable dirty bytes for diagnostic
evidence, but `release-linux-amd64` rejects every tracked modification, untracked
source or deletion instead of treating that digest as tagged content. The workflow
rechecks both `HEAD` and the tag commit against protected `GITHUB_SHA` immediately
before executing repository scripts. It passes that expected commit and tag ref into
the runner, which resolves both at initial binding and again before checking tree and
release-content stability for publication.

The tag workflow downloads checksum-pinned Cosign and runs the real cryptographic
fixture before the release validator. It retains one deterministic bounded tar for
90 days. GitHub artifact attestation remains a post-gate action over that frozen tar;
it is not an input prerequisite created by the same validator.

### Runbook network and revision boundary

The protected runner requires one exact approved hostname separate from the runbook
URL. It resolves the complete A/AAAA set once, rejects empty, malformed, excessive,
mixed unsafe, private, loopback, link-local, multicast, reserved, documentation and
IPv6 ULA answers, and pins a validated address into the HTTPS request while
preserving the original hostname for SNI and certificate verification. Redirects are
forbidden. The response must be exact HTTP 200, approved textual content, bounded and
contain the required markers. Its single revision is
`v3.0.0@<exact-40-character-release-commit>`.

### Waiver governance

OCI vulnerability and license waivers are signed evidence fields, not local
overrides. Every waiver contains `issuedAt`, `expiresAt`, `approver`, `owner`, risk or
ticket ID, reason, exact finding and exact release/artifact binding. A vulnerability
finding identity includes the vulnerability ID, package, version, artifact type and
severity; changing any one field invalidates the waiver. Critical waivers expire
within 24 hours; High and license waivers expire within seven days. OCI evidence has
one five-day freshness policy, so every waiver is additionally capped by that signed
five-day evidence expiry and can never remain effective beyond it. Far-future,
incomplete, cross-release and cross-artifact waivers are rejected.

The OCI signer cannot approve its own waivers. Every non-empty waiver must have one
matching entry in separately trust-verified `hsk-media-oci-waiver-approvals` bytes
from the distinct accepted `oci-risk-approval` producer. The approval repeats every
waiver field and exact release/image/report/finding binding; duplicate, missing,
tampered, cross-release and unused approvals are rejected. Its canonical `observedAt`
and `expiresAt` define an active window of no more than five days, never beyond the OCI
evidence expiry; every approved waiver must already be issued within clock skew and
cannot outlive that approval. A waiver-free release needs no approval payload, but its
global producer policy must still have the `oci-risk-approval` producer accepted.

### Production migration-19 recovery

`migrate:resolve:media-cleanup-audit:production` owns its decision boundary. It
accepts no arguments and, inside one bounded Prisma Client transaction, queries the
target for:

- one exact migration-19 row and checksum;
- exactly one unfinished, unrolled-back failed target row and no other unresolved
  migration;
- exactly 18 successful migrations;
- zero migration-19 functions and triggers;
- zero malformed cleanup audit facts and zero lifecycle rows lacking their exact
  authoritative audit timestamp;
- the immutable source migration checksum.

Test execution requires the exact loopback `*_test` URL to equal
`TEST_DATABASE_URL`. Production execution requires `NODE_ENV=production` and an
operator-approved SHA-256 of the normalized `host:port/database/public` target via
`MEDIA_MIGRATION_EXPECTED_TARGET_SHA256`. A rejected target or unsafe state exits
`78` without mutating migration history. Query/mutation/postcondition defects exit
`70`; deadline expiry exits `124`. Raw database diagnostics are not forwarded.

The wrapper holds Prisma's advisory lock key and `SHARE ROW EXCLUSIVE` locks on
`_prisma_migrations`, `MediaIngestion` and `AuditLog` across precheck, one exact
conditional history update and postcheck. The update is constrained by the exact row
ID, migration name, checksum and unfinished/unrolled-back state and must affect one
row. Any zero-row update, cancellation, deadline, query failure or postcondition
failure detected before the transaction callback returns rejects the transaction, so
PostgreSQL rolls the mutation back. Returning the exact `commit` decision is the
irrevocable boundary: the wrapper then waits for Prisma's transaction result. A
successfully acknowledged commit is reported as success even if a late signal or
outer deadline arrived while `COMMIT` was in flight; reporting timeout after a real
commit would invite an unsafe retry. There is no external resolve child and no
advisory-lock bypass that can outlive the guard. Abrupt termination before the commit
decision rolls back with the database session; an interruption after that boundary
must be reconciled by rerunning the same guarded state check.

Production preflight, deploy and retained-failure inspection use the same detached
process-group supervisor. Their 45-second operational deadline requests TERM then
KILL for the complete group; completion is never reported while that group is still
observable. Resolve instead uses only the bounded database transaction above, so it
has no schema-engine descendant requiring process-group cleanup.

The deploy wrapper classifies the current invocation before consulting any retained
failure metadata. Current `P3009` always remains retry-block exit `1`. Retained log
classification is used only for the exact current transaction-aborted branch; a
historical `P0001` or `55P03` cannot relabel a new P3009 result.

## Consequences

- Code can now consume evidence from real independent producers, but checked-in
  producer acceptance is intentionally incomplete. This is
  `HOST_ACCEPTANCE_REQUIRED`, not production readiness.
- Exact-head protected evidence cannot exist until the scoped commit is available to
  the protected tag workflow. Local ignored `test-results` remain diagnostic only.
- Migration recovery no longer depends on a manual preflight decision, while writers
  must still remain quiesced and the invariant must be reconciled forward.
- ADR-006 remains authoritative for metrics topology and hermetic tooling. Its former
  final-verifier-as-producer identity and live evidence V1 sections are superseded by
  this ADR.

## Sources

- GitHub Actions OIDC and reusable workflow identity guidance.
- GitHub artifact attestation and artifact retention guidance.
- Sigstore Cosign blob signing, verification and CI guidance.
- Prisma Migrate failed-migration recovery and CLI reference.
