# API Specification — HSK System

## 0. Trạng thái tài liệu

Cập nhật 27/10/2026 theo HEAD `9de1eb0` (M4.2b: thêm `PUT /exam/attempts/:attemptId/answers/:questionKey`, `PUT /exam/attempts/:attemptId/answers`, `GET /exam/attempts/:attemptId/media-grants`). Tài liệu chia hai phần:

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
  call của BFF), admin users list và admin audit logs, public learning (`levels`, `lessons`,
  `topics`, `stories`) và `learning/path`, `learning/home`. Endpoint
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
  dictionary (trừ các route `…/save`), health và signed media content không cần token. JWT HS256 có header `kid`,
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
- Rate limit: mặc định 20 req/phút cho **mỗi route và mỗi user/IP**, không phải tổng chung
  mọi route (khoá throttler gồm controller, handler và tracker). Route có giới hạn riêng:
  `GET /auth/me` 120/phút/user, `POST /learning/exercises/:exerciseId/attempts`
  60/phút/user, `GET /dictionary`, `GET /dictionary/words/:id` và `GET /dictionary/words/:id/save`
  120/phút/user hoặc IP, `POST` và `DELETE /dictionary/words/:id/save` 60/phút/user (mục A.5), `GET /media/:mediaId/access` 120/phút/user,
  `GET /media/:mediaId/content` 60/phút/grant cộng trần 600/phút/IP (mục A.11),
  `POST /auth/register` 100/phút/IP, `POST /auth/login` 10/phút/IP,
  `POST /auth/refresh` 30/phút/IP, `POST /auth/email-verification/request` 3/15 phút,
  `POST /auth/email-verification/confirm` 10/phút/IP, `POST /auth/password-reset/request`
  5/15 phút/IP, `POST /auth/password-reset/confirm` 10/phút/IP,
  `POST /users/me/deletion-request` 5/15 phút, `POST /exam/tests/:testId/attempts` và
  `GET /exam/attempts/:attemptId` 60/phút/user, `PUT /exam/attempts/:attemptId/answers/:questionKey`
  240/phút/user, `PUT /exam/attempts/:attemptId/answers` 60/phút/user,
  `GET /exam/attempts/:attemptId/media-grants` 30/phút/user (mục A.9d). Khi `NODE_ENV=test`,
  mặc định và các route trên có giới hạn qua hàm (`authMeLimit`, `loginIpLimit`, …) nâng lên
  1.000 (trần IP của route media content nâng lên 10.000), **trừ** route exam của M4.2b: chỉ
  `POST /exam/tests/:testId/attempts` và `PUT /exam/attempts/:attemptId/answers/:questionKey`
  được nâng lên 1.000; `PUT /exam/attempts/:attemptId/answers` (60), `GET /exam/attempts/:attemptId`
  (60) và `GET /exam/attempts/:attemptId/media-grants` (30) giữ nguyên ở mọi môi trường. Các
  route ghi số cố định (3, 5 và `email-verification/confirm` 10) giữ nguyên. `429` với
  `error: { code: "TOO_MANY_REQUESTS", message: "ThrottlerException: Too Many Requests" }`. Khoá
  `user:<id>` khi bearer JWT hợp lệ (kid, chữ ký HS256, hạn; không tra DB), còn lại
  `ip:<req.ip>`. Các route ghi /IP luôn khoá theo IP. Route đếm theo user sẽ đếm theo IP
  khi request không có bearer hợp lệ (không gửi bearer, hoặc token sai chữ ký hay hết
  hạn; token còn hạn nhưng session đã bị thu hồi vẫn đếm theo user). `req.ip` lấy từ
  `X-Forwarded-For` qua `TRUST_PROXY_HOPS` (mặc định 1: nginx hoặc BFF). Bộ đếm là
  cửa sổ cố định lưu ở bảng PostgreSQL `RateLimitCounter`, dùng chung mọi replica;
  vượt giới hạn thì khoá hết thời gian `ttl` của route (60 giây hoặc 15 phút), hit
  trong lúc bị khoá không được đếm. Mỗi request thêm một câu upsert; lỗi database làm request thất bại
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

| Method | Path | Auth | Throttle |
| --- | --- | --- | --- |
| `GET` | `/dictionary?query=<hanzi, pinyin hoặc nghĩa Việt/Anh>` | public | 120/phút/user hoặc IP (`dictionaryReadLimit`, 1.000 khi `NODE_ENV=test`) |
| `GET` | `/dictionary/words/:id` | public | 120/phút/user hoặc IP (cùng `dictionaryReadLimit`) |
| `GET` | `/dictionary/words/:id/save` | JWT | 120/phút/user (cùng `dictionaryReadLimit`) |
| `POST` | `/dictionary/words/:id/save` | JWT, header `Idempotency-Key` bắt buộc | 60/phút/user (`wordSaveLimit`, 1.000 khi `NODE_ENV=test`) |
| `DELETE` | `/dictionary/words/:id/save` | JWT | 60/phút/user (cùng `wordSaveLimit`) |

"Từ public" = Word `published`, chưa soft-delete, `isPure = true`, có ít nhất một meaning
(`PUBLIC_WORD_WHERE` trong `modules/dictionary`, dùng chung cho cả 5 route). Không route
nào đặt header cache.

**Search.** Query được chuẩn NFC rồi `trim`; hợp lệ khi dài 1–64 ký tự và:

- có ký tự hanzi `㐀-鿿`: chỉ gồm hanzi, `[a-zA-Z1-5:üÜ' ]`;
- không có hanzi: chỉ gồm chữ Latin có hoặc không dấu, số `1-5`, dấu cách, `'`, `:`.

Query không hợp lệ (rỗng, `<script>`, `%`, quá 64 ký tự, …) → `[]` với `200` (không `400`).
"Có cấp HSK" = từ có ít nhất một Level `published`, chưa soft-delete (cùng điều kiện với
`level` trong response). Mỗi request tối đa 3 truy vấn DB.

- **Hanzi:** `hanzi` bắt đầu bằng query. Thứ tự: cấp HSK thấp hơn trước (theo `orderIndex` của Level published), từ không có cấp xếp sau; `hanzi` ngắn trước,
  rồi `hanzi`, rồi `id`. Tối đa 20.
- **Latin**, tối đa 20 từ, không trùng `id`, nhóm 1 trước rồi nhóm 2 lấp chỗ còn lại:
  1. Pinyin: `pinyinNormalized` bắt đầu bằng query đã chuẩn pinyin (bỏ số thanh, chữ
     thường, `ü` → `u:`). Chỉ chạy khi query không có dấu tiếng Việt (gồm toàn ký tự
     `[a-zA-Z1-5:üÜ' ]`). Thứ tự: cấp HSK thấp hơn trước (theo `orderIndex` của Level published), từ không có cấp xếp sau; khớp trọn (`pinyinNormalized` bằng
     query) trước, pinyin ngắn trước, rồi `pinyinNormalized`, rồi `id`.
  2. Nghĩa: chạy khi query sau chuẩn nghĩa (bỏ dấu, `đ` → `d`, chữ thường, gộp khoảng
     trắng) dài ≥ 2 ký tự và nhóm 1 chưa đủ 20; chỉ gồm từ chưa có ở nhóm 1. Một meaning
     khớp khi `meaningViNormalized` hoặc `meaningEnNormalized` khớp **đầu từ**: cột bắt
     đầu bằng query, hoặc chứa query ngay sau một ký tự không phải chữ/số. Query có dấu
     còn khớp đầu từ `meaningViNormalized` với query viết thường giữ dấu, cho dòng cũ do
     backfill P0 chuẩn hoá giữ dấu. Thứ tự: khớp chính xác trước (cột bằng query, bằng
     `"to " + query`, hoặc bằng query giữ dấu), cấp HSK thấp hơn trước (theo `orderIndex`
     của Level published), từ không có cấp xếp sau, nghĩa khớp ngắn nhất
     trước, rồi `id`.

Chỉ từ public; `level` là tên Level published đầu tiên theo `orderIndex`. Dữ liệu từ điển
thật hiện chỉ có nghĩa tiếng Anh (CC-CEDICT, 0 nghĩa Việt cho tới M1.2a), nên hôm nay
tra theo nghĩa chỉ ra kết quả nhờ nghĩa Anh. Ví dụ: `?query=hoc` và `?query=học` khớp từ
có nghĩa Việt "học tập" và nghĩa Anh "hockey", không khớp "shocking"; `?query=study` đưa
từ có nghĩa đúng "to study" lên trước "field of study"; `?query=xue` trả từ có pinyin
`xue…` trước, rồi tới từ có nghĩa bắt đầu bằng "xue". `data` `200` là mảng:

```json
[{ "id": 12, "hanzi": "学习", "pinyin": "xué xí", "pinyinTone": "xue2 xi2",
   "meanings": [{ "en": "to study", "vi": "học tập" }], "level": "HSK 1" }]
```

**Chi tiết từ** `GET /dictionary/words/:id`. `:id` không phải số nguyên dương an toàn →
`400`; không phải từ public → `404` (`error.code` `WORD_NOT_FOUND`). `data` `200`:

```json
{ "id": 12, "hanzi": "学习", "traditional": "學習", "pinyin": "xué xí", "pinyinTone": "xue2 xi2",
  "example": "我每天都学习中文。",
  "meanings": [{ "order": 1, "en": "to study", "vi": "học tập", "partOfSpeech": "verb", "usage": null, "note": null }],
  "levels": [{ "code": "HSK1", "name": "HSK 1" }],
  "sources": [{ "name": "…", "version": "1.0.0", "license": null, "attribution": null }] }
```

`meanings` theo `meaningOrder`; `levels` chỉ Level published, chưa xoá, theo `orderIndex`;
`sources` để nguồn `isPrimary` đứng đầu rồi theo id nguồn. Trường nullable trả `null`.
Không trả trạng thái, audio, ảnh, stroke, người tạo/sửa, thời điểm hay `referenceUrl`
(audio từ vựng thuộc backlog M2.B12).

**Lưu từ** (Q62: chỉ lưu `UserWord`, chưa tạo thẻ ôn SRS). Thiếu token → `401`; `:id` sai
dạng → `400`. Không response nào chứa `userId` hay `Idempotency-Key`.

| Route | `data` | Lỗi |
| --- | --- | --- |
| `GET …/save` | `{ wordId, saved }`. Đã lưu → `saved: true`, kể cả khi từ đã bị gỡ public (để còn bỏ lưu được) | chưa lưu và từ không public → `404 WORD_NOT_FOUND` |
| `POST …/save` | `{ wordId, saved: true, eventId, occurredAt }`; trả `201` kể cả replay. Lưu lần đầu tạo `UserWord` và `LearningEvent` `word_saved` (`resourceType: "word"`, `resourceId: wordId`) trong một transaction khoá `User`; đã lưu rồi → `eventId: null`, `occurredAt: null`, không tạo event | thiếu/sai key → `400`; key đã dùng cho request khác → `409`; key quá 24 giờ → `400`; từ không public → `404 WORD_NOT_FOUND`; tài khoản không active → `401` |
| `DELETE …/save` | `{ wordId, saved: false }`; idempotent, `200` cả khi chưa lưu hoặc từ không tồn tại. **Bỏ lưu không ghi event** (`LearningEventType` chưa có loại bỏ lưu) | tài khoản không active → `401` |

