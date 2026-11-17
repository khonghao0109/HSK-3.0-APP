# Khảo sát dữ liệu HSK1 (Pha 1, nhánh `feat/content-hsk1`)

Ngày khảo sát: 17/11/2026. Nguồn số liệu: truy vấn chỉ đọc trên DB dev (`hsk_system`), file đã commit
`backend/scripts/dictionary/raw/hsk1.json`, `backend/scripts/dictionary/parsed/final_words.json`, mã nguồn
`backend/src/modules/content-pilot/`, `backend/src/modules/cms/`, `frontend/src/`. Pha này **không ghi DB**.

Đầu ra kèm theo: `backend/content/hsk1/words.csv` (530 dòng `WordLevel` HSK1, có cột `audit_flag`).

## 1. Từ HSK1: 530 dòng nhưng chỉ 498 từ học được

| Số liệu | Giá trị |
|---|---|
| Dòng `WordLevel` của `Level.code = 'HSK1'` (con số 530 trong PLAN) | 530 |
| Chữ Hán khác nhau trong 530 dòng | 496 |
| Mục trong danh sách GF0025-2021 cấp 1 (`raw/hsk1.json`) | 500 (497 chữ Hán khác nhau; 地, 干, 还 xuất hiện 2 lần vì 2 cách đọc) |
| Mục GF0025 không có `Word` | 1: `车上` (cụm từ, không có trong CC-CEDICT — đã biết ở `content-pipeline.md` §K) |
| `Word` HSK1 có nghĩa tiếng Anh | 530/530 |
| `Word` HSK1 có nghĩa tiếng Việt | 0 |
| `WordExample` của từ HSK1 | 0 |
| `Word` HSK1 ở `published`, chưa soft-delete | 530/530 |

**Vì sao 530 ≠ 500.** Pipeline từ điển (`scripts/dictionary/map-level.ts`) gắn cấp HSK1 cho **mọi** `Word`
có cùng chữ Hán, nên 29 chữ đa âm kéo theo cả cách đọc không thuộc HSK1. Phân loại trong `words.csv`:

| `audit_flag` | Số dòng | Ý nghĩa |
|---|---|---|
| `ok` | 481 | Cách đọc HSK1, dấu thanh lưu đúng |
| `suspect_tone` | 17 | Cách đọc HSK1 nhưng `pinyinTone` lưu sai thanh (mục 2) |
| `spurious_reading` | 32 | Cách đọc không thuộc HSK1, bị gắn cấp nhầm (ví dụ 六 `lu4`, 女 `ru3`, 和 `huo2`/`hu2`, 吧 `bia1`, 那 `nuo2`) |

→ **498 từ học được** (481 + 17) = 500 mục GF0025 − `车上` − 1 (干 gān/gàn gộp chung một `Word` vì
pipeline giữ một `Word` cho mỗi `(hanzi, pinyin bỏ dấu)`). Mọi chỉ tiêu "100% từ HSK1" ở các pha sau tính
trên **498**, không phải 530. 32 dòng `spurious_reading` không soạn nghĩa/ví dụ, không đưa vào bài.

Đa âm được giữ hai cách đọc: 地 (`de` trợ từ, `dì`), 还 (`hái`, `huán`) — đúng như GF0025 liệt kê hai lần.

## 2. Lỗi dấu thanh trong `Word.pinyinTone` (chặn TL-218)

`final_words.json` chỉ giữ **một** `pinyin_tone` cho mỗi `(hanzi, pinyin bỏ dấu)`, lấy theo dòng
CC-CEDICT đầu tiên, nên một số từ HSK1 thường gặp bị lưu sai thanh. Validator (`pinyin_tone_mismatch`,
TL-218) bắt file bài học phải khớp giá trị đã lưu ⇒ hiện **không thể** nạp bài dùng các từ dưới đây với
pinyin đúng mà không đổi dữ liệu nguồn:

