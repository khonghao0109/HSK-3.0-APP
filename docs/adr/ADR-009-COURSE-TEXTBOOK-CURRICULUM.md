# ADR-009: Course — khoá học giáo trình, chủ đề và chuyên ngành

- Status: Accepted (PO 23/11/2026: duyệt toàn bộ khuyến nghị mục 9)
- Date: 2026-11-23
- Scope: mô hình nội dung và lộ trình learner sau lesson-units; chỉ thiết kế, chưa có migration
- Related ADR: `ADR-001-IMMUTABLE-EVENT-RETENTION-AND-ACCOUNT-DELETION.md`,
  `ADR-002-EXERCISE-AUTHORING-VERSION-MEDIA-IMPORT-ATOMICITY.md`
- Related docs: `docs/database/P0_SCHEMA_MIGRATION_RUNBOOK.md`, `docs/process/content-pipeline.md`,
  `docs/process/textbook-lesson-intake.md`

## Context

### Quyết định PO đầu vào (không bàn lại trong ADR này)

- 20/11/2026: sau lesson-units làm giáo trình chuẩn HSK 2.0 sáu cấp trước, HSK 3.0 sau; khoá chuyên
  ngành để sau. Từ vựng đi theo bài, không gắn nhãn cấp HSK 2.0 cho từ (bài cấp 3 có thể chứa từ
  cấp 4). Không quy đổi cấp giữa giáo trình 2.0 và Level HSK 3.0. Chưa làm đề thi thử HSK 2.0.
- 23/11/2026: PO có sách HSK 2.0 đủ 6 cấp và HSK 3.0 cấp 1–4; PO tự cung cấp từ vựng, ngữ pháp,
  bài khoá cho từng bài. Matching lộ cặp đáp án: chấp nhận, ngoài phạm vi.
- 23/11/2026 (Q-C1): các khoá học **chạy song song**; người học **tự chọn** khoá và có thể theo
  nhiều khoá cùng lúc. Khoá dự kiến: Chủ đề HSK 3.0 (24 bài HSK1 hiện có, gắn Level), Giáo trình
  HSK 2.0 (6 cấp, cấp 4–6 có thể chia 上/下), Giáo trình HSK 3.0 (cấp 1–4, 5–9 sau), Chuyên ngành
  (thương mại, công xưởng, IT/web3…; không theo cấp, làm sau nhưng mô hình phải hỗ trợ ngay).
- 23/11/2026 (Q-C2): bài khoá **dùng nguyên văn sách**. Giữ cờ bản quyền theo khoá, là **công tắc
  PO/admin bật tắt**, không phải cổng chặn mặc định.

### Hiện trạng code (khảo sát 23/11/2026, base `e2db1ed`)

**Level và invariant.**
- `Level` có `code @unique`, `orderIndex @unique`, `minBand`, `maxBand`,
  `curriculumVersion String @default("HSK_3_0")`, `status` (`backend/prisma/schema.prisma:684-712`).
- Ràng buộc DB `Level_code_band_check` chỉ cho đúng bảy cặp `HSK1..HSK6` (band n–n) và
  `HSK7_9` (band 7–9) (`backend/prisma/migrations/20260810090000_p0_schema_foundation_level/migration.sql:77-86`).
- Invariant repo: "`HSK7_9` là một Level cho band 7–9 … Không tách hoặc gộp khi chưa có product
  decision, ADR và migration riêng" (`AGENTS.md:32`, file local ở gốc checkout chính, gitignored).

**Lesson và nội dung.**
- `Lesson.levelId Int` bắt buộc, `@@unique([levelId, orderIndex])`, index
  `[levelId, status, deletedAt, orderIndex]` (`schema.prisma:726-766`). CMS tạo bài bắt buộc
  `levelId` (`backend/src/modules/cms/dto/create-lesson.dto.ts:10`, `cms.service.ts:288`) và kiểm
  Level khi publish (`cms.service.ts:455, 1192-1223`).
- `LessonWord` nối `lessonId`–`wordId`, `topicId` tuỳ chọn, `@@unique([lessonId, wordId])`
  (`schema.prisma:998-1014`). Từ không mang cấp qua bài; cấp nằm ở `WordLevel`
  (`schema.prisma:983-991`).
