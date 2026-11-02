# Pipeline nội dung pilot HSK1 (M2.9a)

Tài liệu này là kết quả **Pha 1** của M2.9a: khảo sát pipeline nội dung hiện có, chốt định dạng
file nội dung, mô tả script nạp dữ liệu cho Pha 2 và quy trình chạy cho PO ở Pha 3. **Pha 1
không viết code**: mọi lệnh trong tài liệu là lệnh *dự kiến*, chưa chạy.

- Task: `docs/PLAN.md:281` (và bản lặp `docs/PLAN.md:588`), cải tiến R21 `docs/PLAN.md:752`.
- Bài mẫu: `backend/content/pilot/hsk1/lesson-01.json`.
- Dải mã của M2.9a: **Q172–Q179 và TL-210…TL-229** (TL-224 trở đi còn trống); **Q194** là mã do
  TL cấp riêng cho luật `fill_blank` ở Pha 2 (nằm ngoài dải Q172–Q179, không phải quyết định PO).
- "Pha 1b" = vòng sửa tài liệu + bài mẫu sau review của TL đối với Pha 1. Các mã này **chưa được ghi** vào `docs/PLAN.md` hay
  `docs/product/learner-ui-decisions.md`; đề xuất bổ sung ở §8.

### Quyết định đã chốt (áp dụng trong toàn bộ tài liệu)

| Mã | Nội dung |
| --- | --- |
| Q172 | Nội dung pilot là bản nháp gốc do AI soạn; mọi bản ghi ở `draft`; chỉ người (PO hoặc reviewer PO chỉ định) approve và publish |
| Q173 | Pilot chỉ dùng `mcq`, `fill_blank`, `arrange_sentence`; không `listening_choice` (chưa có audio) và không `speaking_repeat` (không publish được) |
| Q174 | Placeholder M1.3 xử lý bằng **archive qua CMS API**, không hard-delete; danh sách archive phải được PO duyệt |
| Q175 | Giữ block `text` + `vocabulary_list`. Renderer và việc thêm `vocabulary_list` vào union `TopicContentBlock` thuộc **task mới M2.5f**. **Người học chưa thấy nội dung topic cho tới M2.5f** — hiện chỉ thấy số đếm section và bài tập |
| Q176 | `mcq` đúng **4 option = 1 đáp án + 3 distractor** (R21 "≥ 4 mục" hiểu là 4 option tổng) |
| Q177 | **Không** thao tác DB trực tiếp với Story; 14 story placeholder chờ **M5.4** (khi CMS Story có archive) |
| Q178 | `DataSource` pilot tạo bằng **(a) migration forward** insert theo `code` với `ON CONFLICT DO NOTHING` |
| Q179 | `LessonWord` ghi bằng **(a) script Prisma** trong 1 transaction: `SELECT … FROM "Lesson" WHERE id=$1 FOR UPDATE`, chỉ ghi khi lesson `draft` và chưa archive, ngược lại fail-fast; **danh sách từ của bài nằm trong checklist của người duyệt** |
| Q194 | `fill_blank.acceptedTexts` gồm **chữ Hán + pinyin có dấu + pinyin không dấu** (viết liền, chữ thường); prompt ghi rõ "(gõ chữ Hán hoặc pinyin)" |
| TL-210 | Mỗi bài là một file JSON `backend/content/pilot/hsk1/lesson-NN.json`, có `"schemaVersion": 1` |
| TL-211 | Từ vựng tham chiếu bằng `hanzi` kèm `pinyin` có dấu thanh, không dùng id DB |
| TL-212 | `sourceKey` bài tập dạng `pilot-hsk1:lNN:eNN`, cố định qua các lần chạy |
| TL-213 | Slug bài không trùng placeholder (`${levelSlug}-lesson-${n}`) |
| TL-214 | (`orderIndex` lesson pilot = 1001–1005) — **chấp nhận** |
| TL-215 | (slug `hsk1-pilot-lNN-<chủ-đề>`) — **chấp nhận** |
| TL-216 | (**sửa**) Các thành phần của `Idempotency-Key` nối bằng ký tự ngăn cách cố định (ví dụ `\n`) hoặc hash `canonicalJson([dataSourceId, fileName, rows])`. Replay chỉ hợp lệ với **cùng tài khoản admin** (khác tài khoản → `409`). Bài đã nhập chỉ sửa qua **revision CMS**; nhập lại chỉ cho row có `sourceKey` mới |
| TL-217 | (**sửa**) Chỉ dùng lại Topic khi khớp **slug/title VÀ `status = draft`**; khác đi → fail-fast, không dùng lại theo `orderIndex` đơn thuần |
| TL-218 | (**sửa**) Chuẩn hoá đúng như `normalizePinyin` (`backend/src/common/utils/normalize-pinyin.ts`). Pipeline từ điển giữ **một pinyin cho mỗi `(hanzi, pinyin bỏ dấu)`**, nên dấu thanh trong file phải khớp `Word.pinyin` đã lưu; lệch → fail-fast, không tự ánh xạ |
| TL-219 | (resolve `Word` theo `(hanzi, pinyin)`, fail-fast khi thiếu) — **chấp nhận** |
| TL-220 | (`LessonExercise` không unique `(lessonId, orderIndex)`; script tự giữ duy nhất) — **chấp nhận** |
| TL-221 | (thứ tự publish vận hành Topic → Exercise → Lesson) — **chấp nhận** |
| TL-222 | (khoá stage theo task) — **bác**: hash theo path + `git commit -- <paths>` đã đủ |
| TL-223 | (chuyển `check.mjs` thành test trong `backend/test/` ở Pha 2) — **chấp nhận** |

**Ghi chú về tên riêng trong `key_text`:** được phép ghép từ các từ HSK1 (ví dụ `小雨` = `小` +
`雨`); tên riêng không tính là từ vựng của bài và phải ghi rõ trong `review.notice` của file JSON.

Các điểm từng là câu hỏi mở ở vòng trước nay đã chốt: (1) đường ghi `LessonWord` → Q179;
(2) nguồn `DataSource` → Q178; (3) block nội dung → Q175; (4) 14 Story placeholder → Q177.

## 0. Kết luận điều kiện tiên quyết

| Câu hỏi | Kết luận | Bằng chứng |
| --- | --- | --- |
| Pilot có làm được chỉ với API hiện có? | **Có**, với hai ngoại lệ đã có quyết định: `DataSource` cần một migration dữ liệu (Q178) và `LessonWord` cần script Prisma có guard (Q179) | K-A…K-H bên dưới, §4.1–§4.2 |
| `hsk1.json` có đủ từ cho chủ đề? | **Có**. 20 từ của bài 1 đều có trong `hsk1.json` **và** trong `final_words.json` (nguồn tạo bảng `Word`) với `level = HSK1`, pinyin khớp từng dấu thanh | self-check ở §5 |
| Placeholder có đang được learner dùng? | **Đang hiển thị**: 35 lesson placeholder đều `status: 'published'` và đi qua `buildLessonReadyWhere` | `backend/scripts/learning/seed-learning.ts:132`, `:141`; `backend/src/common/policies/lesson-readiness.policy.ts:20-29` |
| Có phải sửa file ngoài `docs/process/content-pipeline.md` + `lesson-01.json`? | **Pha 1/1b: không.** Pha 2 cần thêm script nạp dữ liệu, script `LessonWord` (Q179) và một migration `DataSource` (Q178) | §4 |

---

## 1. Khảo sát

Mỗi mục dưới đây trả lời đúng câu hỏi K-A…K-H của prompt, kèm `file:line`. Toàn bộ số liệu lấy
từ đọc source và đọc file dữ liệu trong repo — **không truy vấn DB** (xem §6).

### K-A — Khối nội dung trong `Topic.content`

**Block type có trong dữ liệu (seed).** Seed chỉ tạo 2 loại block, mỗi block chỉ có 1 field
`value` (string):

| `type` | Fields | Nguồn |
| --- | --- | --- |
| `text` | `value` | `backend/scripts/learning/seed-learning.ts:41-42`, `:54-55`, `:64-65` |
| `vocabulary_list` | `value: 'lesson_words'` (con trỏ tới `LessonWord` của bài, không phải danh sách từ) | `backend/scripts/learning/seed-learning.ts:44-47` |

Không có `grammar_points`, `example_sentences`, `image`, `audio` block trong seed
(`grep "type:" backend/scripts/learning/*.ts` chỉ ra 4 dòng nêu trên). `type` là string tự do:
helper ghi thẳng `content: Prisma.InputJsonValue` (`backend/scripts/learning/seed-learning-topic.ts:11`, `:23`).

**Nơi frontend parse.** Frontend **không parse block nào** của `Topic.content`:

- Contract của lesson page chỉ giữ `sections` counts, không có `topics[].content`
  (`frontend/src/features/learner-lesson/lesson-activity-contract.ts:12-35`, `sections` ở `:27-34`).
- Contract của player chỉ giữ topic `{ id, orderIndex, exercises }` — **không `content`, không
  `type`**; Zod `z.object` strip key lạ (`frontend/src/features/learner-lesson/lesson-player-contract.ts:30-38`).
- `frontend/src/features/learner-lesson/lesson-player-model.ts:56-70` (`readChoices`) và `:88-112`
  (`toPlayerExercise`) chỉ đọc `exercise.content` để lấy `options`/`tokens`; không có hàm nào
  đọc `Topic.content`.
