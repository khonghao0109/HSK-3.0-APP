# Danh sách archive placeholder HSK1 (Pha 4, chờ PO duyệt)

Agent **không tự archive** (yêu cầu Pha 4, mục 5). Tài liệu này chỉ liệt kê để PO duyệt; người có quyền
CMS thực hiện sau khi PO chốt, bằng API archive có sẵn (không hard delete, ADR-001):

- `POST /api/v1/admin/cms/topics/:topicId/archive`
- `POST /api/v1/admin/cms/lessons/:lessonId/archive`

Nguồn: script seed placeholder `backend/scripts/learning/seed-learning.ts` (M1.3) và số liệu DB dev ghi ở
`docs/content/hsk1-audit.md` mục 7. Agent không đọc được DB dev ở phiên này, nên **id topic phải tra lại
trên CMS** (`GET /api/v1/admin/cms/lessons/:lessonId`) trước khi archive; id lesson theo audit Pha 1.

## Lesson placeholder HSK1

| Lesson id (audit) | Slug | Tiêu đề | Trạng thái | orderIndex | Nội dung |
|---|---|---|---|---|---|
| 1 | `hsk1-lesson-1` | HSK1 - Lesson 1 | published | 1 | 2 topic, 20 `LessonWord`, 0 bài tập |
| 2 | `hsk1-lesson-2` | HSK1 - Lesson 2 | published | 2 | 2 topic, 20 `LessonWord`, 0 bài tập |
| 3 | `hsk1-lesson-3` | HSK1 - Lesson 3 | published | 3 | 2 topic, 20 `LessonWord`, 0 bài tập |
| 4 | `hsk1-lesson-4` | HSK1 - Lesson 4 | published | 4 | 2 topic, 20 `LessonWord`, 0 bài tập |
| 5 | `hsk1-lesson-5` | HSK1 - Lesson 5 | published | 5 | 2 topic, 20 `LessonWord`, 0 bài tập |

## Topic placeholder HSK1

Mỗi lesson placeholder có 2 topic do seed tạo (10 topic):

| Lesson | Topic (orderIndex) | Tiêu đề | Trạng thái |
|---|---|---|---|
| `hsk1-lesson-1` … `hsk1-lesson-5` | 1 | Vocabulary Overview | published |
| `hsk1-lesson-1` … `hsk1-lesson-5` | 2 | Practice Notes | published |

## Không nằm trong danh sách

- 14 `Story` placeholder (Q177): giữ nguyên.
- Lesson pilot HSK1 `hsk1-pilot-l01` … `l10` (orderIndex 1001–1010) và topic/bài tập của chúng.
- Placeholder các cấp khác (HSK2–HSK7_9): ngoài phạm vi HSK1.

## Thứ tự đề xuất

1. Xuất bản đủ bài pilot 1–10 (Topic → Exercise → Lesson, TL-221) và kiểm lộ trình HSK1 hiển thị đúng.
2. Archive 10 topic placeholder, rồi 5 lesson placeholder.
3. Kiểm lại lộ trình HSK1 phía người học: chỉ còn bài pilot.

PO chốt 18/11/2026: archive ngay sau bước 1,
vì `LessonWord` của placeholder là 100 từ đầu danh sách, không theo chủ đề.
