# ADR-003: Frontend foundation and secure admin browser session

- Status: Accepted
- Date: 2026-08-11
- Owners: Product, Frontend, Security, Backend

## Context

The repository frontend is a zero-byte scaffold. The NestJS backend exposes a
bearer access token from `POST /api/v1/auth/login`, validates token expiry, and
re-reads the current user for `GET /api/v1/auth/me`. It does not yet expose a
refresh-token, browser-session revocation, or logout endpoint. Browser code must
not retain the bearer token in readable storage or receive a generic backend
proxy.

Exercise list and detail endpoints already exist behind active-account JWT and
admin-role enforcement. This slice is read-only and must not add CMS mutation UI
or claim Media Operations support.

## Decision

### Runtime and package policy

- Use Next.js 16.3 with the App Router, React 19, and strict
  TypeScript. Node.js 22/24/26 are supported operational targets; the repository
  currently runs Node.js 26.
- Use a service-local npm lockfile because the existing runnable backend also
  uses npm and there is no shared workspace task graph yet. Do not add
  Turborepo.
- Use Server Components by default. Client Components are limited to login,
  logout, retry, and other browser interactions.
- Use CSS variables with primitive → semantic → component token layers. Do not
  add a runtime CSS-in-JS dependency for V1.
- Use Zod for critical auth/CMS response validation, Vitest + React Testing
  Library for unit/component tests, and Playwright + axe for browser flows.

### Session transport

1. The browser posts credentials only to the same-origin Next.js login route.
2. The route validates the request Origin, calls the allowlisted backend login
   endpoint, and validates the response.
3. Only an active backend user whose current role is `admin` receives a
   frontend session.
4. The bearer token is stored only in a `HttpOnly`, `SameSite=Lax`, path `/`
   cookie. `Secure` is mandatory in production. Cookie `Max-Age` is derived
   from the JWT `exp` claim and never extends token life.
5. The backend URL is a server-only environment value. It is not exposed as a
   `NEXT_PUBLIC_*` variable.
6. Server-only BFF helpers attach `Authorization: Bearer ...` only to an
   allowlist: `/auth/login`, `/auth/me`, `/admin/cms/exercises`, and
   `/admin/cms/exercises/:id`.
7. Every protected admin request verifies `/auth/me`, so current account state
   and database role—not a stale role claim—remain authoritative.
8. Missing, invalid, or expired sessions redirect directly from the protected
   Server Component boundary to the canonical
   `/login?reason=session` page. The absolute destination is built only from a
   validated `APP_ORIGIN`; request URL, `Host`, and forwarded-host headers are
   not trusted for redirect construction.
9. The login form owns a recovery/login state machine when it receives
   `reason=session`. It starts non-navigating exact-same-origin
   `POST /api/session/recover`. Same-origin responses use 204 plus a bounded
   `x-session-recovery` state (`ready`, `invalid`, or `unavailable`) so expected
   recovery states do not create browser console errors. Only backend 401/403
   becomes `invalid`. Recovery responses never carry `Set-Cookie`. On `invalid`,
   the coordinator awaits exact-same-origin POST
   logout to clear the old HttpOnly cookie, then and only then starts login.
   Submit during recovery is queued with input values retained; double submit is
   deduplicated. A 5xx/network failure fails closed with an explicit retry, and
   unmount aborts the coordinator-owned request before login can start. This
   ordering plus the mutation-free recovery response means a stale response can
   never delete a newer login cookie. Protected RSC navigation never redirects
   through an API route, and `GET /api/session/logout` is not exposed.
10. Non-admin users are sent to a dedicated forbidden page before any admin
    data is rendered. Logout V1 deletes the frontend cookie only through
    `POST /api/session/logout`. State-changing BFF routes use
    same-origin checks now so future CMS mutations inherit a CSRF boundary.

### API and rendering boundary

- Pages use server-side fetching, pagination, and filters. Browser query state
  is represented in the URL; the browser never downloads the full inventory to
  filter locally.
- A typed server-only fetch wrapper applies a bounded timeout and safe error
  normalization. V1 does not automatically retry requests; retry is an explicit
  user action to avoid hidden request amplification.
- Runtime schemas cover only the auth and Exercise endpoints used by this
  slice. An OpenAPI-generated client remains backlog until an authoritative
  specification exists.
- Error responses shown in the UI contain only safe status/category/request ID
  information. Tokens, authoritative answers, raw backend bodies, SQL, and
  storage credentials are never logged by the frontend client.

### Generated types and deterministic gates

- `next-env.d.ts` is a Next.js-owned generated artifact. It is included by
  `tsconfig.json`, ignored by Git and Prettier, and must not be edited or
  tracked.
- `typecheck` runs `next typegen` before `tsc --noEmit`. This makes route-aware
  types deterministic regardless of whether `next dev` or `next build` ran
  first and regardless of whether the local generated file exists.
- A portable Node regression runner removes only the ignored local artifact,
  invokes the public typecheck command, and verifies regeneration without a
  tracked worktree diff.