- Trang bài học dựng 3 row từ counts, không từ content (`frontend/src/features/learner-lesson/lesson-sections.ts:48-93`;
  render ở `frontend/src/app/(learner)/learn/lessons/[id]/page.tsx:140-216`).
- Grep `vocabulary_list` toàn repo: chỉ có `backend/scripts/learning/seed-learning.ts:45`.
- Hệ quả: `text`, `vocabulary_list` đều **bị bỏ qua** (không render, cũng không lỗi). `image`
  và `audio` chỉ tồn tại trong DTO backend, cũng không render.

**Backend có validate shape không?** Không. Cột là JSON tuỳ ý (`backend/prisma/schema.prisma:733`);
DTO chỉ bound kích thước: `@Validate(BoundedJsonPayload)` = object|array, depth ≤ 20, canonical
≤ 100 000 byte (`backend/src/modules/cms/dto/create-topic-revision.dto.ts:36-39`;
`backend/src/modules/cms/dto/bounded-json-payload.validator.ts:8-9`, `:14`, `:17-18`). Service cast
thẳng `content as Prisma.InputJsonValue` (`backend/src/modules/cms/cms.service.ts:1189-1207`, cast ở `:1202`).
`backend/src/common/validation/` không có validator nào cho Topic.

**DTO khai báo lệch với seed.** `TopicContentBlock` chỉ khai báo `text{value}`, `image{url,alt?}`,
`audio{url,title?}` — **thiếu `vocabulary_list`** (`backend/src/modules/learning/dto/topic-response.dto.ts:5-19`);
`GET /learning/topics` vẫn cast `content as TopicContentBlock[]` mà không kiểm
(`backend/src/modules/learning/learning.service.ts:226`).

**Dữ liệu thực tế có 3 dạng `content`**, không chỉ mảng block: (i) mảng block như trên
(`backend/scripts/learning/seed-learning.ts:154`, `:160`); (ii) **chuỗi trơn**
(`backend/scripts/learning/seed-detail.ts:101`, `:123` — Topic và Story); (iii) object bất kỳ,
vì DTO chỉ đòi object|array (`backend/src/modules/cms/dto/bounded-json-payload.validator.ts:14`).
Vì vậy pipeline **không được** giả định `Topic.content` là mảng.

**Quyết định Q175:** giữ 2 block `text` + `vocabulary_list`; việc thêm `vocabulary_list` vào union
`TopicContentBlock` và viết renderer thuộc **task M2.5f**. Hệ quả: **người học chưa thấy nội dung
topic** cho tới M2.5f.

**`TopicType`** (`backend/prisma/schema.prisma:95-101`): `vocabulary | grammar | key_text | quiz | ai_speaking`.

| `TopicType` | Learner hiển thị? | Bằng chứng |
| --- | --- | --- |
| `vocabulary` | **Gián tiếp, một phần**: topic `vocabulary` tăng `sections.vocabulary.topicCount` (dùng cho trạng thái "đã học" của row), nhưng row "Từ vựng" chỉ hiện khi `wordCount > 0`, tức phải có `LessonWord` | `backend/src/modules/learning/activity/lesson-activity-progress.ts:124-136`; `frontend/src/features/learner-lesson/lesson-sections.ts:59-71` |
| `grammar` | **Gián tiếp**: góp vào `sections.grammar.topicCount` → row "Ngữ pháp" | `backend/src/modules/learning/activity/lesson-activity-progress.ts:134-135`; `lesson-sections.ts:72-81` |
| `key_text` | **Không** (không đếm, không render) | `lesson-activity-progress.ts:133-136` không có nhánh |
| `quiz` | **Không** như topic; exercise bên trong vẫn vào player | `frontend/src/features/learner-lesson/lesson-player-model.ts:115-130` |
| `ai_speaking` | **Không** | như trên |

Backend activity trả mọi topic public bất kể `type` (`backend/src/modules/learning/activity/lesson-activity.service.ts:63-75`, map ở `:641-648`)
nhưng frontend strip `type`/`content`. Kết luận K-A: **không block type nào được learner render**;
`vocabulary`/`grammar` chỉ ảnh hưởng tới con số trên 2 row.

### K-B — `LessonWord`

**Nơi learner đọc.** Chỉ một endpoint: `GET /api/v1/lessons/:id`
(`backend/src/modules/learning/lessons.controller.ts:23-29`) → `getLessonDetail`
(`backend/src/modules/learning/learning.service.ts:108-189`, select `lessonWords` ở `:135-157`,
filter `PUBLIC_LESSON_WORD_WHERE` ở `:136`) → serializer map sang key `words`
(`backend/src/modules/learning/public-lesson.serializer.ts:50-60`). Response chỉ có
`{ id, hanzi, traditional, pinyin, pinyinTone, meanings[{en, vi}] }` — **không** `orderIndex`,
**không** câu ví dụ (`public-lesson.serializer.ts:50-60`; `backend/src/modules/learning/dto/lesson-response.dto.ts:28-35`).
Filter public: `Word` published + chưa xoá (`backend/src/common/policies/lesson-readiness.policy.ts:3-11`).
Endpoint `/activity` mà learner page dùng chỉ trả `wordCount`
(`backend/src/modules/learning/activity/lesson-activity.service.ts:583-585`) và frontend hiện
không render mảng `words` (chỉ tồn tại trong generated types
`frontend/src/lib/api/backend-generated-types.ts:2512-2520`).

**Có nằm trong revision/snapshot của Lesson không? KHÔNG.**

- `LessonSnapshot` chỉ gồm `{ title, description, orderIndex, slug }`
  (`backend/src/modules/cms/cms.service.ts:139-144`, hàm build `:1175-1187`); snapshot này là
  toàn bộ payload revision (`:261`, `:310`).
- `TopicSnapshot` **có** `content` JSON (`backend/src/modules/cms/cms.service.ts:146-154`) — tức
  chỉ nội dung Topic được versioned.
- `ContentEntityType` không có `lesson_word` (`backend/prisma/schema.prisma:144-155`);
  `grep -rin "lessonword" backend/src/modules/cms` = **0 match**.
- Model `LessonWord` chỉ có `lessonId/topicId?/wordId/orderIndex`, unique `(lessonId, wordId)`,
  **không** `status`, `deletedAt`, `dataSourceId`, `createdById`
  (`backend/prisma/schema.prisma:906-922`, unique `:918`).

Hệ quả: `LessonWord` là bảng mutable **ngoài** revision/review/publish. Ghi vào lesson đã publish
thì learner thấy ngay, không có contentHash, không có actor trong revision.

**Không có API admin.** Toàn bộ route CMS (`backend/src/modules/cms/cms.controller.ts:130-735`) không
có route `lesson-words`/`words` (`grep -rin "lessonword" backend/src/modules/cms` = 0). Writer duy
nhất trong repo là 2 seed script: `backend/scripts/learning/seed-learning.ts:168-183`,
`backend/scripts/learning/seed-detail.ts:196-208` (đều `lessonWord.upsert` theo `lessonId_wordId`).

**Câu ví dụ.** Có model `Sentence` (`backend/prisma/schema.prisma:924-958`) và `LessonWordExample`
(`:960-974`) nhưng **không service/API nào đọc/ghi** (`grep -rn "prisma.sentence\|lessonWordExample\|lessonSentence" backend/src` = 0)
— bảng chết, learner không hiển thị. Câu ví dụ learner thấy được chỉ là field phẳng
`Word.example` (`:810`) do trang từ điển hiển thị (`backend/src/modules/dictionary/dictionary-word.mapper.ts:27`;
`frontend/src/features/learner-dictionary/word-detail.tsx:308-313`), 1 câu/từ, không gắn bài học.
⇒ Câu ví dụ của pilot **phải nằm trong `Topic.content`** để đi qua `TopicSnapshot.content` và
review; đây là lý do file JSON chứa `words[].example`.

**Cách ghi `LessonWord`:** đã chốt **Q179** — script Prisma trong một transaction, khoá hàng
lesson `FOR UPDATE` và chỉ ghi khi lesson `draft` (chi tiết §4.1). Hai phương án bị loại: thêm
endpoint CMS (phá R21) và không ghi `LessonWord` (mất row "Từ vựng" vì `wordCount` = 0).

### K-C — Tra `Word` bằng `hanzi`

- **Khoá unique thực tế là `(hanzi, pinyin)`**, không phải `hanzi`: `@@unique([hanzi, pinyin])`
  (`backend/prisma/schema.prisma:839`); `hanzi` chỉ có index thường (`:840`). Vì vậy hai pinyin
  khác nhau của cùng một chữ là hai row hợp lệ.
- **`WordLevel`** là bảng nối 1 row/(word, level), unique `(wordId, levelId)`
  (`backend/prisma/schema.prisma:891-904`, unique `:901`). HSK1 là **row `Level` có `code='HSK1'`**,
  không phải enum trên `Word` (`backend/scripts/dictionary/seed.ts:22-30`, upsert `:49-66`).
- **Tra theo hanzi hiện có**: `GET /api/v1/dictionary?query=` là **prefix** `LIKE 'x%'`, order theo
  Level thấp nhất rồi độ dài, `LIMIT 20`, không có logic chọn "đúng 1 row"
  (`backend/src/modules/dictionary/dictionary.service.ts:116-122`, `:35`; trả `pinyin` để client
  phân biệt homograph ở `:160-172`). Không có endpoint lookup exact theo hanzi; chi tiết từ chỉ
  theo `id` (`backend/src/modules/dictionary/dictionary.controller.ts:56-61`).
