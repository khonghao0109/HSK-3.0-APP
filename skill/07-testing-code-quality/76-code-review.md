---
name: code-review
description: "Review code/diff theo risk, correctness, security, integrity, scale và operability. Sử dụng khi review PR/commit hoặc trước stage/release."
---

# Code Review

1. Đọc requirement/ADR và toàn diff; kiểm Git state/untracked/staged, không đánh giá chỉ file tác giả nêu.
2. Truy flow end-to-end: input/auth → transaction/data → output/UI → telemetry/failure/rollback.
3. Ưu tiên blocker: correctness/integrity/history, security/privacy, concurrency/idempotency, migration compatibility, availability.
4. Kiểm horizontal scale, timeout/retry/backpressure/pool/cache/queue, performance query/bundle và accessibility.
5. Đánh giá test có thể fail thật, classifier không false-green, fixture disposable/seed-independent.
6. Finding nêu severity, file/line, scenario/impact và remediation cụ thể; tách nit.
7. Re-review actual staged bytes, secret/focused-test/generated artifact trước commit.

**Gate:** không sign-off khi gate/evidence/docs stale; no finding không chứng cứ; giữ scope và thay đổi người dùng.
