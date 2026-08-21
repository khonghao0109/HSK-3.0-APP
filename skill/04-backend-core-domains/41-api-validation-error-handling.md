---
name: api-validation-error-handling
description: "Chuẩn hóa input validation, normalization và safe error contract cho HSK API. Sử dụng khi thêm DTO/parser/import, constraint mapping hoặc xử lý lỗi provider/database."
---

# API Validation & Error Handling

1. Xác định exact allowed keys, type, range, length, array count, JSON depth/bytes và Unicode normalization.
2. Reject unknown field bằng generic bounded path; không phản chiếu attacker-controlled key/value, URL, credential hoặc SQL.
3. Dùng 400 cho DTO/path/query/unknown-field/transport validation; 422 chỉ cho domain semantic hoặc authoring shape theo `docs/api.md`; auth 401/403, missing 404, conflict 409, rate 429 và unavailable/timeout 503.
4. Map Prisma/SQLSTATE theo domain; timeout/deadlock/connection không được giả thành invariant violation.
5. Error có code ổn định, safe message, optional safe field path và correlation ID; log nội bộ redacted.
6. Batch/import trả row error deterministic và atomicity policy; cap workload trước persistence.
7. Unit test boundary/collision/sanitization và E2E exact response.

**Gate:** không 500 cho client-domain error đã biết; không leak secret; cùng validator dùng cho manual/import/scorer khi contract chung.