- **Từ đồng tự**: phải resolve theo cặp `(hanzi, pinyin)`. Dữ liệu: trong
  `backend/scripts/dictionary/parsed/final_words.json`, **29 hanzi HSK1 có > 1 pinyin variant**
  (ví dụ 了 `le|liao`, 哪 `na|ne|nei`, 和 `he|hu|huo`). Đây là lý do TL-211 bắt buộc kèm `pinyin`.
- **Từ có trong `hsk1.json` nhưng thiếu trong `Word`**: seed từ điển **không đọc** `hsk1.json`, nó
  đọc `parsed/final_words.json` và `createMany({ skipDuplicates: true })` — key hiệu lực là
  `(hanzi, pinyin)` (`backend/scripts/dictionary/seed.ts:20`, `:78-96`); khi map meaning/level mà
  không thấy `wordId` thì `continue` **im lặng** (`:147`). Dữ liệu: `hsk1.json` có **500 entry /
  497 hanzi**; `final_words.json` có **121 856** row, **530** row level HSK1, và **1 hanzi HSK1 vắng
  mặt** là `车上` (cụm 2 chữ, không phải headword) ⇒ không thể có `Word` row. Vì vậy script Pha 2
  phải **fail-fast** khi không tìm được `Word` theo `(hanzi, pinyin)` — không tự tạo `Word`
  (Word không có CMS route: `backend/src/modules/cms/cms.controller.ts` không có route `words`).
- **Kiểm chứng cho bài mẫu**: 20 từ của `lesson-01.json` đều tìm thấy trong `final_words.json`
  với `level = HSK1` và pinyin khớp (`/tmp/hsk-m29a/check.mjs`, §5).

### K-D — `dataSourceId` cho import (A.9 bắt buộc)

- **Chỉ có `GET /admin/cms/data-sources`**, không có POST/PATCH/PUT
  (`backend/src/modules/cms/cms.controller.ts:256-264`; service chỉ có `listDataSources` và
  `listMediaEligible` — `backend/src/modules/cms/data-sources.service.ts:35-63`, `:66-83`;
  hợp đồng `docs/api/api.md:671`).
- **Field bắt buộc** của `DataSource`: `code` (unique), `name`, `version`
  (`backend/prisma/schema.prisma:496-498`); unique phụ `(name, version)` (`:526`).
  `license`, `attribution`, `referenceUrl`, `contentHash`, `notes` là optional (`:499-505`) —
  nhưng `license` **bắt buộc nếu nguồn dùng cho media**: predicate `eligibleFor=media`
  (`backend/src/modules/cms/media-ingestion/media-ingestion.policy.ts:9-14`) và trigger snapshot
  media (`backend/prisma/migrations/20260813120000_media_provenance_provider_hardening/migration.sql:130-133`).
- **`dataSourceId` là bắt buộc trong body import**: `@IsInt @Min(1) @Max(INT4_MAX)`
  (`backend/src/modules/cms/dto/exercise-import.dto.ts:22-27`); preview kiểm tồn tại
  (`backend/src/modules/cms/exercise-import/exercise-import.service.ts:335-339`), commit khoá row
  `FOR UPDATE` (`:117-126`); ghi vào `ImportJob.dataSourceId` (`:235`) và `LessonExercise.dataSourceId`
  (`:274`). Import **không** kiểm `license`/`kind` (`grep license` trong `exercise-import/` = 0).
- **Đường tạo DataSource hiện có trong repo**:
  - Migration SQL forward, idempotent — đã dùng thật cho 8 nguồn từ điển:
    `INSERT INTO "DataSource" (...) VALUES (...) ON CONFLICT ("code") DO NOTHING`
    (`backend/prisma/migrations/20260810092000_p0_cms_provenance_import_audit/migration.sql:377-388`;
    ghi nhận ở `docs/PLAN.md:908`).
  - Test seed (chỉ DB disposable, guard `assertDisposableTestDatabase`):
    `backend/scripts/test/seed-frontend-admin-console.ts:111-120`, guard ở `:60`, npm script
    `test:seed:frontend-console` (`backend/package.json:59`).
  - **Không** có `prisma/seed.ts` hay block `prisma.seed`; **không** có route/service create.
- Ràng buộc: khi row đã bị `MediaIngestion` tham chiếu, các field
  `code/version/license/referenceUrl/attribution/contentHash` **immutable** (trigger
  `DataSource_media_provenance_guard`, `backend/prisma/migrations/20260813120000_media_provenance_provider_hardening/migration.sql:172-202`).
- **Cách tạo nguồn pilot:** đã chốt **Q178** — migration forward insert row pilot với
  `ON CONFLICT ("code") DO NOTHING` (chi tiết §4.2). Ba phương án bị loại: script one-off (không có
  migration history, dễ trỏ nhầm DB), nhét vào seed nội dung (trộn concern, seed đang publish
  placeholder), thêm endpoint (phá R21).

### K-E — Ràng buộc từng dạng bài tập + distractor R21

**Hợp đồng A.9** (`docs/api/api.md:726-737`):

| `type` | `content` | `answer` |
| --- | --- | --- |
| `mcq` | `{ options: [{ id, text }] }`, **2–100** phần tử, `id` không trùng | `{ optionId }`, phải là một `id` trong `content.options` |
| `fill_blank` | `{}` (exact-key: không field nào khác) | `{ acceptedTexts: string[] }` **1–100** + `caseSensitive?` boolean |
| `arrange_sentence` | `{ tokens: [{ id, text }] }`, 2–100, `id` không trùng | `{ tokenIds }` đủ mọi token, không trùng, **thứ tự = đáp án đúng** |

Field chung: `id` 1–128 ký tự không khoảng trắng; `text`/`prompt` 1–4096; `explanation` ≤ 4096;
`orderIndex` 1–1 000 000 (`docs/api/api.md:726-728`).

**Validator** (`backend/src/common/validation/lesson-exercise-authoring.validator.ts:6-11`):
`maxStringLength 4 096`, `maxArrayLength 100`, `maxJsonBytes 65 536`, `maxDepth 8`; thêm
`orderIndex` 1..1 000 000 (`:13-16`). Áp dụng: depth (`:274-282`), canonical bytes (`:284-300`),
exact-key top-level (`:66-73`) và theo type (`:146`, `:163`, `:179`, `:181`, `:215`, `:232`),
`required_field` (`:74-76`), stable-id regex `^[\p{L}\p{N}][\p{L}\p{N}._:-]*$` (`:382-394`),
array min/max (`:347-366`). **20 từ và 8+ bài tập không vi phạm giới hạn nào**: 8 row < 100 row
tối đa của import (`backend/src/modules/cms/exercise-import/exercise-import.constants.ts:1`;
`backend/src/modules/cms/dto/exercise-import.dto.ts:42-43`). Mỗi exercise được validate độc lập
nên không cộng dồn.

**Đính chính quan trọng:** API **không** yêu cầu ≥ 4 lựa chọn — validator chỉ chặn `< 2` options
(`lesson-exercise-authoring.validator.ts:147`) và `< 2` tokens (`:216`). Con số "≥ 4 mục" của R21
là ràng buộc **phía script sinh dữ liệu**, không phải lỗi server.

**Distractor cùng Level theo R21** (`docs/PLAN.md:752`, nguyên văn):
"Script ngoài sinh file import bài tập nháp (mcq, arrange_sentence, listening_choice) từ
Word/LessonWord; distractor cùng Level, thiếu ≥ 4 mục thì báo lỗi; đi qua revision → review →
publish đã có, không thêm endpoint".

Cách hiểu và cách kiểm trong script (thiết kế, repo chưa có code distractor — `grep distractor`
chỉ ra `docs/PLAN.md:752` và `docs/archive/PRODUCT_IMPLEMENTATION_MASTER_PLAN.md:730`):

1. "Cùng Level" neo vào `WordLevel.levelId` của Level đích (`backend/prisma/schema.prisma:891-904`) —
   HSK1 là `Level.code = 'HSK1'`.
2. Candidate hợp lệ = `WordLevel` của Level đó ⋈ `Word` `published` + `deletedAt IS NULL`
   (`backend/src/common/policies/lesson-readiness.policy.ts:3-11`). **Được dùng cả từ đang có
   trong bài** (`LessonWord` của lesson đích) — R21 chỉ đòi "cùng Level"; điều kiện duy nhất là
   **không trùng đáp án** và không trùng nhau trong cùng một câu.
3. Sinh `id` cho option theo stable-id (gợi ý `w<wordId>`), không trùng trong cùng exercise.
4. **Thiếu < 4 candidate ⇒ báo lỗi, không sinh câu.** Script phải tự đếm và fail-closed *trước*
   `exercise-imports/preview`; server không enforce ngưỡng 4.
5. `arrange_sentence` không có distractor — chỉ là hoán vị token. Hai điều kiện bắt buộc:
   `content.tokens` phải **xáo trộn** (UI render token đúng thứ tự trong `content`,
   `frontend/src/features/learner-lesson/lesson-player.tsx:795`) và `id` token **không được sắp**
   theo thứ tự đáp án (dùng id ngẫu nhiên như `tkn-q7`, `tkn-b2`, không dùng `t1, t2, t3`).
   Mỗi bài chỉ được có **đúng một** thứ tự đúng ngữ pháp.

