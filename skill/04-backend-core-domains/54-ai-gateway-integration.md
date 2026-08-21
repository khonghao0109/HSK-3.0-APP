---
name: ai-gateway-integration
description: "Triển khai backend AI gateway bảo mật, quota và provider-independent. Sử dụng khi backend gọi RAG/model/speech, streaming response hoặc quản lý AI cost/safety."
---

# AI Gateway Integration

1. Backend authenticate/authorize user rồi gửi context tối thiểu; browser không gọi provider trực tiếp hay thấy API key.
2. Request schema/size/allowed tool rõ; prompt/system policy server-side, redact PII và chống injection/exfiltration.
3. Provider adapter có connect/overall timeout, bounded retry, circuit breaker, concurrency/quota và cancellation.
4. Idempotency/correlation cho request cần retry; streaming xử lý abort/backpressure và partial failure.
5. Response validate/sanitize/citation; content safety và human fallback cho use case giáo dục nhạy cảm.
6. Log metadata/token/cost/latency/safety code, không raw secret/conversation ngoài retention policy.
7. Test malicious prompt, provider timeout/429/malformed/stream abort, quota và failover.

**Gate:** budget/SLO/dashboard/kill switch, provider privacy approval và contract không khóa model cụ thể.