| Chữ | Đang lưu | Đúng (HSK1) | | Chữ | Đang lưu | Đúng (HSK1) |
|---|---|---|---|---|---|---|
| 上 | shang3 | shàng | | 打 | da2 | dǎ |
| 个 | ge3 | gè | | 正 | zheng1 | zhèng |
| 几 | ji1 | jǐ | | 看 | kan1 | kàn |
| 号 | hao2 | hào | | 累 | lei3 | lèi |
| 吗 | ma2 | ma (nhẹ) | | 要 | yao1 | yào |
| 差 | cha1 | chà | | 跑 | pao2 | pǎo |
| 干 | gan1 | gàn (GF0025 có cả gān, gàn) | | 过 | guo1 | guò |
| 教 | jiao4 | jiāo (động từ "dạy") | | 那 | na1 | nà |
| 小朋友 | xiao3 peng2 you3 | xiǎo péngyou | | | | |

Danh sách này do agent soát bằng mắt trên 498 từ; **người duyệt cần soát lại** (có thể sót). Lỗi này
cũng có thể đang hiện ra ở trang tra từ cho người học (chưa kiểm UI ở pha này).

## 3. Trạng thái 5 bài pilot

- File `backend/content/pilot/hsk1/lesson-01.json` … `lesson-05.json` có đủ 100 từ, đúng định dạng.
- **Chưa nạp vào DB dev:** không có `Lesson` nào có slug `hsk1-pilot-*`. `DataSource`
  `HSK30_PILOT_ORIGINAL_V1` (migration Q178) đã có trên DB dev.
- `content-pipeline.md`: Pha 2 (script nạp, migration, test) đã có trong repo; Pha 3 (PO nạp, duyệt,
  archive placeholder, publish) chưa làm.
- Validator đang khoá `orderIndex` pilot trong dải **1001–1005** (`PILOT_CONTENT_LIMITS.pilotOrderIndexMax`)
  ⇒ bài 06 trở đi cần nới dải (đề xuất 1001–1030) — thay đổi nhỏ trong Pha 4.

## 4. M2.5f chưa làm: người học không thấy nội dung topic

`frontend/src` không có chỗ nào render block `vocabulary_list` (grep rỗng); PLAN ghi M2.5f ⬜. Nạp bài
xong, người học chỉ thấy số section và bài tập, **không thấy** danh sách từ, giải thích ngữ pháp hay
bài khoá. Đề xuất: làm M2.5f ở **PR riêng** trước khi PO publish bài HSK1 (Q175).

## 5. Nghĩa tiếng Việt (M1.2a): chưa có chỗ lưu trạng thái duyệt

`WordMeaning` có `meaningVi`, `meaningViNormalized`, `dataSourceId`, không có cột trạng thái. 0/200.156
dòng có `meaningVi`. Đề xuất (chờ PO, xem câu hỏi P1):

- **Phương án A (không migration, đề xuất):** duyệt theo **lô file** — trạng thái nằm trong
  `review` của `backend/content/hsk1/meanings/batch-NN.json`; script chỉ nạp lô `approved` có tên người
  duyệt và ngày; mỗi lô một `DataSource` riêng ⇒ rollback theo lô = gỡ `meaningVi` các dòng có
  `dataSourceId` của lô. Nhược điểm: không có dấu vết duyệt trong DB, chỉ có trong git.
- **Phương án B (migration):** thêm cột `meaningViStatus` (draft/approved) hoặc bảng `MeaningBatch`;
  có dấu vết trong DB, nhưng cần migration + API, ngoài phạm vi nội dung.

Lưu ý: ghi `meaningVi` vào `WordMeaning` sẵn có (dòng tiếng Anh `meaningOrder` 1) hay tạo dòng
`WordMeaning` mới chỉ có tiếng Việt — cần chốt (P2), vì `dataSourceId` của dòng tiếng Anh đang là
`CC_CEDICT_2026_05_04`; ghi đè sẽ làm mất ghi công.

## 6. Câu hỏi và đề thi backend đang hỗ trợ

- `QuestionType` soạn được (M4.1a, `QUESTION_AUTHORING_TYPES`): `mcq`, `true_false`, `fill_blank`,
  `arrange_sentence`. Giá trị cũ `listening`/`reading`/`writing`/`speaking` bị DTO từ chối.
- `Skill`: `listening`, `reading`, `writing`, `speaking`; "Từ vựng & Ngữ pháp" = tag `tu-vung`/`ngu-phap`
  gắn kỹ năng Đọc (Q112–Q114). Tối đa 10 tag/câu, tên tag ≤ 40 ký tự.