Replay một `Idempotency-Key` trả lại kết quả gốc, kể cả khi từ đã bị bỏ lưu sau đó; trạng thái hiện tại đọc bằng `GET …/save`. Replay cùng key trả lại đúng kết quả cũ (cùng `eventId`). Hai request lưu song song của
một user được tuần tự hoá bằng khoá `User`: đúng một `UserWord` và một event.

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
| `GET` | `/learning/home` | — | Home (dưới); header `Cache-Control: no-store` |
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

Activity `data`: `{ lesson: { id, title, description, slug, orderIndex, levelId }, level,
position, state, sections, progress,
topics: [{ …topic, progress: {…}, exercises: PublicExercise[] }], standaloneExercises:
PublicExercise[], currentTopic | null, currentExercise | null, nextAction }`.
`PublicExercise` = projection public + `topicId` + `latestAttempt: Attempt | null`.
`nextAction ∈ start_lesson | submit_exercise | complete_topic | complete_lesson | completed`.
Trường thêm cho màn bài học (M2.B13, Q43):
- `level`: `{ id, code, name }` của Level chứa bài.
- `position`, `state`: cùng định nghĩa và cùng code với `GET /learning/path` (đọc từ
  `loadLevelPaths`, chỉ thu hẹp về level của bài); `state ∈ done | current | available | locked`.
  Bài đang khoá vẫn trả `200` với `state: "locked"`; chỉ `POST start` chặn.
- `sections.vocabulary`: `{ wordCount, topicCount, topicsDone }`. `wordCount` = đúng tập
  `words` của `GET /learning/lessons/:id` (LessonWord có Word published, chưa xoá).
- `sections.grammar`: `{ topicCount, topicsDone }`.
  `topicCount` đếm topic public (published, chưa xoá) có `type` `vocabulary` hoặc `grammar`
  tương ứng; `topicsDone` là số topic đó có UserTopicProgress `done` của user.
- `sections.practice`: `{ exerciseCount, attempted }`. `exerciseCount` = số exercise public
  của bài (cùng tập `topics[].exercises` + `standaloneExercises`, loại `speaking_repeat`);
  `attempted` = số exercise trong tập đó có ít nhất một attempt đã submit của user.
- Mọi trường của activity đọc từ cùng một snapshot (REPEATABLE READ).

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

Home `data` (Q13, chỉ đọc, không ghi DB): `{ nextStep, greetingName, dailyGoal, streakDays,
continueLesson }`.
- `nextStep`: như Path.
- `greetingName: string | null`: `UserProfile.displayName` đã trim nếu khác rỗng; không có thì
  `User.name` nếu hợp lệ theo luật `displayName` (trim, 1–50 ký tự, không ký tự control hay bidi
  override); không có thì `null` (frontend hiện "Chào bạn").
- Timezone: `UserProfile.timezone` nếu là IANA hợp lệ; không có profile, giá trị không hợp lệ,
  hoặc hợp lệ với ICU của Node nhưng PostgreSQL không nhận (ví dụ `US/Pacific-New`, PostgreSQL
  báo SQLSTATE `22023`) thì dùng `Asia/Ho_Chi_Minh`; trường hợp PostgreSQL không nhận, server
  ghi log `warn` kèm `userId` và timezone rồi tính lại cả `minutesToday` lẫn `streakDays`.
  "Hôm nay" là ngày lịch theo timezone này; đầu ngày là 00:00 local đổi sang UTC theo luật của
  timezone (đúng cả ngày đổi giờ DST).
- `dailyGoal`: `{ targetMinutes, minutesToday } | null`, `null` khi không có goal active.
  `targetMinutes` = `UserGoal.dailyMinutes`. `minutesToday` = `min(floor(tổng durationSeconds /
  60), 1440)` của các attempt của chính learner có `submittedAt` từ đầu ngày hôm nay tới thời
  điểm request và `durationSeconds` khác `null`; không cap theo `targetMinutes`.
- `streakDays`: số ngày local liên tiếp của chuỗi gần nhất. Ngày học là ngày local có ít nhất
  một LearningEvent `lesson_completed`, `topic_completed` hoặc `exercise_submitted` (không tính
  `lesson_started`, `topic_started`, `word_saved`) xảy ra không muộn hơn thời điểm request.
  Chuỗi kết thúc hôm nay hoặc hôm qua vẫn được giữ (chưa học hôm nay chưa làm mất chuỗi); kết
  thúc trước hôm qua thì `0`. Độ dài không giới hạn.
- Ngày local của lịch sử tính theo timezone hiện tại lúc request: đổi timezone sẽ tính lại mọi
  ngày cũ (cả `minutesToday` lẫn `streakDays`) theo timezone mới.