- Topic có `type` `vocabulary | grammar | key_text | quiz | ai_speaking` (`schema.prisma:96-102`);
  block `grammar_point` (topic grammar) và `dialogue` (topic key_text) được kiểm ở
  `backend/src/common/validation/topic-content-blocks.ts:3-28`.
- Bài "sẵn sàng" cho learner chỉ khi bài published **và Level published** và có topic/story
  published (`backend/src/common/policies/lesson-readiness.policy.ts:20-48`). Learner chỉ thấy từ
  đã published (`lesson-readiness.policy.ts:9-11`).

**Mọi chỗ trên đường learner giả định "bài thuộc Level".** Không chỗ nào sắp bài toàn cục:
`orderIndex` luôn được hiểu là thứ tự trong một Level.
- Lộ trình `GET /learning/path`: `loadLevelPaths` đọc bài sẵn sàng, gom theo `levelId`
  (`backend/src/modules/learning/path/learning-path.reader.ts:19-67`); mở khoá = bài đầu của Level,
  hoặc bài trước trong cùng Level đã xong, hoặc đã có `Progress` (`learning-path.policy.ts:38-49`);
  vị trí bài = thứ tự trong Level (`learning-path.policy.ts:65-121`); response gom theo Level
  (`learning-path.service.ts:42-50, 85-96`); `NextLesson` mang `levelCode`
  (`learning-path.policy.ts:123-148`); chọn bài tiếp theo theo Level mục tiêu
  (`learning-path.policy.ts:159-197`).
- Trang chủ `GET /learning/home`: bài tiếp theo theo `goal.targetLevel.orderIndex`, tìm bài theo
  `levelCode` (`backend/src/modules/learning/home/learning-home.service.ts:62-68`).
- Activity: chặn bắt đầu bài khi bài trước **cùng `levelId`** chưa xong
  (`backend/src/modules/learning/activity/lesson-activity.service.ts:789-822`); response nhúng
  `levelId`, Level (`:587-588, 637-638`).
- Danh sách bài `GET /learning/lessons`, `GET /lessons` lọc `levelId` và sắp `orderIndex`
  (`backend/src/modules/learning/learning.service.ts:75-81`); chi tiết bài trả `level`
  (`learning.service.ts:120-142`, `public-lesson.serializer.ts:38, 84`).
- Onboarding/goal/plan: `UserGoal.targetLevelId` và `LearningPlan.targetLevelId` bắt buộc
  (`schema.prisma:366-378, 409-425`); `setGoal` đổi band thành Level
  (`backend/src/modules/onboarding/onboarding.service.ts:198-264`); kế hoạch = mọi bài sẵn sàng
  của Level mục tiêu, mỗi ngày một bài (`onboarding.service.ts:331-362`).
- Ôn tập/SRS: lọc theo `levelCodes` của **từ** (qua `WordLevel`), không theo bài
  (`backend/src/modules/learning/review/review-preferences.ts:15, 50-116`, `review-queue.ts:9-32`).
- Frontend: tab Level và tiến độ theo Level ở trang Lộ trình
  (`frontend/src/features/learner-path/learner-path-levels.tsx:111-279`,
  `frontend/src/app/(learner)/learn/path/page.tsx:44, 97-98`); thẻ "Tiếp tục" ghi Level + số bài
  (`frontend/src/app/(learner)/learn/page.tsx:177`); breadcrumb bài theo `level.code`
  (`frontend/src/app/(learner)/learn/lessons/[id]/page.tsx:85, 108`); tìm bài kế tiếp sau khi xong
  bài bằng cách duyệt `path.levels` (`frontend/src/features/learner-lesson/lesson-complete.ts:10-11`);
  onboarding đổi band thành Level (`frontend/src/features/onboarding/onboarding-route-handler.ts:123-151`).
- Tiến độ: `Progress` khoá theo `(userId, lessonId)` (`schema.prisma:1162-1187`), không phụ thuộc
  Level. Attempt và `LearningEvent` cũng gắn theo bài.

**Bộ nhập.**
- Bộ nhập pilot dùng chung validator (`backend/src/modules/content-pilot/pilot-content.validator.ts`)
  và chuyển bài tập qua `/admin/cms/exercise-imports` (`import-pilot-content.ts:553-580`). Nhiều luật
  gắn cứng HSK1: slug `hsk1-pilot-lNN-…` (`pilot-content.validator.ts:206`), 20 từ một bài (`:46`),
  từ phải nằm trong `hsk1.json` (`:469-476`).