- Câu hỏi có `difficulty` (1–5), `explanation`, `objective`, `audioId`, `imageId`, `dataSourceId`.
- Đề: `Test` (`duration` phút, `passScore`, `scoringVersion hsk-p0-v1`) → `TestSection` (`skill`,
  `orderIndex`) → `QuestionGroup` → `TestQuestion`. Q118: mỗi câu điểm như nhau, 100 điểm/phần, điểm tối
  đa = 100 × số phần, điểm đỗ bắt buộc khi xuất bản, một đồng hồ cho cả đề.
- API: `POST /admin/cms/questions` (+ revisions/reviews/publish/archive), `POST /admin/cms/tests`,
  `PUT /admin/cms/tests/:id/structure`, publish/archive/duplicate.
- **Khác giả định của task:** `POST /admin/cms/questions` **không nhận `Idempotency-Key`** và `Question`
  **không có cột `sourceKey`**. Script nạp câu hỏi phải tự bảo đảm idempotent (P3).
- DB dev: 0 `Question`, 0 `Test`, 0 `Tag`.

## 7. Placeholder (M1.3)

DB dev: 35 `Lesson` (5/cấp, đều `published`, `orderIndex` 1–5), 70 `Topic`, 14 `Story` published.
HSK1: `hsk1-lesson-1` … `hsk1-lesson-5` (id 1–5), mỗi bài 2 topic, 20 `LessonWord`, 0 bài tập. Danh
sách archive chi tiết làm ở Pha 4 (`docs/content/hsk1-archive-list.md`); không đụng 14 Story (Q177).

## 8. Câu hỏi cần PO / Tech Lead quyết định

| # | Câu hỏi | Đề xuất của agent |
|---|---|---|
| P1 | Workflow duyệt nghĩa tiếng Việt: phương án A (trạng thái trong file lô, không migration) hay B (migration cột/bảng trạng thái)? Ai là người duyệt (PLAN M1.2a còn chờ)? | A |
| P2 | Nghĩa tiếng Việt ghi vào dòng `WordMeaning` mới (giữ nguyên dòng CC-CEDICT) hay vào cột `meaningVi` của dòng tiếng Anh sẵn có? | Dòng mới, `meaningOrder` sau dòng CC-CEDICT, `dataSourceId` = lô |
| P3 | Idempotency cho script nạp câu hỏi khi API không có `Idempotency-Key`/`sourceKey`: (a) thêm header + cột `sourceKey` (migration, ngoài phạm vi nội dung), (b) script tra trùng bằng `contentHash` qua API list trước khi tạo + sổ ghi `sourceKey → questionId` trong repo, (c) ghi `sourceKey` vào `objective`? | (b) |
| P4 | Sửa 17 dấu thanh sai trong `Word.pinyinTone`/`final_words.json` (mục 2): cho phép một migration dữ liệu riêng (ngoài hai ngoại lệ Q178/Q179) hay giữ nguyên và chặn các từ này khỏi bài học? | Migration dữ liệu riêng, PR riêng, có danh sách duyệt |
| P5 | 32 dòng `spurious_reading`: gỡ cấp HSK1 (sửa `map-level`, PR riêng) hay giữ nguyên và chỉ loại khỏi nội dung? Chỉ tiêu "530 từ" trong PLAN M1.2b đổi thành 498? | Đổi chỉ tiêu thành 498; gỡ cấp ở PR riêng |
| P6 | `车上` không có `Word`: bỏ khỏi chỉ tiêu hay thêm `Word` (không được tự tạo theo TL-219)? | Bỏ khỏi chỉ tiêu, ghi chú |
| P7 | Làm M2.5f (player hiển thị `Topic.content`) ở PR riêng trước khi publish bài HSK1? | Có |
| P8 | Nới dải `orderIndex` pilot 1001–1005 thành 1001–1030 cho bài 06–22? | Có |
| P9 | #15: cấu trúc đề HSK1 và bộ tag dạng câu (đề xuất ở Pha 5) | Chờ |
| P10 | Q184: nhà cung cấp TTS | Chờ bảng so sánh Pha 5b |
