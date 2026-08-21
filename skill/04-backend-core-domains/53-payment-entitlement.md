---
name: payment-entitlement
description: "Thiết kế payment, subscription, webhook và entitlement an toàn. Sử dụng khi thêm gói trả phí, checkout, renewal, refund hoặc quyền premium."
---

# Payment & Entitlement

1. Provider xử lý card; hệ thống không lưu PAN/CVV; chốt product/price/currency/tax/refund/renewal disclosure với legal.
2. Checkout idempotent; amount/price server-side; return URL allowlist và auth context.
3. Webhook verify signature/timestamp, store event ID, process idempotent/out-of-order và reconcile định kỳ.
4. Ledger/payment/subscription fact immutable; entitlement là projection theo effective period, grace/cancel/refund rules.
5. Không cấp quyền chỉ từ client redirect; authorization đọc entitlement server-side và cache invalidation an toàn.
6. Secret rotate, least privilege, audit và data minimization/retention; sandbox fixture tách production.
7. Test duplicate/missing/reordered webhook, dispute/refund, clock boundary, provider outage và replay.

**Gate:** finance reconciliation, no double charge/entitlement, PCI scope documented, kill switch/support/refund runbook.
