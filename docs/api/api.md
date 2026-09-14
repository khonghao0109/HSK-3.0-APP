# API Specification — HSK System

## 0. Trạng thái tài liệu

Cập nhật 04/09/2026 theo HEAD `3211bf8`. Tài liệu chia hai phần:

- **Part A — Đã triển khai**: chỉ gồm endpoint có controller trong `backend/src/modules`,
  mô tả đúng request/response như code hiện tại (kể cả chỗ chưa đẹp).
- **Part B — Dự kiến**: endpoint chưa có code, gắn milestone theo
  [../product/roadmap.md](../product/roadmap.md) §6. Không được coi là hợp đồng.

Khi thêm hoặc đổi endpoint, sửa Part A, DTO, test và `docs/PLAN.md` trong cùng PR.
Kế hoạch sinh OpenAPI từ code nằm ở ADR-008 §5; khi có `openapi.json`, Part A trỏ tới
spec sinh thay vì viết tay.

## 1. Quy ước thực tế

- Base path: `/api/v1`; versioning theo path; JSON UTF-8.
- Auth: `Authorization: Bearer <jwt>` cho route đánh dấu `JWT`/`admin`. Public content,
  dictionary, health và signed media content không cần token. JWT HS256 có header `kid`,
  claims `sub`, `email`, `role`; strategy đọc lại `status`, `deletedAt`, `role` từ DB mỗi
  request. Chưa có refresh/revocation.
- Validation: `whitelist`, `forbidNonWhitelisted`, `transform`. Field lạ → `400` với
  path `$.$unknown`. Boolean chỉ nhận JSON boolean thật. ID trên path phải là số nguyên
  dương `1..2147483647`, sai → `400`.
- Envelope: **không có interceptor toàn cục.** Learning, Onboarding, Activity/Progress,
  CMS, Media Admin/Ingestion và Media access trả `{ "success": true, "data": …,
  "meta"?: … }`. Auth, Users và Dictionary trả object/array trần. Health trả
  `{ success, database, env, port }`. Client không được giả định một envelope duy nhất
  (backlog A-03).
- `meta` chỉ xuất hiện ở list phân trang: `{ page, limit, total, totalPages }`. Không có
  `meta.requestId`/`timestamp`. Header `x-request-id` (UUID) chỉ được đọc vào audit log
  ở route CMS, không echo ra response.
- Lỗi: body mặc định NestJS `{ statusCode, message, error }`. Validation `400` trả
  `{ code: "REQUEST_VALIDATION_FAILED", message, errors: [{ path, codes }] }`. Một số lỗi
  domain trả `{ code, message }` (ví dụ `MEDIA_STORAGE_*` 503, `listening_media_not_ready`
  422, `UPLOAD_TOO_LARGE` 413). Message không phản chiếu SQL/Prisma.
- Pagination: `page ≥ 1`, `limit 1..100` mặc định 20. Không có `sortBy`/`sortOrder`; thứ
  tự cố định theo endpoint.
- Status code: `200` GET; **mọi `POST` trả `201` kể cả idempotent replay** (chưa dùng
  `@HttpCode`); `204` chưa dùng; `400`, `401`, `403`, `404`, `409`, `413`, `422`, `429`,
  `500`, `503`.
- Rate limit: toàn cục 20 req/phút (`register` 100, `login` 10); `429` với body
  `{ statusCode: 429, message: "ThrottlerException: Too Many Requests" }`. Khoá
  `user:<id>` khi bearer JWT hợp lệ (kid, chữ ký HS256, hạn; không tra DB), còn lại
  `ip:<req.ip>`. `register`/`login` luôn khoá theo IP. `req.ip` lấy từ
  `X-Forwarded-For` qua `TRUST_PROXY_HOPS` (mặc định 1: nginx hoặc BFF). Bộ đếm là
  cửa sổ cố định lưu ở bảng PostgreSQL `RateLimitCounter`, dùng chung mọi replica;
  vượt giới hạn thì khoá hết thời gian `ttl` (60 giây), hit trong lúc bị khoá không
  được đếm. Mỗi request thêm một câu upsert; lỗi database làm request thất bại
  (fail-closed), không bỏ qua giới hạn.
- Idempotency: header `Idempotency-Key`; activity 8–128 ký tự `^[A-Za-z0-9][A-Za-z0-9._:-]*$`;
  exercise import 8–128; media ingestion 32–128. Cùng key cùng body → kết quả gốc; cùng
  key khác body → `409`.

## Part A — Đã triển khai

Cột Auth: `public` (không token), `JWT` (account `active`, chưa soft-delete), `admin`
(JWT + `role=admin`, service và DB kiểm lại role trong transaction).