**Shape row của import** (`backend/src/modules/cms/exercise-import/lesson-exercise-import.ts:47-58`):
`sourceKey` (bắt buộc, 1–128, không khoảng trắng — `:74`, `:231-244`), `lessonId` (bắt buộc — `:75`),
`topicId?` (`:76-79`), `orderIndex` (bắt buộc 1..1e6 — `:80`), `type`, `prompt`, `content`,
`answer`, `explanation?`, `mediaId?`; key lạ → `unknown_field` tại `$.$unknown` (`:70-72`).
`ImportBody`: `dataSourceId`, `fileName` 1–255, `rows` 1–100
(`backend/src/modules/cms/dto/exercise-import.dto.ts:20-46`; `docs/api/api.md:687-689`).

### K-F — Placeholder (M1.3)

**Nhận diện bằng code seed** (`backend/scripts/learning/seed-learning.ts`):

| Thuộc tính | Giá trị | Dòng |
| --- | --- | --- |
| Số bài/level | `LESSONS_PER_LEVEL = 5` | `:7` |
| Từ/bài | `WORDS_PER_LESSON = 20` | `:8` |
| Description | prefix `Temporary lesson for testing` + tên level | `:9`, `:115` |
| Slug lesson | `${levelSlug}-lesson-${n}` với `levelSlug` = `name` bỏ mọi ký tự không `[a-z0-9]` ⇒ `hsk1-lesson-1`…`hsk1-lesson-5` (không có gạch giữa `hsk` và `1`) | `:34-36`, `:113` |
| Title lesson | `${level.name} - Lesson ${n}` | `:114` |
| `orderIndex` lesson | 1..5 | `:131`, `:140` |
| Trạng thái | `status: 'published'`, `deletedAt: null` | `:132-133`, `:141` |
| Topic | 2/bài: `Vocabulary Overview` (ord 1) + `Practice Notes` (ord 2), published | `:149-163`; `seed-learning-topic.ts:24`, `:32` |
| Slug story | `${levelSlug}-story-${n}` (loop hardcode 2) | `:190`, `:195`, `:208` |
| Story gắn lesson? | **Không** — seed không set `lessonId` ⇒ story level-scoped | `:205-212` |

Số lượng suy ra từ code (không query DB): **7 Level × 5 = 35 Lesson** (`:112`),
**35 × 2 = 70 Topic** (`:149-163`), **7 × 2 = 14 Story** (`:190`), khớp `docs/PLAN.md:101`, `:214`.
`seed-detail.ts` nếu chạy sẽ tạo thêm `hsk-1-lesson-detail-test` + 1 Topic + 1 Story
(`backend/scripts/learning/seed-detail.ts:62-131`) và xung đột `orderIndex: 1` với placeholder
của HSK1 (`:70`, `:77` vs `@@unique([levelId, orderIndex])` `backend/prisma/schema.prisma:719`).

**API archive:**

- Lesson: `POST /api/v1/admin/cms/lessons/:lessonId/archive`, **không body**
  (`backend/src/modules/cms/cms.controller.ts:450-458`; `docs/api/api.md:621`).
- Topic: `POST /api/v1/admin/cms/topics/:topicId/archive`, **không body**
  (`backend/src/modules/cms/cms.controller.ts:524-532`; `docs/api/api.md:627`).
- **Story: KHÔNG có API archive — thực tế không có endpoint admin nào cho Story**
  (`grep -n "story" backend/src/modules/cms/cms.controller.ts` = 0 match; bảng A.8 chỉ có
  Lesson/Topic — `docs/api/api.md:613-627`; Story mutation xếp M5 — `docs/api/api.md:1444`).
- Không có route unarchive/restore cho bất kỳ entity nào trong CMS controller (`backend/src/modules/cms/cms.controller.ts` không có route restore; `cms.service.ts` không có hàm unarchive).

**Cascade:** archive là soft UPDATE đúng **1 hàng** (`status: 'archived'`, `deletedAt: now()`)
(`backend/src/modules/cms/cms.service.ts:487-495` lesson, `:756-764` topic). Không archive Topic con,
không xoá `LessonWord`, không chạm `Progress`. Các `onDelete: Cascade` trong schema
(`Topic.lesson` `backend/prisma/schema.prisma:747`, `LessonWord.lesson` `:913`, `Progress.lesson` `:1086`)
chỉ chạy khi hard delete — không có hard delete nào trong `backend/src` (`grep "\.lesson\.delete"` = 0),
và `LessonExercise.lesson` còn là `onDelete: Restrict` (`:1017`). Archive không kiểm tra progress
(`cms.service.ts:476-486`), archive lần 2 trả `idempotent: true` (`:485-491`).

**Ảnh hưởng learner đang có tiến độ trên placeholder:** `Progress` **được giữ nguyên** (không mất
dữ liệu) nhưng bài không truy cập được nữa:

- `GET /learning/lessons/:id` dùng `buildLessonReadyWhere` ⇒ 404 (`backend/src/modules/learning/learning.service.ts:112`, ném ở `:185`;
  `docs/api/api.md:353`).
- `POST /learning/lessons/:id/start` gọi `requirePublicLesson` **trước** khi đọc progress ⇒ 404
  "Lesson not found or not ready." (`backend/src/modules/learning/activity/lesson-activity.service.ts:159`, `:856-865`).
- Path/home ẩn progress khỏi lộ trình (`backend/src/modules/learning/path/learning-path.reader.ts:36-52`).
- API progress vẫn đọc được row (`lesson-activity.service.ts:669-672`, `:694-696`).
- Publish Topic của lesson đã archive trả 404 `Parent lesson not found.`
  (`backend/src/modules/cms/cms.service.ts:1067-1075`, gọi ở `:704`).
- Story placeholder **không** bị ảnh hưởng (level-scoped, `backend/src/modules/learning/learning.service.ts:237-242`)
  ⇒ 14 story "Temporary short story for …" vẫn public và **không thể archive** bằng API hiện có.

### K-G — Điều kiện publish Lesson

`LESSON_NO_PUBLISHED_CHILD` chỉ throw ở một chỗ: `assertLessonPublishReady`
(`backend/src/modules/cms/cms.service.ts:1078-1107`, throw `:1101-1106`), gọi từ
`publishLessonRevision` (`:435`).

Điều kiện đúng:

1. Level phải `published` + `deletedAt IS NULL` (`cms.service.ts:1084-1087`) → nếu không:
   `LESSON_LEVEL_NOT_PUBLISHED` (`:1095-1099`, `docs/api/api.md:656`).
2. `topicCount + storyCount > 0` với cả hai đếm theo `PUBLIC_CONTENT_WHERE`
   (`cms.service.ts:1088-1093`) → nếu không: `LESSON_NO_PUBLISHED_CHILD` (`:1101-1106`,
   `docs/api/api.md:657`).
3. Revision được yêu cầu là **latest** và review mới nhất `approved` — `decidePublishAction`
   (`backend/src/modules/cms/cms-workflow.ts:16-45`, throws `:24-29`, `:31-36`), gọi lại trong
   `publishLessonRevision` (`cms.service.ts:418-427`); `REVISION_NOT_LATEST` còn được kiểm ở
   `getRequestedLatestRevision` (`cms.service.ts:855-877`).
4. Entity chưa archive — `assertMutableEntity` (`cms.service.ts:1043-1054`, gọi `:405`).

Lưu ý: `Story` chỉ được đếm khi có `lessonId` (`cms.service.ts:1091-1093`), mà seed story có
`lessonId = null` ⇒ với lesson seed, `storyCount` luôn 0, chỉ Topic thỏa.

**Quan hệ thật và thứ tự publish.** `LessonExercise` có `lessonId` bắt buộc + `topicId?` optional
(`backend/prisma/schema.prisma:996-997`, FK `Restrict` `:1017-1018`); `Topic.lessonId` bắt buộc
(`:729`, `:747`).

- Exercise publish **không** đòi Topic/Lesson published — chỉ kiểm parent tồn tại
  (`backend/src/modules/cms/exercise-authoring.service.ts:639-660`, gọi `:416`).
- Topic publish chỉ kiểm lesson tồn tại, không kiểm published (`cms.service.ts:704`).
- Lesson publish **không** đếm exercise (`cms.service.ts:1088-1093`).

⇒ Thứ tự bắt buộc duy nhất là **≥ 1 Topic phải published trước khi publish Lesson**. Trình tự
khuyến nghị (để learner không thấy bài thiếu nội dung): **Topic → Exercise → Lesson**; đây là quy
ước vận hành, không phải ràng buộc cứng của server.

### K-H — Unique `slug` và `orderIndex`

- Lesson `slug` là **unique toàn cục** (`slug String @unique`, `backend/prisma/schema.prisma:691`;
  index `Lesson_slug_key` `backend/prisma/migrations/20260513095839_init_scale_ready/migration.sql:365`) —
  **không** phải `[levelId, slug]`.
- Lesson `@@unique([levelId, orderIndex])` (`backend/prisma/schema.prisma:719`;
  `20260513101532_refine_learning_indexes/migration.sql:22`).
- Topic `@@unique([lessonId, orderIndex])` (`backend/prisma/schema.prisma:759`; migration trên `:31`) —
  scope theo lesson, Topic không có slug.
- Story unique `slug` (`:774`); `orderIndex` chỉ là index thường (`:793-794`).
- Trùng unique → P2002 → `409 CONTENT_UNIQUE_CONFLICT` (`backend/src/modules/cms/cms-workflow.ts:60`,
  `backend/src/modules/cms/cms.service.ts:1147-1152`, `docs/api/api.md:658`).

