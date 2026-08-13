# Media Observability & Edge Security Closeout

- Date: 2026-08-13
- Owners: Media Platform, Security Platform, Platform SRE
- Scope: backend and operations artifacts; includes forward-only lifecycle migration
  18; no UI change
- Status: code gates must be recorded after execution; live infrastructure remains a
  separate release gate

## Risk and acceptance matrix

| Risk                    | Failure mode                                         | Acceptance                                                                                                       | Owner             |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------- |
| P1 storage truthfulness | corrupt/missing object counted as provider outage    | typed storage error reaches a bounded integrity/coherence metric and content is never returned                   | Media Platform    |
| P1 scanner truthfulness | malformed ClamAV protocol counted as outage          | exact protocol parser emits `invalid_response`; network failure emits `unavailable`; both fail closed            | Security Platform |
| P1 artifact confidence  | string assertions mistaken for a deployed tool check | pinned real binaries run Nginx, promtool and disposable Grafana validation; missing tools are `BLOCKED_EXTERNAL` | Platform SRE      |
| P1 metrics topology     | public or load-balanced scrape loses replica truth   | public edge denies metrics; private headless/network-policy path scrapes each replica with secret identity       | Platform SRE      |
| P1 edge security        | permissive CORS/placeholders reach production        | bootstrap rejects ambiguous origins, weak/reused secrets and applies API-safe headers                            | Security Platform |

## Storage error classification

| Source condition                                                                                   | Typed kind            | Storage metric outcome | Signed-read outcome | Reconciliation | HTTP behavior                            |
| -------------------------------------------------------------------------------------------------- | --------------------- | ---------------------- | ------------------- | -------------- | ---------------------------------------- |
| provider timeout/reset/unknown client error                                                        | `unavailable`         | `error`                | `unavailable`       | unchanged      | safe `503 MEDIA_STORAGE_UNAVAILABLE`     |
| S3 404/NoSuchKey                                                                                   | `not_found`           | `not_found`            | `integrity_error`   | `violation`    | safe `503 MEDIA_STORAGE_INTEGRITY_ERROR` |
| configured/stored provider mismatch                                                                | `provider_mismatch`   | `provider_mismatch`    | `provider_mismatch` | `violation`    | fail closed before storage I/O           |
| missing body/type/length/checksum or malformed checksum metadata                                   | `malformed_response`  | `malformed_response`   | `integrity_error`   | `violation`    | corrupt response is never returned       |
| over-limit body, truncated/length mismatch, computed hash mismatch, DB MIME/size/checksum mismatch | `integrity_violation` | `integrity_error`      | `integrity_error`   | `violation`    | corrupt response is never returned       |

Errors expose only fixed messages. Bucket, object key, checksum, capability
signature, provider response and URL never become a metric label or error detail.

## ClamAV classification

| Scanner condition                                                           | Typed kind / domain outcome | Metric             | Ingestion result                                      |
| --------------------------------------------------------------------------- | --------------------------- | ------------------ | ----------------------------------------------------- |
| exact `stream: OK\0`                                                        | clean                       | `success`          | continue                                              |
| exact single-name `FOUND\0`                                                 | malware                     | `malware`          | `422 MALWARE_DETECTED`                                |
| timeout, connection failure or reset                                        | `unavailable`               | `unavailable`      | fail closed with `503 MEDIA_SCANNER_UNAVAILABLE`      |
| missing/multiple NUL, oversized, ambiguous/misleading `OK`, scanner `ERROR` | `invalid_response`          | `invalid_response` | fail closed with `503 MEDIA_SCANNER_INVALID_RESPONSE` |

Raw scanner responses and file payloads are never logged.

## Metrics producer and consumer matrix

| Code path                             | Metric                                                | Dashboard                      | Alert / response                           |
| ------------------------------------- | ----------------------------------------------------- | ------------------------------ | ------------------------------------------ |
| ingestion request/final state         | `hsk_media_ingestion_total`, processing latency       | Ingestion outcomes             | SLO investigation                          |
| ClamAV exact parser                   | `hsk_media_scanner_total`, scanner latency            | Scanner outcomes and latency   | unavailable and invalid-response alerts    |
| S3 adapter and media access/replay    | `hsk_media_storage_operations_total`, storage latency | Storage operations and latency | storage spike or immediate integrity alert |
| signed content service                | `hsk_media_signed_access_total`                       | Integrity and reconciliation   | immediate integrity alert                  |
| replay/access coherence checks        | `hsk_media_reconciliation_total`                      | Integrity and reconciliation   | immediate coherence alert                  |
| one aggregate PostgreSQL scrape query | cleanup/stuck counts and oldest age                   | Cleanup/Stuck panels           | cleanup/stuck alerts                       |
| Prometheus target health              | `up{job="hsk-media-replicas"}`                        | Replica scrape health          | replica scrape failure                     |

Counters are intentionally process-local. Prometheus attaches `instance` and scrapes
each replica directly, then aggregates with `sum`. A restart resets one replica's
counter; `increase` and the per-replica `up` alert prevent a reset from becoming a
false global page. Database gauges use one aggregate SQL query per scrape to bound
pool pressure.

## Public/private access and rotation

