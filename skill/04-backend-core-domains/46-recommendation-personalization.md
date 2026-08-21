---
name: recommendation-personalization
description: "Thiết kế recommendation/personalization minh bạch và an toàn cho lộ trình HSK. Sử dụng khi đề xuất lesson, review, goal, difficulty hoặc experiment ranking."
---

# Recommendation & Personalization

1. Chốt objective và guardrail: learning outcome, completion, diversity, latency, fairness; không tối ưu click đơn thuần.
2. Input chỉ từ consented/minimal data; feature/version/provenance/retention rõ và tránh sensitive proxy.
3. Baseline rule-based deterministic trước model; fallback khi feature/model unavailable.
4. Filter hard eligibility/visibility/HSK band trước ranking; không đề xuất content draft/deleted/không có quyền.
5. Version algorithm, log safe reason code, explain/override/reset cho user và explore/exploit có giới hạn.
6. Offline evaluation + A/B guardrail, sample-size/stop rule; monitor drift, bias, latency và cost.
7. Test cold start, sparse/history deleted, adversarial feedback, stale model và multi-instance consistency.

**Gate:** measurable uplift không hại learning/safety, rollback/kill switch và privacy review hoàn tất.
