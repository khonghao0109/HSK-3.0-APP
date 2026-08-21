---
name: architecture-decision-records
description: "Tạo và quản trị ADR cho quyết định kỹ thuật quan trọng của HSK 3.0. Sử dụng khi chọn boundary, data model, security, framework, provider, consistency, migration hoặc trade-off khó đảo ngược."
---

# Architecture Decision Records

1. Ghi context, problem, constraints và decision drivers; không viết ADR để hợp thức hóa sau cùng.
2. Liệt kê ít nhất hai phương án khả thi, trade-off, chi phí, security/privacy và operational impact.
3. Chốt decision, scope, status, owner, date, consequences và điều kiện revisit.
4. Gắn link requirement, diagram, code/schema, benchmark/test, migration/runbook.
5. Khi supersede, giữ lịch sử và trỏ ADR mới; không sửa ngược quyết định đã áp dụng như chưa từng tồn tại.

**Gate:** ADR đủ cho người khác tái dựng lý do; claim scale/security có evidence; implementation và docs đồng bộ; decision chưa duyệt không được mô tả là chuẩn.
