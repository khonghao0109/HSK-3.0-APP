---
name: modular-monolith-architecture
description: "Thiết kế boundary và dependency cho modular monolith NestJS của HSK core. Sử dụng khi thêm module/domain, refactor shared code hoặc đánh giá nhu cầu tách service."
---

# Modular Monolith Architecture

1. Chia theo bounded context/capability, không theo controller/service/repository toàn cục.
2. Mỗi module sở hữu model, transaction, invariant và public application interface; module khác không truy cập private implementation.
3. Enforce dependency direction bằng module API/lint/test; shared chỉ chứa primitive ổn định, không thành “common” vô chủ.
4. Dùng transaction nội bộ cho consistency; event/outbox cho side effect sau commit khi cần.
5. Tránh cyclic dependency, cross-module Prisma write và schema owner mơ hồ.
6. Chỉ tách service khi scale, team ownership, security hoặc failure isolation tạo lợi ích đo được; chuẩn bị contract/observability/data migration trước.

**Gate:** capability có owner, dependency graph acyclic, test boundary, transaction rõ và không cần distributed transaction ngầm.