- Gắn `LessonWord`: tra `Word` theo `(hanzi, pinyin)`, không lọc trạng thái, **không tự tạo Word**;
  thiếu thì dừng với `word_not_found` (`import-pilot-content.ts:750-800`).

## Decision

### 1. Mô hình

Thêm ba bảng, không đổi `Level`.

```
Course
  id, code (unique, ví dụ HSK3_TOPIC, HSK2_TEXTBOOK, HSK3_TEXTBOOK, SPEC_TRADE)
  kind               topic | textbook | specialty
  curriculumVersion  HSK_2_0 | HSK_3_0 | null (specialty không theo chuẩn)
  title, description, orderIndex (unique), status ContentStatus, publishedAt, deletedAt
  keyTextVisible     boolean, mặc định true (công tắc bản quyền, mục 5)
  dataSourceId       nguồn nội dung (provenance như Level/Lesson)

CourseUnit                          -- một "quyển" hoặc một module
  id, courseId, orderIndex (unique trong course)
  gradeNumber        int | null    (cấp của sách: 1–6, 1–9; null với chuyên ngành)
  volume             null | upper | lower   (上 / 下)
  title              ví dụ "Cấp 4 · 上", "Thương mại cơ bản"
  levelId            int | null    (chỉ khoá topic HSK 3.0 gắn Level)
  status, deletedAt

CourseEnrollment                    -- người học theo khoá nào
  id, userId, courseId, status active | left
  enrolledAt, lastActivityAt, leftAt
  isCurrent          boolean, tối đa một dòng true mỗi user (partial unique)
  unique (userId, courseId)

Lesson
  + courseUnitId (thêm mới, nullable ở pha expand, NOT NULL ở pha contract)
  levelId          bỏ NOT NULL ở đầu pha C3 (không phải C1); bắt buộc khi unit thuộc khoá topic (CHECK/validation)
  unique mới (courseUnitId, orderIndex); giữ (levelId, orderIndex) cho bài có levelId
```

`orderIndex` của bài từ nay là thứ tự **trong CourseUnit**, đúng với cách code hiện đang dùng
(thứ tự trong Level).

### 2. Đơn vị bên trong khoá

**Phương án A (khuyến nghị): bảng `CourseUnit` có thứ tự.** Mỗi quyển (cấp, tập) là một unit. Cấp
1–3 HSK 2.0 là một unit; cấp 4–6 là hai unit `upper`/`lower`. HSK 3.0 cấp 5–9 sau này chỉ là
**thêm dòng** CourseUnit, không migration. Chuyên ngành dùng unit làm module, `gradeNumber = null`.
Lộ trình và mở khoá đi theo `(unit.orderIndex, lesson.orderIndex)`.

**Phương án B: cột trên `Lesson`** (`courseId`, `gradeNumber`, `volume`). Ít bảng hơn nhưng tiêu đề
quyển, trạng thái publish từng quyển và thứ tự giữa các quyển phải suy ra từ cột lặp lại ở mọi bài;
publish một quyển là cập nhật hàng loạt bài; khoá chuyên ngành không có "cấp" phải nhồi module vào
`gradeNumber`. Loại vì khó đổi tên/ẩn một quyển và dễ lệch dữ liệu.

**Phương án C: cây unit lồng nhau** (cấp → tập → bài). Linh hoạt nhất nhưng truy vấn lộ trình phức
tạp hơn mà nhu cầu hiện có chỉ cần hai tầng. Để dành, A nâng lên C được bằng cột `parentId`
nullable (forward-only).

### 3. Quan hệ Course với Level

- **Không đổi `Level`, không đổi invariant `HSK7_9`**. Không thêm dòng Level cho HSK 2.0.
- Khoá **topic HSK 3.0**: mỗi unit gắn đúng một Level (`CourseUnit.levelId`), bài giữ `levelId`
  như hiện nay. Mục tiêu band, đề thi thử, placement, SRS theo Level tiếp tục chạy cho khoá này.