**Placeholder đã archive vẫn chiếm `orderIndex` và `slug`.** Unique index chỉ gồm cột dữ liệu,
không có `WHERE deletedAt IS NULL` (migration `20260513101532`…`:22`, `:31`; `20260513095839`…`:365`);
archive là UPDATE chứ không DELETE (`cms.service.ts:487-495`); admin list không lọc `deletedAt`
(`cms.service.ts:172-183`; `backend/src/modules/cms/dto/admin-lessons-query.dto.ts:19-22`).
Ngược lại, chạy lại `seed:learning` sẽ **hồi sinh** placeholder đã archive (upsert theo slug rồi set
`status: 'published'`, `deletedAt: null` — `backend/scripts/learning/seed-learning.ts:123-134`).

**`orderIndex` cho pilot:** seed dùng 1..5 (`seed-learning.ts:131`, `:140`). Pilot dùng
**1001–1005** (ngoài dải seed, vẫn ≤ `@Max(1_000_000)` — `backend/src/modules/cms/dto/create-lesson-revision.dto.ts:25-29`).
Không có kiểm tra "contiguous": path tự tính `position` từ index mảng đã lọc
(`backend/src/modules/learning/path/learning-path.policy.ts:68-69`, `:78`), unlock so sánh
`orderIndex` với previous ready (`backend/src/modules/learning/activity/lesson-activity.service.ts:800-814`).
Topic của lesson mới dùng 1,2,3 vì unique scope theo `lessonId`.

---

## 2. Định dạng file `lesson-NN.json`

Đường dẫn: `backend/content/pilot/hsk1/lesson-NN.json`, một file/bài, `"schemaVersion": 1` (TL-210).
Bài mẫu: `backend/content/pilot/hsk1/lesson-01.json`.

### 2.1 Cấu trúc

| Field | Kiểu | Bắt buộc | Ý nghĩa / ràng buộc |
| --- | --- | --- | --- |
| `schemaVersion` | int | ✔ | Phải `1`; script từ chối version khác |
| `lesson` | object | ✔ | Metadata bài học |
| `lesson.sourceKey` | string | ✔ | `pilot-hsk1:lNN` — định danh nội bộ của file (không gửi API, không phải `sourceKey` của exercise) |
| `lesson.levelCode` | string | ✔ | `"HSK1"`; script resolve `levelId` qua `GET /api/v1/levels` |
| `lesson.slug` | string | ✔ | kebab-case, **unique toàn cục**, phải khác `${levelSlug}-lesson-N` (TL-213). Mẫu: `hsk1-pilot-l01-chao-hoi-gioi-thieu` |
| `lesson.title` | string | ✔ | 1–200 (`LessonRevision`) |
| `lesson.description` | string | ✖ | ≤ 2000 |
| `lesson.orderIndex` | int | ✔ | 1..1 000 000; pilot dùng 1001–1005 (K-H) |
| `dataSource` | object | ✔ | `{ code, version }` — resolve sang `dataSourceId` qua `GET /admin/cms/data-sources` (K-D) |
| `words` | array | ✔ | Danh sách từ vựng; hiện **không có API** (K-B) — dữ liệu để review và để ghi theo phương án được chọn |
| `words[].hanzi` | string | ✔ | Phải có trong `hsk1.json` (TL-211) và trong bảng `Word` theo `(hanzi, pinyin)` (K-C) |
| `words[].pinyin` | string | ✔ | Có dấu thanh; dùng để phân biệt đồng tự (TL-211) |
| `words[].meaningVi` | string | ✔ | Nghĩa tiếng Việt ngắn — **người kiểm lại** |
| `words[].example` | object | ✔ | `{ hanzi, pinyin, meaningVi }`; câu ví dụ gốc, chỉ dùng từ HSK1 |
| `topics` | array | ✔ | ≥ 1 `vocabulary`; khuyến nghị có `grammar` hoặc `key_text` |
| `topics[].key` | string | ✔ | Định danh cục bộ trong file (`t01`…); dùng để nối exercise → topic |
| `topics[].type` | enum | ✔ | `vocabulary \| grammar \| key_text \| quiz \| ai_speaking` (`backend/prisma/schema.prisma:95-101`) |
| `topics[].title` | string | ✔ | 1–200 |
| `topics[].subtitle` | string | ✖ | ≤ 500 |
| `topics[].orderIndex` | int | ✔ | 1..1e6, unique theo lesson |
| `topics[].isPremium` / `isLocked` | boolean | ✔ | `TopicRevision` bắt buộc 2 field này |
| `topics[].content` | array block | ✔ | Chỉ dùng block learner hợp lệ theo K-A (xem 2.2) |
| `exercises` | array | ✔ | ≥ 8 bài, ≥ 3 loại trong `mcq \| fill_blank \| arrange_sentence` (Q173) |
| `exercises[].sourceKey` | string | ✔ | `pilot-hsk1:lNN:eNN` (TL-212), cố định qua các lần chạy, ≤ 128 ký tự không khoảng trắng |
| `exercises[].topicKey` | string \| null | ✔ | Trỏ tới `topics[].key`; `null` = exercise độc lập của lesson |
| `exercises[].type` | enum | ✔ | Chỉ 3 loại được publish (Q173) |
| `exercises[].prompt` | string | ✔ | 1–4096 |
| `exercises[].content` | object | ✔ | Theo bảng A.9 cho từng type (K-E) |
| `exercises[].answer` | object | ✔ | Theo bảng A.9 |
| `exercises[].explanation` | string | ✔ (pilot) | ≤ 4096, tiếng Việt |
| `exercises[].orderIndex` | int | ✔ | 1..1e6; `LessonExercise` **không** có unique `(lessonId, orderIndex)` (`backend/prisma/schema.prisma:1028-1039`) nên script phải tự giữ duy nhất |
| `review` | object | ✔ | `{ status: "draft", requiredChecks: string[], notice: string, notes: [] }` — nơi người duyệt ghi chú; `status` luôn `draft` cho tới khi người approve (Q172) |

### 2.2 Block nội dung được phép trong `topics[].content`

Theo K-A, **không block type nào đang được learner render**. File mẫu chỉ dùng 2 loại tồn tại
trong dữ liệu và nằm trong đường đi qua `TopicSnapshot.content`:

| `type` | Field | Trạng thái |
| --- | --- | --- |
| `text` | `value` | Nằm trong union DTO (`backend/src/modules/learning/dto/topic-response.dto.ts:7-9`) |
| `vocabulary_list` | `value: "lesson_words"` | Đúng shape seed (`backend/scripts/learning/seed-learning.ts:44-47`) nhưng **ngoài union DTO** — thiếu trong `topic-response.dto.ts:5-19`; cần bổ sung khi làm UI (xem §4.3) |

Nội dung ngữ pháp/hội thoại đặt trong các block `text` (mỗi điểm 1 block) để không phát minh type
mới khi chưa có renderer. Đây là quyết định **Q175** — xem §4.3 cho hệ quả và mốc M2.5f.

### 2.3 Ánh xạ sang API

| File | API | Ghi chú |
| --- | --- | --- |
| `lesson.levelCode` | `levelId` cho `CreateLesson` | resolve qua `GET /api/v1/levels` (public, chỉ trả Level published — `backend/src/modules/learning/learning.service.ts:36-43`) |
| `lesson.{title, description, orderIndex, slug}` | `CreateLesson` = `LessonRevision` + `levelId` (`docs/api/api.md:632`) | `POST /admin/cms/lessons` |
| `topics[i].{title, subtitle, type, content, orderIndex, isPremium, isLocked}` | `CreateTopic` = `TopicRevision` + `lessonId` (`docs/api/api.md:634-635`) | `POST /admin/cms/topics` |
| `topics[i].key` | — | không gửi API; resolve sau khi tạo (lessonId + orderIndex) |
| `exercises[j]` | `ImportBody.rows[]` (`backend/src/modules/cms/exercise-import/lesson-exercise-import.ts:47-58`) | `sourceKey, lessonId, topicId, orderIndex, type, prompt, content, answer, explanation` |
| `dataSource.{code, version}` | `ImportBody.dataSourceId` | resolve qua `GET /admin/cms/data-sources` (paging) |
| `words[]` | **không có API** (K-B) | xử lý theo §4.1 |
| `review` | — | không gửi API; trạng thái draft nằm ở DB (`ContentStatus.draft` — `backend/prisma/schema.prisma:22-26`) |

---

## 3. Trình tự gọi API của script Pha 2

Script dự kiến: `backend/scripts/content/import-pilot-content.ts` (đề xuất, Pha 2 tạo), chạy bằng
`npx ts-node`, nhận đường dẫn file JSON + biến môi trường `API_BASE_URL`, `ADMIN_TOKEN` **từ
environment của tiến trình** (không đọc/ghi `.env`, không hard-code token).

### 3.1 Các bước