- `continueLesson`: `nextLesson` của Path cộng `completionPercent` của bài đó trên Path
  (`{ lessonId, title, slug, levelCode, position, completionPercent } | null`).

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
/learning/lessons/:lessonId/activity` trả `state` (cùng giá trị với `GET /learning/path`);
chỉ `POST start` chặn bằng `409 lesson_locked`. `nextAction` vẫn có thể là `start_lesson`
cho bài đang khoá. Topic start, attempt
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
| `GET` | `/admin/cms/lessons/:lessonId` | — | `{ lesson, revisions, topics }` |
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

`GET /admin/cms/lessons/:lessonId` (M5.1a, B1): `topics` là mọi Topic của bài học (kể cả
archived), sắp xếp `orderIndex` asc rồi `id` asc, KHÔNG có trường `content`; mỗi phần tử kèm
`latestRevision` tóm tắt `{ id, revision, authorId, createdAt, reviews }` với `reviews` tối đa
1 bản mới nhất `{ decision, reviewerId, createdAt }` (không snapshot, không contentHash), hoặc
`null` khi chủ đề chưa có bản sửa. Không phân trang (một bài học có ít chủ đề).

Lỗi: `400` DTO; `403` role; `404` entity; `409` (mã máy trong `error.code`, bảng dưới);
`503` lock timeout. Lock order và hash: ADR-002, overview §3.4.

Mã `409` (M5.1a, B2 — message tiếng Anh giữ nguyên, client map `code` sang câu tiếng Việt):

| `error.code` | `error.message` | Khi nào |
| --- | --- | --- |
| `CONTENT_ARCHIVED` | `Archived content cannot be changed.` / `Archived <Lesson\|Topic> cannot be changed.` | Mutation vào content đã archived |
| `REVISION_NOT_LATEST` | `Only the latest content revision can be used for this action.` / `… can be published.` | Review/publish bản sửa không còn là mới nhất |
| `REVIEW_NOT_APPROVED` | `The latest review decision must approve this revision.` | Publish khi đánh giá mới nhất không phải approved |
| `LESSON_LEVEL_NOT_PUBLISHED` | `Lesson requires a published, non-deleted parent level.` | Publish lesson mà Level chưa published |
| `LESSON_NO_PUBLISHED_CHILD` | `Lesson requires at least one published Topic or Story.` | Publish lesson chưa có Topic/Story published |
| `CONTENT_UNIQUE_CONFLICT` | `Content conflicts with an existing slug or order.` | Trùng unique (ví dụ slug lesson) |
| `CONTENT_CONSTRAINT_CONFLICT` | `Content violates a database integrity constraint.` | Vi phạm ràng buộc FK/check |
| `CONTENT_CONCURRENT_UPDATE` | `Concurrent content update detected; retry the request.` | Race transaction, retry được |
| `CONTENT_REVISION_INVALID` | `Lesson revision snapshot is invalid.` / `Topic revision snapshot is invalid.` / `Content revision hash is missing.` | Snapshot/hash bản sửa không hợp lệ |

`REVISION_NOT_LATEST`/`REVIEW_NOT_APPROVED` từ `decidePublishAction` dùng chung, nên publish
LessonExercise (A.9) cũng trả hai mã này. M5.1b1 bổ sung mã máy cho mọi `409` riêng của
Exercise ở bảng A.9.

### A.9 Admin CMS — Exercise và Import (admin)

| Method | Path | Query/Body/Header | `data` |
| --- | --- | --- | --- |
| `GET` | `/admin/cms/data-sources` | `page`, `limit` (1–100, mặc định 20), `eligibleFor?` (chỉ `media`: giữ nguồn mà finalize ingestion chấp nhận — code, version, license không rỗng; field tuỳ chọn nếu có thì không rỗng; giá trị khác → `400`); chỉ đọc, dùng cho trang Nhập dữ liệu và Tải media | `[{ id, code, name, version }]` + `meta`; sort `name ASC, version DESC, id ASC` |
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

Import bài tập (M5.1b2) chạy hai bước trên cùng payload: `preview` chỉ kiểm và trả
`previewHash` (sha256 canonical của `dataSourceId`, `fileName` đã chuẩn hoá, các dòng hợp lệ
và danh sách lỗi; không ghi DB); `commit` bắt buộc `previewHash` khớp payload hiện tại và
header `Idempotency-Key` 8–128 ký tự `[A-Za-z0-9][A-Za-z0-9._:-]*` — replay cùng key với
cùng payload trả lại kết quả cũ (`idempotent: true`), thiếu key → `422`
(`error.code = UNPROCESSABLE_ENTITY`, không có mã riêng). Commit all-or-nothing: chỉ cần một
dòng lỗi thì không ghi gì.

Giới hạn body: JSON mặc định của backend là 100 KB (không cấu hình riêng cho route này);
body lớn hơn → `413` (`error.code = PAYLOAD_TOO_LARGE`, message không lặp lại body); JSON
hỏng → `400` (`error.code = MALFORMED_REQUEST`). Client chặn sớm ở 90 000 byte, BFF chặn
102 400 byte (A.12).

Lỗi `422` khi commit gặp dòng không hợp lệ (`error.code = IMPORT_VALIDATION_FAILED`,
`error.message = Exercise import contains invalid rows.`): `details.errors` là mảng
`{ rowNumber (1-based), code, path }` đã sắp theo `rowNumber`, `path`, `code`. Preview trả
cùng shape lỗi trong `data.errors` (không phải 422). `code` là mã public viết HOA: các mã
riêng của import là `SOURCE_KEY_ALREADY_EXISTS`, `DUPLICATE_SOURCE_KEY_IN_BATCH`,
`UNEXPECTED_FIELD`, `OPTION_ID_NOT_FOUND`, `PARENT_LESSON_NOT_FOUND`,
`TOPIC_LESSON_MISMATCH`, `MEDIA_NOT_FOUND`, `INVALID_SOURCE_KEY`, `INVALID_ROW`; các mã
validator bài tập khác lấy nguyên mã viết HOA (vd `REQUIRED_FIELD`, `PAYLOAD_TOO_LARGE`).
`path` dùng `$` cho cả dòng (`object_required`), `$.$unknown` cho trường lạ và tên trường
cho lỗi từng ô (`sourceKey`, `lessonId`, `topicId`, `mediaId`, `content.options[0].id`…).

Lỗi `409` của import chỉ có `error.message` tiếng Anh, KHÔNG có mã máy riêng
(`error.code = CONFLICT`): preview hash không khớp payload (`Preview hash does not match; the
import payload changed.`), replay `Idempotency-Key` với payload khác, hoặc bản ghi import cũ
không đầy đủ (`… manual review is required.`). Race/timeout hạ tầng → `503` message
`Exercise import is temporarily unavailable; retry the request.` (retry được với cùng key).

`ExerciseAdmin`: `{ id, lessonId, topicId, mediaId, type, prompt, content, answer,
explanation, version, orderIndex, status, dataSourceId, sourceKey, createdById, updatedById,
publishedById, publishedAt, deletedAt, createdAt, updatedAt, media: { id, url, type,
mimeType, duration, processingStatus, deletedAt } | null, lesson: { id, title, slug },
topic | null, dataSource | null }`.

Hình dạng `content`/`answer` theo từng loại (canonical sau validator; `id` ổn định 1–128 ký
tự, không khoảng trắng; `text` 1–4096; `prompt` 1–4096; `explanation` ≤4096; `orderIndex`
1–1 000 000):

| `type` | `content` | `answer` |
| --- | --- | --- |
| `mcq`, `listening_choice` | `{ options: [{ id, text }] }`, 2–100 phần tử, `id` không trùng | `{ optionId }`, phải là một `id` trong `content.options` |
| `fill_blank` | `{}` | `{ acceptedTexts: string[] }` 1–100 phần tử + `caseSensitive?` boolean |
| `arrange_sentence` | `{ tokens: [{ id, text }] }`, 2–100 phần tử, `id` không trùng | `{ tokenIds: string[] }` đủ mọi token, không trùng, **thứ tự = đáp án đúng** |
| `speaking_repeat` | `{ referenceText? }` | `{}`; chỉ lưu draft, không publish được |

Canonical payload ≤ 65 536 byte, depth ≤ 8. `mediaId` chỉ dùng cho `listening_choice`; publish
cần Media `audio`, `processingStatus = ready`, chưa xoá.

Lỗi `409` (mã máy trong `error.code`; message tiếng Anh giữ nguyên từng chữ):

| `error.code` | `error.message` | Khi nào |
| --- | --- | --- |
| `TOPIC_LESSON_MISMATCH` | `Topic must belong to the exercise parent lesson.` / `Topic must be live and belong to the exercise parent lesson.` | `topicId` không thuộc `lessonId` hoặc Topic không live |
| `CONTENT_ARCHIVED` | `Archived LessonExercise cannot be changed.` | Mutation vào bài tập đã archived |
| `REVISION_NOT_LATEST` | `Only the latest content revision can be used for this action.` / `… can be published.` | Review/publish bản sửa không còn mới nhất (dùng chung A.8) |
| `REVIEW_NOT_APPROVED` | `The latest review decision must approve this revision.` | Publish khi đánh giá mới nhất không phải approved (dùng chung A.8) |
| `CONTENT_UNIQUE_CONFLICT` | `LessonExercise content conflicts.` | Trùng unique của LessonExercise |
| `CONTENT_CONSTRAINT_CONFLICT` | `LessonExercise violates a database integrity constraint.` | Vi phạm FK/check (ví dụ `mediaId` không tồn tại) |
| `CONTENT_CONCURRENT_UPDATE` | `Concurrent LessonExercise update detected; retry the request.` | Race transaction, retry được |
| `CONTENT_REVISION_INVALID` | `LessonExercise revision snapshot is invalid.` / `LessonExercise revision snapshot integrity check failed.` / `Content revision hash is missing.` | Snapshot/hash bản sửa không hợp lệ |

Lỗi `422` (mã máy trong `error.code`; `details.path` là vị trí lỗi để client hiện đúng ô):

| `error.code` | `error.message` / `details` | Khi nào |
| --- | --- | --- |
| `EXERCISE_TYPE_NOT_PUBLISHABLE` | `speaking_repeat is unsupported for publishing in Lesson Activity V1.` | Publish bản sửa `speaking_repeat` |
| `listening_media_not_ready` | `Listening audio media must be ready and live.`, `details.path = "mediaId"` | Publish `listening_choice` khi audio thiếu/chưa ready/đã xoá |
| mã validator bảng dưới | `LessonExercise validation failed at <path>.`, `details.path` = đường dẫn | Payload sai shape/giới hạn theo từng loại |

Mã validator của `lesson-exercise-authoring.validator.ts` (422, kèm `details.path`): `required_field`,
`invalid_exercise_type`, `unsupported_publish_type`, `object_required`, `unknown_field`,
`array_required`, `array_too_small`, `array_too_large`, `duplicate_stable_id`,
`invalid_stable_id`, `authoritative_option_not_found`, `accepted_texts_required`,
`boolean_required`, `invalid_token_set`, `media_not_allowed`, `media_required`,
`positive_safe_integer_required`, `max_depth_exceeded`, `invalid_json`, `payload_too_large`,
`string_required`, `non_empty_string_required`, `string_too_long`.

### A.9b Admin CMS — Ngân hàng câu hỏi (admin, M4.1a)

Envelope §1. Danh sách có `meta.pagination`; mọi response có `Cache-Control: no-store`.
Mọi `POST` trả `201` kể cả `idempotent = true`. State machine giống bài tập: bản sửa nháp →
review (`approved | changes_requested | rejected`) → publish bản sửa mới nhất đã approved →
archive; revision/review/audit append-only. Row `Question` khoá `FOR UPDATE` sau
`lockActiveCmsActor` trong mọi mutation (TL-85).

| Method | Path | Query/Body | `data` |
| --- | --- | --- | --- |
| `GET` | `/admin/cms/questions` | `levelId?`, `skill?` (4 kỹ năng), `type?` (4 dạng M4.1a), `difficulty?` (1–3), `status?`, `tag?` (1–5 slug, lặp lại `?tag=a&tag=b`, OR), `q?` (1–100, ILIKE trên `content`, ký tự `%`/`_` là literal), `page`, `limit` | `[{ …QuestionAdmin, latestRevision }]` + `meta`; sort `updatedAt desc, id desc` |
| `GET` | `/admin/cms/questions/counts` | — | `{ total, bySkill: { listening, reading, writing, speaking }, vocabularyGrammar }`; không tính câu archived/`deletedAt`; `vocabularyGrammar` = số câu có tag `tu-vung` hoặc `ngu-phap` |
| `GET` | `/admin/cms/questions/:questionId` | — | `{ …QuestionAdmin, revisions[] }`, revisions mới nhất trước |
| `POST` | `/admin/cms/questions` | `QuestionRevision` | `{ question, revision, idempotent: false }` |
| `POST` | `/admin/cms/questions/:questionId/revisions` | `QuestionRevision` | `{ question, revision, idempotent }`; snapshot trùng bản mới nhất → `idempotent: true` |
| `POST` | `/admin/cms/questions/:questionId/revisions/:revisionId/reviews` | `{ decision, note? ≤2000 }` | `{ revision, review, idempotent }` |
| `POST` | `/admin/cms/questions/:questionId/revisions/:revisionId/publish` | — | `{ question, revision, idempotent }` |
| `POST` | `/admin/cms/questions/:questionId/archive` | — | `{ question, idempotent }` |
| `GET` | `/admin/cms/tags` | `q?` (1–40, ILIKE trên `name`, `%`/`_` literal), `limit` (1–100, mặc định 50) | `[{ slug, name, questionCount }]`; sort `name asc, id asc`; `questionCount` chỉ đếm câu chưa archived |

`QuestionRevision` (body tạo bản sửa): `type` ∈ `mcq | true_false | fill_blank |
arrange_sentence` (bốn giá trị `listening | reading | writing | speaking` bị từ chối `400`) ·
`skill` ∈ 4 kỹ năng · `levelId` · `content` = đề bài 1–4096 · `answers`, `correctAnswer` JSON
≤100 000 byte/depth 20 (validator sau DTO áp canonical ≤65 536 byte/depth 8) · `explanation?`
≤4096 · `objective?` ≤500 · `difficulty?` 1–3 hoặc `null` · `audioId?`, `imageId?` · `tags?`
≤10 tên, mỗi tên 1–40 ký tự, không trùng slug. `tags` được chuẩn hoá thành slug (bỏ dấu tiếng
Việt, chữ thường, nối `-`), sắp xếp, dedupe theo slug (trùng slug → `422 duplicate_tag`).

Hình dạng `answers`/`correctAnswer` theo từng loại (`content` của row = đề bài, không phải
object):

| `type` | `answers` (cột `Question.answers`) | `correctAnswer` |
| --- | --- | --- |
| `mcq` | `{ options: [{ id, text }] }`, 2–100 phần tử, `id` không trùng | `{ optionId }`, phải là `id` trong `answers.options` |
| `true_false` | `{}` | `{ value: boolean }` |
| `fill_blank` | `{}` | `{ acceptedTexts: string[] }` 1–100 + `caseSensitive?` boolean |
| `arrange_sentence` | `{ tokens: [{ id, text }] }`, 2–100 phần tử | `{ tokenIds: string[] }`, đủ mọi token, **thứ tự = đáp án đúng** |

`QuestionAdmin`: `{ id, content, type, skill, audioId, imageId, answers, correctAnswer,
explanation, objective, levelId, difficulty, version, contentHash, status, dataSourceId,
createdById, updatedById, publishedById, publishedAt, deletedAt, createdAt, updatedAt,
level: { id, code }, tags: [{ slug, name }] }`. TL-82a: danh sách **mặc định chỉ gồm câu
chưa lưu trữ** (`status <> 'archived'` và `deletedAt IS NULL`), nên `meta.total` bằng
`counts.total` khi không lọc; truyền `status=archived` mới trả câu đã lưu trữ. TL-82b: `tag`
nhận 1–5 slug lặp lại và kết hợp OR. `latestRevision` = `{ id, revision, decision }` hoặc
`null`.
`revisions[]` = `{ id, revision, contentHash, createdAt, author: { id, name } | null,
changedFields: string[], reviews: [{ decision, note, reviewer: { id, name } | null,
createdAt }] }`. `changedFields` so snapshot với bản liền trước trên đúng 12 field
`type, skill, levelId, content, answers, correctAnswer, explanation, objective, difficulty,
audioId, imageId, tags`; revision 1 trả `[]`.

Snapshot của revision gồm đúng 12 field trên (không có `id`/`version`/`status`), `tags` là
slug đã sort, `contentHash` = sha256 canonical JSON của snapshot. Câu `draft` materialize
row `Question` ngay khi tạo bản sửa; câu `published` chỉ materialize khi publish.

Tag: upsert `Tag` theo `slug` (`ON CONFLICT DO NOTHING`, an toàn khi 2 transaction tạo cùng
slug); tên hiển thị lấy từ lần tạo đầu tiên; liên kết `QuestionTag` thừa bị xoá, thiếu được
thêm trong cùng transaction. Tag row không bị xoá khi bỏ liên kết.

`GET /admin/cms/tags` (TL-93) là danh sách gợi ý tag cho form soạn câu hỏi: admin-only,
`no-store`, không phân trang. `questionCount` đếm câu có tag đó mà `status <> 'archived'` và
`deletedAt IS NULL`, nên tag chỉ còn gắn với câu lưu trữ trả `0` nhưng vẫn xuất hiện trong gợi
ý. Không có route `:param` ở cấp đầu nên `tags` không xung đột route; vẫn khai báo trước mọi
route tham số hoá.

Media (TL-81, TL-81a): `audioId` phải là Media `audio`, `imageId` phải là Media `image`; kiểm
trong transaction với `FOR SHARE`. Hai mức kiểm:
- **Lưu câu hỏi / lưu bản sửa:** chỉ chặn tham chiếu không thể dùng được — `not_found`,
  `wrong_type`, `quarantined`, `archived` (đã xoá) → `409 MEDIA_NOT_USABLE` với `details.field`
  và `details.reason`. Media `pending`/`processing` **được phép lưu** để tác giả soạn câu hỏi
  trong lúc tệp đang xử lý.
- **Publish:** media phải `processingStatus = ready` và chưa `deletedAt`; mọi trạng thái khác
  → `409 QUESTION_NOT_PUBLISHABLE` với `details.reasons` chứa `audio_not_ready` (audio) hoặc
  `image_not_ready` (ảnh).

Publish (TL-83) chỉ áp dụng cho bản sửa mới nhất đã `approved`; vi phạm điều kiện →
`409 QUESTION_NOT_PUBLISHABLE` với `details.reasons[]` = `{ code, field }`:
`explanation_required` (`explanation`), `audio_required` (`audioId`, khi `skill = listening`),
`level_not_found` (`levelId`), `audio_not_ready` (`audioId`), `image_not_ready` (`imageId`).
`audio_not_ready`/`image_not_ready` áp cho mọi trạng thái media không phải `ready` (kể cả
`pending`/`processing`/`quarantined`/đã xoá/không tồn tại).
Câu đã archived không sửa/publish được. Archive bị chặn khi câu nằm trong `Test` đang
`published` (TL-84).

Lỗi `409` (mã máy trong `error.code`; message tiếng Anh giữ nguyên):

| `error.code` | `error.message` | Khi nào |
| --- | --- | --- |
| `QUESTION_ARCHIVED` | `Archived Question cannot be changed.` | Mutation/review/publish câu đã archived |
| `QUESTION_NOT_PUBLISHABLE` | `Question does not meet the publish requirements.`, `details.reasons` | Publish thiếu điều kiện TL-83 |
| `QUESTION_IN_PUBLISHED_TEST` | `Question belongs to a published test and cannot be archived.` | Archive câu đang thuộc `Test` published (TL-84) |
| `QUESTION_IN_PUBLISHED_TEST` | `A published test uses this question; level, skill and type cannot change.`, `details.field` ∈ `levelId \| skill \| type` | Publish bản sửa đổi levelId/skill/type của câu đang nằm trong đề đã xuất bản (Q116, TL-99) |
| `MEDIA_NOT_USABLE` | `Question media must exist, be live and of the right type.`, `details.field`, `details.reason` ∈ `not_found \| wrong_type \| quarantined \| archived` | Lưu bản sửa với media không tồn tại/sai loại/bị cách ly/đã xoá |
| `REVISION_NOT_LATEST` | `Only the latest content revision can be used for this action.` | Review/publish bản sửa không còn mới nhất (dùng chung A.8) |
| `REVIEW_NOT_APPROVED` | `The latest review decision must approve this revision.` | Publish khi đánh giá mới nhất không phải approved (dùng chung A.8) |
| `QUESTION_UNIQUE_CONFLICT` | `Question content conflicts.` | Trùng unique của Question/Tag |
| `QUESTION_CONSTRAINT_CONFLICT` | `Question violates a database integrity constraint.` | Vi phạm FK/check |
| `QUESTION_CONCURRENT_UPDATE` | `Concurrent Question update detected; retry the request.` | Race transaction, retry được |
| `CONTENT_REVISION_INVALID` | `Question revision snapshot is invalid.` / `Question revision snapshot integrity check failed.` / `Content revision hash is missing.` | Snapshot/hash bản sửa không hợp lệ |

Lỗi `422`: `Question validation failed at <path>.` với `error.code` là mã validator và
`details.path` là vị trí lỗi (client hiện đúng ô). Mã dùng chung với bài tập cho
`mcq`/`fill_blank`/`arrange_sentence`; `true_false` thêm `boolean_required`. Mã riêng của
ngân hàng câu hỏi: `invalid_question_type`, `invalid_skill`, `invalid_difficulty`,
`invalid_tag`, `duplicate_tag`.

Audit trong cùng transaction (TL-86): `question.created`, `question.revision_created`,
`question.reviewed`, `question.published`, `question.archived`; `targetType = "question"`,
`afterSummary = { entityType, entityId, revision, status, contentHash, decision? }`.

### A.9c Admin CMS — Đề thi (admin, M4.1b)

Envelope §1. Danh sách có `meta.pagination`; mọi response có `Cache-Control: no-store`.
8 endpoint admin-only (`JwtAuthGuard` + `RolesGuard` với `role = admin`), route tĩnh `tests`
khai báo trước `tests/:testId`, `:testId` qua `ParsePositiveIntPipe` (không phải số nguyên
dương `1..2147483647` → `400`). Mọi `POST` trả `201`. Đề `draft` sửa trực tiếp (kèm
`expectedUpdatedAt`) và publish thẳng khi qua bộ kiểm tra; đề `published` chỉ đọc, muốn sửa
phải archive rồi duplicate (Q117). `Test.duration` là **số phút** cho **cả đề** (một đồng hồ,
1–300, Q118); `TestSection.duration` để trống, không dùng. Mọi mutation khoá actor
(`lockActiveCmsActor`) rồi khoá row `Test` bằng `FOR UPDATE` và đọc lại trong cùng
transaction (TL-97). Thứ tự khoá của mọi mutation: actor → row `Test` (`FOR UPDATE`) →
các row `Question` được tham chiếu (`FOR SHARE`, theo `id` tăng dần) → các row `Media` của
nhóm (`FOR SHARE`). `PUT structure` cũng khoá câu theo thứ tự này trước khi kiểm câu dùng
được (H3), nên archive/publish một câu không chen được giữa bước kiểm và bước ghi.

| Method | Path | Query/Body | `data` |
| --- | --- | --- | --- |
| `GET` | `/admin/cms/tests` | `levelId?`, `status?` (`draft \| published \| archived`), `q?` (1–100, ILIKE trên `title`, `%`/`_` là literal), `page`, `limit` | `TestAdmin[]` + `meta`; sort `updatedAt desc, id desc`; mặc định ẩn đề đã lưu trữ (`status <> 'archived'` và `deletedAt IS NULL`), truyền `status=archived` mới thấy đề archived |
| `GET` | `/admin/cms/tests/:testId` | — | `TestDetail`; id không tồn tại → `404` message `Test not found.`; vẫn trả được đề đã archive |
| `POST` | `/admin/cms/tests` | `CreateTest` | `TestDetail`; tạo đề `draft` chưa có section |
| `PATCH` | `/admin/cms/tests/:testId` | `UpdateTest` | `TestDetail`; chỉ đề `draft` |
| `PUT` | `/admin/cms/tests/:testId/structure` | `ReplaceTestStructure` | `TestDetail`; thay toàn bộ cây section/group/câu, chỉ đề `draft` |
| `POST` | `/admin/cms/tests/:testId/publish` | `PublishTest` = `{ expectedUpdatedAt }` | `TestDetail`; chỉ đề `draft` |
| `POST` | `/admin/cms/tests/:testId/archive` | — | `TestDetail`; archive được từ `draft` hoặc `published` |
| `POST` | `/admin/cms/tests/:testId/duplicate` | — | `TestDetail`; nhân bản mọi trạng thái thành đề `draft` mới |

`CreateTest` (body tạo đề nháp, TL-100): `levelId` (level phải tồn tại, không → `422`
`level_not_found`) · `title` trim 1–200 · `instruction?` trim ≤2000 (rỗng → `null`) ·
`duration` nguyên 1–300 phút (Q118) · `passScore?` nguyên ≥ 0 hoặc `null`. `passScore` chỉ
được so với `maxScore` khi publish, nên tạo/sửa vẫn lưu được giá trị ngoài khoảng.

`UpdateTest` (body PATCH meta): bắt buộc `expectedUpdatedAt` (ISO8601, echo `updatedAt` của
lần đọc gần nhất) + các field optional như `CreateTest`; `passScore: null` xoá điểm đỗ;
`instruction: null` xoá hướng dẫn. `levelId`, `title`, `duration` **không nhận `null`** —
gửi `null` (khác với bỏ trống field) trả `400 REQUEST_VALIDATION_FAILED` và đề không đổi
(H1). Body chỉ có `expectedUpdatedAt` vẫn hợp lệ (chỉ chạm `updatedAt`). Chỉ áp dụng khi đề
`draft`.

`ReplaceTestStructure` (body PUT, TL-96): bắt buộc `expectedUpdatedAt` + `sections[]` 0–10
phần (đề nháp được phép rỗng để dựng dần). Mỗi phần: `skill` ∈ `listening | reading |
writing | speaking`, `title` trim 1–100, `instruction?` ≤1000, `groups[]` 1–20 nhóm. Mỗi
nhóm: `title?` ≤100, `instruction?` ≤1000, `audioId?`/`imageId?`, `questionIds[]` 1–50 id
câu; tổng ≤ 200 câu/đề. Câu "không nhóm" là group không có `title`.

```json
{
  "expectedUpdatedAt": "2026-10-25T07:30:00.000Z",
  "sections": [
    {
      "skill": "listening",
      "title": "Phần 1 — Nghe",
      "instruction": "Chọn đáp án đúng.",
      "groups": [
        {
          "title": "Hội thoại 1",
          "instruction": "Nghe hội thoại và chọn đáp án.",
          "audioId": 42,
          "imageId": null,
          "questionIds": [101, 102, 103]
        }
      ]
    }
  ]
}
```

- **Thay toàn bộ cây trong một transaction:** xoá placement → `TestQuestion` → `QuestionGroup`
  → `TestSection` rồi tạo lại theo đúng thứ tự mảng. **Id section và group đổi sau mọi lần
  PUT structure** (client phải `GET /admin/cms/tests/:testId` lại, không cache id).
- **`orderIndex`:** section `1..N` liên tục theo thứ tự mảng (không sắp theo `skill`); group
  `1..M` liên tục trong từng section; `TestQuestion.orderIndex` = `placement.orderIndex` =
  thứ tự liên tục `1..N` trên toàn đề, không reset theo section/group; mọi placement đều có
  `groupId` (câu "không nhóm" là group không có title).
- **Lưu không kiểm level/skill/published của câu** — đó là việc của publish. Chỉ chặn tham
  chiếu không thể dùng: câu không tồn tại/đã soft-delete/`archived` → `409
  TEST_QUESTION_NOT_USABLE` với `details.field` = vị trí
  (`sections[i].groups[j].questionIds[k]`) và `details.reason` ∈ `not_found | archived`;
  media nhóm kiểm ở mức lưu theo TL-81a (`audioId` phải là Media `audio`, `imageId` là Media
  `image`, khoá `FOR SHARE`) → `409 MEDIA_NOT_USABLE` với `details.field` ∈
  `sections[i].groups[j].audioId | sections[i].groups[j].imageId` và `details.reason` ∈
  `not_found | wrong_type | quarantined | archived`. Media `pending`/`processing` **được phép
  lưu**; publish mới đòi `ready`.
- Trước khi kiểm câu dùng được, service khoá các câu bằng `FOR SHARE` theo `id` tăng dần
  (cùng thứ tự như publish), rồi mới kiểm (H3).
- Archive được từ `draft` hoặc `published`, sau đó mọi mutation trả `TEST_ARCHIVED`. Duplicate
  giữ nguyên level và cấu trúc section/group/placement cùng tham chiếu câu, bỏ kết quả thi,
  luôn tạo đề `draft` mới với title `"<title> (bản sao)"`; tiêu đề nguồn được cắt theo code
  point để tổng ≤200 ký tự (không tách đôi cặp surrogate của emoji, H6).

`TestAdmin`: `{ id, levelId, levelCode, title, instruction, duration, passScore, maxScore,
status, version, sectionCount, questionCount, skills, createdAt, updatedAt, publishedAt }`;
`duration` tính bằng phút; `maxScore = 100 × sectionCount` (Q118 — mỗi câu điểm như nhau, mỗi
phần 100 điểm); `skills` = các `skill` khác nhau của section theo thứ tự phần. `TestDetail` =
`TestAdmin` + `sections[]`: section = `{ id, skill, title, instruction, orderIndex,
questionCount, groups[] }`; group = `{ id, title, instruction, audioId, imageId, orderIndex,
questions[] }`; question = `{ questionId, orderIndex, type, skill, levelId, difficulty,
status, content }`. `GET tests` trả `TestAdmin` (không `sections`), `GET tests/:testId` và
mọi mutation trả `TestDetail`. **Id section/group chỉ sống trong một lần đọc**: mỗi `PUT
structure` tạo id mới.

Publish (TL-98) chỉ áp dụng cho đề `draft`; mọi vi phạm gom vào một `409 TEST_NOT_PUBLISHABLE`
với `details.reasons[]` = `{ code, field }`, tối đa 20 reason. Một câu có thể sinh **nhiều**
reason cùng `field` (ví dụ vừa chưa xuất bản, vừa khác cấp, vừa khác kỹ năng) để tác giả sửa
hết trong một vòng (H2); chỉ câu không còn tồn tại mới dừng ở `question_not_published`:

| `reason.code` | `field` | Khi nào |
| --- | --- | --- |
| `level_not_found` | `levelId` | Level của đề không còn tồn tại |
| `sections_required` | `sections` | Đề chưa có section nào |
| `section_empty` | `sections[i]` | Section không có group nào |
| `group_empty` | `sections[i].groups[j]` | Group không có câu nào |
| `question_not_published` | `sections[i].groups[j].questionIds[k]` | Câu không tồn tại, đã soft-delete/archived hoặc chưa `published` |
| `question_level_mismatch` | `sections[i].groups[j].questionIds[k]` | `levelId` của câu khác `levelId` của đề |
| `question_skill_mismatch` | `sections[i].groups[j].questionIds[k]` | `skill` của câu khác `skill` của section |
| `pass_score_required` | `passScore` | `passScore = null` |
| `pass_score_out_of_range` | `passScore` | Ngoài khoảng `0..maxScore` |
| `audio_not_ready` | `sections[i].groups[j].audioId` | Media audio của group không `ready`/không dùng được |
| `image_not_ready` | `sections[i].groups[j].imageId` | Media ảnh của group không `ready`/không dùng được |
| `question_audio_not_ready` | `sections[i].groups[j].questionIds[k]` | Media audio của câu không `ready`/không dùng được (TL-129) |
| `question_image_not_ready` | `sections[i].groups[j].questionIds[k]` | Media ảnh của câu không `ready`/không dùng được (TL-129) |

Publish thành công: `status = published`, set `publishedAt`/`publishedById`, `version` và
`scoringVersion` giữ nguyên (TL-98). Đề đã publish chỉ đọc: `PATCH`/`PUT structure`/publish
lần nữa → `409 TEST_NOT_EDITABLE`; archive vẫn được.

Lỗi `409` (mã máy trong `error.code`; message tiếng Anh giữ nguyên):

| `error.code` | `error.message` | Khi nào |
| --- | --- | --- |
| `TEST_NOT_EDITABLE` | `Only a draft Test can be changed.` / `Only a draft Test can be published.` | `PATCH`/`PUT structure`/`publish` khi đề không còn `draft` |
| `TEST_ARCHIVED` | `Archived Test cannot be changed.` / `Archived Test cannot be published.` | Mutation/publish đề đã archive |
| `TEST_CONCURRENT_UPDATE` | `The Test changed since it was read; reload and retry.` / `Concurrent Test update detected; retry the request.` | `expectedUpdatedAt` lệch `updatedAt` (đọc lại rồi retry) hoặc race transaction |
| `TEST_NOT_PUBLISHABLE` | `Test does not meet the publish requirements.`, `details.reasons` | Publish thiếu điều kiện TL-98 |
| `TEST_QUESTION_NOT_USABLE` | `Test questions must exist and must not be soft-deleted or archived.`, `details.field`, `details.reason` ∈ `not_found \| archived` | `PUT structure` chứa câu không tồn tại/đã xoá/archived |
| `MEDIA_NOT_USABLE` | `Test group media must exist, be live and of the right type.`, `details.field`, `details.reason` ∈ `not_found \| wrong_type \| quarantined \| archived` | `PUT structure` với media nhóm không dùng được |
| `TEST_UNIQUE_CONFLICT` | `Test content conflicts.` | Trùng unique của Test/TestSection/QuestionGroup |
| `TEST_CONSTRAINT_CONFLICT` | `Test violates a database integrity constraint.` | Vi phạm FK/check |

Timeout/connection hạ tầng → `503` message `Test operation is temporarily unavailable; retry
the request.` (retry được).

Lỗi body: DTO lồng nhau sai shape, field lạ (`whitelist` + `forbidNonWhitelisted` →
`$.$unknown`) hoặc vượt giới hạn mảng/độ dài → `400 REQUEST_VALIDATION_FAILED` với
`details.errors: [{ path, codes }]` (§1). Lỗi nghiệp vụ sau DTO là `422` với `details.path` =
vị trí để client focus đúng ô: trùng `questionId` trong cùng đề → `TEST_STRUCTURE_INVALID`
(`details.path` = vị trí lặp, vd `sections[0].groups[0].questionIds[1]`); tổng >200 câu →
`TEST_STRUCTURE_INVALID` với `details.path = "sections"`; `levelId` không tồn tại →
`level_not_found`, `details.path = "levelId"`, message `Test level does not exist.`.
`:testId` hoặc query sai → `400`.

Audit trong cùng transaction (TL-101): `test.created`, `test.updated`,
`test.structure_updated`, `test.published`, `test.archived`, `test.duplicated`;
`targetType = "test"`, `targetId` là chuỗi id; `afterSummary = { entityType: "test", entityId,
status, sectionCount, questionCount }`, riêng `test.duplicated` thêm `sourceTestId`;
`correlationId` = request id. Không ghi `beforeSummary`.

Q116 (TL-99): publish bản sửa đổi `levelId`, `skill` hoặc `type` của câu đang nằm trong đề
`published` → `409 QUESTION_IN_PUBLISHED_TEST` với `details.field` ∈ `levelId | skill | type`
(message `A published test uses this question; level, skill and type cannot change.`); sửa
`content`, `answers`, `correctAnswer`, `explanation`, `tags` hay media vẫn publish được. Lượt
thi cũ bảo vệ bằng snapshot (M4.2a), không cần migration. Chi tiết ở A.9b.

TL-129: cổng publish kiểm cả media **mức câu** (`Question.audioId`, `Question.imageId`) với
hai mã `question_audio_not_ready`/`question_image_not_ready`; bước bắt đầu thi chạy lại đúng
hàm `collectTestPublishBlockers` này, nên đề đã xuất bản mà media của câu hỏng thì
`POST /exam/tests/:testId/attempts` trả `409 EXAM_TEST_UNAVAILABLE` kèm vị trí câu. Bài đang
làm **không** bị ảnh hưởng: nội dung đã đóng băng trong snapshot (Q120/Q121).

### A.9d Thi thử — học viên (M4.2a/M4.2b)

Envelope §1. 6 endpoint learner (`JwtAuthGuard`, account `active` và chưa soft-delete); mọi
response có `Cache-Control: no-store`; `:testId`/`:attemptId` qua pipe số nguyên dương
`1..2147483647` (sai → `400`). Chỉ cần đăng nhập là bắt đầu được bài thi: không lọc theo cấp
của học viên, không chặn free/premium (Q119). "Đề thi được" = tồn tại, `status = published`,
chưa lưu trữ (`deletedAt IS NULL`), và `availableFrom ≤ now < availableTo` nếu hai trường này
có đặt (Q119); đề nháp/đã lưu trữ/ngoài cửa sổ đều trả cùng `404 EXAM_TEST_NOT_FOUND` để
không lộ đề nháp.

| Method | Path | Body | `data` |
| --- | --- | --- | --- |
| `GET` | `/exam/tests/:testId` | — | `ExamTestIntro` — thông tin giới thiệu đề + bài đang làm của chính người gọi |
| `POST` | `/exam/tests/:testId/attempts` | `{ "idempotencyKey": "<uuid>" }` | `ExamAttemptView`; tạo bài mới → `201`, trả lại chính bài đang làm hoặc replay key → `200` |
| `GET` | `/exam/attempts/:attemptId` | — | `ExamAttemptView` của chính người gọi, đã bỏ đáp án; **route này có thể ghi** đúng một lần chuyển `timed_out` (TL-127) |
| `PUT` | `/exam/attempts/:attemptId/answers/:questionKey` | `SaveExamAnswer` | `ExamAnswerSaveView` — lưu một câu (TL-121) |
| `PUT` | `/exam/attempts/:attemptId/answers` | `{ "items": [SaveExamAnswer & { questionKey }] }` 1–20 item | `{ results: [ExamAnswerBatchResult], serverNow, remainingSeconds }` (TL-124) |
| `GET` | `/exam/attempts/:attemptId/media-grants` | — | `{ grants: [{ mediaId, kind, url, expiresAt }], unavailable: [mediaId] }` (TL-128) |

`ExamTestIntro`:

```json
{ id, title, instruction, levelCode, durationMinutes, questionCount, sectionCount, maxScore, passScore, sections:[{orderIndex,title,skill,questionCount,maxScore}], activeAttempt: null | {id,startedAt,expiresAt,answeredCount,questionCount} }
```

`answeredCount` chỉ đếm câu có `answer` khác JSON `null`: câu mới đánh dấu (lưu `answer: null` với
`isFlagged: true`) không tính, và xoá đáp án làm giảm số đếm (F3).

`ExamAttemptView` (dùng cho cả `POST` và `GET` attempt):

```json
{ id, testId, status, startedAt, expiresAt, serverNow, remainingSeconds, maxScore, questionCount, test:{title,instruction,levelCode,durationMinutes,passScore}, sections:[{key,orderIndex,title,instruction,skill,groups:[{key,orderIndex,title,instruction,content,audio,image,questions:[{key,orderIndex,type,skill,content,answers,audio,image}]}]}], answers:[{questionKey,answer,isFlagged,version,answeredAt,lastSavedAt}] }
```

`ExamAnswerSaveView` = `ExamAnswerView` + `serverNow`, `remainingSeconds`; `ExamAnswerView` =
`{ questionKey, answer, isFlagged, version, answeredAt, lastSavedAt }` (TL-127). `questionKey`
chính là `ExamAnswer.snapshotQuestionKey` nội bộ (`q<orderIndex>`); `answer` là shape của
learner (`{choice}`, `{value}`, `{text}`, `{order}`) hoặc `null` khi đã xoá đáp án.
`answeredAt` là lần đầu lưu một đáp án khác `null`, giữ nguyên khi xoá đáp án.

`SaveExamAnswer` (body lưu một câu, TL-121):

```json
{ "answer": { "choice": "a" } | null, "isFlagged": false, "expectedVersion": null, "idempotencyKey": "<uuid>", "clientElapsedMs": 12345 }
```

`answer: null` xoá đáp án nhưng **giữ** `isFlagged`. Shape đáp án theo `snapshot.type` (TL-122):
`mcq` = `{ choice: <id option trong snapshot> }`; `true_false` = `{ value: boolean }`;
`fill_blank` = `{ text: string }` chuẩn hoá NFC, trim, 1–200 code point;
`arrange_sentence` = `{ order: [<hoán vị đủ mọi token id trong snapshot>] }`. Sai shape/id →
`400 EXAM_ANSWER_INVALID` với `details.field` (`answer.choice`, `answer.value`, `answer.text`,
`answer.order`). Server **không** chấm đúng/sai ở bước này (M4.3).

`expectedVersion`: `null` nghĩa là "tạo mới" — nếu câu đã có row thì `409
EXAM_ANSWER_VERSION_CONFLICT`; khác `null` phải bằng `version` hiện tại, lưu thành công thì
`version` tăng 1. Conflict trả `details.current` = `ExamAnswerView` của row đang thắng hoặc
`null` khi câu chưa có row. Mỗi lần lưu thành công ghi đúng **một** event `autosaved`
(`idempotencyKey` = key của request, `metadata = { questionKey, version, clientElapsedMs,
bodySha256 }`, **không** chứa nội dung đáp án); trùng key + cùng câu + cùng body →
`200` trả lại row hiện tại (không tăng version, không thêm event), trùng key nhưng khác câu
hoặc khác body → `409 EXAM_IDEMPOTENCY_KEY_REUSED` (TL-123). Cột
`ExamAnswer.saveIdempotencyKey` chỉ giữ key mới nhất.

Batch (TL-124): chạy trong **một** transaction, mỗi item dùng đúng logic trên; lỗi từng item
không làm hỏng lô — **trừ** body chứa khoá `__proto__` (bị chặn ở tầng raw-body trước DTO và trả
`400 EXAM_ANSWER_INVALID` cho cả request, vì class-transformer sẽ làm mất dấu vết của khoá này).
`results[i].status` ∈ `saved | replayed | conflict | invalid | not_found`
kèm `answer` (saved/replayed), `code` (invalid; `EXAM_ANSWER_INVALID` hoặc
`EXAM_IDEMPOTENCY_KEY_REUSED`) hoặc `current` (conflict). 1–20 item, `questionKey` trùng
trong lô → `400 REQUEST_VALIDATION_FAILED`, `questionKey` không có trong snapshot →
`not_found` của riêng item. Attempt đã đóng/hết hạn thì **cả lô** `409` như dưới.

Lỗi (mã máy trong `error.code`; message tiếng Anh giữ nguyên):

| HTTP | `error.code` | Khi nào |
| --- | --- | --- |
| `401` | `UNAUTHORIZED` | Thiếu/sai token |
| `404` | `EXAM_TEST_NOT_FOUND` | Đề không tồn tại, đang nháp, đã lưu trữ hoặc ngoài cửa sổ `availableFrom`/`availableTo` — không lộ đề nháp |
| `409` | `EXAM_TEST_UNAVAILABLE` | Nội dung đề không còn hợp lệ lúc bắt đầu; `details.reasons` dùng cùng bộ mã với bước publish ở A.9c |
| `409` | `EXAM_IDEMPOTENCY_KEY_REUSED` | Cùng `idempotencyKey` đã dùng cho đề khác (`POST` start) hoặc cho câu/body khác (`PUT` answers) |
| `404` | `EXAM_ATTEMPT_NOT_FOUND` | Attempt không tồn tại hoặc không phải của người gọi |
| `404` | `EXAM_QUESTION_NOT_FOUND` | `:questionKey` không khớp `^q\d+$` hoặc không có trong snapshot của attempt (TL-121) |
| `400` | `EXAM_ANSWER_INVALID` | Sai kiểu hoặc sai shape với `snapshot.type`, hoặc sai id option/token: `details.field` theo type (`answer.choice`, `answer.value`, `answer.text`, `answer.order`); thiếu hẳn `answer` → `details.field = answer` |
| `409` | `EXAM_ANSWER_VERSION_CONFLICT` | `expectedVersion` lệch version hiện tại, hoặc `null` khi câu đã có row; `details.current` |
| `409` | `EXAM_ATTEMPT_EXPIRED` | Chỉ `PUT` (một câu hoặc lô) trả mã này khi quá `expiresAt + 5 s` và vừa chuyển attempt sang `timed_out`; `GET` cũng chuyển `timed_out` nhưng trả `200`, còn `media-grants` chỉ đọc và không đổi status |
| `409` | `EXAM_ATTEMPT_CLOSED` | Attempt không còn `in_progress` (submitted/timed_out/invalidated); `details.status` |
| `400` | `REQUEST_VALIDATION_FAILED` | Body sai: thiếu `isFlagged`/`expectedVersion`/`idempotencyKey`, key không phải UUID, `items` ngoài 1–20 hoặc trùng `questionKey`, hoặc có field thừa |

Hành vi Q120: mỗi học viên có **tối đa 1 bài `in_progress` trên mỗi đề** (partial unique index
ở `docs/database/P0_DATA_DICTIONARY.md`); bấm "Bắt đầu" khi đang có bài dở trả lại chính bài
đó (`200`, đồng hồ vẫn chạy tiếp). Bài đang làm còn hạn được trả lại ngay cả khi nội dung đề
đã đổi sau khi bắt đầu (Q121); cổng publish chỉ chạy khi tạo bài mới. Bài `in_progress` đã quá
hạn bị chuyển `timed_out` (event `timed_out`, `metadata.reason = 'expired_on_start'`) rồi tạo
bài mới (`201`); `GET` intro coi bài quá hạn là `activeAttempt: null` và **không** đổi dữ liệu.

Đồng hồ và timeout lười (TL-126/TL-127, F1/F4): thời điểm hiện tại lấy bằng `clock_timestamp()`
của PostgreSQL **sau khi** transaction đã giữ khoá `ExamAttempt` (start: sau khoá User và khoá
attempt ở nhánh đóng; save/GET/media-grants: sau khoá attempt), nên ân hạn được xét đúng lúc
khoá đã nằm trong tay (một save đang chờ khoá sẽ bị xét theo đồng hồ sau khi khoá về tay nó).
Lưu được chấp nhận khi `now < expiresAt + 5 s` (hằng `EXAM_SAVE_GRACE_SECONDS`); quá ngưỡng đó
mà status còn `in_progress` thì `PUT`/`GET` áp dụng timeout lười: `status = timed_out`,
`submittedAt = expiresAt`, `remainingSeconds = 0`, ghi đúng **một** event `timed_out` với
`metadata.reason = 'expired_on_save'` (PUT) hoặc `'expired_on_read'` (GET), rồi PUT trả
`409 EXAM_ATTEMPT_EXPIRED` (lần lưu sau thấy `timed_out` nên trả `409 EXAM_ATTEMPT_CLOSED`).
Riêng start **không** áp ân hạn: qua `expiresAt` là đóng attempt ngay
(`reason = 'expired_on_start'`); ân hạn 5 s chỉ dành cho save đang bay, và save đang giữ khoá
commit trước nên start thấy attempt đã đóng và bỏ qua bước đóng. Mọi chuyển
`in_progress → timed_out` là update có điều kiện `status = 'in_progress'` và chỉ transaction
thắng mới ghi event, nên một attempt có **đúng một** event `timed_out`. `GET` trả `200` với
`status = timed_out`; lần đọc thứ hai không ghi thêm event. `remainingSeconds` không bao giờ âm.

Khoá khi lưu (TL-125, F8d): `ExamAttempt FOR UPDATE` theo `id` đã lọc `userId` (không thuộc
người gọi → `404`), rồi row `ExamAnswer`; đường lưu **không** khoá User/Test/Media. Lần insert
đầu tiên của một câu có FK `questionId` nên PostgreSQL ngầm lấy `FOR KEY SHARE` trên row
`Question` tương ứng, vì vậy lượt lưu đầu tiên của câu đó có thể phải chờ transaction admin
đang sửa câu (`Question FOR UPDATE`). Không có vòng deadlock: start giữ `Question FOR SHARE`,
tương thích với `FOR KEY SHARE`, nên save đang giữ khoá attempt không phải chờ start; còn
admin không bao giờ chờ `ExamAttempt`. Thứ tự hiệu dụng: start = User → Test/Question/Media
(`FOR SHARE`) → ExamAttempt (`FOR UPDATE`, chỉ ở nhánh đóng attempt hết hạn); save/GET =
ExamAttempt (`FOR UPDATE`) → (chỉ lần insert đầu) Question `FOR KEY SHARE`.

Media của bài thi (TL-128): `GET /exam/attempts/:attemptId/media-grants` chỉ trả khi attempt
của người gọi còn `in_progress` và chưa quá `expiresAt + 5 s` (route **chỉ đọc**: có lấy khoá
`ExamAttempt` để đọc đồng hồ sau khoá nhưng không đổi status, không áp dụng timeout lười); `grants` gồm mọi `mediaId` có trong snapshot (media của nhóm và của câu) với
`url` đúng định dạng `/api/v1/media/:id/content?expires&signature` của signer hiện có, TTL =
`min(remainingSeconds + 60, 300)` giây; media không còn dùng được thì bỏ khỏi `grants` và chỉ
nêu `mediaId` ở `unavailable`. Không mở rộng `GET /media/:id/access` cho exam.

R11: response dựng theo allowlist từng trường; khi đang thi không bao giờ trả `correctAnswer`,
`explanation`, `acceptedTexts`, `caseSensitive`, `tokenIds`, `optionId`, `isCorrect`,
`contentHash`, `questionId`, `questionVersion`. Đáp án/giải thích chỉ có trong snapshot nội bộ
và chỉ dùng để chấm điểm, xem lại sau khi nộp (A.9c nói về snapshot của đề; payload snapshot
ghi ở `docs/database/P0_DATA_DICTIONARY.md`).

Ghi chú: `remainingSeconds = max(0, expiresAt − now)` và `serverNow` theo giờ server (đồng hồ
tính bằng giờ server, Q122); `maxScore = 100 × số phần` (Q118); key câu dạng `q<orderIndex>`
chính là `ExamAnswer.snapshotQuestionKey` (đổi tên thành `questionKey` trong response từ
M4.2b). Rate limit (TL-130): `PUT` một câu 240/phút (môi trường test 1 000), `PUT` lô 60/phút,
`GET` attempt 60/phút, media-grants 30/phút.

### A.10 Admin Media Library và Ingestion (admin)

Response có `Cache-Control: no-store`.

| Method | Path | Input | `data` | Status |
| --- | --- | --- | --- | --- |
| `GET` | `/admin/cms/media` | `type?` (audio/image/pdf/video), `processingStatus?`, `lifecycle?` (active/archived), `dataSourceId?`, `page`, `limit` | `MediaAdmin[]` + `meta` (thêm `meta.ingestionEnabled: boolean` = `MEDIA_INGESTION_ENABLED`, không lộ cấu hình khác); sort `updatedAt DESC, id DESC` | 200 |
| `GET` | `/admin/cms/media/:mediaId` | — | `MediaAdmin` + `usage: { lessonExercises: [{ id, lessonId, topicId, prompt, status }] (≤50), counts: { lessonExercises, otherContent } }` | 200 |
| `POST` | `/admin/cms/media/:mediaId/quarantine` | — | `{ idempotent, media }`; đã archived → `409` | 201 |
| `POST` | `/admin/cms/media/:mediaId/archive` | — | `{ idempotent, media }` | 201 |
| `POST` | `/admin/cms/media/ingestions?dataSourceId=` | `multipart/form-data`, đúng một field `file` ≤10 MiB (JPEG/PNG/MP3/WAV); header `Idempotency-Key` 32–128 | `{ idempotent, media: { id, type, mimeType, size, processingStatus } }` | 201 |
| `GET` | `/admin/cms/media/ingestions` | `page`, `limit` (mặc định 20, ≤100) | `MediaIngestionAdmin[]` + `meta` phân trang; sort `startedAt DESC, id DESC` | 200 |
| `POST` | `/admin/cms/media/ingestions/:ingestionId/cleanup` | — | `{ ingestionId, cleanupCompleted: true }` hoặc `{ ingestionId, cleanupCompleted: false, settling: true }` | 201 |

`MediaAdmin`: `{ id, filename, type, mimeType, size, duration, processingStatus, lifecycle,
usageCount, dataSourceId, uploadedById, updatedById, deletedAt, createdAt, updatedAt,
dataSource: { id, code, name, version } }` — không URL, storageKey, checksum.

`MediaIngestionAdmin` (M5.2b, TL-46/TL-47): `{ id, status, failureCode, filename, size,
dataSource: { id, code, name, version }, startedAt, processingStartedAt, cleanupRequiredAt,
cleanupAttempts, cleanupLastAttemptAt, cleanupAvailable }`. Chỉ liệt kê lượt cần đối soát:
`status = 'cleanup_required'`, hoặc `status = 'processing'` có `processingStartedAt` cũ hơn
15 phút (cùng điều kiện với metric `hsk_media_stuck_processing`, hằng
`MEDIA_INGESTION_STUCK_PROCESSING_SQL`); `failed`/`rejected`/`completed` không hiện.
`cleanupAvailable` = `cleanup_required` và provider storage của bản ghi trùng adapter hiện tại.
Không trả `storageKey`, `processingToken`, `idempotencyKeyHash`, `requestFingerprint`,
`checksum`, `storageProvider`, `source*Snapshot`, `cleanupAbsentObservedAt`, `actorId`,
`mediaId`, `declaredMimeType`, `validatedMimeType`. Không gắn cờ ingestion: danh sách và
cleanup vẫn chạy khi `MEDIA_INGESTION_ENABLED=false` (ADR-005). Route khai báo trước
`/admin/cms/media/:mediaId`.

Ingestion: `MEDIA_INGESTION_ENABLED=false` → từ chối; giới hạn concurrency trong
process qua `MEDIA_INGESTION_MAX_CONCURRENCY` (1–16, mặc định 4): khi đầy slot → drain
có giới hạn; quá giới hạn hoặc quá hạn thì trả `503` rồi đóng; request không có body
thì trả `503`. `503` có `error.code` `MEDIA_INGESTION_BUSY`, `Retry-After: 1` và
`Connection: close`; 5 request/admin/phút → `429`; quá size → `413` `error.code`
`UPLOAD_TOO_LARGE`; multipart hỏng → `400` `error.code` `MULTIPART_INVALID`; client
ngắt trong khi upload body → client không nhận được response (kết nối đã đóng); không tạo
bản ghi ingestion; upload timeout → `408` `MEDIA_UPLOAD_TIMEOUT`; file bị reject →
`400/422` (nguồn thiếu giấy phép → `422` `MEDIA_SOURCE_NOT_APPROVED`); `409` có `error.code`:
`IDEMPOTENCY_KEY_IN_USE` (cùng key khác request), `MEDIA_INGESTION_IN_PROGRESS` (đang xử lý),
`IDEMPOTENCY_KEY_RENEWAL_REQUIRED` (key đã qua dọn dẹp storage, cần key mới),
`MEDIA_STORAGE_PROVIDER_MISMATCH` (provider storage của bản ghi khác adapter); message tiếng Anh
giữ nguyên; scanner/storage timeout →
`503`. Sau khi đã nhận đủ body, client ngắt kết nối không huỷ công việc (việc tiếp tục
hoàn tất trong nền và retry với cùng `Idempotency-Key` được replay `201` với
`idempotent: true`). Pipeline: claim → sharp/music-metadata → ClamAV → reserve → put →
finalize. Chi tiết ADR-005 và runbook.

### A.11 Media signed access

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| `GET` | `/media/:mediaId/access` | JWT (admin, hoặc learner khi media được một exercise public tham chiếu: cùng điều kiện với route attempts, xem dưới bảng); 120/phút/user | `200` `data: { expiresAt, url }`; `url` tương đối `/api/v1/media/:id/content?expires=&signature=`; không đủ quyền → `403`; media không ready → `404` |
| `GET` | `/media/:mediaId/content?expires=<unix>&signature=<64 hex>` | public (capability URL; TTL learner cố định 300 giây, admin theo `MEDIA_ACCESS_TTL_SECONDS` 60–600 giây, mặc định 300); 60/phút/grant và 600/phút/IP | bytes thô, không envelope, với `Content-Type`, `Content-Length`, `Accept-Ranges: bytes`, `Content-Disposition: inline`, `Cache-Control: private, no-store`, `nosniff`, `X-Request-ID`. Một range `bytes` hợp lệ → `206` với `Content-Range: bytes s-e/size`; range ngoài kích thước → `416` envelope JSON (`error.code` `MEDIA_RANGE_NOT_SATISFIABLE`) kèm `Content-Range: bytes */size`; header hỏng, nhiều range hoặc unit khác → `200` cả file. Lỗi khác vẫn là envelope JSON: grant sai/hết hạn → `403` (xét trước Range); `429` của backend; `503` với `error.code` `MEDIA_STORAGE_UNAVAILABLE` / `MEDIA_STORAGE_PROVIDER_MISMATCH` / `MEDIA_STORAGE_INTEGRITY_ERROR` |

Learner chỉ nhận grant khi có ít nhất một `LessonExercise` dùng media thoả đúng predicate
của route attempts (`PUBLIC_LESSON_EXERCISE_WHERE` + `buildLessonReadyWhere()`): exercise
published, chưa soft-delete, loại public (listening_choice thì media audio ready), topic
(nếu có) published; lesson published, Level published và chưa soft-delete, lesson có ít
nhất một topic hoặc story published. Admin không đổi.

Rate limit route content: bucket `default` khoá theo `grant:<sha256(mediaId:expires:signature)>`
(không chứa chữ ký gốc) khi `mediaId`, `expires`, `signature` đúng dạng và
`now ≤ expires ≤ now + max(TTL learner, TTL admin) + 60`; ngược lại khoá theo IP. Throttler
riêng `mediaContentIp` giữ trần 600/phút/IP chỉ cho route này. Ở edge, nginx thêm
`limit_req` 20 req/giây/địa chỉ, burst 200, trả `429` có `Cache-Control: private, no-store`; body
429 của edge là trang lỗi HTML của nginx, không phải envelope JSON.

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
| `/api/admin/media/ingestions/:ingestionId/cleanup` | `POST` | Dọn dẹp lượt tải (M5.2b, TL-50): kiểm `Origin` → 403, id `^[1-9]\d{0,9}$` và ≤ 2 147 483 647 → 400, cookie admin → 401 rồi `POST` không body tới backend; thành công trả `201` + `no-store`; giữ status và `code` lỗi của backend (`503` `MEDIA_CLEANUP_REQUIRED`/`MEDIA_CLEANUP_OUTCOME_UNKNOWN`, `409`); lỗi khác hay phản hồi lệch shape → `503` |
| `/api/admin/media/:id/access`, `/content` | `GET` | Xem trước media ở trang chi tiết (TL-54): cùng handler với `/api/learner/media/:id/*` nhưng đọc cookie `hsk_admin_session` và trả `src` `/api/admin/media/:id/content?expires=&signature=`; TTL grant admin = `MEDIA_ACCESS_TTL_SECONDS` |
| `/api/admin/exercise-imports/preview` | `POST` | Preview nhập bài tập (M5.1b2): kiểm `Origin` → 403, cookie admin → 401, body > 102 400 byte → 413, JSON hỏng → 400 rồi chuyển tiếp `/admin/cms/exercise-imports/preview`; giữ `code`/`details` của backend |
| `/api/admin/exercise-imports` | `POST` | Commit nhập bài tập: như route preview, thêm header `Idempotency-Key` bắt buộc đúng `IDEMPOTENCY_KEY_PATTERN` (sai/thiếu → 400) và body > 102 400 byte → 413; chuyển key qua `RequestOptions.idempotencyKey` |
| `/api/admin/users/:id/role` | `PATCH` | Đổi vai trò (M5.3, TL-70): kiểm `Origin` → 403, id `^[1-9]\d{0,9}$` và ≤ 2 147 483 647 → 400, cookie admin → 401, JSON body 400 nếu không phải object có `role` là `user`/`admin`; chỉ chuyển tiếp đúng `{ role }`, trả `200` + `no-store`, giữ `code` lỗi backend |
| `/api/admin/users/:id/suspend` | `POST` | Khoá tài khoản (M5.3): như route role, body phải có `reason` là string (backend tự trim/kiểm 1–500 → 400); chỉ chuyển tiếp đúng `{ reason }`, trả `201` + `no-store`, giữ `code` lỗi backend |
| `/api/admin/users/:id/unsuspend` | `POST` | Mở khoá (M5.3): như route role nhưng không đọc body, chuyển tiếp `POST /admin/users/:id/unsuspend`, trả `201` + `no-store`, giữ `code` lỗi backend |

Trang admin đọc dữ liệu bằng Server Component gọi thẳng backend (`exercise-service.ts`,
`media-service.ts`), không qua BFF route. Bốn route `GET` `/api/admin/exercises`,
`/api/admin/exercises/:id`, `/api/admin/media`, `/api/admin/media/:id` không có consumer
nên đã bị xoá (H.14, E-01) để thu hẹp bề mặt tấn công; thêm lại route đọc cho client
component phải kèm redact `answer`/snapshot và `media.url` cùng test. Layout admin không
render lại khi điều hướng client, nên mỗi trang admin tự map lỗi backend `401` → login và
`403` → `/forbidden`.

Hai route import trả lỗi theo envelope BFF (`failure(status, code, details)`), nên `422`
giữ `error.details.errors`, `409` giữ status và `413` được UI dịch thành câu tiếng Việt
("Tệp tối đa 90 KB." cho tệp người dùng chọn; body BFF lớn hơn 100 KB không lộ message thô).

Route preview (Z1): giữ tối đa 100 lỗi ĐẦU theo thứ tự backend trong `data.errors`, thêm
`data.errorsTotal` là tổng số lỗi thật; UI hiện "Hiện 100 lỗi đầu trong N lỗi." khi
`errorsTotal > 100`. Thiếu/sai `Idempotency-Key` ở route commit trả `400`
`error.code = INVALID_IDEMPOTENCY_KEY`. Kiểm `Content-Length > 102 400` chạy trước khi đọc
body (Z12), vẫn giữ kiểm theo độ dài thật sau khi đọc cho request không có header.

### A.13 Admin Users và Audit (admin)

Response có `Cache-Control: no-store`. Cả 5 route yêu cầu JWT admin: thiếu/sai token
→ `401`, role `user` → `403`.

| Method | Path | Input | `data` | Status |
| --- | --- | --- | --- | --- |
| `GET` | `/admin/users` | `role?` (`user`/`admin`), `status?` (`active`/`suspended`/`deletion_pending`), `q?` ≤100 ký tự sau trim, `page`, `limit` | `AdminUser[]` + `meta` phân trang; sort `createdAt DESC, id DESC` | 200 |
| `PATCH` | `/admin/users/:id/role` | `{ role: 'user' \| 'admin' }` | `AdminUser` | 200 |
| `POST` | `/admin/users/:id/suspend` | `{ reason: string }` 1–500 ký tự sau trim | `AdminUser` | 201 |
| `POST` | `/admin/users/:id/unsuspend` | — | `AdminUser` | 201 |
| `GET` | `/admin/audit-logs` | `targetType?`, `targetId?` (≤64 ký tự sau trim), `page`, `limit` | `AdminAuditLog[]` + `meta` phân trang; sort `createdAt DESC, id DESC` | 200 |

`AdminUser`: `{ id, email, name, role, status, lastLoginAt, createdAt }` — không bao giờ
trả `password`, `failedLoginAttempts`, `lockUntil` hay token.

- Mặc định `GET /admin/users` loại `status = 'anonymized'` và mọi bản ghi đã có
  `deletedAt`. `status=deletion_pending` là cách duy nhất thấy bản ghi chờ xoá (bản ghi
  này đã có `deletedAt` do yêu cầu xoá đặt trước đó).
- `q` tìm ILIKE trên `email` hoặc `name`; `%`, `_`, `\` được escape để khớp literal; `q`
  rỗng sau trim coi như không lọc. `role`, `status` ngoài danh sách trên, `q` >100 ký tự
  hay query lạ → `400 REQUEST_VALIDATION_FAILED`.
- `:id` qua `ParsePositiveSafeIntegerPipe`: không phải số nguyên dương
  `1..2147483647` → `400`. Id không tồn tại hoặc user đã anonymized → `404`.

`AdminAuditLog`: `{ id, createdAt, action, actor: { id, name, email } | null, targetType,
targetId, target: { email } | null, reason, roleChange }`.

- `id` là chuỗi vì `AuditLog.id` là PostgreSQL bigint.
- `actor` null khi hành động do hệ thống thực hiện.
- `target` chỉ có khi `targetType` là user (không phân biệt hoa/thường, vì audit cũ ghi
  `User`) và user đó chưa anonymized; ngược lại `null`.
- `reason` chỉ với `user.suspended`; `roleChange: { from, to } | null` chỉ với
  `user.role_changed` (TL-67a — ngoại lệ duy nhất cho quy tắc cấm trả summary, chỉ hai giá
  trị role). Không trả `ipAddress`, `userAgent`, `beforeSummary`, `afterSummary` hay bất kỳ
  phần nào khác của summary.
- Lọc `targetType` so khớp chính xác chuỗi đã lưu (audit cũ có thể là `User`).

Ghi audit (TL-66): action `user.role_changed`, `user.suspended`, `user.unsuspended`;
`targetType = 'user'`, `targetId` là chuỗi id, `actorId` là admin thực hiện,
`correlationId` = request id, `beforeSummary`/`afterSummary` chỉ chứa `{ role }` hoặc
`{ status }` (+ `{ reason }` với `user.suspended`). Không ghi IP/UA.

Nghiệp vụ:

- Mọi mutation chạy trong một transaction, mở đầu bằng `pg_advisory_xact_lock` trên một
  key hằng dùng chung; phép đếm "admin active cuối cùng" chạy trong cùng transaction đó.
  Mọi `UPDATE` đều có điều kiện trạng thái trong `WHERE` (row lock trên user mục tiêu).
- TL-76: ngay sau `pg_advisory_xact_lock`, mutation đọc lại hàng actor bằng
  `SELECT … FROM "User" WHERE id = <actorId> FOR UPDATE`; actor phải có `role='admin'`,
  `status='active'`, `deletedAt IS NULL`. Không đạt → `403 FORBIDDEN`, message
  `Insufficient role.` (giống RolesGuard), không UPDATE và không ghi audit. Nhờ vậy request
  của admin vừa bị hạ quyền/khoá trong lúc đang xử lý sẽ fail closed thay vì commit.
- `PATCH role`: chỉ user `active` hoặc `suspended` mới đổi được. Tự đổi role của chính
  mình → `409 ADMIN_SELF_ACTION_FORBIDDEN` (kể cả khi gửi đúng role hiện tại). Hạ quyền
  admin `active` cuối cùng → `409 LAST_ADMIN_REQUIRED`. Gửi đúng role hiện tại → `200`,
  không ghi audit. Hạ quyền admin đang `suspended` không bị chặn bởi luật admin cuối.
- `POST suspend`: chỉ `active` → `suspended`; mọi `UserSession` chưa bị thu hồi của user
  nhận `revokedAt` trong cùng transaction nên access token cũ nhận `401` ngay lần request
  kế tiếp. Tự khoá mình → `409 ADMIN_SELF_ACTION_FORBIDDEN`. Khoá admin `active` cuối
  cùng → `409 LAST_ADMIN_REQUIRED`.
- `POST unsuspend`: chỉ `suspended` → `active`; không mở khoá tài khoản
  `deletion_pending`/`anonymized`.

Lỗi (mã máy trong `error.code`; message tiếng Anh giữ nguyên từng chữ):

| `error.code` | HTTP | Khi nào |
| --- | --- | --- |
| `USER_NOT_FOUND` | 404 | Id không tồn tại hoặc user đã anonymized |
| `ADMIN_SELF_ACTION_FORBIDDEN` | 409 | Admin tự đổi role hoặc tự khoá tài khoản mình |
| `USER_NOT_MODIFIABLE` | 409 | Đổi role user không ở trạng thái `active`/`suspended` (vd `deletion_pending`) |
| `LAST_ADMIN_REQUIRED` | 409 | Hạ quyền hoặc khoá admin `active` cuối cùng |
| `USER_NOT_ACTIVE` | 409 | Khoá user không ở trạng thái `active` |
| `USER_NOT_SUSPENDED` | 409 | Mở khoá user không ở trạng thái `suspended` |
| `FORBIDDEN` | 403 | Token không phải admin |
| `UNAUTHORIZED` | 401 | Thiếu/sai token |
| `REQUEST_VALIDATION_FAILED` | 400 | `:id`, body hoặc query sai shape/giới hạn (chi tiết như §1) |

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
| `PATCH` | `/dictionary/words/:id/progress` | Tiến độ học từ | M3 |
| `GET` | `/review/due`; `POST` `/review/sessions`, `/review/cards/:id/grade` | SRS | M3 |
| CRUD | `/admin/cms/tests` (đã có ở A.9c); `/admin/cms/questions` (đã có ở A.9b) | Exam authoring | M4 |
| `PUT/POST/GET` | `PUT` `/exam/attempts/:id/answers/:key`; `POST` `/exam/attempts/:id/submit`; `GET` `/exam/results/*` | Exam attempt flow (snapshot, autosave, resume, submit) | M4 |
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