### Production CSP nonce boundary

- Next.js 16 `src/proxy.ts` generates 18 cryptographically random bytes for
  every matched request and encodes them as a 24-character base64 nonce.
- The proxy places the nonce and CSP in upstream request headers and returns
  the same policy in the response. Next.js extracts the nonce and applies it to
  framework, page, and inline runtime scripts.
- Production `script-src` uses the request nonce plus `strict-dynamic`; it does
  not contain `unsafe-inline` or `unsafe-eval`. Development may use
  `unsafe-eval` for React diagnostics and `unsafe-inline` for development
  styles only.
- `media-src` is restricted to `'self'` because Media Operations do not exist
  yet. A future Media slice may add only the exact configured storage/CDN
  origin after its threat and retention model is approved; broad `https:` or
  wildcard sources remain prohibited.
- The root layout waits for a request so every page is dynamically rendered.
  This disables static optimization, ISR, PPR, and default CDN page caching,
  increasing request-time rendering cost. This trade-off is accepted for the
  authenticated operational console and strict production CSP.
- The proxy matcher excludes `api`, `_next/static`, `_next/image`,
  `favicon.ico`, `sitemap.xml`, and `robots.txt`, and skips requests carrying
  either `next-router-prefetch` or `purpose: prefetch`. Normal document/RSC
  requests retain the nonce policy; JSON APIs and router prefetches do not
  mint CSP nonces. Common security headers remain configured for all routes in
  `next.config.ts`.

## Threat model and controls

| Threat                         | Control                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| XSS reads bearer token         | HttpOnly cookie; token never enters props, markup, client state, or browser storage                           |
| CSRF on session/mutations      | SameSite cookie plus exact Origin validation on login, recovery, logout, and future state-changing BFF routes |
| Open-proxy SSRF/data exposure  | Fixed server-only backend origin and route allowlist; no arbitrary URL forwarding                             |
| Stale admin claim              | `/auth/me` revalidation against current database role/account state                                           |
| Expired/malformed token        | Backend remains signature authority; recovery classifies only 401/403 invalid, then coordinator clears before login |
| Stale recovery response        | Recovery cannot set/delete cookies; coordinator enforces recover → optional clear → login and abort ownership |
| Sensitive error leakage        | Runtime response validation and safe normalized error categories                                              |
| Cached cross-user admin data   | Protected fetches use `cache: no-store`; no shared user cache                                                 |
| Clickjacking/content injection | Per-request nonce CSP, frame deny, MIME sniffing deny, referrer and permissions headers; HSTS in production   |

## Consequences and limitations

- Access-token expiry requires a new login. There is no silent refresh.
- Frontend logout does not revoke an already copied bearer token because the
  backend has no session-revocation runtime yet.
- Backend CORS must still be pinned to explicit production origins even though
  browser CMS traffic uses the same-origin BFF.
- Nonce CSP makes pages request-time rendered and removes static/ISR/PPR/CDN
  page caching until a separately reviewed hash/SRI strategy is adopted.
- Media upload/library and Exercise mutation UI remain explicit later slices.
- The repository has no direct admin-login reference image. Login QA is a visual
  regression against the existing workbench UI; the consumer onboarding image
  is not treated as an equivalent surface. Admin console pages remain grounded
  in `docs/ui_image/06-admin-cms-operations.png`.
- A future refresh/session implementation must add rotation, reuse detection,
  revocation, device/session management, and corresponding CSRF review before
  changing this cookie contract.

## Alternatives rejected

- **localStorage/sessionStorage bearer token:** rejected because any successful
  script injection could read the credential.
- **Client-readable cookie:** rejected for the same reason.
- **Generic Next.js API proxy:** rejected because it expands SSRF and accidental
  authorization surface.
- **Frontend-only JWT role check:** rejected because role/account lifecycle in
  PostgreSQL is authoritative.
- **Separate admin application or Turborepo:** rejected until an operational or
  deployment boundary justifies the added coordination cost.

## Verification

- Unit/component tests cover validation, session-cookie attributes, safe errors,
  timeouts, role guards, filters, and sensitive rendering boundaries.
- Route/integration tests cover login, recovery, logout, `/auth/me`, canonical
  session redirects, exact-origin checks, role, and backend error mapping.
- Playwright runs against the real NestJS backend on a guarded disposable test
  database and covers session persistence, deep links, logout, permissions,
  filters, detail, keyboard use, responsive layouts, console errors, and axe.
- Production Playwright additionally verifies strict nonce CSP, per-request
  nonce uniqueness, document/API/prefetch matcher behavior, the complete
  security-header matrix, canonical `APP_ORIGIN`, cookie recovery, login
  rendering, direct anonymous admin access, and Link-driven RSC navigation
  without browser console/CSP/hydration/fallback errors.
- Test counts and release evidence are recorded only after the current frozen
  tree is executed. Manual in-app Browser evidence remains a separate required
  release gate and is never inferred from Playwright.
