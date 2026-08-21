---
name: feature-flags-experimentation
description: "Thiết kế feature flag, progressive rollout và experiment an toàn. Sử dụng khi rollout rủi ro, A/B test, kill switch hoặc tách deploy khỏi release."
---

# Feature Flags & Experimentation

1. Flag có type, owner, purpose, safe default, target, creation/expiry và removal issue.
2. Server-side evaluate quyền/invariant; client flag không là security boundary, payload không lộ config nhạy cảm.
3. Consistent assignment theo stable pseudonymous key; exposure event chính xác, consent/privacy và sample ratio monitoring.
4. Schema/API compatible cả on/off và phiên bản app cũ; flag flip không phá transaction/cache.
5. Rollout internal→cohort→percentage; SLI/business guardrail, abort/kill switch và audit change.
6. Test on/off/default/provider outage/stale cache và interaction giữa flags; hạn chế combinatorial explosion.
7. Sau decision, remove flag/dead code/data path trong deadline.

**Gate:** experiment hypothesis/power/stop rule rõ; không dùng flag để giữ code chưa hoàn thiện vô hạn.
