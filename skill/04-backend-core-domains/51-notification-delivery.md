---
name: notification-delivery
description: "Thiết kế email/push/in-app notification đáng tin cậy và tuân thủ preference. Sử dụng khi thêm reminder, security alert, campaign hoặc provider delivery."
---

# Notification Delivery

1. Phân loại transactional/security/learning/marketing; consent/preference/quiet hours và unsubscribe theo category.
2. Tạo notification intent + outbox; worker idempotent, provider key, retry jitter, DLQ và dedup.
3. Template versioned/localized, escape input, không đưa token/PII nhạy cảm vào subject/log/deep link.
4. Security alert không bị tắt sai; marketing có legal basis và suppression list.
5. Track accepted/delivered/bounce/complaint/click tối thiểu; webhook signature + replay protection.
6. Rate/cap theo user/campaign; provider failover chỉ khi tránh duplicate và data policy phù hợp.
7. Test duplicate/out-of-order webhook, hard bounce, revoked user, timezone và deep-link authorization.

**Gate:** no duplicate spam, preference enforced, reputation/delivery SLO dashboard và kill switch/runbook.