### A.1 Health

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/health` | public |

Response `200`: `{ "success": true, "database": "connected", "env": "production", "port": 3000 }`.
DB lỗi → `500` mặc định. (Backlog: chỉ trả `{ status }`, tách liveness/readiness.)

### A.2 Auth

| Method | Path | Auth | Rate limit |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | public | 100/phút/IP |
| `POST` | `/auth/login` | public | 10/phút/IP; 5 lần sai/15 phút/email |
| `GET` | `/auth/me` | JWT | global |

Body register: `{ "email": string(email), "password": string(≥6), "name"?: string }`.
Email canonicalize `trim().toLowerCase()`; DB unique theo `lower(email)`. Password trong
blacklist → `400 "Password is too weak."`; email đã tồn tại → `401 "Email already exists"`
(backlog: đổi thành `409` chung).

Body login: `{ "email", "password" }`. Sai credential → `401`; account không `active`,
đã soft-delete hoặc đang khoá (5 lần sai → khoá 15 phút) → `403`.

Thứ tự kiểm tra login (H.5, B-01):

1. Throttle theo email đã chuẩn hoá `trim().toLowerCase()`, trước khi tra user: mỗi
   lần thử tính một điểm vào `RateLimitCounter` (key SHA-256 của
   `login:email:<email>`), quá 5 trong 15 phút → `429` như body throttle chung, kể cả
   email không tồn tại. Login thành công xoá bộ đếm này nên chỉ lần sai tích luỹ.
2. Account không `active` → `403` (không tính vào lockout).
3. Lockout: một câu `UPDATE` nguyên tử giữ chỗ lượt thử (tăng `failedLoginAttempts`,
   lượt thứ 5 đặt `lockUntil` = now + 15 phút) trước khi verify Argon2; account đang
   khoá không được giữ chỗ → `403` mà không hash mật khẩu. Thành công đặt lại
   `failedLoginAttempts = 0`, `lockUntil = null`; khoá hết hạn thì đếm lại từ đầu.

Dưới `NODE_ENV=test` giới hạn IP của login nới thành 1.000/phút cho e2e từ loopback,
như giới hạn toàn cục.

Response register/login (`201`, không envelope, không `tokenType`/`expiresIn`):

```json
{ "user": { "id": 1, "email": "user@example.com", "role": "user", "name": null }, "accessToken": "<jwt>" }
```

Response `GET /auth/me` (`200`): `{ "user": { "id": 1, "email": "user@example.com", "role": "user" } }`.

### A.3 Users

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| `GET` | `/users/me` | JWT | `{ id, email, name, role, createdAt }` |
| `GET` | `/users` | admin | mảng cùng shape, sort `id ASC`, chưa phân trang (finding B-05) |

### A.4 Public learning content

Tất cả `public`, envelope `{ success: true, data, meta? }`. Chỉ trả content `published`
và `deletedAt IS NULL`. Lesson phải đạt readiness: Lesson và Level published, có ít nhất
một Topic hoặc Story published.

| Method | Path | Query | `data` |
| --- | --- | --- | --- |
| `GET` | `/levels`, `/learning/levels` | — | `[{ id, name, orderIndex }]` |
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

Response `200` (mảng trần, không `id`):

```json
[{ "hanzi": "学习", "pinyin": "xué xí", "pinyinTone": "xue2 xi2",
   "meanings": [{ "en": "to study", "vi": "học tập" }], "level": "HSK 1" }]