| Path                              | Public ingress                           | Private monitoring network     | Credential                                      |
| --------------------------------- | ---------------------------------------- | ------------------------------ | ----------------------------------------------- |
| signed media content              | matched; query-redacted, no shared cache | not required                   | signed HMAC query                               |
| `/metrics` on dedicated port 9464 | namespace `404` at public edge           | direct pod/replica scrape only | current/previous bearer from secret-managed env |

`ops/observability/media-metrics-private-network.yml` defines the headless endpoint
and NetworkPolicy. `media-prometheus.yml` uses pod discovery/relabeling for one target
per ready replica, never a load-balanced application endpoint. Actual two/three
replica execution is a target-environment external gate. Rotation must preserve an
acceptance overlap because Prometheus hot-refreshes `current`, while backend env is
read only at startup:

1. keep `current=OLD`, stage `previous=NEW`, then roll every backend so all replicas
   accept both values while Prometheus continues using OLD;
2. atomically swap the projection to `current=NEW`, `previous=OLD`; Prometheus may
   now hot-refresh to NEW while every backend still accepts both;
3. roll every backend again with NEW current and OLD previous, then verify every
   scrape target before removing overlap;
4. remove `previous`, keep `current=NEW`, roll once more and verify every target;
5. never log the Authorization header or place either token in repository YAML.

## Production edge matrix

| Input                                                                                 | Production result                                                     |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| missing/empty `ALLOWED_ORIGINS`, blank comma segment or any wildcard                  | bootstrap rejected                                                    |
| HTTP, path, query, fragment or userinfo origin                                        | bootstrap rejected                                                    |
| explicit HTTPS origin                                                                 | normalized and exact-match allowlisted                                |
| malicious suffix/subdomain not explicitly listed                                      | CORS denied                                                           |
| dev/test default                                                                      | only explicit `localhost` and `127.0.0.1` HTTP origins                |
| JWT/pepper/signing/metrics placeholder, short/low-diversity encoding or reused secret | bootstrap rejected                                                    |
| ordinary API response                                                                 | nosniff, frame deny, no-referrer, restrictive permissions and API CSP |
| HSTS                                                                                  | configured only by the TLS Nginx edge contract                        |

## Operational artifact validation

Pinned production artifacts and SHA-256 values live in
`ops/observability/media-toolchain.json`. The real gate is:

```bash
cd backend
npm run test:ops:media
```

When prerequisites exist, the harness runs:

- `nginx -t` with a complete temporary wrapper, starts Nginx, exercises the signed
  content and public metrics routes, and inspects a query-redacted safe log;
- `promtool check rules media-alerts.yml` and
  `promtool test rules media-alerts.test.yml`;
- pinned disposable Grafana imports and reads back the dashboard, provisions a
  Prometheus datasource, verifies the rendered HTTPS runbook link and executes every
  non-empty panel target through the Grafana datasource API. A guaranteed-absent
  metric separately proves that a successful empty query stays an explicit no-data
  state rather than being mistaken for a populated panel or a query failure.

## Application secret lifecycle

Generate JWT secrets, password pepper, media signing keys and metrics bearer tokens
with an approved CSPRNG at a minimum of 32 random decoded bytes; never derive one
from another or place generated values in shell history, repository files or release
logs. Inject them through the environment's secret manager and workload identity,
then use audited rollout revisions.

- JWT rotation uses the application's declared overlap/key-version contract; revoke
  old signing material only after issued access/refresh lifetimes and session
  revocation behavior are verified.
- Password pepper rotation changes password-verification semantics. It requires an
  explicit dual-pepper/login rehash plan or a forced credential reset; a blind swap
  locks out every existing password.
- `MEDIA_SIGNING_SECRET` is a single active HMAC key in V1. Rotating it invalidates
  every outstanding signed media grant immediately, so either drain the maximum
  grant TTL before rollout or accept/document that revocation window and roll all
  replicas atomically with monitoring for `invalid_grant`.
- Metrics bearer rotation follows the overlap-safe four-phase sequence below; do not
  reuse JWT, pepper, media-signing or metrics material across purposes.

The gate acquires only checksum-pinned artifacts or uses a verified cache and emits
independent sanitized JSON/JUnit status. Missing artifact/network/runbook/provider
is `BLOCKED_EXTERNAL`; invalid repository behavior is `FAIL_INTERNAL`. No static
artifact test upgrades either result to PASS.

## Release boundary

Internal deterministic tests can make the repository `CODE_READY`. Operational
artifact readiness remains `BLOCKED_EXTERNAL` until the pinned tools execute. Live
S3, ClamAV, deployed proxy, production notification delivery, running backend
replicas and production
secret-manager/workload-identity verification are separately `BLOCKED_EXTERNAL`.
No production endpoint or credential was supplied or used by this closeout.

## Evidence contract

Do not copy old suite counts into a release decision. Run every gate on current HEAD
and retain `backend/test-results/media-operations/media-operations-validation.json`
plus its JUnit companion. Each validator records status, duration, command IDs,
per-command exit/duration/log path and verified artifact digests. Live provider,
deployed mesh/policy, PVC binding, real runbook and production notification-provider
evidence remain separate external gates.
