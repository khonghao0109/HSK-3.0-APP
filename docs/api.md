# API Specification - HSK System

## 1. Overview

- Base URL: `/api/v1`
- Protocol: `HTTPS`
- Format: `application/json`
- Auth: `Bearer JWT`
- Timezone lưu DB: `UTC`
- Versioning: path-based (`/api/v1`)

> Trạng thái 10/08/2026: schema P0 đã sẵn sàng. Runtime có auth với active-account authorization, user read, health, dictionary search, learning read và Onboarding Goal & Learning Plan V1. Session/profile/privacy, placement scoring, CMS, SRS và exam attempt vẫn là backlog.

Visibility runtime hiện hành: public level/word chỉ trả record `status=published` và `deletedAt IS NULL`; pinyin search dùng `pinyinNormalized`. Các endpoint `DELETE` content trong tài liệu này mang nghĩa archive/soft-delete, không hard-delete row đã có lịch sử.

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
- `GET /levels/:id`
- `POST /levels` (admin)
- `PATCH /levels/:id` (admin)
- `DELETE /levels/:id` (admin)

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
- `POST /lessons` (admin)
- `PATCH /lessons/:id` (admin)
- `DELETE /lessons/:id` (admin)

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
- `GET /topics/:id`
- `POST /topics` (admin)
- `PATCH /topics/:id` (admin)
- `DELETE /topics/:id` (admin)

## 5.4 Stories

- `GET /stories?levelId=3`
- `GET /stories/:id`
- `POST /stories` (admin)
- `PATCH /stories/:id` (admin)
- `DELETE /stories/:id` (admin)

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
    "hasCompletedPlacement": false,
    "nextStep": "ready"
  }
}
```

`nextStep` là `set_goal`, `generate_plan` hoặc `ready`. Plan active nhưng không còn khớp level/band/start date của goal hiện hành sẽ cho `nextStep=generate_plan`. Endpoint không trả `PlacementAttempt.detailSnapshot`.

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
- `startDate`: ngày lịch hợp lệ theo `YYYY-MM-DD`; API và DB giữ date-only, không dịch timezone.
- Field ngoài DTO bị từ chối.

Request giống hoàn toàn active goal là idempotent và trả lại row hiện tại. Khi thay đổi, service khóa row `User` bằng `SELECT ... FOR UPDATE`, deactivate goal cũ và tạo goal mới trong một transaction. Hai request đồng thời không thể để lại nhiều hơn một active goal.

#### GET `/learning-plans/current`

Trả active plan của account hiện tại và items tăng dần theo `orderIndex`; chưa có plan trả `data: null`. Mỗi item có `scheduledDate` date-only và lesson tối thiểu gồm `id`, `title`, `description`, `orderIndex`, `slug`.

#### POST `/learning-plans`

Không có body. Active goal là bắt buộc. V1 snapshot danh sách lesson public tại thời điểm tạo bằng `LearningPlanItem`, xếp một lesson mỗi ngày từ `startDate`; `endDate` là ngày item cuối.

Plan đang active và khớp `targetLevelId`, `targetBand`, `startDate` được trả lại khi retry. Nếu goal thay đổi, plan cũ chuyển `cancelled` và plan/items mới được tạo trong cùng transaction sau khi khóa row `User`. Chỉ lesson thuộc target level, `status=published`, `deletedAt IS NULL` được chọn; cùng `orderIndex` được tie-break bằng `id`. Nếu không có lesson hợp lệ, API trả `409` và không tạo/cancel plan.

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

### 16.4 CMS/import

- CRUD content tạo revision và audit.
- `POST /admin/imports`, preview/validate/commit/status/error rows.
- Review revision bằng approve/request-change/reject; publish chỉ cập nhật content sau authorization.

### 16.5 Learning activity và SRS

- `POST /learning/exercises/:id/attempts` với idempotency key.
- `PATCH /progress/lessons/:lessonId` và progress topic.
- `GET /review/due`, `POST /review/sessions`, `POST /review/cards/:id/grade`.

`ReviewCard` là scheduler source of truth; `UserWordProgress` chỉ là legacy summary.

### 16.6 Exam attempt flow

- `POST /exam/tests/:id/attempts`: server tạo attempt và immutable snapshot.
- `PUT /exam/attempts/:id/answers/:snapshotQuestionKey`: autosave idempotent/optimistic version.
- `GET /exam/attempts/:id`: resume dựa vào server timer.
- `POST /exam/attempts/:id/submit`: transactionally finalize và tạo duy nhất một `Result`.

Client không gửi đáp án đúng, điểm cuối hoặc thời gian có thẩm quyền. Kết quả mới phải truy được `ExamAttempt`, snapshot và scoring version.
