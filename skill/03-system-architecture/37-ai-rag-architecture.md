---
name: ai-rag-architecture
description: "Thiết kế AI/RAG gateway, ingest, retrieval và safety cho trợ lý HSK. Sử dụng khi thêm model/provider, embedding, knowledge source, prompt, evaluation hoặc AI feature."
---

# AI/RAG Architecture

1. Chốt use case, non-goal, harm model, latency/cost/quality target và human fallback.
2. Registry nguồn có license/provenance/version/hash; chunk/normalize/embed pipeline idempotent và reproducible.
3. Tách AI service; backend truyền user/permission context tối thiểu, không foreign key/secret xuyên owner.
4. Retrieval enforce ACL trước generation; chống prompt injection/data exfiltration, sanitize tool/output và cite nguồn.
5. Provider có DPA/retention/training policy; redact PII, set timeout/rate/cost quota/circuit breaker.
6. Version model/prompt/index; offline golden-set eval + online feedback/guardrail/drift/cost telemetry.
7. Câu trả lời bất định phải nêu giới hạn; nội dung học/thi quan trọng có human review.

**Gate:** no-answer và malicious corpus test, source citation/ACL đúng, rollback model/index/prompt, kill switch và quality/cost SLO.
