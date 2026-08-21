---
name: analytics-event-design
description: "Thiết kế product analytics event taxonomy và measurement plan có privacy. Sử dụng khi đo funnel, learning outcome, experiment, admin operation hoặc telemetry hành vi."
---

# Analytics Event Design

1. Bắt đầu từ product question/decision và metric tree; không instrument “mọi click”.
2. Event tên domain verb/past tense nhất quán, có schema version, occurredAt, actor pseudonym, session/correlation và context allowlist.
3. Không gửi password/token/raw answer/recording/PII không cần thiết; consent/region/retention rõ.
4. Client event dùng cho interaction, server event cho business fact; dedup bằng event ID/idempotency.
5. Định nghĩa source of truth, numerator/denominator, timezone, attribution và late/duplicate rule cho metric.
6. Contract test, debug view, sample validation và warehouse reconciliation.
7. Theo dõi schema drift, volume/cost, missing/duplicate rate; owner/deprecation rõ.

**Gate:** dashboard metric tái lập được từ event contract, privacy review và data quality SLO đạt.
