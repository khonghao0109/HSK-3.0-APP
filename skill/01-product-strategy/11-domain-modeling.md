---
name: domain-modeling
description: "Mô hình hóa domain, bounded context, aggregate, lifecycle, invariant và ngôn ngữ dùng chung trước khi thiết kế API/schema. Sử dụng khi bổ sung module, gỡ mâu thuẫn thuật ngữ, tách boundary hoặc chuẩn bị thay đổi dữ liệu lớn trong HSK System."
---

# Domain Modeling

## Mục tiêu

Mô tả nghiệp vụ độc lập với UI/database đủ rõ để bảo vệ invariant và phân quyền ownership giữa các module.

## Quy trình

1. Thu thập thuật ngữ từ user flow, content team, API, schema và code.
2. Tạo ubiquitous language; ghi định nghĩa, từ đồng nghĩa cấm dùng và ví dụ.
3. Chia bounded context theo capability/ownership, không theo bảng hoặc màn hình.
4. Xác định entity, value object, aggregate root, policy, domain service và event.
5. Viết lifecycle/state machine và transition hợp lệ cho aggregate quan trọng.
6. Nêu invariant phải đúng trong mọi thời điểm và transaction boundary bảo vệ nó.
7. Mô tả relation xuyên context bằng ID/event/API; tránh foreign key xuyên database owner.
8. Lập context map: upstream/downstream, contract, eventual consistency và failure mode.
9. Đối chiếu model với Prisma/API/UI; ghi gap thay vì ép domain theo schema hiện có.
10. Viết ADR khi chọn boundary hoặc consistency có trade-off đáng kể.

## Bounded context khuyến nghị

- Identity & Access.
- Curriculum & Content CMS.
- Learning Activities & Progress.
- Dictionary & Lexical Data.
- Review/SRS.
- Exam Delivery & Results.
- Media, Engagement/Notification, Support.
- Subscription & Entitlement.
- Analytics.
- AI/RAG là service/database riêng, nhận identity/permission context qua contract.

## Invariant HSK quan trọng

- Level là HSK 1–9 theo version curriculum đã chốt.
- Published content có version, source/provenance và không bị thay đổi ngầm.
- Exam result tham chiếu snapshot tại attempt, không phụ thuộc question live.
- Review event là lịch sử; schedule hiện tại được suy ra/cập nhật có kiểm soát.
- Premium access được quyết định bằng entitlement phía server.
- User data chỉ được truy cập theo owner/role và lifecycle đã định nghĩa.

## Đầu ra bắt buộc

- Glossary và context map.
- Domain diagram cùng aggregate/lifecycle/invariant.
- Ownership matrix cho dữ liệu và capability.
- Danh sách domain event/contract và ADR cần có.

## Quality gate

- Mỗi entity có identity, lifecycle và owner rõ ràng.
- Không dùng một model cho hai khái niệm có lifecycle khác nhau.
- Invariant quan trọng có enforcement point và test strategy.
- Domain model không phụ thuộc vào label UI tạm thời.

## Điều kiện dừng hoặc chuyển cấp

Yêu cầu product/content owner chốt khi thuật ngữ HSK, quy tắc scoring, content version hoặc entitlement còn mâu thuẫn và ảnh hưởng trực tiếp tới aggregate/schema.
