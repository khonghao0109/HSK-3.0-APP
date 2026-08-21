# Production Quality Baseline

Apply controls in proportion to the affected boundary and demonstrated risk. A review is read-only; an implementation verifies affected behavior; a release additionally verifies the frozen artifact and deployment contract.

## Always preserve

- Server-side authorization, secret/PII safety, privacy and data-integrity invariants.
- Bounded input/work, timeout for external work, deterministic failure taxonomy and safe rollback where applicable.
- User worktree ownership, environment authorization and protected-data boundaries.
- Evidence must describe commands actually run; no invented counts or PASS claims.

## Add when the risk requires it

- Idempotency, locking and concurrency tests for retryable or contested mutations.
- Circuit breaker, queue, outbox, cache, shared service or load shedding only when a real failure/scale boundary requires them.
- SLI/SLO, capacity, RPO/RTO, chaos/failure rehearsal and full CI matrix for release-critical paths or an explicit NFR—not every local change.
- ADR for difficult-to-reverse architecture/product decisions; routine local changes need normal code/docs review only.
- Database migration gates only when schema/data changes; UI visual/a11y gates only when UI changes.

## Release truth

Build once from a frozen commit tree. Bind artifact digest, provenance and manifest to that tree, then promote the same artifact. Staged bytes are review input, not published-artifact evidence. Do not call backup valid without restore proof or horizontal scale valid while correctness depends on one process.
