# API Specification - HSK System

## 1. Overview

- Base URL: `/api/v1`
- Protocol: `HTTPS`
- Format: `application/json`
- Auth: `Bearer JWT`
- Timezone lưu DB: `UTC`
- Versioning: path-based (`/api/v1`)

> Trạng thái 12/08/2026: schema P0 đã sẵn sàng. Runtime có auth với active-account authorization, user read, health, dictionary search, learning read, Onboarding Goal & Learning Plan V1, CMS Lite publish workflow cho Lesson/Topic, Exercise Authoring & Import Validation V1, Lesson Activity Attempt & Progress V1, Secure Admin Session/Exercise Read Console và Media Asset Operations/Admin Library V1. Backend refresh/revocation session, profile/privacy, placement scoring, CMS cho Level/Story/Word/Question/Test, secure Media upload/ingestion, SRS và exam attempt vẫn là backlog. Artifact Exercise backend V1 và frontend read console đều có fresh-disposable-DB gate evidence.

Visibility runtime hiện hành: public level/word chỉ trả record `status=published` và `deletedAt IS NULL`; pinyin search dùng `pinyinNormalized`. Lesson public còn phải đạt readiness contract ở mục 16.4. Các endpoint archive/delete content trong tài liệu này mang nghĩa soft lifecycle, không hard-delete row đã có lịch sử.

## 2. Conventions

### 2.1 Response format

