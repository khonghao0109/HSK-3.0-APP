# UI Source of Truth

Read this reference only for work that changes or reviews visible/interactable UI.

1. Identify the route/module and list the matching files under `docs/ui_image`.
2. Open the relevant images at original resolution and map route → image → current component → intended change.
3. Read `frontend/AGENTS.md`, `frontend/DESIGN.md`, tokens, shared components and local Next.js documentation for the installed version.
4. Preserve the reference IA, hierarchy, action placement and visual language; do not redesign outside scope.
5. Verify required states, keyboard/focus/semantics, responsive behavior and console on the real production build when UI changed.

Do not load generic design support bundles implicitly. A user may explicitly request an installed design skill, but project work must not depend on ignored local files or unavailable scripts. Schema, backend, data and ops-only tasks do not read `docs/ui_image`.