- Khoá **textbook HSK 2.0**: unit và bài **không gắn Level** (`levelId = null`), vì PO quyết không
  quy đổi cấp 2.0 sang Level 3.0; gắn sẽ ngầm khẳng định "cấp 3 sách 2.0 = HSK3 band 3".
- Khoá **textbook HSK 3.0**: được phép gắn Level cùng số cấp (cùng chuẩn), nhưng là tuỳ chọn khi
  nạp; quyết khi làm khoá đó (Q-C7).
- Khoá **specialty**: không gắn Level.
- Readiness của bài (`lesson-readiness.policy.ts:20-48`) đổi từ "Level published" sang "Course
  published và CourseUnit published, và nếu bài có `levelId` thì Level published".

### 4. Lộ trình learner (Q-C1 đã quyết: song song, tự chọn)

- **Theo khoá:** người học có nhiều `CourseEnrollment` `active`. Đúng một khoá `isCurrent`: khoá
  mà Trang chủ và nút "Học tiếp" dùng để chọn bài. Đổi khoá đang học = đổi cờ, không đụng tiến độ.
  Khi người học làm bài ở khoá khác, `lastActivityAt` của khoá đó cập nhật; khuyến nghị **không tự
  đổi** `isCurrent` (tránh nhảy khoá bất ngờ), chỉ đổi khi người học chọn.
- **Mở khoá và tiến độ độc lập theo khoá:** luật hiện có giữ nguyên nhưng phạm vi đổi từ Level sang
  khoá: bài đầu của khoá mở; bài kế mở khi bài trước (theo `unit.orderIndex`, `lesson.orderIndex`)
  xong hoặc đã có `Progress`. Mặc định unit sau mở khi unit trước xong bài cuối; người học vẫn vào
  được bài đã có `Progress`. `Progress` vẫn theo `(userId, lessonId)`, một bài chỉ thuộc một unit
  nên tiến độ tự tách theo khoá. Phần trăm hoàn thành khoá/unit tính từ `Progress`.
- **Bài dùng chung giữa hai khoá: không cho.** Mỗi bài thuộc đúng một unit; muốn dùng lại nội dung
  thì nhân bản bài. Nhờ vậy mở khoá và tiến độ không cần xét chéo khoá.
- **Onboarding và goal:**
  - Onboarding thêm bước chọn khoá (danh sách khoá published). Khoá topic HSK 3.0 giữ nguyên bước
    chọn band → `UserGoal.targetLevelId` như hiện nay; `LearningPlan` (mỗi ngày một bài của Level
    mục tiêu) chỉ áp cho khoá này.
  - Khoá textbook và specialty: goal chỉ dùng `dailyMinutes` (mục tiêu phút/ngày và nhắc học áp cho
    mọi khoá). Không tạo `LearningPlan` theo Level cho các khoá này. Kế hoạch theo khoá là việc sau
    (`LearningPlan.courseId` nullable, forward-only).
  - `UserGoal.targetLevelId` và `LearningPlan.targetLevelId` hiện bắt buộc; người chỉ học khoá
    textbook vẫn có goal band HSK 3.0 từ onboarding cũ. Khuyến nghị: giữ bắt buộc ở pha này (không
    đổi schema goal), onboarding cho khoá textbook đặt band mặc định ẩn hoặc giữ band người học chọn;
    nới thành nullable chỉ khi PO muốn người học hoàn toàn không có mục tiêu HSK 3.0 (Q-C8).
- **Ôn tập/SRS:** **một kho ôn chung** cho mọi khoá. SRS hiện theo từ (`review-queue.ts:9-32`); cùng
  một từ học ở hai khoá là một thẻ, ôn tách theo khoá sẽ nhân đôi thẻ và lệch lịch. Bộ lọc
  `levelCodes` hiện có giữ cho người muốn lọc theo cấp HSK 3.0; thêm bộ lọc "theo khoá" (từ có
  `LessonWord` trong khoá đó) là tuỳ chọn sau. Từ của khoá 2.0 không có `WordLevel` 2.0 nên chỉ
  lọc được theo khoá, không theo cấp 2.0.
- **Đề thi thử:** vẫn theo Level HSK 3.0, không đổi. Chưa có đề HSK 2.0 (PO 20/11).

**Endpoint mới hoặc đổi (chưa viết contract vào `docs/api/api.md`):**