| # | Bước | Endpoint | Idempotent? | Ghi chú |
| --- | --- | --- | --- | --- |
| 0 | Preflight | `GET /api/v1/levels`, `GET /admin/cms/data-sources`, `GET /admin/cms/lessons?search=<slug>` | đọc | Fail-fast nếu thiếu Level HSK1 / DataSource / slug đã tồn tại ở trạng thái không mong muốn |
| 1 | Tạo Lesson draft | `POST /admin/cms/lessons` | **Không** (`data.idempotent: false` trong hợp đồng `docs/api/api.md:617`) | Idempotent do script: nếu `search` thấy slug ⇒ dùng lại `lessonId`, không tạo mới |
| 2 | Tạo Topic draft | `POST /admin/cms/topics` (mỗi topic) | **Không** | Idempotent do script (TL-217): đọc `GET /admin/cms/lessons/:id` → `topics[]`; chỉ dùng lại `topicId` khi **khớp slug/title VÀ `status = draft`**; khác đi ⇒ fail-fast, **không** dùng lại theo `orderIndex` đơn thuần |
| 3 | Preview exercise | `POST /admin/cms/exercise-imports/preview` | đọc (không ghi DB) | Trả `previewHash`, `validRows`, `errors[]`; script **dừng** nếu `invalidRows > 0`, **trừ** trường hợp ở §3.3 (mọi lỗi là `source_key_already_exists`) |
| 4 | Commit exercise | `POST /admin/cms/exercise-imports` + `previewHash` + `Idempotency-Key` | **Có** | replay cùng key + cùng payload ⇒ `idempotent: true`, không nhân bản |
| 5 | Ghi `LessonWord` (Q179) | Prisma transaction + `SELECT … FOR UPDATE` | **Có** (`upsert` theo `(lessonId, wordId)`) | Chỉ ghi khi lesson `draft`; khác ⇒ fail-fast (§4.1) |
| 6 | Kiểm chứng | `GET /admin/cms/lessons/:id`, `GET /admin/cms/exercises?lessonId=` | đọc | Xác nhận mọi bản ghi `draft`, đếm đúng 3 topic / 10 exercise |

`GET /admin/cms/lessons?search=` khớp `title`/`slug` kiểu `contains` không phân biệt hoa thường
(`backend/src/modules/cms/cms.service.ts:176-184`), nên script **phải tự so khớp tuyệt đối** `slug`
và dừng nếu có > 1 kết quả.

### 3.2 `Idempotency-Key`

Pattern bắt buộc của backend: `[A-Za-z0-9][A-Za-z0-9._:-]*`, dài 8–128, thiếu/sai → 422
(`backend/src/modules/cms/exercise-import/exercise-import.service.ts:581-592`;
`docs/api/api.md:692-694`). Preview hash là sha256 canonical của
`{contractVersion, dataSourceId, fileName?, rows, errors}` (`backend/src/modules/cms/exercise-import/lesson-exercise-import.ts:145-166`).

Công thức (TL-216) — **cố định theo intent, không theo lần chạy**; các thành phần nối bằng ký tự
ngăn cách cố định (`\n`) hoặc hash trên `canonicalJson` để không phụ thuộc thứ tự khoá:

```
key = `pilot-import:v1:${lessonSourceKey}:` +
      sha256(canonicalJson([dataSourceId, fileName, rows])).slice(0,16)
```

- Cùng nội dung ⇒ cùng key ⇒ chạy lại là replay, không nhân bản.
- Key phải ổn định giữa các máy/phiên: chỉ phụ thuộc `dataSourceId`, `fileName`, canonical rows và
  `sourceKey` bài — không phụ thuộc thời gian, `uuid`, hay thứ tự duyệt Map.
- **Replay chỉ hợp lệ với cùng tài khoản admin** (TL-216): cùng key + cùng payload nhưng khác
  tài khoản ⇒ `409` vì service so `existing.createdById !== actor.id`
  (`backend/src/modules/cms/exercise-import/exercise-import.service.ts:139-143`). CMS **không có**
  route đọc `ImportJob`, nên nếu script muốn pre-check thì đọc bảng `ImportJob` bằng Prisma client
  (cùng đường với Q179); nếu không pre-check thì coi `409` là điểm dừng và báo người chạy.
- **Bài đã nhập chỉ sửa qua revision CMS** (`POST /admin/cms/exercises/:exerciseId/revisions`,
  `backend/src/modules/cms/cms.controller.ts:295`). Nhập lại chỉ dành cho row có `sourceKey`
  **mới**; row cũ sẽ trả `SOURCE_KEY_ALREADY_EXISTS` (422, `docs/api/api.md:707`).
- Header `Idempotency-Key` chỉ tồn tại trong phạm vi CMS: ngoài `exercise-imports` chỉ có media
  ingestion đọc header này (`backend/src/modules/cms/cms.controller.ts:140-178`); create/revision/
  review/publish của Lesson/Topic **không** nhận key.

### 3.3 Chạy lại sau khi lỗi giữa chừng

| Đã xong trước khi lỗi | Trạng thái DB | Lần chạy lại |
| --- | --- | --- |
| Chưa tạo gì | trống | Chạy lại bình thường |
| Đã tạo Lesson | 1 lesson `draft` | Preflight tìm thấy slug ⇒ dùng lại `lessonId`; nếu lesson `published`/`archived` ⇒ **dừng và báo**, không sửa (tránh đè bài đã duyệt) |
| Đã tạo 1–2 Topic | lesson có 1–3 topic | Bước 2 đọc `topics[]` của lesson, khớp theo `orderIndex`; chỉ tạo topic còn thiếu. Không tạo trùng vì `@@unique([lessonId, orderIndex])` |
| Import commit xong nhưng script chết trước bước 6 | exercises `draft`, `ImportJob` đã có | Chạy lại bước 3–4 với **cùng payload** ⇒ cùng `previewHash` + cùng key ⇒ `idempotent: true`, không nhân bản |
| Import đang dở (timeout/503) | không rõ | Backend hứa retry được với cùng key (`docs/api/api.md:718`); script retry tối đa 2 lần với cùng key rồi dừng và in hướng dẫn kiểm tra |

**Luật bỏ qua điểm dừng (TL-216).** Nếu preview trả `invalidRows > 0` nhưng **mọi** lỗi đều là
`source_key_already_exists`, hoặc DB đã có `ImportJob` cùng `Idempotency-Key` cho cùng
`dataSourceId` + cùng tài khoản admin, thì script **không dừng**: gọi `commit` với **đúng key và
đúng `previewHash` cũ** để nhận `idempotent: true`. Mọi trường hợp khác (kể cả khác tài khoản
admin) vẫn dừng và báo.

Nguyên tắc: **mọi bước ghi đều phải kiểm trạng thái trước khi ghi**; script không bao giờ
`DELETE`, không bao giờ sửa bản ghi không do pilot tạo, và dừng ngay nếu gặp bản ghi đã `published`.

---

## 4. Quyết định thi hành cho Pha 2

Các câu hỏi của vòng khảo sát trước đã được chốt (bảng quyết định ở đầu tài liệu). Mục này ghi
cách thi hành + bằng chứng, để Pha 2 không phải quyết định lại.

### 4.1 Q179 — Ghi `LessonWord` bằng script Prisma có guard

`LessonWord` không có revision, không có `status`, không có API admin (K-B), nên đây là chỗ duy
nhất phải ghi thẳng DB ngoài CMS. Cách thi hành đã chốt:

1. Mở transaction và khoá hàng lesson ngay:
   `SELECT id, status, "publishedAt", "deletedAt" FROM "Lesson" WHERE id = $1 FOR UPDATE`.
2. Chỉ ghi khi `status = 'draft'` **và** `"publishedAt" IS NULL` **và** `"deletedAt" IS NULL`;
   khác đi ⇒ **fail-fast**, không ghi gì. Đây là guard chống đè bài đã duyệt.
3. `lessonWord.upsert` theo unique `(lessonId, wordId)` (`backend/prisma/schema.prisma:918`) với
   `orderIndex` lấy theo đúng thứ tự trong file nguồn, không theo thứ tự query DB.
4. (tuỳ chọn, khuyến nghị) Ghi `AuditLog` (`backend/prisma/schema.prisma:1334-1352`):
   `action = 'lesson_word.import_pilot'`,
   `correlationId` = hash file nguồn, `afterSummary` = số từ + hash.
5. Sau transaction, đọc lại lesson để xác nhận vẫn `draft`.
6. **Danh sách từ của bài nằm trong checklist của người duyệt** (Q179) — khớp
   `review.requiredChecks` trong file JSON.

Giới hạn đã biết: không có revision cho `LessonWord` (`ContentEntityType` không có `lesson_word`,
`backend/prisma/schema.prisma:144-155`), nên `AuditLog` chỉ là log tự ghi, không phải source of
truth. Hai phương án bị loại: **(b)** thêm endpoint CMS — phá R21 ("không thêm endpoint",
`docs/PLAN.md:752`), phải sửa `backend/openapi.json` + `docs/api/api.md` + DTO/test; **(c)** không
ghi `LessonWord` mà đưa từ vào `Topic.content` — đúng workflow nhưng `wordCount` = 0 nên row
"Từ vựng" biến mất (`frontend/src/features/learner-lesson/lesson-sections.ts:59-67`). Ghi lại để
M5 xem lại khi Story/Word có CMS mutation.

### 4.2 Q178 — `DataSource` pilot tạo bằng migration forward

Chỉ có `GET /admin/cms/data-sources` (K-D), nên nguồn phải tạo bằng dữ liệu. **Đã chốt (a):**
migration forward `INSERT INTO "DataSource" (...) VALUES (...) ON CONFLICT ("code") DO NOTHING`,
đúng pattern 8 nguồn từ điển
(`backend/prisma/migrations/20260810092000_p0_cms_provenance_import_audit/migration.sql:377-388`):
idempotent theo `code` unique (`backend/prisma/schema.prisma:496`), có migration history, không
thêm endpoint.

