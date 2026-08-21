---
name: documentation-management
description: "Quản trị tài liệu kiến trúc, product, API, runbook, ADR và context như code. Sử dụng khi behavior/contract/operation thay đổi hoặc audit tài liệu."
---

# Documentation Management

1. Chọn đúng loại: context/reference, requirement, ADR, API, runbook, process/report; mỗi loại có owner/source/status.
2. Viết hiện trạng khác mục tiêu; exact version/command/path/checksum/count chỉ từ evidence mới.
3. Link code/schema/test/dashboard/runbook hai chiều; tránh duplicate source of truth.
4. ADR immutable history/supersede; runbook tested; API examples safe và executable khi khả thi.
5. Không ghi credential/PII/internal exploit; placeholder được đánh dấu, no false completion.
6. Validate link/fence/format/diff và stale claim trong release review.
7. Archive/deprecate có redirect/context; review schedule cho tài liệu vận hành/pháp lý.

**Gate:** người mới thực thi được không suy đoán; docs implementation khớp current reviewed bytes, còn release claim phải khớp frozen commit tree/artifact digest/provenance/manifest.
