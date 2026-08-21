# Skill Inventory and Provenance

The machine-readable source is `skill-system-manifest.json` in this directory.

## Active and discoverable

- `hsk-production-delivery`
- Production groups `01-product-strategy` through `10-delivery-production-operations`

These instructions are HSK project-maintained, project-internal work. The repository has no top-level redistribution license; no external redistribution right is implied.

The user-managed global `anti-overengineering` installation is the only host-discoverable selector with that name. It is not copied, linked or read by repository validation. A clean clone retains the same proportionality, security, privacy and data-integrity guardrails in the root router, production baseline and relevant production groups, so repository correctness does not depend on the global filesystem.

## Explicit-only

None. No additional helper has enough HSK-specific evidence to justify another discoverable skill.

## Quarantined local imports

`backend-patterns`, `banner-design`, `brand`, `design`, `design-system`, `frontend-design`, `gpt-taste`, `hallmark`, `redesign-existing-projects`, `slides`, `ui-styling` and `ui-ux-pro-max` are excluded from Git/discovery. Their local copies may contain unknown provenance/license, unsupported metadata, broken links, non-Codex agent paths, unavailable dependencies, external-generation workflows or stack-specific mandates. They are not part of the reproducible HSK skill system and must not be invoked implicitly.

`ui-styling` locally includes a license file; this does not make its stack assumptions or dependencies suitable for active HSK routing. Reconsider a quarantined skill only through an explicit provenance/license/security/stack review and a separate scoped change.

## Repository routing regression versus host acceptance

`classifyRoutingContract()` is a deterministic repository classifier for manifest regression cases. Codex runtime does not call it, so its PASS result is not evidence of implicit host invocation.

After installing or changing discovery entries, reload Codex or start a new session and verify the real host:

- Discovery lists exactly one selector named `anti-overengineering`, from the global installation.
- Explicit `$hsk-production-delivery` and group invocation opens the expected `SKILL.md` path.
- A schema-review prompt does not pull UX/UI or frontend skills.
- A real UI implementation prompt selects UX/UI plus frontend.
- A review prompt does not authorize stage or commit.
- Cross-functional go/no-go uses group 10 or the root router.
- Technical staging/promotion uses group 08, not group 10.

If the current host session still caches the removed repository selector, report `HOST_RELOAD_REQUIRED`; do not reinterpret the repository classifier as host acceptance.
