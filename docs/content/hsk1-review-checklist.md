# Checklist người duyệt nội dung HSK1

Người duyệt do PO chỉ định (P1, 17/11/2026). Agent chỉ soạn nháp; **chỉ người duyệt** đổi trạng thái
`approved`, approve hoặc publish (Q172, Q185).

## A. Lô nghĩa tiếng Việt và câu ví dụ (`backend/content/hsk1/meanings/batch-NN.json`)

Mỗi lô khoảng 100 từ, ứng với 5 bài trong `backend/content/hsk1/curriculum.md`. Lô 01 = bài 1–5, lô 02 = bài 6–10.

### Cách duyệt

1. Chạy `cd backend && npm run content:check:meanings`. Mọi lô phải `lỗi=0`. Dòng in ra có `contentSha256` của từng lô.
2. Đọc từng mục trong `entries`, đối chiếu tiêu chí ở mục B. Được phép tra Hanzii, HanyuGuide, từ điển… để
   **đối chiếu**, nhưng câu chữ trong file phải do agent soạn và người duyệt sửa, không chép nguồn khác.
3. Sửa trực tiếp trong file khi cần, ghi nhận xét vào `review.notes` (mỗi nhận xét một chuỗi, ghi `hanzi` và lý do).
   Muốn agent sửa: đặt `review.status = "changes_requested"`, để nhận xét trong `review.notes`.
4. Khi đạt: chạy lại bước 1 (nội dung có thể đã đổi), rồi điền
   ```json
   "review": { "status": "approved", "reviewer": "<họ tên>", "reviewedAt": "YYYY-MM-DD",
               "contentSha256": "<hash bước 1 in ra>", "notes": [...] }
   ```
   Hash gắn bản duyệt với nội dung: sửa bất kỳ chữ nào sau khi duyệt thì validator báo `review_hash_mismatch`.
5. Nạp (chỉ lô approved):
   ```bash
   cd backend
   npm run content:import:meanings -- --file content/hsk1/meanings/batch-01.json --dry-run
   npm run content:import:meanings -- --file content/hsk1/meanings/batch-01.json
   ```
   Script tạo `DataSource` `HSK30_VI_HSK1_BNN` (notes: người duyệt, ngày, hash, file), thêm một dòng `WordMeaning`
   tiếng Việt sau các dòng CC-CEDICT của mỗi từ, và tạo `WordExample` ở `published` khi và chỉ khi lô `approved`
   có người duyệt, ngày duyệt và hash khớp (PO 17/11/2026); thiếu một điều kiện thì không nạp. Chạy lại không tạo trùng.
6. Gỡ một lô (rollback): `npm run content:import:meanings -- --rollback HSK30_VI_HSK1_B01 [--dry-run]`.
   Xoá ví dụ rồi nghĩa của đúng lô đó, giữ `DataSource` với ghi chú rollback để nạp lại bản sửa.

### Tiêu chí đạt (B)

| Mục | Đạt khi |
|---|---|
| Nghĩa | Đúng nghĩa thông dụng HSK1, đúng từ loại (từ đa từ loại ghi "danh từ, động từ"); nhiều nghĩa tách bằng dấu phẩy; không viết hoa đầu (trừ danh từ riêng), không dấu chấm cuối; lượng từ bắt đầu "(lượng từ)" |
| Câu ví dụ | Tự nhiên, đúng ngữ pháp, dùng đúng nghĩa đã ghi, ≤ 12 chữ Hán, chỉ dùng từ HSK1 và tên riêng khai báo trong `properNames` |
| Pinyin | Đúng từng âm tiết; **thanh gốc, không ghi biến điệu** (quy ước repo: 不是 = bù shì, 一个 = yī ge; audio TTS vẫn đọc đúng biến điệu); thanh nhẹ không dấu; 上 chỉ vị trí sau danh từ viết thanh nhẹ (桌子上 = zhuōzi shang); tên riêng và tên ngôn ngữ viết hoa cả ở mục từ lẫn câu (Hànyǔ, Zhōngwén, Běijīng, Zhōngguó) |
| Bản dịch | Đúng, tự nhiên |
| Nguồn | Không giống câu chữ của từ điển hay app bên thứ ba |

### Hiển thị sau khi nạp (P2)

Tra từ, chi tiết từ, danh sách từ trong bài: chỉ hiện nghĩa tiếng Việt (Q65, PO giữ 17/11/2026); thẻ ôn: nghĩa
tiếng Việt, chỉ dùng tiếng Anh khi từ chưa có nghĩa Việt (Q260). Câu ví dụ `published` hiện ở chi tiết từ.

## B. Bài học (Pha 4)

File: `backend/content/pilot/hsk1/lesson-01.json` … `lesson-10.json`. Từ, nghĩa và câu ví dụ trong `words`
lấy nguyên từ lô nghĩa đã duyệt (batch-01 cho bài 1–5, batch-02 cho bài 6–10); test
`pilot-content.validator.spec.ts` chặn mọi lệch. Phần cần duyệt mới: `description`, 3 topic và 10 bài tập.

### Tiêu chí

| Mục | Đạt khi |
|---|---|
| Topic `vocabulary` | Đoạn giới thiệu đúng chủ đề; block `vocabulary_list` = `lesson_words` |
| Topic `grammar` | Mỗi điểm ngữ pháp của bài (xem `backend/content/hsk1/curriculum.md`) có giải thích tiếng Việt đúng, cấu trúc, 2–3 ví dụ |
| Topic `key_text` | 4–8 lượt thoại tự nhiên, chỉ dùng từ đã học tới bài đó, pinyin và bản dịch đúng |
| `mcq` | 4 lựa chọn, đúng một đáp án; ba lựa chọn sai đặt vào đều sai rõ ràng |
| `fill_blank` | Chỗ trống chỉ một đáp án hợp lý; `acceptedTexts` = chữ Hán + pinyin có dấu + pinyin không dấu (Q194) |
| `arrange_sentence` | Chỉ một thứ tự đúng (chú ý trạng ngữ thời gian trước/sau chủ ngữ) |
| Giải thích | Mỗi bài tập có giải thích tiếng Việt đúng |

Ghi nhận xét vào `review.notes` của file bài (hoặc comment PR). Máy kiểm: `npm run content:check:pilot`
(trong `backend/`, không cần DB).

### Nạp và xuất bản

1. Agent/dev nạp từng bài: `npm run content:import:pilot -- --file content/pilot/hsk1/lesson-NN.json --dry-run`,
   rồi bỏ `--dry-run`. Mọi bản ghi ở `draft`; `LessonWord` ghi theo Q179.
   Dùng **cùng một tài khoản admin** cho mọi lần nạp lại (Idempotency-Key gắn với người gửi; tài khoản khác
   nạp lại sẽ bị 409). Nạp liền nhiều bài có thể chạm rate limit (429): chờ rồi chạy lại, script idempotent.
2. Người duyệt duyệt trên CMS theo thứ tự TL-221: **Topic → Exercise → Lesson**. Với mỗi bài: approve rồi publish
   3 topic, rồi 10 bài tập, cuối cùng lesson. Publish lesson trước khi topic/bài tập `published` sẽ cho người
   học thấy bài rỗng.
3. Sau khi đủ bài 1–10 `published`, archive placeholder theo `docs/content/hsk1-archive-list.md` (khi PO chốt).
4. Rollback một bài: archive lesson (không hard delete); topic và bài tập archive theo cùng thứ tự ngược lại.
