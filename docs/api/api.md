# API Specification — HSK System

## 0. Trạng thái tài liệu

Cập nhật 04/09/2026 theo HEAD `3211bf8`. Tài liệu chia hai phần:

- **Part A — Đã triển khai**: chỉ gồm endpoint có controller trong `backend/src/modules`,
  mô tả đúng request/response như code hiện tại (kể cả chỗ chưa đẹp).
- **Part B — Dự kiến**: endpoint chưa có code, gắn milestone theo
  [../product/roadmap.md](../product/roadmap.md) §6. Không được coi là hợp đồng.

Khi thêm hoặc đổi endpoint, sửa Part A, DTO, test và `docs/PLAN.md` trong cùng PR.

**OpenAPI (H.10c, ADR-008 §5).** [`backend/openapi.json`](../../backend/openapi.json)
(OpenAPI 3.0) sinh từ code và là contract máy đọc của Part A: path, param, header, body
DTO, envelope §1, lỗi `default`, security `JWT`. Tài liệu này giữ phần code không suy ra
được: quy tắc nghiệp vụ, mã lỗi domain, idempotency, rate limit.

- Sinh lại: `npm run openapi:generate` trong `backend/` (cần `nest build` để Swagger plugin
  suy schema DTO; không cần database), commit cùng thay đổi controller/DTO. CI backend chạy
  `npm run openapi:check` và fail khi file commit bị lệch.
- `data` có schema đầy đủ cho các endpoint có response DTO: `auth/register`, `auth/login`,
  `auth/me`, admin exercise list/detail, admin media list/detail/archive/quarantine (mọi
  call của BFF), public learning (`levels`, `lessons`, `topics`, `stories`) và
  `learning/path`. Endpoint
  khác mới có envelope, `data` để trống schema (bất kỳ JSON), shape xem Part A.
- Frontend: `npm run typegen:backend` sinh `frontend/src/lib/api/backend-generated-types.ts`
  bằng `openapi-typescript`, chỉ dùng làm type. Không sinh fetch client (ADR-003): allowlist
  path trong `backend-client.ts` và Zod parse tại BFF giữ nguyên; test
  `backend-openapi-contract.spec.ts` bắt type sinh phải fresh và mọi response đã document
  của call BFF phải qua được Zod schema tương ứng.
- Swagger UI `/api/docs` (JSON `/api/docs-json`) chỉ bật khi `NODE_ENV=development`; tắt
  ở `test` và `production`.

## 1. Quy ước thực tế

- Base path: `/api/v1`; versioning theo path; JSON UTF-8.
- Auth: `Authorization: Bearer <jwt>` cho route đánh dấu `JWT`/`admin`. Public content,
  dictionary, health và signed media content không cần token. JWT HS256 có header `kid`,
  claims `sub`, `email`, `role`; strategy đọc lại `status`, `deletedAt`, `role` từ DB mỗi
  request. Chưa có refresh/revocation.
- Validation: `whitelist`, `forbidNonWhitelisted`, `transform`. Field lạ → `400` với
  path `$.$unknown`. Boolean chỉ nhận JSON boolean thật. ID trên path phải là số nguyên
  dương `1..2147483647`, sai → `400`.
- Envelope (H.10a, A-03): mọi response JSON, thành công hay lỗi, đi qua
  `TransformInterceptor` và `GlobalExceptionFilter` toàn cục. Bảng "Response" bên dưới
  chỉ mô tả `data`.

  ```json
  { "success": true, "data": {},
    "meta": { "requestId": "<id>", "timestamp": "2026-09-14T05:00:00.000Z",
              "pagination": { "page": 1, "limit": 20, "total": 41, "totalPages": 3 } } }
  ```

  `meta.pagination` chỉ có ở list phân trang (bảng ghi `+ meta`). Handler trả `undefined`
  → `data: null`. Ngoại lệ duy nhất là bytes của `GET /media/:id/content` (A.11) và
  listener metrics riêng (không phải route Nest): không bọc JSON.
