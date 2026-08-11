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
8. Invalid or expired sessions are cleared through the session route and sent
   to login. Non-admin users are sent to a dedicated forbidden page before any
   admin data is rendered.
9. Logout V1 deletes the frontend cookie only. State-changing BFF routes use
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

## Threat model and controls

| Threat                         | Control                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| XSS reads bearer token         | HttpOnly cookie; token never enters props, markup, client state, or browser storage                               |
| CSRF on session/mutations      | SameSite cookie plus exact Origin validation on state-changing BFF routes                                         |
| Open-proxy SSRF/data exposure  | Fixed server-only backend origin and route allowlist; no arbitrary URL forwarding                                 |
| Stale admin claim              | `/auth/me` revalidation against current database role/account state                                               |
| Expired/malformed token        | Validate JWT structure/expiry for cookie lifetime; backend remains signature authority; clear cookie on rejection |
| Sensitive error leakage        | Runtime response validation and safe normalized error categories                                                  |
| Cached cross-user admin data   | Protected fetches use `cache: no-store`; no shared user cache                                                     |
| Clickjacking/content injection | Frame deny, CSP, MIME sniffing deny, referrer and permissions headers; HSTS in production                         |

## Consequences and limitations

- Access-token expiry requires a new login. There is no silent refresh.
- Frontend logout does not revoke an already copied bearer token because the
  backend has no session-revocation runtime yet.
- Backend CORS must still be pinned to explicit production origins even though
  browser CMS traffic uses the same-origin BFF.
- Media upload/library and Exercise mutation UI remain explicit later slices.
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
- Route/integration tests cover login, logout, `/auth/me`, role and backend error
  mapping.
- Playwright runs against the real NestJS backend on a guarded disposable test
  database and covers session persistence, deep links, logout, permissions,
  filters, detail, keyboard use, responsive layouts, console errors, and axe.
- Verified result for this slice: 46/46 Vitest assertions and 12/12 Playwright
  cases across Chromium 1440/768/390; production dependency audit has zero known
  vulnerabilities.