- Giá trị: `code = HSK30_PILOT_ORIGINAL_V1`, `version = 1.0.0`,
  `name = HSK 3.0 pilot content (AI-authored)`, `license`/`attribution` ghi "nội dung gốc do AI
  soạn cho HSK 3.0 APP (Q172)". File JSON dùng đúng `code`/`version` này.
- `DataSource` **không có field `kind`**; `license`/`attribution` nullable ở DB nhưng bắt buộc nếu
  nguồn dùng cho media (`backend/src/modules/cms/media-ingestion/media-ingestion.policy.ts:9-14`).
- Field provenance immutable sau khi bị media tham chiếu (trigger
  `backend/prisma/migrations/20260813120000_media_provenance_provider_hardening/migration.sql:172-202`) ⇒ giá trị phải
  trung thực ngay từ migration đầu.
- Phương án (b) script one-off và (d) thêm endpoint bị loại: (b) không có migration history, dễ
  trỏ nhầm DB; (d) phá R21.

### 4.3 Q175 — Block nội dung: giữ `text` + `vocabulary_list`, chờ M2.5f

Người học hiện **chưa thấy nội dung topic** (K-A): renderer thuộc **M2.5f**, cùng việc thêm
`vocabulary_list` vào union `TopicContentBlock`
(`backend/src/modules/learning/dto/topic-response.dto.ts:5-19` đang thiếu loại này). Vì vậy:

- Định dạng file giữ đúng 2 block `text` và `vocabulary_list` (Q175); không phát minh block mới.
- Nội dung ngữ pháp/hội thoại đặt trong các block `text`.
- Trước M2.5f chỉ kiểm được dữ liệu đã lưu + API trả về, **chưa** kiểm được "học viên nhìn thấy gì".

### 4.4 Q177 — Story placeholder chờ M5.4

14 story `${levelSlug}-story-N` đang `published` và **không thể archive**: CMS chưa có route Story
(`docs/api/api.md:1444` xếp M5). Đã chốt: **không thao tác DB trực tiếp với Story**; chờ **M5.4**
khi CMS Story có archive. Đây là phần chưa xử lý được của M1.3, phải ghi nhận khi PO duyệt danh
sách archive ở Pha 3.

### 4.5 Q176 + Q194 — Luật bài tập

- **Q176:** `mcq` đúng **4 option** = 1 đáp án + 3 distractor. Server chỉ enforce ≥ 2 options
  (`backend/src/common/validation/lesson-exercise-authoring.validator.ts:147`), nên ngưỡng 4 là
  ràng buộc phía script/preview.
- Option `mcq` là **một từ HSK1** (chữ Hán), không dùng câu đầy đủ hay nghĩa tiếng Việt; distractor
  khi đặt vào ô trống **không được** tạo câu đúng ngữ pháp.
- **Q194:** `fill_blank.acceptedTexts` có 3 dạng cho mỗi đáp án: chữ Hán, pinyin có dấu, pinyin
  không dấu viết liền chữ thường — ví dụ `["高兴", "gāoxìng", "gaoxing"]`; prompt ghi
  "(gõ chữ Hán hoặc pinyin)" và dùng ô trống thống nhất `___`.
- **R21 distractor:** lấy từ cùng Level (`WordLevel.levelId`), **được dùng cả từ trong bài**, chỉ
  không trùng đáp án và không trùng nhau trong cùng câu.
- `arrange_sentence` không có distractor: mỗi bài chỉ được có **đúng một** thứ tự đúng ngữ pháp,
  và `id` token không được sắp theo thứ tự đáp án.

### 4.6 Ghi chú nhỏ đã chốt

1. `orderIndex` pilot = **1001–1005** (TL-214); file mẫu dùng 1001.
2. `words[].pinyin` lưu có dấu thanh (dạng hiển thị). Khi resolve `Word`, chuẩn hoá đúng như
   `normalizePinyin` (`backend/src/common/utils/normalize-pinyin.ts`: bỏ số thanh, trim, lowercase,
   `ü → u:`, gộp khoảng trắng) rồi so **sau khi bỏ hết khoảng trắng** (`Word.pinyin` lưu
   `"xue sheng"`); pipeline từ điển giữ một pinyin cho mỗi `(hanzi, pinyin bỏ dấu)` (TL-218).
   Lệch ⇒ fail-fast, không tự ánh xạ.
3. Giới hạn của `BoundedJsonPayload` (100 000 byte/depth 20) áp cho **từng `content`**, không phải
   toàn file JSON.
4. `sourceKey` của exercise phải khớp regex stable-id của validator
   (`^[\p{L}\p{N}][\p{L}\p{N}._:-]*$`, `backend/src/common/validation/lesson-exercise-authoring.validator.ts:382-394`),
   không khoảng trắng, ≤ 128 ký tự.
5. Endpoint chi tiết bài có **2 alias**: `GET /lessons/:id` và `GET /learning/lessons/:id`
   (`docs/api/api.md:353`).

---

## 5. Bài mẫu `lesson-01.json` và tự kiểm

**Nội dung:** chủ đề "Chào hỏi và giới thiệu bản thân"; 20 từ HSK1 (mỗi từ có `hanzi`,
`pinyin` có dấu thanh, `meaningVi`, 1 câu ví dụ gốc + pinyin + dịch); 3 topic (`vocabulary`,
`grammar`, `key_text`); 10 bài tập = 4 `mcq` + 3 `fill_blank` + 3 `arrange_sentence`; mỗi bài có
`explanation` tiếng Việt; khối `review` ghi rõ **pinyin và nghĩa tiếng Việt phải được người kiểm
lại** trước khi approve.

**Tự kiểm:** script `/tmp/hsk-m29a/check.mjs` (ngoài repo; prompt §4 cấm đặt script trong repo ở
Pha 1). Lệnh đã dùng trên máy tạo bằng chứng: `node /tmp/hsk-m29a/check.mjs` (mặc định đọc
bài 1) hoặc `node /tmp/hsk-m29a/check.mjs <path>` — chỉ chạy được khi còn `/tmp/hsk-m29a/`.

Script kiểm: `hanzi` ∈ `hsk1.json`; đúng 20 từ không trùng; `pinyin` khớp **dấu thanh** với
`parsed/final_words.json` sau khi chuẩn hoá như `normalizePinyin` (bỏ số thanh, `ü → u:`, bỏ hết
khoảng trắng); từ có trong `final_words.json` với `level = HSK1`; câu ví dụ chỉ dùng chữ Hán thuộc
HSK1; ≥ 2 topic có `vocabulary` + (`grammar`|`key_text`); block chỉ `text`/`vocabulary_list`;
≥ 8 bài, ≥ 3 loại, không `listening_choice`/`speaking_repeat`; `mcq` ≥ 4 option, `optionId` ∈
options, option chữ Hán phải là từ HSK1, và **mỗi vị trí đáp án chỉ dùng 1 lần** trong bài;
`fill_blank.acceptedTexts` có đủ chữ Hán + pinyin có dấu + pinyin không dấu (Q194) và ô trống
thống nhất `___`; `arrange_sentence.tokenIds` là hoán vị đủ token, **id không lộ thứ tự đáp án**,
`content.tokens` đã xáo; `id` không trùng/không khoảng trắng; mọi string ≤ 4096; payload mỗi bài
≤ 65 536 byte, depth ≤ 8; `sourceKey` đúng `pilot-hsk1:lNN:eNN`; slug không trùng mẫu placeholder.

Kết quả (bản đúng): `OK`, `words=20 topics=3 exercises=10`, sha256 của file
`aee51f6fc2ced6c98aaf792965f58ccf891b95b8fc51169291359048286718d0`. Bản cố ý sai
(`/tmp/hsk-m29a/lesson-01.broken.json`) bị bắt **20 lỗi**, trong đó mỗi luật mới
(`mcq_answer_position_skew`, `arrange_ids_reveal_order`, `fill_blank_missing_pinyin`,
`blank_marker_inconsistent`) xuất hiện ít nhất 1 lần — xem báo cáo task.

**Giới hạn bằng chứng:** script và bản cố ý sai chỉ nằm ở `/tmp`, **không tái lập được từ repo**
cho tới khi **TL-223** (Pha 2) chuyển `check.mjs` thành test trong `backend/test/`. Từ đó mới có
bằng chứng tái lập được trong CI.

---

## 6. Kiểm chứng và giới hạn của tài liệu

- **Không kết nối DB dev**, không chạy seed, không đọc `.env`. Mọi con số về dữ liệu lấy từ file
  trong repo: `backend/scripts/dictionary/raw/hsk1.json` (500 entry / 497 hanzi),
  `backend/scripts/dictionary/parsed/final_words.json` (121 856 row; 530 row HSK1; 1 hanzi HSK1
  `车上` không có row; 29 hanzi HSK1 có > 1 pinyin).
- Số placeholder (35/70/14) suy ra từ code seed × 7 Level (`docs/PLAN.md:135`), khớp
  `docs/PLAN.md:101`, `:214` — **chưa xác minh trạng thái DB dev**.
- **Chưa xác minh:** hàng `Word` thật trong DB dev có đủ 500 HSK1; row `DataSource` pilot đã tồn
  tại chưa; DataSource nào đang được UI import liệt kê.
- Mọi endpoint trong tài liệu là endpoint **đã có trong code**; tài liệu này không thêm endpoint
  nào. Tài liệu này **không** chứa migration; migration `DataSource` (Q178) và script `LessonWord`
  (Q179) thuộc Pha 2.
