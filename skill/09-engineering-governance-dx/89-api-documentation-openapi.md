---
name: api-documentation-openapi
description: "Quản trị OpenAPI/API docs và contract examples cho HSK. Sử dụng khi thêm/sửa endpoint, DTO, auth, error, pagination, idempotency hoặc deprecation."
---

# API Documentation & OpenAPI

1. OpenAPI sinh/đối chiếu từ typed runtime contract; operationId/tag/version/servers/security scheme nhất quán.
2. Schema nêu required/nullability/format/bounds/enum/unknown-field và example synthetic.
3. Document auth/permission, idempotency, rate limit, pagination/filter/sort, cache và error matrix.
4. Mutation ghi state transition/concurrency/retry/side effect; upload/import ghi size/type/atomicity.
5. Không đưa token/password/real URL/PII; response public/admin tách rõ.
6. Contract diff trong CI phân loại breaking; deprecation telemetry/window/migration guide.
7. Test spec parse/lint, provider response và consumer/BFF compatibility.

**Gate:** docs/api/OpenAPI/code/test cùng behavior, không endpoint shadow/undocumented error và SDK generation ổn định.