| Endpoint | Loại | Ghi chú |
| --- | --- | --- |
| `GET /learning/courses` | mới | Khoá published, kèm cờ đã theo, `isCurrent`, tiến độ |
| `GET /learning/courses/:code` | mới | Unit và bài của một khoá, trạng thái mở khoá theo khoá |
| `POST /learning/courses/:code/enrollment` | mới | Theo khoá (idempotent) |
| `DELETE /learning/courses/:code/enrollment` | mới | Bỏ theo dõi: `status = left`, giữ tiến độ |
| `PUT /learning/current-course` | mới | Chọn khoá đang học |
| `GET /learning/path` | đổi | Thêm tham số `course`; mặc định khoá đang học. Response gom theo unit thay vì Level; khoá topic vẫn có `levelCode` trên unit |
| `GET /learning/home` | đổi | Bài tiếp theo lấy từ khoá đang học; thêm tóm tắt khoá |
| `GET /learning/lessons`, `GET /lessons`, `GET /lessons/:id` | đổi | Thêm `course`, `unit`; `level` có thể null |
| `POST /learning/lessons/:id/start` (activity) | đổi | Luật mở khoá theo khoá thay cho theo Level |
| `GET/PUT onboarding goal` | đổi | Thêm chọn khoá; band chỉ bắt buộc với khoá topic |
| `GET/POST/PATCH /admin/cms/courses`, `/admin/cms/course-units` | mới | CRUD, publish, archive, công tắc bài khoá |
| `POST /admin/cms/lessons` | đổi | Nhận `courseUnitId`; `levelId` suy từ unit hoặc null |
| `GET /admin/cms/lessons` | đổi | Lọc theo `courseId`, `courseUnitId` |

### 5. Bản quyền: công tắc theo khoá

- PO quyết dùng nguyên văn bài khoá. `Course.keyTextVisible` (mặc định `true`) là công tắc PO/admin
  bật tắt trên CMS; **không** chặn nạp hay publish.
- Khi tắt: mọi topic `key_text` và block `dialogue` của khoá **bị lọc ở tầng serializer learner**
  (cùng chỗ đã lọc topic chưa published: `learning.service.ts`, `public-lesson.serializer.ts`,
  `lesson-activity.service.ts`, đường lộ trình). Không xoá, không archive: nội dung, revision,
  `Progress`, attempt, event giữ nguyên (ADR-001); bật lại là hiện lại.
- Readiness: bài chỉ còn topic `key_text` sau khi lọc thì coi như không có topic published (không
  vào được), còn topic khác thì vẫn học được.
- Mỗi lần bật/tắt ghi `AuditLog` (người, thời điểm, khoá, giá trị cũ/mới).

### 6. Nhập nội dung

- Tái dùng bộ nhập pilot: cùng luồng preflight → tạo bài/topic nháp → preview/commit bài tập qua
  `/admin/cms/exercise-imports` → ghi `LessonWord` có guard → kiểm chứng
  (`docs/process/content-pipeline.md` §3). Mở rộng file nạp với `courseCode`, `unit`
  (`gradeNumber`, `volume`) và `orderIndex` trong unit.
- Tách luật HSK1 cứng thành **profile theo khoá**: profile `pilot-hsk1` giữ nguyên các luật hiện
  có; profile `textbook` bỏ "20 từ/bài", bỏ "từ phải thuộc hsk1.json", đổi mẫu slug thành
  `<courseCode>-g<cấp>[u|l]-lNN-…`.
- Mẫu PO điền: `docs/process/textbook-lesson-intake.md` (bảng tính hoặc văn bản); đội kỹ thuật
  chuyển thành file nạp.
- **Từ chưa có trong từ điển** (khác hiện nay là dừng với `word_not_found`): bộ nhập tạo `Word`
  **nháp** (status `draft`) kèm `DataSource` của khoá và báo danh sách; `LessonWord` vẫn được ghi.
  Learner chỉ thấy từ published (`lesson-readiness.policy.ts:9-11`), nên thêm luật publish: bài
  textbook không publish được khi còn `LessonWord` trỏ tới Word chưa published. Từ có sẵn nhưng
  chưa published cũng theo luật này. Khuyến nghị tạo nháp thay vì báo lỗi, vì giáo trình 2.0 chắc
  chắn có từ ngoài bộ dictionary HSK 3.0 và PO muốn nạp theo từng bài.