- Index dùng chung với hai session khác trên cùng checkout, nên `git diff --cached` có thể chứa
  file ngoài task. Commit của task này dùng `git commit -- <path>` (TL-222) để chỉ ghi 2 file của
  M2.9a; không dùng `git add -A`/`git add .`.
- Số dòng `file:line` được đối chiếu với **HEAD của repo** tại thời điểm viết (commit `0fc94a6`).
  Ba session cùng làm trên một checkout, nên nếu HEAD đổi thì phải kiểm lại trước khi dùng số dòng
  làm bằng chứng.

## 7. Quy trình Pha 3 cho PO (dự kiến — chưa chạy)

Điều kiện vào: Pha 2 xong (script nạp + 5 file nội dung + migration `DataSource`), DB dev có
backup, `ADMIN_TOKEN` của tài khoản admin. Mọi bước đọc trước, ghi sau; mỗi bước in kết quả để PO
đối chiếu.

**Thứ tự đã chốt (PO, Pha 1b):** nhập + review + approve bài pilot **TRƯỚC**; chỉ khi bài pilot
sẵn sàng publish mới **archive 5 lesson placeholder HSK1 và publish bài pilot trong cùng một lượt
thao tác**. Lý do: HSK1 không có khoảng trống nội dung, và **Q18 — khoá bài tuần tự**
(`docs/product/learner-ui-decisions.md:36`: "bài sau mở khi bài liền trước xong") khiến bài pilot
(`orderIndex` 1001) bị chặn sau 5 placeholder nếu publish khi placeholder còn `published`.

### Bước 1 — Dry-run, lập danh sách placeholder cần archive (chỉ đọc)

```bash
# 1.1 Danh sách Level + id
curl -s "$BASE/api/v1/levels" -H "Authorization: Bearer $ADMIN_TOKEN"

# 1.2 Toàn bộ lesson của HSK1 (kèm status) — lọc client-side theo dấu hiệu placeholder
curl -s "$BASE/api/v1/admin/cms/lessons?levelId=$HSK1_LEVEL_ID&limit=100&page=1" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 1.3 Với từng lesson nghi placeholder: lấy topics (KHÔNG có content) để đối chiếu tiêu đề seed
curl -s "$BASE/api/v1/admin/cms/lessons/$LESSON_ID" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Tiêu chí nhận diện (K-F): `slug` khớp `^hsk1-lesson-[1-5]$`, `description` bắt đầu
`Temporary lesson for testing`, `title` khớp `HSK1 - Lesson N`, topic là
`Vocabulary Overview` / `Practice Notes`. Kỳ vọng: **5 lesson + 10 topic**, `status = published`.

Xuất bảng `slug | lessonId | title | status | topicIds` để PO duyệt ở bước 2.

### Bước 2 — PO duyệt danh sách archive

PO (hoặc reviewer PO chỉ định) ký duyệt danh sách ở bước 1. **Không archive gì trước khi có duyệt
bằng văn bản** (Q174). Ghi chú bắt buộc trong biên bản: 14 Story placeholder **không archive được**
và chờ M5.4 (Q177).

### Bước 3 — Import nội dung draft

```bash
# Xem trước: chỉ kiểm, không ghi DB
npx ts-node backend/scripts/content/import-pilot-content.ts \
  --file backend/content/pilot/hsk1/lesson-01.json --dry-run

# Ghi thật: tạo Lesson draft + Topic draft + exercise draft (preview → commit)
npx ts-node backend/scripts/content/import-pilot-content.ts \
  --file backend/content/pilot/hsk1/lesson-01.json
```

Kỳ vọng: lesson `draft`, 3 topic `draft`, 10 exercise `draft`, `ImportJob` 1 row.

PO kiểm bằng API (không dựa vào cờ nội bộ của script):

```bash
curl -s "$BASE/api/v1/admin/cms/exercises?lessonId=$LESSON_ID&limit=100" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Đối chiếu từng dòng: `type` ∈ {`mcq`, `fill_blank`, `arrange_sentence`}, `status = draft`, đủ 10
dòng, `sourceKey` đúng `pilot-hsk1:lNN:eNN`; với `mcq` xem `content.options` có đúng 4 option và
`answer.optionId` nằm trong đó; đọc `explanation` để kiểm tiếng Việt.

### Bước 4 — Review + approve

Trước khi gửi review, gọi lại danh sách để xác nhận đúng trạng thái (không dựa vào cờ của script):

```bash
curl -s "$BASE/api/v1/admin/cms/exercises?lessonId=$LESSON_ID&limit=100" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Kiểm `status = draft`, đúng 10 dòng, `type` thuộc 3 loại của Q173. Sau đó người duyệt đọc nội dung
trên admin (lesson detail + từng topic/exercise) và ghi quyết định:

```bash
# Lesson
curl -s -X POST "$BASE/api/v1/admin/cms/lessons/$LESSON_ID/revisions/$REVISION_ID/reviews" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"decision":"approved","note":"..."}'
# Topic
curl -s -X POST "$BASE/api/v1/admin/cms/topics/$TOPIC_ID/revisions/$REVISION_ID/reviews" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"decision":"approved"}'
# Exercise
curl -s -X POST "$BASE/api/v1/admin/cms/exercises/$EXERCISE_ID/revisions/$REVISION_ID/reviews" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"decision":"approved"}'
```

`decision` ∈ `approved | changes_requested | rejected` (`backend/prisma/schema.prisma:157-161`).
Pinyin, nghĩa tiếng Việt và **danh sách từ của bài** (Q179) **phải được người kiểm ở bước này**
(khoá `review.requiredChecks` trong file JSON).

### Bước 5 — Một lượt: archive 5 placeholder + publish bài pilot

```bash
# 5.1 Publish Topic trước (Lesson cần ≥1 Topic published — LESSON_NO_PUBLISHED_CHILD)
curl -s -X POST "$BASE/api/v1/admin/cms/topics/$TOPIC_ID/revisions/$REVISION_ID/publish" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 5.2 Publish Exercise
curl -s -X POST "$BASE/api/v1/admin/cms/exercises/$EXERCISE_ID/revisions/$REVISION_ID/publish" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 5.3 Archive 5 lesson placeholder HSK1 (idempotent; không body; không cascade sang Topic)
for id in $PLACEHOLDER_LESSON_IDS; do
  curl -s -X POST "$BASE/api/v1/admin/cms/lessons/$id/archive" \
    -H "Authorization: Bearer $ADMIN_TOKEN"
done

# 5.4 Publish Lesson ngay sau 5.3, không để khoảng trống giữa hai bước
curl -s -X POST "$BASE/api/v1/admin/cms/lessons/$LESSON_ID/revisions/$REVISION_ID/publish" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Vì sao 5.3 và 5.4 phải liền nhau (Q18): nếu publish Lesson khi placeholder còn `published` thì lộ
trình HSK1 vẫn có 5 bài placeholder đứng trước bài pilot (orderIndex 1–5 < 1001), learner bị khoá ở
bài placeholder và không tới được bài pilot.

**Rollback (bắt buộc biết trước khi chạy 5.3):** CMS **không có** endpoint unarchive/restore
(K-F), nên nếu 5.4 lỗi sau khi 5.3 đã archive thì HSK1 tạm thời không còn bài publish. Đường lùi
duy nhất: chạy lại `npm run seed:learning` cho đúng 5 slug placeholder — script upsert theo `slug`
và set `status: 'published'`, `deletedAt: null` nên hồi sinh placeholder (K-H, `:123-134`) — rồi
sửa lỗi publish và lặp lại 5.3–5.4. Phải kiểm lại 5 slug sau khi re-seed trước khi thử tiếp.

Lỗi thường gặp: `LESSON_NO_PUBLISHED_CHILD` (chưa publish Topic), `REVIEW_NOT_APPROVED` /
`REVISION_NOT_LATEST` (review không phải bản mới nhất), `CONTENT_ARCHIVED`
(`docs/api/api.md:651-661`).

### Bước 6 — Kiểm sau publish

```bash
curl -s "$BASE/api/v1/learning/lessons?levelId=$HSK1_LEVEL_ID"
curl -s "$BASE/api/v1/learning/lessons/$LESSON_ID"
```

Kỳ vọng: danh sách HSK1 chỉ còn bài pilot; detail trả 3 topic + `words` + 10 exercise (chỉ exercise
`published`); row "Từ vựng" có `wordCount > 0` (nhờ Q179). **Chưa kiểm được** nội dung topic hiển
thị cho learner cho tới M2.5f (Q175).

## 8. Liên hệ PLAN

Đề xuất cập nhật `docs/PLAN.md` (không sửa trong task này):

1. Dòng M2.9a (`docs/PLAN.md:281`, `:588`) → **`M2.9a 🟡 Pha 1 chờ review`**.
2. Ghi nhận dải mã của M2.9a: **Q172–Q179** và **TL-210…TL-223** đã dùng, TL-224…TL-229 còn trống;
   **Q194** dành cho luật `fill_blank`.
3. Thêm task **M2.5f** (renderer `Topic.content` + đưa `vocabulary_list` vào union
   `TopicContentBlock`) — điều kiện để người học thấy nội dung topic (Q175).
4. Ghi nhận nợ M1.3: 14 Story placeholder chưa archive được, chờ **M5.4** (Q177).

Chi tiết bằng chứng của Pha 1 nằm trong báo cáo task; `docs/PLAN.md` không bị sửa bởi task này.
