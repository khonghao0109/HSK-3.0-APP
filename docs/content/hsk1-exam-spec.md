# Đặc tả đề thi thử HSK1 — **tạm, chờ chốt #15** (Q351)

Cấu trúc dưới đây **chỉ dùng cho đề demo** "Đề thi thử HSK1 – số 1" của lát cắt Bài 1 + đề thi. Khi PO chốt #15,
cập nhật file này và soạn đề 2 theo cấu trúc đã chốt.

## 1. Căn cứ

| Văn bản | Nguồn | Ghi chú |
|---|---|---|
| 《中文水平考试 HSK 考试大纲》(Syllabus for the Chinese Proficiency Test), 中外语言交流合作中心 phát hành 2025-11, áp dụng 2026-07 | PDF liên kết từ trang chủ [chinesetest.cn](https://www.chinesetest.cn/) (mục HSK 3.0, "Examination Syllabus") | Gồm đại cương nhiệm vụ, chủ đề, từ vựng, chữ Hán, ngữ pháp từng cấp; **không** ghi cấu trúc đề |
| 《HSK（一级）样卷》và 答案 (mẫu đề HSK 3.0 cấp 1, cùng đơn vị) | Gói "Sample Questions" `HSK3.0.zip` liên kết từ trang chủ chinesetest.cn | Căn cứ cấu trúc dưới đây; agent đọc phần văn bản của PDF, không nghe file mp3 |
| Trang HSK (Level 1) của CTI | [chinesetest.cn/HSK/1](https://www.chinesetest.cn/HSK/1) | Cấu trúc HSK 2.0: 40 câu, ~40 phút, tối đa 200 điểm, đỗ từ 120 |
| GF0025-2021 《国际中文教育中文水平等级标准》 | Khung từ HSK1 của dự án (`docs/content/hsk1-audit.md`) | Chỉ dùng từ HSK1 |

Ngày đọc: 18/11/2026. **PO cần kiểm:** (1) mẫu đề 2025-11 có phải dạng thức đang áp dụng cho kỳ thi HSK 3.0 cấp 1
không; (2) mẫu đề không ghi thang điểm và điểm đỗ, nên điểm đỗ dưới đây là đề xuất tạm.

## 2. Cấu trúc (theo mẫu HSK（一级）样卷)

Tổng 40 câu, hai phần. Mẫu đề ghi: Nghe 20 câu ~12 phút, Đọc 20 câu 20 phút, 3 phút điền phiếu, toàn bài ~40
phút kể cả 5 phút điền thông tin.

| Phần | Câu | Dạng | Cách làm trong app |
|---|---|---|---|
| Nghe 1 | 1–5 | Nghe một câu, chọn tranh A/B/C | `mcq`, audio câu; `Question.imageId` = **một ảnh ghép 3 tranh có nhãn A/B/C**; lựa chọn "A", "B", "C" |
| Nghe 2 | 6–10 | Nghe câu hỏi, chọn câu trả lời A/B/C | `mcq`, audio câu hỏi; lựa chọn là chữ Hán kèm pinyin |
| Nghe 3 | 11–15 | Nghe hội thoại ngắn, ghép với tranh A–F | `mcq`, audio hội thoại; ảnh nhóm (`QuestionGroup.imageId`) ghép 6 tranh nhãn A–F; lựa chọn "A"–"F" |
| Nghe 4 | 16–20 | Nghe một đoạn ngắn và câu hỏi, chọn A/B/C | `mcq`, audio; lựa chọn chữ Hán kèm pinyin |
| Đọc 1 | 21–25 | Đọc câu, ghép với tranh A–F | `mcq`, ảnh nhóm 6 tranh A–F |
| Đọc 2 | 26–30 | Ghép câu hỏi với câu trả lời A–F | `mcq`, cùng bộ 6 lựa chọn cho 5 câu |
| Đọc 3 | 31–35 | Chọn từ điền vào chỗ trống (ngân hàng từ A–F) | `mcq`, cùng bộ 6 từ cho 5 câu |
| Đọc 4 | 36–40 | Đọc đoạn ngắn, trả lời câu hỏi ★, chọn A/B/C | `mcq` |

Ghi chú:

- Mẫu đề HSK 3.0 cấp 1 **không có dạng đúng/sai** và **không có dạng sắp xếp câu**, nên đề demo không dùng
  `true_false`, `arrange_sentence`. (Prompt lát cắt đề xuất "phán đoán đúng/sai so với tranh"; dạng này có ở HSK 2.0
  và không có trong mẫu 2025-11.)
- **Giới hạn kỹ thuật:** mỗi câu hỏi có một `imageId`, lựa chọn chỉ là văn bản. Dạng chọn tranh dùng một ảnh ghép
  có nhãn chữ cái, lựa chọn là chữ cái. **Không đổi schema.**
- Câu ví dụ (例如) của mẫu đề không đưa vào đề demo.

## 3. Thời gian, điểm (Q118)

- Một đồng hồ cho cả đề: **40 phút** (`duration` = 40).
- Mỗi câu điểm như nhau; **100 điểm mỗi phần**, tối đa 200.
- **Điểm đỗ tạm: 120/200** (theo mốc HSK cấp 1 hiện hành trên chinesetest.cn/HSK/1). PO xác nhận.

## 4. Nội dung

- Chỉ dùng từ HSK1 (GF0025-2021); kiểm bằng script (mọi chữ Hán thuộc danh sách HSK1).
- Mỗi câu: giải thích tiếng Việt, `skill` (`listening`/`reading`), tag dạng câu và `tu-vung`/`ngu-phap`,
  `difficulty` 1–3 (giới hạn của DTO câu hỏi).
- Câu nghe lưu kèm **lời thoại văn bản** (chữ Hán, pinyin, bản dịch, giọng nam/nữ) để duyệt và làm lời giải.
- Tag dạng câu: `nghe-chon-tranh`, `nghe-chon-cau-tra-loi`, `nghe-hoi-thoai-chon-tranh`, `nghe-doan-chon-dap-an`,
  `doc-chon-tranh`, `doc-ghep-cau`, `chon-tu-dien`, `doc-hieu-doan`.
- Dữ liệu nguồn: `backend/content/hsk1/exam/mock-01.json` (nháp, `status: draft`).
- Audio: Azure AI Speech (Q348), giọng `zh-CN-XiaoxiaoNeural` (nữ), `zh-CN-YunxiNeural` (nam). Ảnh: Figma AI (Q350).