- Chữ đa âm: tra theo `(hanzi, pinyin)` như `import-pilot-content.ts:750-800`; pinyin bỏ trống mà
  chữ có nhiều dòng Word thì báo lỗi, không đoán.

### 7. Migration theo pha

Theo `docs/database/P0_SCHEMA_MIGRATION_RUNBOOK.md`: forward-only, không down migration, rollback
= rollback ứng dụng tương thích ngược hoặc forward-fix (§12 runbook).

| Pha | Nội dung | Rollback | Rủi ro dữ liệu |
| --- | --- | --- | --- |
| C1 expand | Tạo `Course`, `CourseUnit`, `CourseEnrollment` (kèm partial unique `isCurrent` vì bảng mới còn rỗng); thêm `Lesson.courseUnitId` nullable; unique `(courseUnitId, orderIndex)`. **Giữ** NOT NULL của `Lesson.levelId` (dời sang C3, khi app đã hiểu bài không Level) | Ứng dụng cũ bỏ qua bảng/cột mới; không drop | Không đổi kiểu cột đang dùng nên không ảnh hưởng code hiện có |
| C2 backfill | Tạo khoá `HSK3_TOPIC` (kind topic, HSK_3_0), mỗi Level hiện có (cả Level chưa có bài) thành một unit (`levelId` = Level đó; TL 23/11: để Level có bài về sau không cần chạy lại mới có unit); gán `courseUnitId` cho bài hiện có (24 bài HSK1 và mọi bài khác); tạo `CourseEnrollment` `isCurrent` cho người có `UserGoal` hoặc `Progress` | Script idempotent `content:course:backfill` (không phải migration SQL, để chạy lại sau mỗi lần nạp bài tới khi C3 xong), chạy lại an toàn; sai thì forward-fix gán lại, không xoá | Không đụng `Progress`, attempt, `LearningEvent` (khoá theo `lessonId`). Kiểm: số bài có `courseUnitId` = tổng bài; số enrollment = số user có goal hoặc progress |
| C3 app | Bỏ NOT NULL của `Lesson.levelId` (migration riêng đầu C3); đọc theo khoá sau feature flag: lộ trình, home, activity, CMS, onboarding; công tắc bài khoá | Tắt flag về đường cũ theo Level (dữ liệu hai đường cùng đúng cho khoá topic) | Bài textbook tạo sau C3 không có Level: đường cũ không thấy chúng (chấp nhận khi rollback) |
| C4 contract | `Lesson.courseUnitId` NOT NULL; CHECK/validation "unit thuộc khoá topic thì bài có `levelId`" | Forward-fix; chạy sau khi log chứng minh mọi bài có unit | Fail nếu còn bài chưa gán unit: preflight đếm trước |

Không hard-delete gì ở mọi pha (ADR-001). Bỏ dùng `@@unique([levelId, orderIndex])` chỉ ở release
riêng sau C4 nếu cần, không trong chuỗi này.

### 8. Các phương án đã loại

- **Tách Level HSK 2.0 riêng trong bảng `Level`** (ví dụ `HSK2_0_L3`, `curriculumVersion = HSK_2_0`):
  loại vì (1) vi phạm `Level_code_band_check` và `code @unique`
  (`migration.sql:77-86`, `schema.prisma:687`): phải sửa ràng buộc và invariant `AGENTS.md:32`;
  (2) Level mang ngữ nghĩa band HSK 3.0 cho goal, placement, đề thi, SRS (`onboarding.service.ts:198-264`,
  `review-preferences.ts:50-116`): dòng Level 2.0 sẽ lọt vào các chỗ đó; (3) trái quyết định PO
  "không quy đổi cấp"; (4) không có chỗ cho khoá chuyên ngành không cấp.
- **Dùng `Level.curriculumVersion` làm khoá học**: cùng vấn đề ràng buộc trên, và một Level chỉ có
  một phiên bản nên không biểu diễn được nhiều khoá cùng chuẩn (topic và textbook HSK 3.0).
- **Chỉ gắn nhãn/tag cho bài, không có thực thể Course**: không có chỗ cho theo khoá, khoá đang học,
  trạng thái publish khoá và công tắc bản quyền.
