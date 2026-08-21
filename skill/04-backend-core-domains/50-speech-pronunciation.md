---
name: speech-pronunciation
description: "Thiết kế recording, speech-to-text và pronunciation feedback có privacy/safety. Sử dụng khi thêm speaking exercise, audio capture, provider speech hoặc scoring phát âm."
---

# Speech & Pronunciation

1. Chốt mục đích, consent, age/privacy, retention và delete path trước thu giọng nói.
2. Capture giới hạn format/size/duration; upload private, scan/transcode và signed access; không public raw recording.
3. Provider boundary redact metadata, timeout/quota/circuit breaker, DPA/training opt-out và region policy.
4. Scoring/feedback versioned, calibration theo accent/noise, nêu uncertainty; không dùng như đánh giá tuyệt đối.
5. Async job idempotent với status/progress/retry/DLQ; user thấy processing/error/retry.
6. Accessibility có transcript/text alternative; user kiểm soát record/play/delete.
7. Test noisy/silent/long/malicious file, provider outage, duplicate callback, deletion và bias slices.

**Gate:** legal/privacy sign-off, security scan, quality threshold/fallback, cost/latency SLO và purge audit.