```

### A.6 Onboarding và Learning plan (JWT)

Envelope `{ success: true, data }`. `userId` luôn lấy từ JWT. Write khoá row `User`
`FOR UPDATE`.

| Method | Path | Body | `data` | Status |
| --- | --- | --- | --- | --- |
| `GET` | `/onboarding/status` | — | `{ hasActiveGoal, hasActiveLearningPlan, hasUsableLearningPlan, hasCompletedPlacement, nextStep }` | 200 |
| `GET` | `/onboarding/goals/current` | — | `UserGoal` hoặc `null` | 200 |
| `POST` | `/onboarding/goals` | `CreateGoal` | `UserGoal` (idempotent nếu trùng goal hiện hành) | 201 |
| `GET` | `/learning-plans/current` | — | `LearningPlan` hoặc `null` | 200 |
| `POST` | `/learning-plans` | `{}` | `LearningPlan` | 201 |

`nextStep ∈ set_goal | content_unavailable | generate_plan | ready`. `hasCompletedPlacement`
hiện luôn `false` (chưa có placement API).

`CreateGoal`: `targetLevelId` int ≥ 1 (level phải published) · `targetBand?` int 1–9 trong
`minBand..maxBand`, bắt buộc với `HSK7_9` · `dailyMinutes` int 1–1440 · `reminderEnabled`
boolean · `reminderTime?` `HH:mm`, bắt buộc khi enabled, phải bỏ khi disabled ·
`startDate` `YYYY-MM-DD`.

`UserGoal`: `{ id, targetLevelId, targetBand, dailyMinutes, reminderEnabled, reminderTime,
startDate, isActive, createdAt, updatedAt, targetLevel: { id, code, name, minBand, maxBand } }`.

`LearningPlan`: `{ id, targetLevelId, targetBand, generatedFromPlacementId, status, startDate,
endDate, createdAt, updatedAt, targetLevel, items: [{ id, orderIndex, scheduledDate, status,
lesson: { id, title, description, orderIndex, slug } }] }` — items chỉ gồm Lesson còn ready.

Lỗi: `400` DTO/band/thiếu goal; `404` level không public; `409` không còn Lesson ready hoặc
dữ liệu cần repair.

### A.7 Lesson activity và Progress (JWT)

Envelope `{ success: true, data }`. Mọi `POST` cần header `Idempotency-Key`; thiếu/sai →
`400`; trả `201` kể cả replay. Body `{}` trừ attempt.

| Method | Path | Body | `data` |
| --- | --- | --- | --- |
| `POST` | `/learning/lessons/:lessonId/start` | `{}` | `{ lessonId, status: "learning", eventId, occurredAt }` |
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

Answer theo type: `mcq`/`listening_choice` `{ optionId }`; `fill_blank` `{ text }`;
`arrange_sentence` `{ tokenIds: [] }`; `speaking_repeat` → `422`. Lỗi: `404` content không
public; `409` cùng key khác request; `422` shape sai; `503` timeout.

### A.8 Admin CMS — Lesson / Topic (admin)

Envelope `{ success: true, data, meta? }`. Mọi `POST` trả `201` kể cả `idempotent = true`.
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

Ingestion: `MEDIA_INGESTION_ENABLED=false` → từ chối; 5 request/admin/phút → `429`; quá
size → `413 { statusCode, code: "UPLOAD_TOO_LARGE", message }`; multipart hỏng → `400
{ code: "MULTIPART_INVALID" }`; file bị reject → `400/422`; đang processing hoặc cùng key
khác request → `409`; scanner/storage timeout → `503`. Pipeline: validate bytes → ClamAV →
sharp/music-metadata → ghi object private → commit Media + MediaIngestion + audit. Chi
tiết ADR-005 và runbook.

### A.11 Media signed access

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| `GET` | `/media/:mediaId/access` | JWT (admin, hoặc learner khi media được Exercise published tham chiếu) | `200 { success: true, data: { expiresAt, url } }`; `url` tương đối `/api/v1/media/:id/content?expires=&signature=`; không đủ quyền → `403`; media không ready → `404` |
| `GET` | `/media/:mediaId/content?expires=<unix>&signature=<64 hex>` | public (capability URL, TTL 60–600 giây) | bytes với `Content-Type`, `Content-Length`, `Content-Disposition: inline`, `Cache-Control: private, no-store`, `nosniff`; grant sai/hết hạn → `403`; `503` với `code` `MEDIA_STORAGE_UNAVAILABLE` / `MEDIA_STORAGE_PROVIDER_MISMATCH` / `MEDIA_STORAGE_INTEGRITY_ERROR` |

Signature = HMAC-SHA256 trên `method`, canonical path, `expiresAt`, checksum; so sánh
timing-safe; body được hash lại trước khi trả (finding B-07 về việc không gắn user).

### A.12 Frontend BFF (same-origin Next.js)

Không thay base URL backend, không phải generic proxy. Mọi route mutation kiểm exact
`Origin`. Cookie `hsk_admin_session`: HttpOnly, SameSite=Lax, Path=/, Secure ở
production, `Max-Age ≤ JWT exp`. Fetch tới backend `no-store`, timeout 8 giây, chỉ trả
safe error kind/message/requestId.

| Route | Method | Mục đích |
| --- | --- | --- |
| `/api/session/login` | `POST` | Origin + credentials → backend login → set cookie; response không có token |
| `/api/session/logout` | `POST` | Origin → xoá cookie |
| `/api/session/recover` | `POST` | Xoá cookie khi backend trả 401/403 (fail-closed) |
| `/api/session/me` | `GET` | Đối chiếu cookie với `/auth/me`; hiện không có consumer (E-01) |
| `/api/admin/exercises`, `/api/admin/exercises/:id` | `GET` | Allowlisted read; response lột `answer` top-level; không có consumer (E-01) |
| `/api/admin/media`, `/api/admin/media/:id` | `GET` | Allowlisted read; không có consumer (E-01) |
| `/api/admin/media/:id/quarantine`, `/archive` | `POST` | Mutation an toàn có Origin check; UI dùng |

## Part B — Dự kiến

Chưa có controller. Cột milestone theo roadmap §6.

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
| — | `/api/docs` (OpenAPI sinh từ code) | Tài liệu API | M6 |
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
