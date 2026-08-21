---
name: business-model-monetization
description: "Thiết kế mô hình giá trị, free/premium packaging, pricing, unit economics, entitlement và thử nghiệm doanh thu. Sử dụng khi xây business case, phân tầng nội dung, thêm subscription/payment hoặc đánh giá tính bền vững của HSK System."
---

# Business Model & Monetization

## Mục tiêu

Tạo mô hình doanh thu phù hợp outcome học tập, không làm hỏng core learning loop hoặc tạo quyền truy cập khó kiểm soát.

## Quy trình

1. Xác định customer, user, payer và beneficiary; không mặc định là cùng một người.
2. Mô tả value metric người dùng hiểu được: level access, review capacity, exam, speaking feedback, AI quota hoặc offline.
3. Nghiên cứu willingness-to-pay và benchmark hiện hành theo thị trường Việt Nam/khu vực.
4. Thiết kế free boundary đủ tạo giá trị trước paywall và premium boundary đủ khác biệt.
5. Tạo package/tier đơn giản; tránh matrix entitlement không thể giải thích hoặc vận hành.
6. Mô hình hóa funnel, conversion, churn, retention, ARPU/LTV, CAC, gross margin và provider fee.
7. Đánh giá chi phí biến đổi: AI token, speech, storage, media delivery, payment và support.
8. Thiết kế entitlement phía server, trial, renewal, grace period, cancel, refund và restore purchase.
9. Xác định experiment, sample, guardrail và stop rule trước khi chạy.
10. Review fairness, dark pattern, trẻ vị thành niên, app-store/payment terms và privacy.

## Đầu ra bắt buộc

- Business model canvas hoặc value/revenue map.
- Packaging/pricing hypothesis và entitlement matrix.
- Unit economics model có assumption/sensitivity.
- Experiment plan, metric và rollout/rollback.
- Revenue risk register và compliance checklist.

## Quy tắc kỹ thuật

- Không dùng `isPremium` đơn lẻ trên content làm nguồn quyền truy cập.
- Backend kiểm tra `Entitlement` theo user/feature/resource và thời hạn.
- Payment webhook idempotent; external event ID unique và có audit.
- Không lưu dữ liệu thẻ trong core database.
- Feature flag không thay thế entitlement và billing state.

## Quality gate

- Pricing claim và benchmark có ngày/nguồn hiện hành.
- Mọi tier map được tới entitlement kiểm thử được.
- Unit economics bao gồm chi phí AI/speech/content/support, không chỉ hosting.
- Free experience vẫn hoàn chỉnh về mặt học tập cơ bản và minh bạch giới hạn.

## Điều kiện dừng hoặc chuyển cấp

Không triển khai charge thật khi chưa có terms/refund/privacy, tax/provider review, reconciliation, support process và release approval của người có thẩm quyền.
