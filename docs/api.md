# API Specification - HSK System

## 1. Overview

- Base URL: `/api/v1`
- Protocol: `HTTPS`
- Format: `application/json`
- Auth: `Bearer JWT`
- Timezone lưu DB: `UTC`
- Versioning: path-based (`/api/v1`)

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
  "orderIndex": 3
}
```

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
  "meaning": "hoc tap",
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