Success:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-05-05T08:00:00.000Z"
  }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid payload",
    "details": []
  },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-05-05T08:00:00.000Z"
  }
}
```

### 2.2 Status codes

- `200`: OK
- `201`: Created
- `204`: No content
- `400`: Bad request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not found
- `409`: Conflict
- `422`: Unprocessable entity
- `429`: Too many requests
- `500`: Internal error

### 2.3 Pagination

Query params:

- `page` (default `1`)
- `limit` (default `20`, max `100`)
- `sortBy` (field)
- `sortOrder` (`asc` | `desc`)

Numeric query params như `page`, `limit`, `levelId` tiếp tục được chuyển từ chuỗi URL hợp lệ sang number; strict JSON boolean chỉ áp dụng cho field boolean trong request body.

Paginated response `meta`:

```json
{
  "page": 1,
  "limit": 20,
  "total": 120,
  "totalPages": 6
}
```

## 3. Authentication & Authorization

## 3.1 Endpoints

### POST `/auth/register`

Email được canonicalize bằng `trim().toLowerCase()` trước lookup/create và PostgreSQL enforce unique theo `lower(email)`.

Body:

```json
{
  "email": "user@example.com",
  "password": "StrongPassword123!"
}
```

Response: user info + access token.

### POST `/auth/login`

Body:

```json
{
  "email": "user@example.com",
  "password": "StrongPassword123!"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "accessToken": "jwt",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "user": {
      "id": 1,
      "email": "user@example.com",
      "role": "user"
    }
  }
}
```

### GET `/auth/me`

- Header: `Authorization: Bearer <token>`
- Return current user profile.

## 3.2 Role policy

- `user`: học, làm bài, xem kết quả của chính mình.
- `admin`: quản trị nội dung, người dùng, báo cáo.

## 4. Users

### GET `/users/me`

- Lấy thông tin tài khoản hiện tại.

### PATCH `/users/me`

Body (partial):

```json
{
  "displayName": "Nguyen Van A",
  "avatarUrl": "https://..."
}
```

### GET `/users` (admin)

- Danh sách user (pagination).

### PATCH `/users/:id/role` (admin)

- Cập nhật role (`user`/`admin`).

## 5. Levels / Lessons / Topics / Stories

## 5.1 Levels

- `GET /levels`
- Alias: `GET /learning/levels`.
- Level admin mutation chưa có runtime trong CMS Lite V1.

Payload mẫu tạo level:

```json
{
  "name": "HSK 3",
  "code": "HSK3",
  "orderIndex": 3,
  "minBand": 3,
  "maxBand": 3,
  "curriculumVersion": "HSK_3_0"
}
```

P0 chỉ chấp nhận code `HSK1`…`HSK6`, `HSK7_9`; `HSK7_9` có `minBand=7`, `maxBand=9`.

## 5.2 Lessons

- `GET /lessons?levelId=3`
- `GET /lessons/:id`
- Alias: `GET /learning/lessons?levelId=3`, `GET /learning/lessons/:id`.
- Admin revision/review/publish/archive dùng `/admin/cms/lessons`; xem mục 16.4.

Create lesson:

```json
{
  "levelId": 3,
  "title": "Bai 1",
  "description": "Mo ta",
  "orderIndex": 1,
  "slug": "hsk-3-bai-1"
}
```

## 5.3 Topics

- `GET /topics?lessonId=12`
- Alias: `GET /learning/topics?lessonId=12`.
- Admin create/detail/revision/review/publish/archive dùng `/admin/cms/topics`; xem mục 16.4.

## 5.4 Stories

- `GET /stories?levelId=3`
- Alias: `GET /learning/stories?levelId=3`.
- Story admin mutation chưa có runtime trong CMS Lite V1.

## 6. Dictionary

## 6.1 Vocabulary

- `GET /dictionary/words?query=...&levelId=...`
- `GET /dictionary/words/:id`
- `POST /dictionary/words` (admin)
- `PATCH /dictionary/words/:id` (admin)
- `DELETE /dictionary/words/:id` (admin)

Create word:

```json
{
  "hanzi": "学习",
  "pinyin": "xue xi",
  "meanings": [
    {
      "meaningOrder": 1,
      "meaningEn": "to study",
      "meaningVi": "học tập",
      "partOfSpeech": "verb"
    }
  ],
  "example": "wo xihuan xuexi hanyu"
}
```

## 6.2 User word progress

- `POST /dictionary/words/:id/save`
- `PATCH /dictionary/words/:id/progress`

Progress body:

```json
{
  "status": "learning"
}
```

## 7. Progress

- `GET /progress/lessons?userId=me`
- `PATCH /progress/lessons/:lessonId`

Body:

```json
{
  "status": "done",
  "score": 85
}
```

## 8. Exam Domain

## 8.1 Question

- `GET /exam/questions?levelId=...&skill=listening`
- `GET /exam/questions/:id`
- `POST /exam/questions` (admin)
- `PATCH /exam/questions/:id` (admin)
- `DELETE /exam/questions/:id` (admin soft delete)

Create question:

```json
{
  "content": "Ban nghe gi?",
  "type": "listening",
  "skill": "listening",
  "answers": ["A", "B", "C", "D"],
  "correctAnswer": "B",
  "explanation": "Ly do",
  "levelId": 3,
  "audioUrl": "/uploads/audio/hsk3-q1.mp3"
}
```

## 8.2 Test

- `GET /exam/tests?levelId=...`
- `GET /exam/tests/:id`
- `POST /exam/tests` (admin)
- `PATCH /exam/tests/:id` (admin)
- `DELETE /exam/tests/:id` (admin soft delete)

Create test:

```json
{
  "levelId": 3,
  "title": "Mock Test HSK 3 - 01",
  "duration": 2700,
  "questionIds": [101, 102, 103]
}
```

## 8.3 Result

- `POST /exam/tests/:id/submit`
- `GET /exam/results/me`
- `GET /exam/results/:id`
- `GET /exam/results/analytics` (admin)

Submit body:

```json
{
  "answers": [
    { "questionId": 101, "answer": "B" },
    { "questionId": 102, "answer": "A" }
  ]
}
```

Submit response:

```json
{
  "success": true,
  "data": {
    "resultId": 555,
    "score": 80,
    "correctCount": 20,
    "total": 25,
    "detail": []
  }
}
```

## 9. Materials

- `GET /materials`
- `GET /materials/:id`
- `POST /materials` (admin)
- `PATCH /materials/:id` (admin)
- `DELETE /materials/:id` (admin)
- `POST /materials/upload` (admin)

Material example:

```json
{
  "title": "De thi thu HSK 3",
  "type": "pdf",
  "url": "/uploads/documents/hsk3-mock.pdf",
  "levelId": 3
}
```

## 10. Admin & Analytics

### GET `/admin/dashboard`

- Tổng user, tổng đề thi, tổng lượt làm bài, active users.

### GET `/analytics/overview` (admin)

- Chỉ số tổng quan theo ngày/tuần/tháng.

### GET `/analytics/level/:levelId` (admin)

- Hiệu suất theo cấp độ.

### GET `/analytics/tests/:testId` (admin)

- Tỷ lệ đúng theo câu hỏi, phân bố điểm.

## 11. AI Gateway (Backend -> AI Service)

Backend chỉ làm gateway qua `modules/ai/chat`:

- `POST /ai/chat`
- `POST /ai/retrieve`

Request chat:

```json
{
  "message": "Giai thich tu nay",
  "context": {
    "levelId": 3,
    "lessonId": 12
  }
}
```

Response:

```json
{
  "success": true,
  "data": {
    "answer": "Noi dung tra loi",
    "sources": []
  }
}
```

## 12. File Upload

- Local phase: `backend/uploads/{audio,images,documents}`
- Production phase: S3/Cloudinary.

Rules:

- Max upload size: cấu hình theo env.
- Chỉ nhận mime hợp lệ.
- Đổi tên file tránh collision.
- Lưu metadata trong DB.

## 13. Security Checklist

- JWT secret mạnh, rotate định kỳ.
- Bcrypt hash password.
- Rate limiting cho `auth/login`, `ai/chat`.
- Validation pipe cho toàn bộ DTO.
- CORS whitelist theo env.
- Audit log cho admin actions.

## 14. OpenAPI / Swagger

Chuẩn triển khai:

- `/api/docs` cho swagger UI.
- Mỗi module có tags riêng: `Auth`, `Users`, `Exam`, `Dictionary`, `Materials`, `Analytics`, `AI`.

## 15. Notes

- Spec này là baseline triển khai. Khi thêm endpoint mới phải cập nhật file này cùng pull request.

## 16. P0 runtime contracts và backlog

### 16.1 Active-account authorization — runtime complete

Mọi endpoint dùng `JwtAuthGuard` đều tải lại account theo JWT `sub`. Chỉ account `status=active` và `deletedAt IS NULL` được chấp nhận; email/role lấy từ database hiện tại, không lấy từ claim cũ. Token đúng chữ ký nhưng account không tồn tại, suspended, deletion pending, anonymized hoặc soft-deleted nhận `401` với thông báo không tiết lộ trạng thái nội bộ.

### 16.2 Onboarding Goal & Learning Plan V1 — runtime complete

Tất cả endpoint dưới đây yêu cầu `Authorization: Bearer <JWT>`. `userId` luôn lấy từ JWT và không được nhận qua body/query.

#### GET `/onboarding/status`

```json
{
  "success": true,
  "data": {
    "hasActiveGoal": true,
    "hasActiveLearningPlan": true,
    "hasUsableLearningPlan": true,
    "hasCompletedPlacement": false,
    "nextStep": "ready"
  }
}
```

`hasActiveLearningPlan` chỉ phản ánh có row plan `active`; `hasUsableLearningPlan` chỉ `true` khi plan đó khớp chính xác goal hiện hành **và** snapshot `lessonId` có thứ tự giống hoàn toàn tập Lesson ready hiện hành, đồng thời tập này không rỗng. `nextStep` có bốn giá trị:

- `set_goal`: chưa có active goal.
- `content_unavailable`: có goal nhưng target level hiện không có Lesson ready; plan lịch sử active, nếu có, không bị tự hủy.
- `generate_plan`: có Lesson ready nhưng chưa có plan usable, gồm cả trường hợp archive/recover làm snapshot thay đổi.
- `ready`: có active goal và active plan usable.

Endpoint không trả `PlacementAttempt.detailSnapshot`.

#### GET `/onboarding/goals/current`

Trả active goal của account hiện tại; chưa có goal là trạng thái bình thường và trả `data: null`.

```json
{
  "success": true,
  "data": {
    "id": 10,
    "targetLevelId": 7,
    "targetBand": 8,
    "dailyMinutes": 30,
    "reminderEnabled": true,
    "reminderTime": "20:30",
    "startDate": "2026-08-11",
    "isActive": true,
    "createdAt": "2026-08-10T10:00:00.000Z",
    "updatedAt": "2026-08-10T10:00:00.000Z",
    "targetLevel": {
      "id": 7,
      "code": "HSK7_9",
      "name": "HSK 7-9",
      "minBand": 7,
      "maxBand": 9
    }
  }
}
```

#### POST `/onboarding/goals`

```json
{
  "targetLevelId": 7,
  "targetBand": 8,
  "dailyMinutes": 30,
  "reminderEnabled": true,
  "reminderTime": "20:30",
  "startDate": "2026-08-11"
}
```

- `targetLevelId`: integer dương; level phải `published` và chưa soft-delete.
- `targetBand`: integer 1–9 và thuộc `Level.minBand..maxBand`. Có thể bỏ/null với level một band (server tự resolve); bắt buộc với `HSK7_9`.
- `dailyMinutes`: integer 1–1440, đúng database CHECK.
- `reminderTime`: chỉ dùng format `HH:mm` 24 giờ; bắt buộc khi `reminderEnabled=true` và phải bỏ/null khi false.
- `reminderEnabled`: bắt buộc là JSON boolean thật (`true`/`false`); string, số, `null`, object và array đều trả `400`.
- `startDate`: ngày lịch hợp lệ theo `YYYY-MM-DD`; API và DB giữ date-only, không dịch timezone.
- Field ngoài DTO bị từ chối.

Request giống hoàn toàn active goal là idempotent và trả lại row hiện tại. Khi thay đổi, service khóa row `User` bằng `SELECT ... FOR UPDATE`, deactivate goal cũ và tạo goal mới trong một transaction. Hai request đồng thời không thể để lại nhiều hơn một active goal.

#### GET `/learning-plans/current`

Trả active plan của account hiện tại và items tăng dần theo `orderIndex`; chưa có plan trả `data: null`. Mỗi item có `scheduledDate` date-only và lesson tối thiểu gồm `id`, `title`, `description`, `orderIndex`, `slug`.

#### POST `/learning-plans`

Không có body. Active goal là bắt buộc. V1 snapshot danh sách lesson public tại thời điểm tạo bằng `LearningPlanItem`, xếp một lesson mỗi ngày từ `startDate`; `endDate` là ngày item cuối.

Plan đang active và khớp `targetLevelId`, `targetBand`, `startDate` cùng tập Lesson ready hiện hành được trả lại khi retry. Nếu goal hoặc tập Lesson ready thay đổi, plan cũ chuyển `cancelled` và plan/items mới được tạo trong cùng transaction sau khi khóa row `User`. Lesson được chọn phải đạt readiness contract ở mục 16.4; cùng `orderIndex` được tie-break bằng `id`. Nếu không còn Lesson ready, API trả `409` trước khi cancel plan active hiện hành. Khi đọc plan cũ, item trỏ đến Lesson không còn ready được ẩn khỏi response public nhưng lịch sử row vẫn được giữ.

#### Error contract

- `400`: DTO không hợp lệ, band sai range, thiếu active goal hoặc reminder/date không hợp lệ.
- `401`: JWT/account không được chấp nhận.
- `404`: level không tồn tại, không published hoặc đã soft-delete.
- `409`: trạng thái dữ liệu cần repair hoặc target level chưa có lesson public.

Client không nhận raw Prisma error, constraint name hoặc SQL trigger message.

### 16.3 Session, profile, placement và privacy — backlog

- `GET /auth/sessions`, `POST /auth/refresh`, `DELETE /auth/sessions/:id`.
- `GET|PATCH /users/me/profile`.
- `POST /onboarding/placements`, `POST /onboarding/placements/:id/complete`.
- Cập nhật trạng thái `LearningPlanItem`.
- `POST /privacy/consents`, `POST /privacy/exports`, `POST /privacy/deletion-requests`.
- Account deletion chuyển `deletion_pending` → revoke session/token → loại PII → `anonymized`; không hard-delete User hoặc immutable history. Xem `docs/adr/ADR-001-IMMUTABLE-EVENT-RETENTION-AND-ACCOUNT-DELETION.md`.

Placement scoring chưa được triển khai; client không được gửi score/recommended level. Refresh/reset/verification token chỉ truyền raw value tại transport một lần; database chỉ lưu hash.

### 16.4 CMS Lite Lesson/Topic publish workflow — runtime complete

Tất cả endpoint CMS dưới đây yêu cầu `JwtAuthGuard`, `RolesGuard` và role `admin`. JWT strategy tải lại role, status và `deletedAt` từ database ở mỗi request; claim role cũ không có thẩm quyền. ID trên path là integer dương. Mutation trả `201`; list/detail trả `200`.

#### Lesson admin API

- `GET /admin/cms/lessons?levelId=&status=&search=&page=1&limit=20`: list/filter, kèm latest revision/review.
- `GET /admin/cms/lessons/:lessonId`: live row cùng toàn bộ revision/review mới nhất trước.
- `POST /admin/cms/lessons`: tạo Lesson `draft` và `ContentRevision.revision=1` trong cùng transaction.
- `POST /admin/cms/lessons/:lessonId/revisions`: append revision mới.
- `POST /admin/cms/lessons/:lessonId/revisions/:revisionId/reviews`: append decision `approved`, `changes_requested` hoặc `rejected`.
- `POST /admin/cms/lessons/:lessonId/revisions/:revisionId/publish`: publish latest approved revision.
- `POST /admin/cms/lessons/:lessonId/archive`: chuyển `archived`, đặt `deletedAt`; retry là idempotent.

Body tạo Lesson gồm `levelId`, `title` (1–200), `description` (tối đa 2.000), `orderIndex` (1–1.000.000), `slug` lowercase kebab-case. Body revision không có `levelId`. Client không được gửi status, revision number, author/audit actor hay các timestamp/ID server-controlled.

#### Topic admin API

- `GET /admin/cms/topics/:topicId`.
- `POST /admin/cms/topics`.
- `POST /admin/cms/topics/:topicId/revisions`.
- `POST /admin/cms/topics/:topicId/revisions/:revisionId/reviews`.
- `POST /admin/cms/topics/:topicId/revisions/:revisionId/publish`.
- `POST /admin/cms/topics/:topicId/archive`.

Body tạo Topic gồm `lessonId`, `title`, `subtitle`, `type`, `content`, `orderIndex`, `isPremium`, `isLocked`; body revision không có `lessonId`. `isPremium` và `isLocked` chỉ nhận JSON boolean thật (`true`/`false`); string, số, `null`, object và array đều trả `400`. JSON content tối đa 100.000 byte và depth 20. Topic được phép publish dưới Lesson draft nhưng chỉ lộ public sau khi parent Lesson đạt readiness.

#### Revision state machine và consistency

```text
draft revision -> approved ---------> published live state
              -> changes_requested -X publish
              -> rejected ----------X publish