- **Bảng riêng cho từng giáo trình** (`TextbookLesson`…): nhân đôi activity, chấm điểm, snapshot,
  CMS và importer đã có cho `Lesson`.
- **Bài dùng chung nhiều khoá (many-to-many)**: tiến độ một bài sẽ mở khoá ở nhiều khoá cùng lúc;
  hoãn tới khi có nhu cầu thật.

## Consequences

- Toàn bộ đường learner đang giả định "bài thuộc Level" (liệt kê ở Context) phải đổi sang phạm vi
  khoá; đây là phần việc lớn nhất (C3), cần feature flag và test lộ trình theo khoá.
- Khoá topic HSK 3.0 giữ nguyên hành vi hiện có, vì unit của nó trùng Level.
- Người học có nhiều khoá: Trang chủ, Lộ trình, onboarding đổi UI (chọn khoá, khoá đang học), cần
  thiết kế mockup mới; `docs/ui_reference/` chưa có.
- Kho ôn chung: thẻ SRS không cho biết từ thuộc khoá nào; muốn lọc theo khoá cần truy vấn qua
  `LessonWord`.
- **Rủi ro bản quyền (Q-C2):** bài khoá nguyên văn sách được publish theo quyết định PO, không có
  cổng pháp lý chặn trước. Nếu chủ sở hữu bản quyền khiếu nại, công tắc `keyTextVisible` ẩn bài
  khoá của cả khoá ngay, nhưng nội dung đã hiển thị trước đó không thu hồi được, và các phần khác
  (ví dụ ngữ pháp, câu ví dụ chép từ sách) không nằm dưới công tắc này. Trách nhiệm pháp lý thuộc
  quyết định PO; khuyến nghị PO lưu bằng chứng quyền sử dụng (giấy phép, thoả thuận đi kèm sách)
  theo từng khoá trong `DataSource`.
- Từ nháp do bộ nhập tạo cần quy trình duyệt nghĩa của PO; chưa duyệt thì bài không publish được.
- Bộ nhập tách profile: luật HSK1 hiện tại phải được giữ nguyên byte-for-byte cho 25 file pilot.

## 9. Câu hỏi mở cho PO

PO 23/11/2026 trả lời: **theo khuyến nghị cho toàn bộ Q-C3 … Q-C10** (cột "Khuyến nghị" dưới đây là quyết định).

| Mã | Câu hỏi | Khuyến nghị |
| --- | --- | --- |
| Q-C3 | Ngoài giáo trình HSK 2.0, có cần bộ **bài chủ đề riêng cho HSK 2.0** không? | Không (TL hiểu như vậy). Khoá topic chỉ có HSK 3.0 |
| Q-C4 | Người học mới chưa chọn khoá thì khoá mặc định là gì? | Khoá topic HSK 3.0, vì onboarding hiện có (band HSK 3.0, kế hoạch theo Level) đã chạy cho khoá này; người học đổi được bất cứ lúc nào |
| Q-C5 | Bỏ theo dõi hoặc đổi khoá: tiến độ cũ có giữ không? | Giữ toàn bộ (ADR-001): enrollment `status = left`, theo lại thì tiến độ còn nguyên |
| Q-C6 | Khi người học làm bài ở khoá không phải "đang học", có tự đổi khoá đang học không? | Không tự đổi; chỉ đổi khi người học chọn |
| Q-C7 | Giáo trình HSK 3.0 có gắn Level cùng số cấp không (cấp 2 sách 3.0 ↔ Level HSK2)? | Có, vì cùng chuẩn; cho phép lọc SRS và đề thi theo cấp. Quyết khi làm khoá này |
| Q-C8 | Người chỉ học giáo trình 2.0 hoặc chuyên ngành có cần mục tiêu band HSK 3.0 không? | Không bắt buộc hỏi; giữ band mặc định ẩn ở pha này, nới schema goal khi có nhu cầu |
| Q-C9 | Mở khoá giữa các quyển (上 → 下, cấp 3 → cấp 4): bắt buộc xong quyển trước, hay mở hết? | Bắt buộc xong bài cuối quyển trước, như luật trong một quyển; có `Progress` thì vào được |
| Q-C10 | Công tắc bản quyền có cần thêm mức "ẩn cả ví dụ ngữ pháp chép từ sách" không? | Chưa; xem xét khi có khiếu nại thật |
