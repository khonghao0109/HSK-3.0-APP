# Media Observability & Edge Security Closeout

- Date: 2026-08-13
- Owners: Media Platform, Security Platform, Platform SRE
- Scope: backend and operations artifacts only; no UI or database schema change
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

| Path                             | Public ingress                           | Private monitoring network     | Credential                                    |
| -------------------------------- | ---------------------------------------- | ------------------------------ | --------------------------------------------- |
| signed media content             | matched; query-redacted, no shared cache | not required                   | signed HMAC query                             |
| `/api/v1/internal/metrics/media` | exact-match `404`, even without token    | direct pod/replica scrape only | current bearer token from secret file/manager |

`ops/observability/media-metrics-private-network.yml` defines the headless endpoint
and NetworkPolicy. `media-prometheus.yml` is a deterministic two-replica rehearsal
topology, never a load-balanced application endpoint. A production replica count
beyond two must use pod service discovery/relabeling while retaining one target per
pod. Rotation procedure:

1. provision a new random token in the secret manager and mount it to Prometheus;
2. deploy backend with new current plus old `MEDIA_METRICS_BEARER_TOKEN_PREVIOUS`;
3. reload every direct scrape target and verify both targets healthy;
4. remove the previous token and roll backend replicas;
5. never log the Authorization header or place the token in repository YAML.

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
- version-check and dashboard import/read-back/delete against an explicitly guarded,
  loopback disposable Grafana.

The current workstation has no `nginx`, `promtool` or Grafana CLI
(`grafana-server`/`grafana`); the command therefore exits `2` with
`BLOCKED_EXTERNAL`. This is not a PASS and does not replace the next live
infrastructure rehearsal.

## Release boundary

Internal deterministic tests can make the repository `CODE_READY`. Operational
artifact readiness remains `BLOCKED_EXTERNAL` until the pinned tools execute. Live
S3, ClamAV, proxy, Alertmanager delivery, two running backend replicas and production
secret-manager/workload-identity verification are separately `BLOCKED_EXTERNAL`.
No production endpoint or credential was supplied or used by this closeout.

## RED/GREEN evidence

The RED contract run failed before implementation because the runtime-security
module and typed storage/scanner constructors did not exist, integrity mismatches
were recorded as unavailable, and metrics used multiple database calls. The process
also exposed that raw provider errors crossed the in-memory/test boundary. No RED
failure was treated as expected success.

Final deterministic evidence on 2026-08-13:

| Gate                                                                                 | Result                                                                        |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| taxonomy/config/storage/scanner/metrics/controller/artifact contracts                | 8 suites, 93 tests PASS                                                       |
| full backend unit                                                                    | 46 suites, 459 tests PASS                                                     |
| Prisma format/validate/generate, TypeScript build/spec, Nest build, ESLint, Prettier | PASS                                                                          |
| fresh media SQL integrity                                                            | PASS, transaction rolled back; User/Media/MediaIngestion/AuditLog remain zero |
| fresh media fencing/concurrency                                                      | 1 suite, 13 tests PASS                                                        |
| replacement fresh full backend E2E                                                   | 11 suites, 160 tests PASS                                                     |
| live-schema and migration-history drift                                              | both report no difference                                                     |
| production dependency audit                                                          | zero vulnerabilities                                                          |
| high-confidence secret scan and added focused/skip scan                              | no finding                                                                    |
| Nginx/promtool/Grafana executable gate                                               | `BLOCKED_EXTERNAL` (exit 2; all three toolchains absent)                      |

The first full-E2E invocation lacked the two synthetic test JWT variables and failed
bootstrap. It was not counted and its database was not reused. The corrected command
ran on a new database. All six databases created by the closeout were dropped and a
final exact-name catalog query returned zero.