published live -> new draft revision (live cũ giữ nguyên) -> approved -> atomic replace
published live -------------------------------------------------------> archived
```

- `ContentRevision` và `ContentReview` là append-only ở cả service lẫn database. Snapshot chỉ chứa mutable domain fields và `contentHash` là SHA-256 của canonical JSON.
- Canonical JSON sort object key theo UTF-16 code unit bằng comparator xác định, không phụ thuộc locale; array giữ nguyên thứ tự và kiểu không hỗ trợ bị reject. Đây là contract nội bộ có phạm vi hẹp, không tuyên bố tương thích đầy đủ RFC 8785/JCS.
- Hash revision cũ không bị backfill. Khi retry revision/publish, service còn so sánh canonical snapshot hiện hành để giữ idempotency cho row từng được hash bằng comparator locale-dependent trước đây; hash mới luôn dùng comparator xác định.
- Lock hierarchy luôn theo `Lesson → Topic`: Topic create/revision/review/publish/archive khóa parent Lesson trước Topic. Unique `(entityType, entityId, revision)` chỉ là backstop.
- Chỉ revision mới nhất với latest review `approved` được publish; stale revision hoặc decision khác trả `409`.
- Retry cùng revision payload trả revision hiện hữu với `idempotent=true`. Retry publish live hash giống revision không ghi audit/publish side effect lần hai.
- Unique conflict và concurrent retry trả `409` an toàn; lock/statement timeout trả `503`; raw Prisma/SQL error không được phản chiếu.
- Mỗi create/revision/review/publish/archive ghi `AuditLog` summary gồm entity type/id, action, revision, status và hash; không lưu raw content/answer/token.
- Hai review cùng decision/content là retry idempotent và không tạo fact thứ hai; decision mới vẫn append review mới. `ContentReview` đã tạo không thể UPDATE/DELETE, kể cả qua SQL trực tiếp.

#### Lesson readiness và public visibility

Lesson ready khi đồng thời:

1. Lesson `published` và `deletedAt IS NULL`.
2. Level cha `published` và `deletedAt IS NULL`.
3. Có ít nhất một Topic hoặc Story liên kết trực tiếp đang `published` và chưa soft-delete.

Exercise không bắt buộc ở V1. Cùng policy này được dùng cho public lesson list/detail, public Topic/Story relation, CMS Lesson publish validation và onboarding plan generation. Public lesson detail chỉ trả child Topic/Story/Exercise public; Exercise có `topicId` chỉ visible khi chính Topic đó public. `LessonWord` chỉ trả Word public; `LessonExercise.answer`, `explanation` và internal metadata không được serialize.

#### CMS backlog còn lại

- CMS Level, Story, Word, Question, Test và Media; Exercise V1 đã có runtime riêng ở mục 16.5.
- Import generic cho các entity khác, import job status/error-row UI, four-eyes approval, scheduled publish, bulk action và optimistic version header.

### 16.5 Exercise Authoring & Import Validation V1 — implemented, final release gate GREEN

Tất cả route bên dưới nằm dưới `/api/v1`, yêu cầu `JwtAuthGuard`, `RolesGuard` và role `admin` hiện hành lấy lại từ database. Path ID phải là positive safe integer. Mutation mặc định trả `201`; list/detail trả `200`.

#### Exercise authoring routes

- `GET /admin/cms/exercises?lessonId=&topicId=&type=&status=&page=1&limit=20`: list admin, sắp theo `lessonId, orderIndex, id`, kèm latest revision/review.
- `GET /admin/cms/exercises/:exerciseId`: live/materialized row và revision history mới nhất trước.
- `POST /admin/cms/exercises`: tạo draft + `ContentRevision.revision=1` + audit trong một transaction.
- `POST /admin/cms/exercises/:exerciseId/revisions`: append revision mới; retry canonical payload giống latest revision là idempotent.
- `POST /admin/cms/exercises/:exerciseId/revisions/:revisionId/reviews`: append `approved`, `changes_requested` hoặc `rejected`; retry cùng reviewer/decision/note khi đó vẫn là latest review là idempotent.
- `POST /admin/cms/exercises/:exerciseId/revisions/:revisionId/publish`: chỉ publish latest revision có latest review `approved`.
- `POST /admin/cms/exercises/:exerciseId/archive`: soft-delete bằng `status=archived` và `deletedAt`; retry là idempotent. Hard-delete `LessonExercise` bị database từ chối.

Body create thêm `lessonId` và `topicId` optional; body revision chỉ gồm snapshot mutable:

```json
{
  "lessonId": 12,
  "topicId": 34,
  "type": "mcq",
  "prompt": "Chọn nghĩa đúng của 你好",
  "content": {
    "options": [
      { "id": "hello", "text": "Xin chào" },
      { "id": "goodbye", "text": "Tạm biệt" }
    ]
  },
  "answer": { "optionId": "hello" },
  "explanation": "你好 là lời chào thông dụng.",
  "orderIndex": 1
}
```

Client không được gửi `status`, `version`, revision number, score/correctness, actor, audit metadata, publication fields hoặc timestamp. Shared validator dùng cùng contract cho create, revision, import và scorer:

- Chỉ chấp nhận đúng top-level keys `type`, `prompt`, `content`, `answer`, `explanation`, `mediaId`; mỗi subtype cũng dùng exact-key validation.
- Toàn bộ human text và stable ID được chuẩn hóa Unicode NFKC. Stable ID dài tối đa 128 ký tự, không whitespace, bắt đầu bằng chữ/số và sau đó chỉ dùng chữ/số/`.`/`_`/`:`/`-`.
- Payload canonical tối đa 65.536 byte, depth tối đa 8, string tối đa 4.096 ký tự, array tối đa 100 phần tử; `orderIndex` từ 1 đến 1.000.000.
- Boolean như `caseSensitive` chỉ nhận JSON boolean thật.

| Type | Exact `content` | Exact authoritative `answer` | Publish V1 |
| --- | --- | --- | :---: |
| `mcq` | `{ "options": [{ "id", "text" }, ...] }`, 2–100 stable unique ID | `{ "optionId": "..." }`, ID phải tồn tại | Có |
| `listening_choice` | Giống `mcq` | Giống `mcq` | Có, bắt buộc ready/live audio |
| `fill_blank` | `{}` | `{ "acceptedTexts": [...], "caseSensitive"?: boolean }`, 1–100 đáp án | Có |
| `arrange_sentence` | `{ "tokens": [{ "id", "text" }, ...] }`, 2–100 stable unique ID | `{ "tokenIds": [...] }`, đúng và đủ tập token, không duplicate | Có |
| `speaking_repeat` | `{ "referenceText"?: "..." }` | `{}` | Không; chỉ lưu draft, publish trả `422` |

Lỗi từ shared shape validator trả `422` với `{ code, path, message }`; mọi field lạ trong authoring/import/DTO dùng generic path `$.$unknown`, không phản chiếu tên property do client kiểm soát. Publish `speaking_repeat` trả safe `422` message và listening media trả `422` với `{ code: "listening_media_not_ready", path: "mediaId", message }`. Không phản chiếu raw answer, SQL, constraint name hoặc Prisma error.

#### Revision, version và publish semantics

- `version` của live/materialized `LessonExercise` là revision đang được materialize. Tạo exercise bắt đầu ở revision/version 1.
- Với exercise `draft`, append revision mới đồng thời materialize snapshot mới và tăng `version`.
- Với exercise đang `published`, append draft revision không đổi live row/version; learner tiếp tục thấy bản đã publish. Publish latest-approved revision mới atomically thay snapshot và đặt `version = revision.revision`.
- Create/revision/review/publish đều yêu cầu Lesson/Topic parent còn live và coherent. Khi parent đã archive, content mutation bị từ chối nhưng endpoint archive Exercise vẫn được phép để cleanup lifecycle; database coupling bắt buộc `status=archived` khi và chỉ khi `deletedAt` khác null.
- Stale revision, revision không approved, archived exercise hoặc hash/snapshot không khớp trả conflict; publish retry đúng live hash/version không tạo side effect/audit lần hai.
- Exercise create khóa `active admin actor User FOR SHARE → Lesson FOR UPDATE → Topic FOR UPDATE (nếu có)` rồi insert; mutation trên Exercise hiện hữu khóa tiếp `LessonExercise FOR UPDATE`. Publish listening mới khóa `Media FOR SHARE` sau Exercise. Role `admin` được enforce cùng active/deleted state. Safety `Media UPDATE` phải chờ publish nhả SHARE lock rồi mới có thể quarantine/soft-archive; public visibility sẽ ẩn Exercise sau đó. Learner submit dùng `active User FOR UPDATE → Lesson/Topic/LessonExercise FOR SHARE → progress FOR UPDATE`; publish và submit vì thế serialize an toàn, kể cả cùng user, để attempt chỉ snapshot trọn một version và không trộn old/new fields.

#### Listening media và snapshot an toàn

Chỉ `listening_choice` được mang `mediaId`; shared validator và database CHECK cùng chặn media trên type khác. Listening chỉ publish khi `mediaId` trỏ tới `Media.type=audio`, `processingStatus=ready`, `deletedAt IS NULL` và URL có ít nhất một ký tự, không chứa whitespace. Publish khóa row Media bằng `FOR SHARE` rồi kiểm tra readiness; `Media_url_nonblank_check` và database publish trigger là backstop cho writer ngoài service. Không có media, media pending/failed/quarantined/deleted, URL không an toàn hoặc media không phải audio đều trả `422` với code `listening_media_not_ready`.

Public exercise và immutable attempt snapshot chỉ project media an toàn:

```json
{
  "id": 99,
  "url": "https://cdn.example.com/audio/hello.mp3",
  "type": "audio",
  "mimeType": "audio/mpeg",
  "duration": 12
}
```

Không trả `storageProvider`, `storageKey`, `originalFilename`, checksum hoặc metadata xử lý. Attempt giữ projection media cùng authoritative answer trong snapshot nội bộ để replay/scoring, nhưng response không trả authoritative answer hay raw snapshot. Sau publish, safety workflow vẫn được phép quarantine hoặc soft-archive Media; public query/serializer ẩn Exercise đó ngay, còn immutable attempt snapshot cũ không bị rewrite và vẫn giữ projection đã chốt để replay.

#### Import preview và atomic commit

- `POST /admin/cms/exercise-imports/preview`
- `POST /admin/cms/exercise-imports` với header `Idempotency-Key`

Preview body:

```json
{
  "dataSourceId": 7,
  "fileName": "hsk1-exercises-v1.json",
  "rows": [
    {
      "sourceKey": "hsk1.lesson12.exercise001",
      "lessonId": 12,
      "topicId": 34,
      "orderIndex": 1,
      "type": "fill_blank",
      "prompt": "Điền lời chào",
      "content": {},
      "answer": { "acceptedTexts": ["你好"] },
      "explanation": "Đáp án được chuẩn hóa NFKC."
    }
  ]
}
```

Mỗi row chỉ được có đúng các key `sourceKey`, `lessonId`, `topicId`, `orderIndex`, `type`, `prompt`, `content`, `answer`, `explanation`, `mediaId`. `rows` bắt buộc từ 1 đến 100; `fileName` 1–255 ký tự sau NFKC/trim. `sourceKey` dùng rule stable ID và unique trong một `DataSource`; cùng key ở DataSource/version khác được phép.

Preview chỉ đọc, không tạo `ImportJob`, `LessonExercise`, revision hoặc audit. Response trả count, lỗi đã sort ổn định theo `rowNumber/path/code` và SHA-256 `previewHash` của canonical contract version + source + file + normalized rows + structural errors. Relational state (parent/media/existing source key) không được đóng băng trong hash, nên commit luôn lookup/revalidate lại trong transaction:

```json
{
  "success": true,
  "data": {
    "totalRows": 1,
    "validRows": 1,
    "invalidRows": 0,
    "errors": [],
    "previewHash": "64-character-sha256"
  }
}
```

Các code import đáng chú ý gồm `UNEXPECTED_FIELD`, `OPTION_ID_NOT_FOUND`, `DUPLICATE_SOURCE_KEY_IN_BATCH`, `SOURCE_KEY_ALREADY_EXISTS`, `PARENT_LESSON_NOT_FOUND`, `TOPIC_LESSON_MISMATCH`, `MEDIA_NOT_FOUND`; các structural code khác được upper-case. `UNEXPECTED_FIELD` dùng path `$.$unknown`, không dùng chính tên key lạ. Mỗi lỗi chỉ có `rowNumber`, `code`, `path`, không trả raw row/answer.

Commit gửi lại cùng body và thêm `previewHash`. Service tính lại hash trước transaction, sau đó khóa theo `active admin actor User FOR SHARE → DataSource FOR UPDATE → Lesson IDs FOR UPDATE tăng dần → Topic IDs FOR UPDATE tăng dần`, revalidate structural + lesson/topic/media/source-key state rồi commit **all-or-nothing** một `ImportJob.completed`, các draft Exercise + revision 1 và một audit summary. Interactive transaction đặt `maxWait=5.000 ms`, `timeout=30.000 ms`; vượt ngưỡng được phân loại thành safe `503`. Có bất kỳ row lỗi thì trả `422 IMPORT_VALIDATION_FAILED` và không ghi partial job/exercise/revision.

`Idempotency-Key` dài 8–128 ký tự, bắt đầu bằng chữ/số và chỉ gồm chữ/số/`.`/`_`/`:`/`-`. Retry cùng actor, DataSource, file name, preview hash và entity type chỉ trả `idempotent=true` khi service revalidate current rows thành công và job đã `completed`, có `startedAt/completedAt`, zero errors, exact row counts, mảng canonical `sourceKey` khớp chính xác cả giá trị lẫn thứ tự, đủ Exercise + revision 1 và đúng một completion audit. Job legacy `pending`/`failed`/incomplete hoặc provenance không coherent trả safe `409` yêu cầu manual review, không tự tiếp tục hay tạo job mới. Tái dùng key cho request khác cũng trả `409`. Duplicate `sourceKey` trong batch hoặc đã tồn tại trong cùng DataSource bị reject; unique `(dataSourceId, sourceKey)` là database backstop, không có upsert ngầm.

Ví dụ commit dùng header `Idempotency-Key: hsk1-exercise-import-v1` và body preview cũ có thêm:

```json
{
  "previewHash": "64-character-sha256"
}
```

Đây là phần minh họa bổ sung; request thực tế vẫn phải gửi lại `dataSourceId`, `fileName` và toàn bộ `rows`. Success `data` gồm `importJob`, danh sách draft `exercises`, `importedRows` và `idempotent`; response retry phải giữ nguyên job/exercise ID.

#### Error matrix

| HTTP | Trường hợp | Contract an toàn |
| ---: | --- | --- |
| `400` | DTO/path/query sai kiểu, unexpected body field tại HTTP whitelist | Không chạy mutation; field lạ dùng path `$.$unknown` |
| `401/403` | JWT/account/role admin không hợp lệ | Không tin role claim cũ |
| `404` | Exercise, revision, DataSource hoặc parent Lesson không tồn tại | Không lộ SQL |
| `409` | Stale revision, parent/topic mismatch, preview hash đổi, idempotency key reuse khác request, matching import job incomplete/incoherent, persistence FK/CHECK (`P2003`/`23503`/`P2004`/`23514`), race hoặc concurrent conflict | Client reload/preview lại; job incomplete cần manual review |
| `422` | Shape/domain authoring sai, speaking publish, listening media chưa ready, import có row lỗi kể cả source key đã tồn tại | Có safe `code/path`; không trả raw answer/payload |
| `503` | Lock/statement/Prisma transaction timeout hoặc connection tạm lỗi | Có thể retry đúng idempotency key |
| `500` | Lỗi persistence không phân loại | Message generic, không lộ secret/URL/SQL |

Feature-specific integrity và production-path concurrency runners được mô tả ở runbook. Runner định nghĩa 7 race: concurrent revisions, concurrent publish, publish/archive, publish/submit với actor và learner khác nhau, publish/submit cùng actor, archive/submit và import idempotency retry. Artifact frozen đã pass fresh deploy 15 migration, P0/Activity/Exercise SQL acceptance, migrate status và hai chiều drift; P0 `3/3`, CMS `4/4`, Activity `5/5`, Exercise `7/7`, full E2E `8/8` suite (`118/118` test) và Exercise preflight rerun rejection đều GREEN trên các database disposable riêng.

### 16.6 Lesson Activity Attempt & Progress V1 — runtime complete

Tất cả endpoint dưới đây yêu cầu Bearer JWT. User ID chỉ lấy từ JWT đã được đối chiếu lại với account active trong database; không endpoint nào nhận `userId`, score hay progress từ client. ID path phải là positive safe integer.

#### Endpoint

- `POST /learning/lessons/:lessonId/start`
- `GET /learning/lessons/:lessonId/activity`
- `POST /learning/topics/:topicId/start`
- `POST /learning/topics/:topicId/complete`
- `POST /learning/exercises/:exerciseId/attempts`
- `GET /learning/exercises/:exerciseId/attempts`
- `POST /learning/lessons/:lessonId/complete`
- `GET /progress/lessons`
- `GET /progress/lessons/:lessonId`

Mọi `POST` yêu cầu header `Idempotency-Key` dài 8–128 ký tự, bắt đầu bằng chữ/số và chỉ gồm chữ, số, `.`, `_`, `:`, `-`. Key có namespace toàn cục theo user nhờ unique `(userId, idempotencyKey)`: cùng user/key/request semantic trả cùng fact; cùng key nhưng operation, target hoặc payload khác trả `409`; hai user có thể dùng cùng key. Attempt request được so bằng SHA-256 của canonical JSON, không dùng thứ tự property của JSON. Timeout/connection error trả `503` an toàn để client retry đúng key; conflict đồng thời trả `409`; raw Prisma/SQL error không được phản chiếu.

Body duy nhất của attempt:

```json
{
  "answer": { "optionId": "stable-option-id" },
  "durationSeconds": 12
}
```

`durationSeconds` là integer 0–86.400 và optional. DTO từ chối `userId`, `attemptNumber`, `score`, `isCorrect`, `exerciseVersion`, `contentSnapshot`, `feedbackVersion`, `submittedAt`, progress và LearningEvent fields. Start/complete chỉ nhận body rỗng.

#### Visibility, transaction và idempotency

- Mutation chỉ dùng Lesson đạt shared readiness, Level/Lesson/Topic/Exercise `published` và chưa soft-delete. Exercise có topic phải thuộc đúng Topic và Lesson public.
- Mỗi write khóa active `User` row bằng `FOR UPDATE` trước. Khi thao tác trên content, service lấy shared lock theo `Lesson → Topic (nếu có) → LessonExercise (nếu có)`, rồi khóa `Progress → UserTopicProgress` theo thứ tự cố định. Attempt, derived progress, event và plan-item transition commit trong một transaction.
- Draft/archived/deleted content không nhận activity mới. Attempt đã tạo trước khi archive vẫn đọc được bởi owner từ snapshot.
- `LessonExerciseAttempt.attemptNumber` do server tính sau lock. Retry không tạo thêm attempt/event, không cộng duration và không thay progress.

#### Scoring `lesson-activity-v1`

| Exercise type | Client answer | Rule |
| --- | --- | --- |
| `mcq` | `{ "optionId": "..." }` | So stable option ID có tồn tại trong authored options. |
| `listening_choice` | `{ "optionId": "..." }` | Cùng rule stable option ID; không dùng array index. |
| `fill_blank` | `{ "text": "..." }` | NFKC → trim → collapse whitespace; mặc định case-insensitive, chỉ case-sensitive khi authoring khai báo. |
| `arrange_sentence` | `{ "tokenIds": ["..."] }` | Token set phải chính xác và thứ tự phải khớp tuyệt đối. |
| `speaking_repeat` | — | `422`, chưa có pronunciation engine nên không tạo điểm/fact giả. |

V1 dùng binary score `100/0`; `isCorrect` nhất quán với score. Shape authoring mơ hồ/sai trả `422` và rollback toàn bộ. Server snapshot exercise ID/location, version, type, prompt, content, authoritative answer, explanation, safe media projection và scoring version trong immutable attempt. Public response chỉ trả attempt ID/number, result, duration, version, feedback version, explanation, safe media projection và submitted time; không trả `userId`, raw answer, authoritative answer, snapshot hoặc internal metadata.

#### Progress, completion và resume

- Lesson start chuyển `not_started → learning`, giữ `startedAt` một lần, tạo `lesson_started`; active plan item `planned → in_progress`.
- Topic start tạo `UserTopicProgress.learning`, cập nhật pointer và tạo `topic_started`.
- Topic percent là số distinct public required exercise đã có submitted attempt chia tổng required exercise, làm tròn gần nhất và clamp 0–100. Topic chỉ `done` sau explicit complete; topic không có exercise phải start trước rồi mới complete.
- Lesson completion unit gồm mỗi public Topic và mỗi public standalone Exercise. Topic chỉ được tính khi `done`; standalone được tính khi đã có attempt. Lesson complete yêu cầu mọi unit xong; content-only lesson vẫn phải start rồi explicit complete.
- Lesson score là trung bình làm tròn của best server score trên từng public exercise đã attempt. Exercise chưa attempt/unsupported không bị gán điểm giả. Time là tổng duration của fact mới, không đếm retry.
- Lesson complete đặt `done/100`, tạo `lesson_completed` và chuyển item thuộc active learning plan sang `completed`.
- Resume order ổn định: Topic `orderIndex,id`, rồi Exercise `orderIndex,id`. `GET .../activity` trả public lesson, topic progress, exercise payload không có answer, latest-attempt summary, current topic/exercise và `nextAction` (`start_lesson`, `submit_exercise`, `complete_topic`, `complete_lesson`, `completed`). Pointer trỏ content vừa archive được recompute khi đọc nhưng không rewrite event/attempt.
- Lesson đã `done` không tự regress khi CMS thêm content trong V1. Content version/published-learning snapshot là backlog.

Database trigger chặn UPDATE/DELETE submitted `LessonExerciseAttempt`, xác minh coherence của `exercise_submitted` event và bảo vệ parent location sau khi có history. `LearningEvent.metadata` cho attempt chỉ có score, correctness, attempt number, exercise version, duration và feedback version; không có answer.

Premium entitlement chưa có model nên `Topic.isPremium/isLocked` chưa được enforce như subscription authorization. Đây là backlog minh bạch, không phải quyền đã triển khai.

#### SRS — backlog

- `GET /review/due`, `POST /review/sessions`, `POST /review/cards/:id/grade`.

`ReviewCard` là scheduler source of truth; `UserWordProgress` chỉ là legacy summary.

### 16.7 Exam attempt flow

- `POST /exam/tests/:id/attempts`: server tạo attempt và immutable snapshot.
- `PUT /exam/attempts/:id/answers/:snapshotQuestionKey`: autosave idempotent/optimistic version.
- `GET /exam/attempts/:id`: resume dựa vào server timer.
- `POST /exam/attempts/:id/submit`: transactionally finalize và tạo duy nhất một `Result`.

Client không gửi đáp án đúng, điểm cuối hoặc thời gian có thẩm quyền. Kết quả mới phải truy được `ExamAttempt`, snapshot và scoring version.

### 16.8 Frontend BFF session và Exercise read console V1

Đây là same-origin Next.js boundary, không thay base URL backend `/api/v1` và
không phải generic reverse proxy.

| Frontend route | Method | Mục đích |
| --- | --- | --- |
| `/api/session/login` | `POST` | Validate exact Origin + credentials, gọi backend auth login, đặt HttpOnly cookie; response không có token. |
| `/api/session/me` | `GET` | Đối chiếu cookie với backend `/auth/me`; chỉ trả current admin identity, clear cookie khi invalid. |
| `/api/session/logout` | `POST` | Validate Origin và clear frontend cookie. |
| `/api/admin/exercises` | `GET` | Allowlisted admin list; query page/limit/Lesson/Topic/type/status; response browser loại `answer`. |
| `/api/admin/exercises/:id` | `GET` | Allowlisted protected detail; chỉ admin hiện tại được xem authoritative answer. |

Cookie mặc định `hsk_admin_session` có `HttpOnly`, `SameSite=Lax`, `Path=/`,
`Secure` ở production và `Max-Age <= JWT exp`. Browser không được lưu token vào
local/session storage. Backend origin lấy từ `BACKEND_API_URL` server-only; mọi
fetch protected là `no-store`, timeout mặc định 8 giây và chỉ trả safe error kind,
message, optional request ID.

Backend `GET /api/v1/admin/cms/exercises` và detail vẫn là authority. Read projection
V1 gồm scalar Exercise fields, safe Media projection, cùng:

```json
{
  "lesson": { "id": 12, "title": "Greetings", "slug": "greetings" },
  "topic": { "id": 34, "title": "Saying hello" },
  "dataSource": {
    "id": 7,
    "code": "HSK3",
    "name": "HSK source",
    "version": "1"
  }
}
```

`topic` và `dataSource` có thể `null`. List còn có `latestRevision`; detail có toàn
bộ revision/review history. Không trả storage provider/key, checksum hay original
filename qua Media projection.

Exercise console V1 chỉ đọc. Không có BFF/UI create, revision, review, publish,
archive hay import Exercise; các backend mutation route đó không được proxy. Media
inventory/detail và hai safety mutation được bổ sung riêng theo contract mục 16.9.

### 16.9 Media Asset Operations API & Admin Library V1

V1 quản trị asset đã tồn tại; không nhận binary upload và không cung cấp delivery
URL. Mọi backend endpoint yêu cầu Bearer JWT, `role=admin`, account active/chưa
soft-delete; lifecycle transaction còn recheck database role sau khi khóa actor.

| Backend endpoint | Method | Contract |
| --- | --- | --- |
| `/api/v1/admin/cms/media` | `GET` | Inventory phân trang; lọc `type`, `processingStatus`, `lifecycle`, `dataSourceId`, `page`, `limit`. |
| `/api/v1/admin/cms/media/:mediaId` | `GET` | Safe metadata, provenance, aggregate usage và tối đa 50 LessonExercise reference. |
| `/api/v1/admin/cms/media/:mediaId/quarantine` | `POST` | Đổi processing state sang `quarantined`; retry idempotent. |
| `/api/v1/admin/cms/media/:mediaId/archive` | `POST` | Soft archive qua `deletedAt`; retry idempotent, không hard-delete. |

`limit` nằm trong `1..100`; ID dùng positive PostgreSQL int4. List sort ổn định theo
`updatedAt DESC, id DESC`. `lifecycle=active|archived`; enum type là
`audio|image|pdf|video`; processing là
`pending|processing|ready|failed|quarantined`.

Safe projection gồm ID, basename filename đã normalize/bound, type, MIME, size,
duration, processing/lifecycle, usage count, provenance IDs/name/code/version và
timestamps. Response tuyệt đối không trả Media URL, storage provider/key, checksum
hay raw metadata. Detail chỉ liệt kê bounded LessonExercise reference; quan hệ content
khác trả aggregate count để không biến endpoint thành graph dump.

Mutation lock theo `active admin User FOR SHARE → Media FOR UPDATE`. Quyết định
idempotent được thực hiện sau lock; chỉ transition thật mới ghi một `AuditLog` an
toàn. Archive giữ lịch sử và reference. Quarantine asset archived trả `409`;
nonexistent trả `404`; timeout/connection/concurrent retry trả safe `503`; constraint
conflict trả `409`.

Browser route tương ứng:

| Frontend/BFF route | Method | Contract |
| --- | --- | --- |
| `/admin/media` | document | URL-driven inventory, desktop table, narrow-screen labelled record list, loading/empty/error/retry. |
| `/admin/media/:mediaId` | document | Protected safe detail, references, not-found/loading và lifecycle controls. |
| `/api/admin/media` | `GET` | Fixed-allowlist list proxy; HttpOnly session, `no-store`. |
| `/api/admin/media/:mediaId` | `GET` | Fixed-allowlist detail proxy. |
| `/api/admin/media/:mediaId/quarantine` | `POST` | Exact canonical origin trước khi backend call. |
| `/api/admin/media/:mediaId/archive` | `POST` | Exact canonical origin và UI xác nhận hai bước. |

Không có upload route/button trong V1. Repository chưa có shared private object
storage adapter, streaming byte limit, magic-byte MIME verification, malware scanner
hay quarantine worker; dùng local disk sẽ phá horizontal scaling. MIME spoofing,
oversize, SVG/HTML/executable, server hash dedupe và signed delivery phải được đóng
trong vertical slice ingestion riêng trước khi bật upload.

Quyết định: `docs/adr/ADR-004-MEDIA-ASSET-OPERATIONS-AND-ADMIN-LIBRARY.md`.
