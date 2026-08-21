---
name: mobile-architecture
description: "Thiết kế kiến trúc mobile HSK gồm navigation, offline sync, secure storage, release và observability. Sử dụng trước khi chọn native/cross-platform hoặc thêm capability mobile."
---

# Mobile Architecture

1. Chốt device/OS matrix, offline expectation, media/speech workload, accessibility và store constraints.
2. Chọn native/cross-platform bằng spike và total cost, không theo xu hướng; chia feature/data/domain/platform layer.
3. Token chỉ trong OS secure storage; certificate/network security, deep-link allowlist và root/jailbreak risk policy.
4. Offline database/cache có version, encryption, quota, conflict rule, idempotent sync và retry/backoff.
5. Navigation/deep link/back stack bền; background task, download, audio và notification theo OS lifecycle.
6. Crash/performance/network telemetry không thu thừa PII; remote config/kill switch và staged store rollout.
7. Test device thật, network transition, low storage/memory, upgrade DB, accessibility và restore session.

**Gate:** không silent data loss, sync conflict có chủ đích, startup/crash/ANR budget và rollback/store release plan.
