# Chỉ số sản phẩm P0 (M2.8)

Activation và lesson completion của MVP, tính từ dữ liệu first-party đã có.

- **Q75 (PO 13/10/2026).** Không tạo bảng `ProductEvent` trong MVP. Chỉ số tính từ
  `User`, `LearningPlan`, `LearningEvent`.
  `ProductEvent` có `consentVersion` chỉ làm khi đã có consent (M1.7b2) hoặc cần event
  không phải học tập. Xem ADR-008 §10.
- **Q77.** `onboarded` = đã từng tạo `LearningPlan` trước `asOf`.
- **Q76.** Activation = có ít nhất 1 `lesson_completed` trong 7 ngày đầu sau đăng ký.

Code: `backend/scripts/analytics/p0-product-metrics.ts`. Test:
`backend/test/p0-product-metrics.e2e-spec.ts`.

## Tham số

| Tham số | Ý nghĩa |
| --- | --- |
| `from`, `to` | Khoảng nửa mở `[from, to)` |
| `asOf` | Mốc cắt dữ liệu; `from < to <= asOf`. Mặc định là lúc chạy |

Cột `createdAt`, `occurredAt` là `timestamp` (không múi giờ) chứa giờ UTC. Tham số
là thời điểm ISO 8601 có `Z` hoặc offset, được đổi sang giờ UTC trong SQL
(`::timestamptz AT TIME ZONE 'UTC'`), nên kết quả không phụ thuộc `TimeZone` của
phiên PostgreSQL.

## Định nghĩa

Cohort: `User` có `role = 'user'` và `createdAt` trong `[from, to)`. Tính cả tài khoản
đã xoá hoặc ẩn danh sau đó (ADR-001: ẩn danh giữ nguyên dòng `User`). Không tính admin.

| Chỉ số | Định nghĩa |
| --- | --- |
| `signups` | Số user trong cohort |
| `onboarded` | Số user trong cohort có ít nhất 1 dòng `LearningPlan` (mọi `status`: `active`, `completed`, `cancelled`) với `createdAt < asOf` (Q77) |
| `activationEligible` | Số user trong cohort có `createdAt + 7 ngày <= asOf` |
| `activated` | Trong `activationEligible`, số user có ≥ 1 `lesson_completed` với `createdAt <= occurredAt < createdAt + 7 ngày` |
| `activationRate` | `activated / activationEligible`, 4 chữ số; `null` khi mẫu bằng 0 |
| `lessonsStarted` | Số cặp (user, bài) khác nhau có `lesson_started` trong `[from, to)` |
| `lessonsCompleted` | Số cặp (user, bài) khác nhau có `lesson_completed` trong `[from, to)` |
| `lessonCompletionRate` | Số cặp trong `lessonsStarted` có `lesson_completed` cùng user và bài, `occurredAt < asOf` (bất kỳ lúc nào), chia `lessonsStarted`; 4 chữ số; `null` khi mẫu bằng 0 |
| `completingLearners` | Số user khác nhau có `lesson_completed` trong `[from, to)` |

Ba chỉ số bài học tính trên mọi user `role = 'user'`, không chỉ cohort.

Q77: `onboarded` đếm theo lịch sử (plan không bị xoá, chỉ chuyển `cancelled`), nên không phụ thuộc thay đổi nội dung; trạng thái ready hiện tại của một user xem qua `GET /onboarding/status`.

## Chạy

Script chỉ đọc (transaction `READ ONLY`) và in JSON ra stdout. `DATABASE_URL` trỏ tới
DB cần đọc, nên dùng role chỉ đọc hoặc replica.

```bash
cd backend
npm run analytics:p0 -- --from 2026-10-01T00:00:00Z --to 2026-11-01T00:00:00Z --as-of 2026-11-08T00:00:00Z
```

Tham số sai (thiếu `--from`/`--to`, ngày không hợp lệ, thiếu offset, không thoả
`from < to <= asOf`) thì exit 2 và không kết nối DB.

## SQL cho Metabase

Biến kiểu Text: `{{from}}`, `{{to}}`, `{{as_of}}`, ví dụ `2026-10-01T00:00:00Z`. Cùng
logic với script.

```sql
WITH params AS (
  SELECT
    ({{from}}::timestamptz AT TIME ZONE 'UTC') AS from_at,
    ({{to}}::timestamptz AT TIME ZONE 'UTC') AS to_at,
    ({{as_of}}::timestamptz AT TIME ZONE 'UTC') AS as_of
),
cohort AS (
  SELECT u.id, u."createdAt"
  FROM "User" u, params
  WHERE u.role = 'user' AND u."createdAt" >= params.from_at AND u."createdAt" < params.to_at
),
activation AS (
  SELECT
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM "LearningPlan" p
        WHERE p."userId" = c.id AND p."createdAt" < params.as_of
      )
    ) AS onboarded,
    count(*) FILTER (WHERE c."createdAt" + interval '7 days' <= params.as_of) AS eligible,
    count(*) FILTER (
      WHERE c."createdAt" + interval '7 days' <= params.as_of
        AND EXISTS (
          SELECT 1 FROM "LearningEvent" e
          WHERE e."userId" = c.id AND e.type = 'lesson_completed'
            AND e."occurredAt" >= c."createdAt"
            AND e."occurredAt" < c."createdAt" + interval '7 days'
        )
    ) AS activated
  FROM cohort c, params
),
learner_events AS (
  SELECT e."userId", e."lessonId", e.type, e."occurredAt"
  FROM "LearningEvent" e
  JOIN "User" u ON u.id = e."userId" AND u.role = 'user'
  WHERE e."lessonId" IS NOT NULL
    AND e.type IN ('lesson_started', 'lesson_completed')
),
started AS (
  SELECT DISTINCT "userId", "lessonId" FROM learner_events, params
  WHERE type = 'lesson_started' AND "occurredAt" >= params.from_at AND "occurredAt" < params.to_at
),
completed AS (
  SELECT DISTINCT "userId", "lessonId" FROM learner_events, params
  WHERE type = 'lesson_completed' AND "occurredAt" >= params.from_at AND "occurredAt" < params.to_at
),
started_and_completed AS (
  SELECT count(*) AS n FROM started s, params
  WHERE EXISTS (
    SELECT 1 FROM learner_events e
    WHERE e."userId" = s."userId" AND e."lessonId" = s."lessonId"
      AND e.type = 'lesson_completed' AND e."occurredAt" < params.as_of
  )
)
SELECT
  (SELECT count(*) FROM cohort) AS signups,
  a.onboarded,
  a.eligible AS activation_eligible,
  a.activated,
  round(a.activated::numeric / NULLIF(a.eligible, 0), 4) AS activation_rate,
  (SELECT count(*) FROM started) AS lessons_started,
  (SELECT count(*) FROM completed) AS lessons_completed,
  round((SELECT n FROM started_and_completed)::numeric / NULLIF((SELECT count(*) FROM started), 0), 4) AS lesson_completion_rate,
  (SELECT count(DISTINCT "userId") FROM completed) AS completing_learners
FROM activation a;
```

## Quyền riêng tư

- Kết quả chỉ có số tổng; không có `userId`, email hay dòng chi tiết nào.
- Metabase đọc bằng role chỉ đọc hoặc replica (ADR-008 §10). Không dựng dashboard có
  bảng chi tiết theo user từ các bảng trên.
- Không gửi dữ liệu ra dịch vụ analytics bên thứ ba (ADR-008 §10).