- Lỗi: `{ "success": false, "error": { "code", "message", "details"? }, "meta":
  { "requestId", "timestamp" } }`. `code` là mã domain khi exception có (ví dụ
  `REQUEST_VALIDATION_FAILED`, `MEDIA_STORAGE_*`, `listening_media_not_ready`,
  `UPLOAD_TOO_LARGE`), còn lại là tên HTTP status (`BAD_REQUEST`, `UNAUTHORIZED`,
  `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `TOO_MANY_REQUESTS`…). Field khác của lỗi domain
  nằm trong `details`: validation `400` → `details.errors: [{ path, codes }]`, lỗi
  authoring `422` → `details.path`, import → `details.errors`. Lỗi không phải
  `HttpException` (Prisma, driver, lỗi lập trình) → `500 INTERNAL_SERVER_ERROR`
  `"Internal server error."`; message gốc không vào response lẫn log (log chỉ tên class
  và requestId). JSON hỏng hoặc path không decode được → `400 MALFORMED_REQUEST`, không
  trích body/path; body quá lớn → `413 PAYLOAD_TOO_LARGE`; route không tồn tại → `404`
  `"Cannot <METHOD> <path>"` đã bỏ query string.
- Request id: nhận `x-request-id` nếu là UUID (8-4-4-4-12 hex) hoặc 32 hex
  (`$request_id` của nginx), ngược lại sinh UUIDv4. Luôn echo ở header `X-Request-ID`
  và `meta.requestId`, kể cả lỗi từ guard (`401`/`403`/`429`). Audit log CMS ghi đúng id
  này vào `correlationId`.
- Pagination: `page` 1..2147483647 mặc định 1, `limit` 1..100 mặc định 20; ngoài khoảng,
  không phải số nguyên hoặc query lạ → `400`. Không có `sortBy`/`sortOrder`; thứ tự cố
  định theo endpoint.
- Status code: `200` GET; **mọi `POST` trả `201` kể cả idempotent replay** (chưa dùng
  `@HttpCode`); `204` chưa dùng; `400`, `401`, `403`, `404`, `409`, `413`, `422`, `429`,
  `500`, `503`.
- Rate limit: toàn cục 20 req/phút (`register` 100, `login` 10); `429` với
  `error: { code: "TOO_MANY_REQUESTS", message: "ThrottlerException: Too Many Requests" }`. Khoá
  `user:<id>` khi bearer JWT hợp lệ (kid, chữ ký HS256, hạn; không tra DB), còn lại
  `ip:<req.ip>`. `register`/`login` luôn khoá theo IP. `req.ip` lấy từ
  `X-Forwarded-For` qua `TRUST_PROXY_HOPS` (mặc định 1: nginx hoặc BFF). Bộ đếm là
  cửa sổ cố định lưu ở bảng PostgreSQL `RateLimitCounter`, dùng chung mọi replica;
  vượt giới hạn thì khoá hết thời gian `ttl` (60 giây), hit trong lúc bị khoá không
  được đếm. Mỗi request thêm một câu upsert; lỗi database làm request thất bại
  (fail-closed), không bỏ qua giới hạn.
- Idempotency: header `Idempotency-Key`; activity 8–128 ký tự `^[A-Za-z0-9][A-Za-z0-9._:-]*$`;
  exercise import 8–128; media ingestion 32–128. Cùng key cùng body → `data` gốc (`meta`
  là của request replay); cùng key khác body → `409`.

## Part A — Đã triển khai

Cột Auth: `public` (không token), `JWT` (account `active`, chưa soft-delete), `admin`
(JWT + `role=admin`, service và DB kiểm lại role trong transaction).

### A.1 Health

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/health` | public |

`data` `200`: `{ "database": "connected", "env": "production", "port": 3000 }`.
DB lỗi → `500 INTERNAL_SERVER_ERROR`. (Backlog B-10: chỉ trả `{ status }`, tách
liveness/readiness.)

### A.2 Auth

| Method | Path | Auth | Rate limit |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | public | 100/phút/IP |
| `POST` | `/auth/login` | public | 10/phút/IP; 5 lần sai/15 phút/email |
| `POST` | `/auth/refresh` | public | 30/phút/IP |
| `POST` | `/auth/logout` | JWT | global |
| `GET` | `/auth/me` | JWT | global |
| `POST` | `/auth/email-verification/request` | JWT | 3/15 phút/user |
| `POST` | `/auth/email-verification/confirm` | public | 10/phút/IP |
| `POST` | `/auth/password-reset/request` | public | 5/15 phút/IP; 3 lần/giờ/email |
| `POST` | `/auth/password-reset/confirm` | public | 10/phút/IP |

Body register: `{ "email": string(email), "password": string(≥6), "name"?: string }`.
Email canonicalize `trim().toLowerCase()`; DB unique theo `lower(email)`. Password trong
blacklist → `400 "Password is too weak."`; email đã tồn tại → `409 "Email already exists"`,
kể cả khi hai request đăng ký cùng email chạy song song (unique index `P2002` cũng map về
`409`). Thao tác tạo user (`user.create`) và enqueue job gửi mail xác thực (`mail.email-verification`)
được thực thi trong cùng một `prisma.$transaction`; nếu enqueue thất bại, transaction rollback
hoàn toàn (không tạo user mồ côi). Session chỉ được tạo sau khi transaction commit thành công.

Body login: `{ "email", "password" }`. Email không tồn tại, account không `active` hoặc
đã soft-delete, sai mật khẩu → cùng `401 "Invalid credentials"`. Chỉ account đang khoá
(5 lần sai → khoá 15 phút) → `403`.

Thứ tự kiểm tra login (H.5, B-01):

1. Throttle theo email đã chuẩn hoá `trim().toLowerCase()`, trước khi tra user: mỗi
   lần thử tính một điểm vào `RateLimitCounter` (key SHA-256 của
   `login:email:<email>`), quá 5 trong 15 phút → `429` như body throttle chung, kể cả
   email không tồn tại. Login thành công xoá bộ đếm này nên chỉ lần sai tích luỹ.
2. Email không tồn tại hoặc account không `active`/đã soft-delete → verify Argon2id với
   một hash mồi (cùng tham số và pepper, tạo từ secret ngẫu nhiên lúc khởi động) rồi
   `401`, không tính vào lockout. Thời gian phản hồi ngang với sai mật khẩu nên không dò
   được email đã đăng ký (H.7, B-06).
3. Lockout: một câu `UPDATE` nguyên tử giữ chỗ lượt thử (tăng `failedLoginAttempts`,
   lượt thứ 5 đặt `lockUntil` = now + 15 phút) trước khi verify Argon2; account đang
   khoá không được giữ chỗ → `403` mà không hash mật khẩu. Thành công đặt lại
   `failedLoginAttempts = 0`, `lockUntil = null`; khoá hết hạn thì đếm lại từ đầu.
4. Verify chỉ chấp nhận hash Argon2id (`$argon2id$`, có pepper). Giá trị lưu ở dạng khác
   (plaintext, Argon2i/Argon2d, bcrypt…) luôn → `401`, không so sánh chuỗi và không tự
   hash lại; account đó cần reset password (H.6, B-02).

Dưới `NODE_ENV=test` giới hạn IP của login và refresh nới thành 1.000/phút cho e2e từ loopback,
như giới hạn toàn cục.

Body refresh: `{ "refreshToken": string }` (32 byte `randomBytes` mã hoá base64url, đúng 43 ký tự).
Throttle 30/phút/IP (1.000/phút dưới test). DB chỉ lưu SHA-256 hex của token trong `UserSession`.
Access token gắn session qua payload `sid` = `UserSession.id`. `JwtStrategy` từ chối (401) nếu
session bị revoke hoặc hết hạn. Thời hạn access token mặc định là 15 phút (`15m`), được BFF proxy
âm thầm làm mới khi còn dưới 2 phút.

Cơ chế xoay vòng (rotation), khoảng ân hạn (grace period) và phát hiện dùng lại (reuse detection):
- Claim nguyên tử một session hợp lệ bằng SQL UPDATE với `CURRENT_TIMESTAMP`, đặt lý do revoke là `rotated`.
- Nếu claim thành công 1 dòng: user phải active và chưa soft-delete. Nếu không: revoke session đó với lý do
  `account_inactive` và trả 401. Nếu hợp lệ: tạo session mới (TTL `AUTH_REFRESH_TOKEN_TTL_DAYS`, mặc định 30 ngày)
  và trả cặp token mới.
- Nếu claim 0 dòng: kiểm tra trạng thái session theo đồng hồ DB:
  - Nếu session mang lý do `rotated` và `revokedAt > CURRENT_TIMESTAMP - 10s` (trong khoảng ân hạn 10 giây): coi là race
    đồng thời vô hại giữa các request (ví dụ nhiều tab refresh cùng lúc hoặc client retry do mạng). Server trả `401`,
    KHÔNG thu hồi thêm session nào của user; session kế tiếp (successor) của bên thắng cuộc vẫn giữ nguyên hiệu lực.
  - Nếu session mang lý do `rotated` và `revokedAt <= CURRENT_TIMESTAMP - 10s` (ngoài khoảng ân hạn 10 giây): coi là
    dùng lại token đã bị xoay vòng (refresh reuse). Server thu hồi TOÀN BỘ session còn lại của user với lý do
    `refresh_reuse`, rồi trả 401.
  - Đánh đổi an toàn: khoảng ân hạn 10 giây giúp loại bỏ race condition làm huỷ nhầm session hợp lệ của người dùng khi
    nhiều tab hoặc luồng cùng refresh một lúc; đổi lại, nếu token bị kẻ tấn công đánh cắp và dùng lại đúng trong 10 giây
    đầu sau khi xoay vòng thì các session còn lại của nạn nhân chưa bị revoke ngay lập tức (request của kẻ tấn công vẫn
    bị 401 từ chối, và chỉ kích hoạt revoke toàn bộ khi token được thử lại sau mốc 10 giây).
  - Nếu token không tồn tại, hết hạn hoặc mang lý do khác: trả 401.
- Mọi nhánh 401 của refresh trả chung thông điệp `Invalid refresh token` để không lộ trạng thái nội bộ.

`POST /auth/logout` (JWT, rate limit toàn cục):
- Yêu cầu access token hợp lệ (`JwtAuthGuard`). Thu hồi đúng session `sid` gắn với access token:
  `revokedAt = CURRENT_TIMESTAMP`, `revocationReason = 'logout'`, với điều kiện `"revokedAt" IS NULL`.
- Phản hồi `204 No Content` không kèm body.
- Gọi lại logout bằng chính token đó (hoặc dùng token đó gọi `/auth/me`) → `401` do session đã bị thu hồi.
- Các session khác của cùng user không bị ảnh hưởng.

`POST /auth/email-verification/request` (JWT, rate limit 3 lần / 15 phút / user):
- Yêu cầu access token hợp lệ (`JwtAuthGuard`). Rate limit áp dụng theo `user:<id>` (3 lần trong 15 phút).
- Nếu email đã xác thực (`emailVerifiedAt` khác null), tài khoản không active hoặc đã soft-delete: phản hồi ngay `204 No Content` mà không đẩy job mới vào hàng đợi.
- Nếu email chưa xác thực: đẩy job `mail.email-verification` với payload `{ userId }` và `singletonKey: 'email-verification:' + userId`.
- Phản hồi `204 No Content` không kèm body. Vượt quá giới hạn rate limit → `429 TOO_MANY_REQUESTS`.

`POST /auth/email-verification/confirm` (public, rate limit 10 lần / phút / IP):
- Body: `{ "token": string }` (43 ký tự base64url unpadded, kiểm tra bằng regex `/^[A-Za-z0-9_-]{43}$/`).
- Thực thi trong một database transaction:
  1. Claim token: `UPDATE "EmailVerificationToken" SET "usedAt" = CURRENT_TIMESTAMP WHERE "tokenHash" = $1 AND "usedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP RETURNING "userId"`.
  2. Cập nhật user: `UPDATE "User" SET "emailVerifiedAt" = COALESCE("emailVerifiedAt", CURRENT_TIMESTAMP) WHERE id = $2 AND "deletedAt" IS NULL AND status = 'active' RETURNING id`.
- Thành công: phản hồi `204 No Content`.
- Thất bại: nếu có 0 dòng cập nhật ở bất kỳ bước nào (token không khớp, token hết hạn, token đã dùng trước đó, hoặc tài khoản đã bị khoá / soft-delete), transaction rollback hoàn toàn và trả về lỗi `400 BAD_REQUEST` với mã lỗi chung duy nhất:
  `{ "success": false, "error": { "code": "INVALID_VERIFICATION_TOKEN", "message": "Verification token is invalid or expired." } }`.
  Phản hồi không phân biệt nguyên nhân nhằm ngăn chặn tấn công user enumeration hoặc dò tìm trạng thái token.
- Cơ chế khoá dòng của PostgreSQL đảm bảo an toàn tuyệt đối khi có nhiều request đồng thời gửi cùng một token: chỉ duy nhất một request thành công (204), các request còn lại nhận 400.

`POST /auth/password-reset/request` (public, 5 lần / 15 phút / IP, 3 lần / giờ / SHA-256 email):
- Body: `{ "email": string(email) }`.
- Email được chuẩn hoá bằng `trim().toLowerCase()`.
- Luôn trả về `204 No Content` không kèm body (kể cả khi email không tồn tại hoặc tài khoản không active/đã soft-delete).
- Rate limit hai lớp:
  - 5 lần / 15 phút theo IP client (vượt quá → `429 TOO_MANY_REQUESTS`).
  - 3 lần / giờ theo SHA-256 của email đã chuẩn hoá (`PostgresThrottlerStorage`). Khi vượt quá giới hạn theo email, endpoint vẫn trả về `204 No Content` và âm thầm không enqueue job để chống dò email mục tiêu (anti-enumeration).
- Response của endpoint hoàn toàn giống hệt nhau (status, body, header) giữa trường hợp email có tồn tại và không tồn tại.
- Khi user tồn tại, `deletedAt IS NULL`, `status = 'active'`, enqueue job `mail.password-reset` với payload `{ userId }` và `singletonKey: 'password-reset:' + userId`.

`POST /auth/password-reset/confirm` (public, rate limit 10 lần / phút / IP):
- Body: `{ "token": string, "newPassword": string(≥6) }`.
- `newPassword` kiểm tra blacklist mật khẩu yếu (`assertPasswordNotBlacklisted`); mật khẩu mới được băm bằng Argon2id TRƯỚC khi mở database transaction.
- Thực thi trong một database transaction:
  1. Claim token: `UPDATE "PasswordResetToken" SET "usedAt" = CURRENT_TIMESTAMP WHERE "tokenHash" = $1 AND "usedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP RETURNING "userId"`.
  2. Đổi mật khẩu: `UPDATE "User" SET password = $hash WHERE id = $userId AND "deletedAt" IS NULL AND status = 'active' RETURNING id`.
  3. Thu hồi toàn bộ session còn hiệu lực của user: `UPDATE "UserSession" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "userId" = $userId AND "revokedAt" IS NULL`. Vì `JwtStrategy` kiểm tra `sid` ở mỗi request nên mọi access token cũ bị vô hiệu hoá ngay lập tức.
  4. Xoá mọi reset token chưa sử dụng khác của user: `DELETE FROM "PasswordResetToken" WHERE "userId" = $userId AND "usedAt" IS NULL`.
- Thành công: phản hồi `204 No Content`. Không tự động đăng nhập sau khi đặt lại mật khẩu.
- Thất bại: nếu có 0 dòng ở bước 1 hoặc bước 2 (token sai, hết hạn, đã dùng, hoặc user suspended/soft-deleted), transaction rollback hoàn toàn và trả về `400 BAD_REQUEST` với mã lỗi chung duy nhất:
  `{ "success": false, "error": { "code": "INVALID_RESET_TOKEN", "message": "Password reset token is invalid or expired." } }`.
  Rollback đảm bảo nếu user bị suspended thì token chưa bị đánh dấu đã dùng (`usedAt` vẫn là null).
- Không can thiệp vào các trường lockout (`failedLoginAttempts`, `lockUntil`).

`data` của register/login (`201`) và refresh (`200`):

```json
{
  "user": { "id": 1, "email": "user@example.com", "role": "user", "name": null },
  "accessToken": "<jwt>",
  "refreshToken": "<base64url-43-chars>",
  "refreshTokenExpiresAt": "2026-10-29T12:00:00.000Z"
}
```

`data` của `GET /auth/me` (`200`): `{ "user": { "id": 1, "email": "user@example.com", "role": "user" } }`.

### A.3 Users

| Method | Path | Auth | Query | Response |
| --- | --- | --- | --- | --- |
| `GET` | `/users/me` | JWT | — | `{ id, email, name, role, createdAt }` |
| `GET` | `/users/me/profile` | JWT | — | `{ displayName, locale, timezone }` |
| `PATCH` | `/users/me/profile` | JWT | — | `{ displayName, locale, timezone }` |
| `POST` | `/users/me/deletion-request` | JWT | — | `{ requestId, scheduledAt }` (HTTP 202) |
| `POST` | `/users/me/data-exports` | JWT | — | `{ exportId, status }` (HTTP 202) |
| `GET` | `/users/me/data-exports` | JWT | — | `[{ id, status, createdAt, completedAt, outputExpiresAt, downloadable }]` |
| `GET` | `/users/me/data-exports/:id/download` | JWT | — | file JSON nhị phân (`application/json; charset=utf-8`) |
| `GET` | `/users` | admin | `page`, `limit` | `[{ id, email, name, role, createdAt }]` + `meta` |

- `GET /users` (H.8, B-05): sort `id ASC`, `skip = (page - 1) * limit`. Bỏ mọi user có
  `deletedAt` khỏi cả `data` và `meta.pagination.total`; user
  `suspended`/`deletion_pending` chưa có `deletedAt` vẫn hiện. `totalPages =
  ceil(total / limit)` (`0` khi rỗng); `page` vượt `totalPages` → `200` với `data: []`.
  Non-admin → `403`. H.10a chuyển phân trang từ object trần `{ items, total, … }` sang
  `meta.pagination`.
- `GET /users/me` chỉ đọc account `status = active` và `deletedAt IS NULL`. Account đã
  soft-delete hoặc không active bị JWT strategy chặn `401` trước; nếu account đổi trạng
  thái giữa strategy và service thì service trả `404 "User not found."`.
- Không trả `password`, `failedLoginAttempts`, `lockUntil` hay trạng thái credential khác.
- `GET /users/me/profile` (`JwtAuthGuard`): đọc hồ sơ người dùng `{ displayName: string | null, locale: string, timezone: string }`.
  - Chưa có dòng `UserProfile` trong database → trả giá trị mặc định `{ displayName: null, locale: "vi-VN", timezone: "Asia/Ho_Chi_Minh" }`, tuyệt đối không tạo dòng mới khi đọc.
  - User bị xoá (soft-delete) hoặc inactive → `404 "User not found."` (nếu không bị JWT guard chặn `401` trước). Không có token → `401`.
- `PATCH /users/me/profile` (`JwtAuthGuard`): cập nhật hồ sơ cá nhân với các trường tuỳ chọn `displayName`, `locale`, `timezone`. Trả về hồ sơ sau khi cập nhật.
  - Body rỗng `{}` → `400 "Request body must not be empty."`.
  - Field lạ (ví dụ `avatarUrl`, `userId`) → `400` với mã lỗi `REQUEST_VALIDATION_FAILED` (xử lý bởi `ValidationPipe` với `forbidNonWhitelisted`). Không có trường `avatarUrl` ở cả GET lẫn PATCH API.
  - `displayName`: kiểu `string | null`. Chuỗi được `trim()`, độ dài sau trim từ 1–50 ký tự Unicode code points (đếm theo code point thay vì UTF-16 code units); gửi `null` để xoá tên hiển thị; chuỗi rỗng sau trim → `400`; chặn ký tự điều khiển `\p{Cc}` và ký tự bidi override (U+202A–U+202E, U+2066–U+2069) → `400`; hỗ trợ tiếng Việt có dấu và chữ Hán.
  - `locale`: chỉ chấp nhận hằng số `SUPPORTED_LOCALES = ['vi-VN'] as const`. Giá trị khác (như `en-US`) → `400`.
  - `timezone`: tên IANA hợp lệ (1–64 ký tự). Phải khớp định dạng chuẩn IANA (ví dụ `Asia/Ho_Chi_Minh`, `UTC`, `Etc/GMT+7`, `America/Argentina/Buenos_Aires`), xác thực qua `new Intl.DateTimeFormat('en-US', { timeZone })` và lưu nguyên bản giá trị gửi lên (không tự ý chuẩn hoá hay đổi tên vùng). Định dạng không khớp (như `asia/ho_chi_minh`, `+07:00`, `EST5EDT`), tên không hợp lệ hoặc chuỗi > 64 ký tự → `400`.
  - Xử lý race an toàn: nhiều request PATCH đồng thời cho user chưa có profile sử dụng parameterized atomic upsert (`INSERT ... ON CONFLICT ("userId") DO UPDATE`), tự động gán `"updatedAt" = CURRENT_TIMESTAMP`, đảm bảo không bao giờ ném lỗi `500` hay tạo dòng trùng lặp.
  - Cách ly tuyệt đối giữa các user: người dùng chỉ đọc và sửa được hồ sơ của chính mình thông qua JWT token. Không có route nhận user id tuỳ ý.
- `POST /users/me/deletion-request` (`JwtAuthGuard`, rate limit `@Throttle(5/15m)` theo user id): Yêu cầu xoá tài khoản với thời gian chờ 7 ngày (Product Owner chốt 30/09/2026).
  - Body: `{ password: string, reason?: string }` (`reason` tuỳ chọn, tối đa 500 ký tự).
  - Xác thực mật khẩu: Sai mật khẩu hiện tại → trả về HTTP `400` với mã lỗi `INVALID_PASSWORD` và message `'Invalid password'`. Không trả `401` để tránh BFF xoá session của người dùng.
  - User không `active` hoặc đã soft-delete (`deletedAt IS NOT NULL`) → trả về `404 "User not found."`.
  - Thành công: trả về HTTP `202 Accepted` với `{ requestId: number, scheduledAt: string }` (thời điểm lên lịch xoá sau 7 ngày).
  - Trạng thái hệ thống:
    - User chuyển sang `status = 'deletion_pending'` và gán `deletedAt = CURRENT_TIMESTAMP`.
    - Toàn bộ `UserSession` hiện tại bị thu hồi (`revokedAt = CURRENT_TIMESTAMP`), các token reset mật khẩu hoặc xác minh email chưa dùng bị xoá. Access token cũ bị từ chối với `401 Unauthorized` ngay lập tức.
    - Hai job nền được enqueue trong transaction: `privacy.anonymize-account` (`startAfter` = `scheduledAt`, `singletonKey = 'anonymize:' + requestId`) và `mail.account-deletion-scheduled` (`singletonKey = 'deletion-mail:' + requestId`).
    - Idempotent: gọi trùng khi đã có request ở trạng thái `requested` sẽ trả lại request hiện có mà không tạo dòng mới.
- Huỷ yêu cầu xoá bằng đăng nhập (`POST /auth/login`):
  - Trong thời gian chờ 7 ngày (`scheduledAt > CURRENT_TIMESTAMP`), người dùng đăng nhập lại đúng mật khẩu sẽ tự động huỷ yêu cầu xoá:
    - Yêu cầu cập nhật `status = 'cancelled'`, `cancelledAt = CURRENT_TIMESTAMP`.
    - User được kích hoạt lại: `status = 'active'`, `deletedAt = NULL`, các bộ đếm khoá đăng nhập được xoá.
    - Đăng nhập thành công trả về HTTP 200/201 cùng token phiên mới bình thường.
  - Sai mật khẩu trong thời gian chờ → trả về HTTP `401 Unauthorized`, yêu cầu xoá vẫn giữ nguyên trạng thái `requested`.
  - Đã quá hạn 7 ngày (`scheduledAt <= CURRENT_TIMESTAMP`), đăng nhập bị chặn (trả về HTTP `401` qua decoy hash) và worker sẽ thực hiện ẩn danh tài khoản theo ADR-001.
- `POST /users/me/data-exports` (`JwtAuthGuard`): Yêu cầu xuất dữ liệu cá nhân của người dùng thành một file JSON lưu trữ trong bucket private.
  - User phải ở trạng thái `active`, `deletedAt IS NULL`, nếu không trả về HTTP `404 "User not found."`.
  - Rate limit: Tối đa 1 export / 24 giờ / user. Nếu đã có export job trong vòng 24 giờ (`createdAt > CURRENT_TIMESTAMP - INTERVAL '24 hours'`) có trạng thái `requested`, `processing`, hoặc `completed` → trả về HTTP `429 Too Many Requests` với mã lỗi `EXPORT_RATE_LIMITED`. Export ở trạng thái `failed` không tính vào giới hạn này.
  - Thành công: trả về HTTP `202 Accepted` với `{ exportId: number, status: 'requested' }`, đồng thời transactional enqueue job `privacy.data-export` với `singletonKey: 'export:' + exportId`.
- `GET /users/me/data-exports` (`JwtAuthGuard`): Lấy danh sách tối đa 10 lượt xuất dữ liệu gần nhất của chính người dùng, sắp xếp mới nhất trước (`createdAt DESC`).
  - Trả về danh sách gồm các trường: `{ id, status, createdAt, completedAt, outputExpiresAt, downloadable }`.
  - `downloadable` là cờ boolean (`status = 'completed'` và `outputExpiresAt > CURRENT_TIMESTAMP` và còn file lưu trữ).
  - Không bao giờ trả về `outputStorageKey` hay `errorMessage`.
- `GET /users/me/data-exports/:id/download` (`JwtAuthGuard`): Tải file dữ liệu JSON đã xuất.
  - Chỉ cho phép tải khi file xuất thuộc sở hữu của chính người dùng, `status = 'completed'`, chưa quá hạn 24 giờ (`outputExpiresAt > CURRENT_TIMESTAMP`) và còn `outputStorageKey`.
  - Mọi trường hợp khác (export không tồn tại, của người dùng khác, chưa xong, hoặc đã hết hạn) đều trả về HTTP `404` đồng nhất.
  - Xác thực tính toàn vẹn: kiểm tra checksum SHA-256 từ storage khớp với nội dung thực tế; nếu lệch trả về HTTP `500` và không trả nội dung.
  - Header bảo mật bắt buộc:
    - `Content-Type: application/json; charset=utf-8`
    - `Content-Disposition: attachment; filename="hsk-data-export-<id>.json"`
    - `Cache-Control: no-store`
    - `X-Content-Type-Options: nosniff`

```json
{
  "items": [{ "id": 1, "email": "user@example.com", "name": null, "role": "user", "createdAt": "2026-09-14T03:00:00.000Z" }],
  "total": 41,
  "page": 1,
  "limit": 20,
  "totalPages": 3
}
```

### A.4 Public learning content

Tất cả `public`, envelope `{ success: true, data, meta? }`. Chỉ trả content `published`
và `deletedAt IS NULL`. Lesson phải đạt readiness: Lesson và Level published, có ít nhất
một Topic hoặc Story published.

| Method | Path | Query | `data` |
| --- | --- | --- | --- |
| `GET` | `/levels`, `/learning/levels` | — | `[{ id, name, orderIndex, code, minBand, maxBand }]` |
| `GET` | `/lessons`, `/learning/lessons` | `levelId` **bắt buộc**, `page`, `limit` | `[{ id, title, description, orderIndex, slug }]` + `meta` |
| `GET` | `/lessons/:id`, `/learning/lessons/:id` | — | Lesson detail; `404` nếu không ready |
| `GET` | `/topics`, `/learning/topics` | `lessonId` **bắt buộc**, `page`, `limit` | `[{ id, lessonId, title, content, orderIndex }]` + `meta` |
| `GET` | `/stories`, `/learning/stories` | `levelId` **bắt buộc**, `page`, `limit` | `[{ id, levelId, title, content, slug }]` + `meta` |
| `GET` | `/learning/test` | — | `"Learning module working"` (smoke, sẽ xoá — B-10) |

Hai bộ route (`/levels` và `/learning/levels`…) gọi cùng service; sẽ giữ một bộ (D-07).

Lesson detail `data`:

```json
{
  "id": 12, "title": "Bài 1",
  "level": { "id": 3, "name": "HSK 3", "orderIndex": 3 },
  "topics": [{ "id": 34, "title": "…", "content": [], "orderIndex": 1 }],
  "words": [{ "id": 9, "hanzi": "学习", "traditional": null, "pinyin": "xué xí", "pinyinTone": "xue2 xi2",
              "meanings": [{ "en": "to study", "vi": "học" }] }],
  "stories": [{ "id": 5, "title": "…", "content": [], "slug": "…" }],
  "exercises": [{ "id": 99, "type": "mcq", "prompt": "…", "content": {}, "version": 1, "orderIndex": 1,
                  "media": { "id": 7, "url": "…", "type": "audio", "mimeType": "audio/mpeg", "duration": 12 } }]
}
```

`exercises[].media` chỉ khác `null` với `listening_choice` có audio ready. Không bao giờ
trả `answer`/`explanation`. `speaking_repeat` không xuất hiện public.

### A.5 Dictionary

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/dictionary?query=<hanzi hoặc pinyin>` | public |

Prefix match trên `hanzi` (khi query chứa ký tự `㐀-鿿`) hoặc `pinyinNormalized`.
Query rỗng hoặc chứa ký tự ngoài `[a-zA-Z1-5:üÜ' ]`/hanzi → trả `[]` (không `400`). Tối
đa 20 kết quả; chỉ Word `published`, `isPure = true`, có ít nhất một meaning.

`data` `200` là mảng, không `id`:

```json
[{ "hanzi": "学习", "pinyin": "xué xí", "pinyinTone": "xue2 xi2",
   "meanings": [{ "en": "to study", "vi": "học tập" }], "level": "HSK 1" }]
```

### A.6 Onboarding và Learning plan (JWT)

Envelope §1. `userId` luôn lấy từ JWT. Write khoá row `User`
`FOR UPDATE`.

| Method | Path | Body | `data` | Status |
| --- | --- | --- | --- | --- |
| `GET` | `/onboarding/status` | — | `{ hasActiveGoal, hasActiveLearningPlan, hasUsableLearningPlan, hasCompletedPlacement, nextStep }` | 200 |
| `GET` | `/onboarding/goals/current` | — | `UserGoal` hoặc `null` | 200 |
| `POST` | `/onboarding/goals` | `CreateGoal` | `UserGoal` (idempotent nếu trùng goal hiện hành) | 201 |
| `GET` | `/learning-plans/current` | — | `LearningPlan` hoặc `null` | 200 |
| `POST` | `/learning-plans` | `{}` | `LearningPlan` | 201 |

`nextStep ∈ set_goal | content_unavailable | generate_plan | ready`. `hasCompletedPlacement`
true khi có `PlacementAttempt` status `completed`; hiện chưa có API tạo placement.

`CreateGoal`: `targetLevelId` int ≥ 1 (level phải published) · `targetBand?` int 1–9 trong
`minBand..maxBand`, bắt buộc với `HSK7_9` · `dailyMinutes` int 1–1440 · `learningPurpose?`
`communication` | `study_abroad` | `hsk_exam` | `work` (tuỳ chọn, `null` khi không gửi) ·
`reminderEnabled` boolean · `reminderTime?` `HH:mm`, bắt buộc khi enabled, phải bỏ khi disabled ·
`startDate` `YYYY-MM-DD`.

`UserGoal`: `{ id, targetLevelId, targetBand, dailyMinutes, learningPurpose, reminderEnabled,
reminderTime, startDate, isActive, createdAt, updatedAt, targetLevel: { id, code, name, minBand, maxBand } }`.

`LearningPlan`: `{ id, targetLevelId, targetBand, generatedFromPlacementId, status, startDate,
endDate, createdAt, updatedAt, targetLevel, items: [{ id, orderIndex, scheduledDate, status,
lesson: { id, title, description, orderIndex, slug } }] }` — items chỉ gồm Lesson còn ready.

Lỗi: `400` DTO/band/thiếu goal; `404` level không public; `409` không còn Lesson ready hoặc
dữ liệu cần repair.

### A.7 Lesson activity và Progress (JWT)

Envelope §1. Mọi `POST` cần header `Idempotency-Key`; thiếu/sai →
`400`; trả `201` kể cả replay. Body `{}` trừ attempt.

| Method | Path | Body | `data` |
| --- | --- | --- | --- |
| `GET` | `/learning/path` | — | Path (dưới); header `Cache-Control: no-store` |
| `POST` | `/learning/lessons/:lessonId/start` | `{}` | `{ lessonId, status: "learning", eventId, occurredAt }`; `409 lesson_locked` khi bài đang khoá (Q18) |
| `GET` | `/learning/lessons/:lessonId/activity` | — | Activity (dưới) |
| `POST` | `/learning/lessons/:lessonId/complete` | `{}` | `{ lessonId, status: "done", eventId, occurredAt }` |
| `POST` | `/learning/topics/:topicId/start` | `{}` | `{ topicId, status: "learning", eventId, occurredAt }` |
| `POST` | `/learning/topics/:topicId/complete` | `{}` | `{ topicId, status: "done", eventId, occurredAt }` |
| `POST` | `/learning/exercises/:exerciseId/attempts` | `{ answer, durationSeconds?: 0..86400 }` | `Attempt` |
| `GET` | `/learning/exercises/:exerciseId/attempts` | — | `Attempt[]` (attemptNumber ASC) |
| `GET` | `/progress/lessons` | — | `Progress[]` (lastActivityAt DESC) |
| `GET` | `/progress/lessons/:lessonId` | — | `Progress` + `currentTopicId`, `currentExerciseId`; `404` nếu chưa có |

`Attempt`: `{ attemptId, exerciseId, attemptNumber, isCorrect, score (100|0), durationSeconds,
exerciseVersion, feedbackVersion, explanation, media, submittedAt }` — không `userId`, không
raw answer.

`Progress`: `{ lessonId, status (not_started|learning|done), score, completionPercent,
timeSpentSeconds, startedAt, completedAt, lastActivityAt, lesson: { title, slug } }`.
Score bài học là trung bình điểm tốt nhất của các bài **đã làm** (D-03).

Activity `data`: `{ lesson: { id, title, description, slug, orderIndex, levelId }, progress,
topics: [{ …topic, progress: {…}, exercises: PublicExercise[] }], standaloneExercises:
PublicExercise[], currentTopic | null, currentExercise | null, nextAction }`.
`PublicExercise` = projection public + `topicId` + `latestAttempt: Attempt | null`.
`nextAction ∈ start_lesson | submit_exercise | complete_topic | complete_lesson | completed`.

Path `data` (Q18, chỉ đọc, không ghi DB): `{ nextStep, goal, levels, nextLesson }`.
- `nextStep ∈ set_goal | content_unavailable | generate_plan | ready`, cùng giá trị
  `GET /onboarding/status`.
- `goal`: `{ targetLevelCode, targetBand, learningPurpose } | null`; `targetLevelCode` là code
  của cấp mục tiêu kể cả khi cấp đó không còn published; `targetBand` có thể `null`.
- `levels`: mọi Level published và chưa xoá như `GET /learning/levels` (kể cả cấp chưa có bài,
  `lessons: []`): `[{ id, code, name, orderIndex, lessonCount, completedCount, lessons: [{ id,
  title, slug, position, state, completionPercent }] }]`. Chỉ Lesson ready; không trả
  `coverImageId`, không có XP. `position` = 1..N theo `[orderIndex ASC, id ASC]` của bài ready;
  `completionPercent` lấy từ Progress, chưa có row là `0`.
- Mở khoá: bài `position = 1`, hoặc bài ready liền trước có Progress `done`, hoặc chính bài đó
  đã có row Progress (mọi status). `state`: `done` (Progress `done`); `current` (tối đa 1 bài
  mỗi cấp: bài mở có Progress `learning` với `lastActivityAt` mới nhất, null xếp cuối, hoà thì
  `position` nhỏ hơn; không có thì bài mở đầu tiên chưa `done`); `available` (mở, chưa `done`,
  không phải current); `locked` (còn lại).
- `nextLesson`: `{ lessonId, title, slug, levelCode, position } | null`: bài `learning` có
  `lastActivityAt` mới nhất trên mọi cấp; không có thì `current` của cấp mục tiêu; cấp mục tiêu
  xong hết hoặc rỗng thì `current` của cấp đầu tiên có `orderIndex` lớn hơn cấp mục tiêu **và
  có `current`**; cũng áp dụng khi cấp mục tiêu không còn published; không có thì `null`. Chưa có goal thì chỉ xét bước đầu.
- Admin có JWT gọi được như mọi route JWT khác của A.7.

Khoá ở `start` (Q18): bài chưa có row Progress mà bài ready liền trước chưa `done` (và không
phải bài đầu cấp) trả `409` `error.code = "lesson_locked"`, message `Complete the previous
lesson first.`. Thứ tự lỗi:
1. `400` thiếu `Idempotency-Key` hoặc key sai format (chặn trước mọi thứ);
2. `404` bài không ready;
3. `400` key hết hạn, `201` replay (kết quả cũ), `409` key đã dùng cho request khác;
4. `409 CONFLICT` bài đã được start bằng key khác;
5. `409 lesson_locked`.

`409
lesson_locked` rollback cả transaction: không tạo Progress hay event, plan item giữ `planned`,
key không bị tiêu (gọi lại cùng key sau khi bài trước xong sẽ thành công). `GET
/learning/lessons/:lessonId/activity` không phản ánh khoá: `nextAction` vẫn có thể là
`start_lesson` cho bài đang khoá; frontend dựa vào `GET /learning/path`. Topic start, attempt
và complete trên bài chưa start vẫn trả `409` `Lesson must be started first.`.

Answer theo type: `mcq`/`listening_choice` `{ optionId }`; `fill_blank` `{ text }`;
`arrange_sentence` `{ tokenIds: [] }`; `speaking_repeat` → `422`. Lỗi: `404` content không
public; `409` cùng key khác request; `409 lesson_locked` start bài đang khoá; `422` shape sai;
`503` timeout.

### A.8 Admin CMS — Lesson / Topic (admin)

Envelope §1 (list có `meta.pagination`). Mọi `POST` trả `201` kể cả `idempotent = true`.
State machine: draft revision → review (`approved | changes_requested | rejected`) → publish
revision đã approved mới nhất → archive. Revision/review/audit append-only.

| Method | Path | Query/Body | `data` |
| --- | --- | --- | --- |
| `GET` | `/admin/cms/lessons` | `levelId?`, `status?`, `search?` (1–200), `page`, `limit` | `[{ …LessonAdmin, latestRevision }]` + `meta` |
| `GET` | `/admin/cms/lessons/:lessonId` | — | `{ lesson, revisions }` |
| `POST` | `/admin/cms/lessons` | `CreateLesson` | `{ lesson, revision, idempotent: false }` |
| `POST` | `/admin/cms/lessons/:lessonId/revisions` | `LessonRevision` | `{ lesson, revision, idempotent }` |
| `POST` | `/admin/cms/lessons/:lessonId/revisions/:revisionId/reviews` | `{ decision, note? ≤2000 }` | `{ revision, review, idempotent }` |
| `POST` | `/admin/cms/lessons/:lessonId/revisions/:revisionId/publish` | — | `{ lesson, revision, idempotent }` |
| `POST` | `/admin/cms/lessons/:lessonId/archive` | — | `{ lesson, idempotent }` |
| `GET` | `/admin/cms/topics/:topicId` | — | `{ topic, revisions }` |
| `POST` | `/admin/cms/topics` | `CreateTopic` | `{ topic, revision, idempotent: false }` |
| `POST` | `/admin/cms/topics/:topicId/revisions` | `TopicRevision` | `{ topic, revision, idempotent }` |
| `POST` | `/admin/cms/topics/:topicId/revisions/:revisionId/reviews` | `{ decision, note? }` | `{ revision, review, idempotent }` |
| `POST` | `/admin/cms/topics/:topicId/revisions/:revisionId/publish` | — | `{ topic, revision, idempotent }` |
| `POST` | `/admin/cms/topics/:topicId/archive` | — | `{ topic, idempotent }` |

Không có `GET /admin/cms/topics` (list).

`LessonRevision`: `title` 1–200 · `description?` ≤2000 · `orderIndex` 1–1 000 000 · `slug`
1–160 kebab-case. `CreateLesson` = `LessonRevision` + `levelId`.
`TopicRevision`: `title` 1–200 · `subtitle?` ≤500 · `type` (`TopicType`) · `content` JSON
≤100 000 byte, depth ≤20 · `orderIndex` · `isPremium`, `isLocked` boolean. `CreateTopic` =
`TopicRevision` + `lessonId`.

`LessonAdmin`: `{ id, levelId, title, description, orderIndex, slug, status, createdById,
updatedById, publishedById, publishedAt, deletedAt, createdAt, updatedAt }`.

Lỗi: `400` DTO; `403` role; `404` entity; `409` stale/không approved/unique; `503` lock
timeout. Lock order và hash: ADR-002, overview §3.4.

### A.9 Admin CMS — Exercise và Import (admin)

| Method | Path | Query/Body/Header | `data` |
| --- | --- | --- | --- |
| `GET` | `/admin/cms/exercises` | `lessonId?`, `topicId?`, `type?`, `status?`, `page`, `limit` | `[{ …ExerciseAdmin, latestRevision }]` + `meta` |
| `GET` | `/admin/cms/exercises/:exerciseId` | — | `{ …ExerciseAdmin, revisions }` |
| `POST` | `/admin/cms/exercises` | `CreateExercise` | `{ exercise, revision, idempotent: false }` |
| `POST` | `/admin/cms/exercises/:exerciseId/revisions` | `ExerciseRevision` | `{ exercise, revision, idempotent }` |
| `POST` | `/admin/cms/exercises/:exerciseId/revisions/:revisionId/reviews` | `{ decision, note? }` | `{ revision, review, idempotent }` |
| `POST` | `/admin/cms/exercises/:exerciseId/revisions/:revisionId/publish` | — | `{ exercise, revision, idempotent }` |
| `POST` | `/admin/cms/exercises/:exerciseId/archive` | — | `{ exercise, idempotent }` |
| `POST` | `/admin/cms/exercise-imports/preview` | `ImportBody` | `{ totalRows, validRows, invalidRows, errors: [{ rowNumber, code, path }], previewHash }` (không ghi DB) |
| `POST` | `/admin/cms/exercise-imports` | `ImportBody` + `previewHash`; header `Idempotency-Key` 8–128 (thiếu → `422`) | `{ importJob, exercises, importedRows, idempotent }` (all-or-nothing) |

`ExerciseRevision`: `type` ∈ `mcq | fill_blank | listening_choice | arrange_sentence |
speaking_repeat` · `prompt` 1–4096 · `content`, `answer` JSON ≤100 000 byte/depth 20 ·
`explanation?` ≤4096 · `orderIndex` · `mediaId?`. Shared validator sau DTO áp thêm giới hạn
canonical 65 536 byte/depth 8/string 4096/array 100 và exact-key theo type. `speaking_repeat`
chỉ lưu draft, không publish. `listening_choice` publish cần audio `ready`.
`CreateExercise` = + `lessonId`, `topicId?`. `ImportBody`: `dataSourceId`, `fileName` 1–255,
`rows` 1–100.

`ExerciseAdmin`: `{ id, lessonId, topicId, mediaId, type, prompt, content, answer,
explanation, version, orderIndex, status, dataSourceId, sourceKey, createdById, updatedById,
publishedById, publishedAt, deletedAt, createdAt, updatedAt, media: { id, url, type,
mimeType, duration, processingStatus, deletedAt } | null, lesson: { id, title, slug },
topic | null, dataSource | null }`.

### A.10 Admin Media Library và Ingestion (admin)

Response có `Cache-Control: no-store`.

| Method | Path | Input | `data` | Status |
| --- | --- | --- | --- | --- |
| `GET` | `/admin/cms/media` | `type?` (audio/image/pdf/video), `processingStatus?`, `lifecycle?` (active/archived), `dataSourceId?`, `page`, `limit` | `MediaAdmin[]` + `meta`; sort `updatedAt DESC, id DESC` | 200 |
| `GET` | `/admin/cms/media/:mediaId` | — | `MediaAdmin` + `usage: { lessonExercises: [{ id, lessonId, topicId, prompt, status }] (≤50), counts: { lessonExercises, otherContent } }` | 200 |
| `POST` | `/admin/cms/media/:mediaId/quarantine` | — | `{ idempotent, media }`; đã archived → `409` | 201 |
| `POST` | `/admin/cms/media/:mediaId/archive` | — | `{ idempotent, media }` | 201 |
| `POST` | `/admin/cms/media/ingestions?dataSourceId=` | `multipart/form-data`, đúng một field `file` ≤10 MiB (JPEG/PNG/MP3/WAV); header `Idempotency-Key` 32–128 | `{ idempotent, media: { id, type, mimeType, size, processingStatus } }` | 201 |
| `POST` | `/admin/cms/media/ingestions/:ingestionId/cleanup` | — | `{ ingestionId, cleanupCompleted: true }` hoặc `{ ingestionId, cleanupCompleted: false, settling: true }` | 201 |

`MediaAdmin`: `{ id, filename, type, mimeType, size, duration, processingStatus, lifecycle,
usageCount, dataSourceId, uploadedById, updatedById, deletedAt, createdAt, updatedAt,
dataSource: { id, code, name, version } }` — không URL, storageKey, checksum.

Ingestion: `MEDIA_INGESTION_ENABLED=false` → từ chối; giới hạn concurrency trong
process qua `MEDIA_INGESTION_MAX_CONCURRENCY` (1–16, mặc định 4): khi đầy slot → drain
có giới hạn; quá giới hạn hoặc quá hạn thì trả `503` rồi đóng; request không có body
thì trả `503`. `503` có `error.code` `MEDIA_INGESTION_BUSY`, `Retry-After: 1` và
`Connection: close`; 5 request/admin/phút → `429`; quá size → `413` `error.code`
`UPLOAD_TOO_LARGE`; multipart hỏng → `400` `error.code` `MULTIPART_INVALID`; client
ngắt trong khi upload body → client không nhận được response (kết nối đã đóng); không tạo
bản ghi ingestion; upload timeout → `408` `MEDIA_UPLOAD_TIMEOUT`; file bị reject →
`400/422`; đang processing hoặc cùng key khác request → `409`; scanner/storage timeout →
`503`. Sau khi đã nhận đủ body, client ngắt kết nối không huỷ công việc (việc tiếp tục
hoàn tất trong nền và retry với cùng `Idempotency-Key` được replay `201` với
`idempotent: true`). Pipeline: claim → sharp/music-metadata → ClamAV → reserve → put →
finalize. Chi tiết ADR-005 và runbook.

### A.11 Media signed access

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| `GET` | `/media/:mediaId/access` | JWT (admin, hoặc learner khi media được Exercise published tham chiếu) | `200` `data: { expiresAt, url }`; `url` tương đối `/api/v1/media/:id/content?expires=&signature=`; không đủ quyền → `403`; media không ready → `404` |
| `GET` | `/media/:mediaId/content?expires=<unix>&signature=<64 hex>` | public (capability URL; TTL learner cố định 60 giây, admin theo `MEDIA_ACCESS_TTL_SECONDS` 60–600 giây, mặc định 300) | bytes thô, không envelope, với `Content-Type`, `Content-Length`, `Content-Disposition: inline`, `Cache-Control: private, no-store`, `nosniff`, `X-Request-ID`; lỗi vẫn là envelope JSON: grant sai/hết hạn → `403`; `503` với `error.code` `MEDIA_STORAGE_UNAVAILABLE` / `MEDIA_STORAGE_PROVIDER_MISMATCH` / `MEDIA_STORAGE_INTEGRITY_ERROR` |

Signature = HMAC-SHA256 trên `method`, canonical path, `expiresAt`, checksum; so sánh
timing-safe; body được hash lại trước khi trả. Grant luôn ký bằng `MEDIA_SIGNING_SECRET`;
khi xoay secret, đặt secret cũ vào `MEDIA_SIGNING_SECRET_PREVIOUS` (chỉ dùng để verify)
cho tới khi hết TTL dài nhất rồi gỡ, nên URL đã phát không gãy giữa chừng. Grant vẫn chưa
gắn user (phần còn lại của finding B-07).

### A.12 Frontend BFF (same-origin Next.js)

Không thay base URL backend, không phải generic proxy. Mọi route mutation kiểm exact
`Origin`. Cookie `hsk_admin_session`: HttpOnly, SameSite=Lax, Path=/, Secure ở
production, `Max-Age ≤ JWT exp`. Fetch tới backend `no-store`, timeout 8 giây, chỉ trả
safe error kind/message/requestId. BFF parse envelope §1 của backend bằng zod
(`frontend/src/lib/api/backend-envelope.ts`; thiếu `meta.requestId` hay sai shape thì
request thất bại an toàn: route admin `503`, session login `500` và không set cookie) rồi trả browser shape riêng không đổi: `{ success: true, data }`, list
thêm `meta` là object phân trang; `meta` của backend không ra browser.

| Route | Method | Mục đích |
| --- | --- | --- |
| `/api/session/login` | `POST` | Origin + credentials → backend login → set cookie; response không có token |
| `/api/session/logout` | `POST` | Origin → xoá cookie |
| `/api/session/recover` | `POST` | Xoá cookie khi backend trả 401/403 (fail-closed) |
| `/api/session/me` | `GET` | Đối chiếu cookie với `/auth/me`. Chỉ xoá cookie khi backend trả 401/403; 5xx, timeout hay body sai giữ cookie và trả `503` (502/503/504) hoặc `500` (E-01). Không có UI consumer; Playwright dùng để kiểm header bảo mật |
| `/api/admin/media/:id/quarantine`, `/archive` | `POST` | Mutation an toàn có Origin check; UI dùng |

Trang admin đọc dữ liệu bằng Server Component gọi thẳng backend (`exercise-service.ts`,
`media-service.ts`), không qua BFF route. Bốn route `GET` `/api/admin/exercises`,
`/api/admin/exercises/:id`, `/api/admin/media`, `/api/admin/media/:id` không có consumer
nên đã bị xoá (H.14, E-01) để thu hẹp bề mặt tấn công; thêm lại route đọc cho client
component phải kèm redact `answer`/snapshot và `media.url` cùng test. Layout admin không
render lại khi điều hướng client, nên mỗi trang admin tự map lỗi backend `401` → login và
`403` → `/forbidden`.

## Part B — Dự kiến

Chưa có controller. Cột milestone theo roadmap §6. Endpoint đã triển khai: Part A và
spec sinh [`backend/openapi.json`](../../backend/openapi.json); endpoint dưới đây khi có
code sẽ tự vào spec đó.

| Method | Path | Mục đích | Milestone |
| --- | --- | --- | --- |
| `POST` | `/auth/refresh`; `GET` `/auth/sessions`; `DELETE` `/auth/sessions/:id` | Refresh/revoke session (UserSession) | M1 |
| `POST` | `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password` | Xác minh email, reset mật khẩu | M1 |
| `GET/PATCH` | `/users/me/profile`; `PATCH` `/users/me` | Hồ sơ | M1 |
| `POST/GET` | `/privacy/consents`, `/privacy/exports`, `/privacy/deletion-requests` | Privacy lifecycle (ADR-001) | M1 |
| `POST` | `/onboarding/placements`, `/onboarding/placements/:id/complete` | Placement (feature flag) | M2 |
| `PATCH` | `/learning-plans/items/:id` | Trạng thái item trong plan | M2 |
| `GET` | `/dictionary/words/:id`; `POST` `/dictionary/words/:id/save`; `PATCH` `/dictionary/words/:id/progress` | Chi tiết từ, lưu từ | M2–M3 |
| `GET` | `/review/due`; `POST` `/review/sessions`, `/review/cards/:id/grade` | SRS | M3 |
| CRUD | `/admin/cms/questions`, `/admin/cms/tests` | Exam authoring | M4 |
| `POST` | `/exam/tests/:id/attempts`; `PUT` `/exam/attempts/:id/answers/:key`; `GET` `/exam/attempts/:id`; `POST` `/exam/attempts/:id/submit`; `GET` `/exam/results/*` | Exam attempt flow (snapshot, autosave, resume, submit) | M4 |
| `GET/PATCH` | `/users` (phân trang), `/users/:id/role`, `/users/:id/lock` | Admin user lifecycle | M5 |
| CMS | Level/Story/Word/Question/Test mutation; generic import; scheduled publish | CMS completion | M5 |
| `GET` | `/admin/dashboard`, `/analytics/*` | Analytics first-party | M5 |
| `POST` | `/support/tickets`, `/reports` | Support / Trust & Safety | M5 |
| CRUD | `/materials`, `/materials/upload` | Tài liệu học | M7+ |
| `POST` | `/ai/chat`, `/ai/retrieve` | AI gateway (ADR-008 §6) | M7+ |

## Phụ lục

- Quyết định liên quan: [../adr/ADR-001…](../adr/ADR-001-IMMUTABLE-EVENT-RETENTION-AND-ACCOUNT-DELETION.md)
  (retention/deletion), [ADR-002](../adr/ADR-002-EXERCISE-AUTHORING-VERSION-MEDIA-IMPORT-ATOMICITY.md)
  (exercise/import), [ADR-003](../adr/ADR-003-FRONTEND-FOUNDATION-ADMIN-SESSION-BFF.md) (BFF),
  [ADR-004](../adr/ADR-004-MEDIA-ASSET-OPERATIONS-AND-ADMIN-LIBRARY.md) (media admin),
  [ADR-005](../adr/ADR-005-SECURE-MEDIA-INGESTION-OBJECT-STORAGE-PROCESSING.md) (ingestion),
  [ADR-006](../adr/ADR-006-HERMETIC-MEDIA-OPERATIONS-AND-PRIVATE-METRICS.md),
  [ADR-007](../adr/ADR-007-MEDIA-EVIDENCE-PRODUCER-TRUST-AND-FAIL-CLOSED-RECOVERY.md) (release evidence),
  [ADR-008](../adr/ADR-008-TECHNOLOGY-STACK-DECISIONS.md) (stack).
- Vận hành media: [../operations/MEDIA_INGESTION_RELEASE_RUNBOOK.md](../operations/MEDIA_INGESTION_RELEASE_RUNBOOK.md).
- Bản api.md cũ (1061 dòng, gồm đặc tả chưa triển khai) nằm trong lịch sử git trước
  04/09/2026.
