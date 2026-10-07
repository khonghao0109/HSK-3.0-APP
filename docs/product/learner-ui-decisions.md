# Quyết định Product Owner cho learner UI

Cập nhật: 07/10/2026 (PO đồng ý đưa bảng này vào repo ngày 07/10/2026; thêm Q13–Q20 cùng ngày).

- **Nguồn:** bảng dưới chép nguyên văn từ mục "Quyết định Product Owner" của
  `docs/ui_reference/README.md`. `docs/ui_reference/` là bộ mẫu HTML chỉ có ở máy local
  (gitignored), dựng từ ảnh mẫu trong `docs/ui_image/`.
- **Nguyên tắc:** quyết định PO thắng ảnh mẫu. Ở những điểm trong bảng, không làm theo ảnh
  PNG.
- **Cách dựng UI:** dev dựng giao diện thật theo bản HTML mẫu trong `docs/ui_reference/`,
  không theo ảnh mẫu, ở những điểm dưới đây.
- Khi bảng trong `docs/ui_reference/README.md` đổi, cập nhật file này cùng lúc. Kiểm:
  `diff <(grep '^| Q' docs/ui_reference/README.md) <(grep '^| Q' docs/product/learner-ui-decisions.md)`.

## Quyết định

| # | Quyết định | Áp dụng trong demo | Lệch so với ảnh mẫu |
| --- | --- | --- | --- |
| Q1 | **Một bộ tab duy nhất theo module 02:** Trang chủ · Học · Tra từ · Ôn tập · Hồ sơ | Tab bar chung trên `home`, `path`, `lesson`, `reader`, `library` (tab Học), `dictionary` (Tra từ), `review-calendar` (Ôn tập), `profile` (Hồ sơ) | Ảnh 03-01, 03-04, 03-05, 03-06 dùng tab Học/Ôn tập/Từ điển/Đọc/Tài liệu; ảnh 04-06 không có tab bar. Đọc và Tài liệu mất tab riêng nên Trang chủ có thêm mục **"Khám phá"** (8 lối tắt: Thi thử, Phát âm, Đọc hiểu, Tài liệu, Trợ lý AI, Hội thoại, Nhận diện chữ, Hỗ trợ), không có trong ảnh 02-01 |
| Q2 | **Nền kem cho toàn app** (`--surface-canvas` = `--cream-50`) | Module 04 bỏ nền navy: thanh tiêu đề navy như module 02/03, thân trang kem, thẻ trắng có viền (khối cuối `m04.css`). Module 05 bỏ nền lạnh `#f8f6f4`. App bar module 03 dùng `--navy-900` | Toàn bộ màu nền/chữ/viền của ảnh 04-01 → 04-06; icon kỹ năng ở 04-04 dựng bằng CSS thay ảnh cắt nền navy. Màn Hoàn thành bài học (02-06) giữ nền navy vì là màn chúc mừng của chính module 02 |
| Q3 | **Lộ trình dùng cấp `HSK7_9`** (một Level cho band 7–9, đúng invariant `AGENTS.md`) | Tab Lộ trình: HSK 1 … HSK 6, **HSK 7–9** | Ảnh 02-02 tách HSK 7, 8, 9. Màn chọn mục tiêu vẫn cho chọn band 7, 8 hoặc 9 vì target giữ band riêng theo invariant |
| Q4 | **Admin là "Hán Lộ Admin" tiếng Việt**, có Tổng quan (dashboard), tạo/sửa bài có duyệt, nhập dữ liệu | Giữ như ảnh mẫu 06 | Không lệch. `frontend/DESIGN.md` đã thêm khối "Product decision (2026-10-01)" ghi hướng này thay cho quy tắc admin tiếng Anh và các mục loại trừ dashboard/create/import |
| Q5 | **Số từ vựng theo chuẩn HSK 3.0** (GF0025-2021, tích luỹ) | Màn Mục tiêu: HSK 1 ~ 500, HSK 2 ~ 1.272, HSK 3 ~ 2.245, HSK 4 ~ 3.245, HSK 5 ~ 4.316, HSK 6 ~ 5.456, HSK 7/8/9 ~ 11.092 (chung cấp 7–9). Tài liệu: "Thẻ từ vựng HSK 3 (973 từ)" (số từ mới riêng cấp 3) | Ảnh 01-03 ghi "HSK 3 ~ 600 từ vựng" (thang HSK 2.0); ảnh 03-06 ghi "600 từ" |
| Q6 | **Lý do học (Giao tiếp / Du học / Thi HSK / Công việc) được lưu thật** (PO 05/10/2026) | Màn Mục tiêu giữ 4 ô như mẫu | Không lệch. Backend thêm trường `learningPurpose` cho mục tiêu (task M2.B6) trước khi làm UI M2.2 |
| Q7 | **Nhắc nhở: lưu tuỳ chọn, câu phụ trung thực** (PO 05/10/2026) | Màn Kế hoạch: câu phụ "Nhắc nhở sẽ được gửi khi tính năng ra mắt" | Ảnh 01-04 ghi "Chúng tôi sẽ nhắc bạn học đúng giờ". Backend chưa có hệ thống gửi nhắc nhở; app vẫn lưu `reminderEnabled`/`reminderTime` |
| Q8 | **Sau màn Kế hoạch: tạo lộ trình rồi vào `/learn`** cho tới khi có placement (M2.3) (PO 05/10/2026) | Bản demo vẫn đi tiếp tới Bài kiểm tra xếp trình độ để thể hiện sản phẩm đầy đủ | App thật bỏ qua bước 3–4 cho tới M2.3; chỉ báo "1/4", "2/4" giữ như mẫu |
| Q9 | **Nút quay lại ở màn Mục tiêu** (PO 05/10/2026) | Bản demo giữ nút về Đăng ký | App thật: người chưa có mục tiêu không có nút (giữ ô trống 44px để bố cục không xê dịch); người đã có mục tiêu thì nút về `/learn` |
| Q10 | **Cấp chưa mở vẫn hiện đủ 9 nút** (PO 05/10/2026) | Bản demo coi mọi cấp đều mở | App thật: chọn cấp chưa có Level published thì hiện "HSK n chưa mở. Hãy chọn cấp độ khác." và khoá nút Tiếp tục |
| Q11 | **Tắt nhắc nhở thì không lưu giờ học** (PO 05/10/2026) | Ô giờ vẫn hiện và chọn được như mẫu | API chỉ có `reminderTime`; giờ chỉ được gửi khi công tắc bật |
| Q12 | **Vòng focus đậm jade-700 cho mọi control, kể cả ô nhập liệu và ô chọn** (PO 05/10/2026) | Mẫu PNG dùng vòng xanh mờ 40% (tương phản khoảng 1,55:1) | `--focus-ring` trong `tokens.css` đổi sang `0 0 0 3px var(--jade-700)` để đạt WCAG 1.4.11 (≥ 3:1); app dùng cùng giá trị |
| Q13 | **Mục tiêu hôm nay và Chuỗi ngày học do backend tính** (`GET /learning/home`, M2.B10; PO 07/10/2026) | Giữ 2 thẻ như mẫu | App thật: số phút hôm nay = tổng `durationSeconds` của lần nộp bài tập trong ngày (theo timezone hồ sơ), nên là 0 cho tới khi có nội dung bài tập (M2.9). Ngày học = có ít nhất một `lesson_completed`, `topic_completed` hoặc `exercise_submitted` (không tính `word_saved`). Đơn vị chuỗi hiện "ngày" thay cho "days" của ảnh 02-01 |
| Q14 | **Ẩn thẻ XP "Cấp 7", chip XP ở Lộ trình và thẻ Ôn tập** cho tới khi có tính năng (PO 07/10/2026) | Bản demo vẫn hiện | App thật không có 3 phần này. XP cần ADR và migration (P1), SRS thuộc M3. Khi so pixel, bản mẫu ẩn cùng các phần đó |
| Q15 | **Chuông không badge, avatar dạng icon chung, chào "Chào bạn" khi chưa có tên** (PO 07/10/2026) | Bản demo có badge "3" và ảnh avatar | Bấm chuông ra toast "Thông báo sẽ có khi tính năng ra mắt." Avatar là icon người dùng và trỏ tới Hồ sơ (Q17). Có tên thì chào "Chào, {tên}" |
| Q16 | **Tab Tra từ, Ôn tập và 8 lối tắt Khám phá vẫn hiện; màn chưa có thì bấm ra toast "Tính năng sắp ra mắt."** (PO 07/10/2026) | Bản demo trỏ tới các màn demo | Giữ bố cục Q1. Khi màn đích ra mắt thì nối link thật |
| Q17 | **Trang Hồ sơ tối thiểu `/learn/profile`: tên, email, nút Đăng xuất** (PO 07/10/2026) | Bản demo dùng `profile.html` đầy đủ | Tab Hồ sơ và avatar trỏ tới trang này cho tới khi làm màn 04/06. Trang chủ không còn nút Đăng xuất |
| Q18 | **Khoá bài tuần tự trong từng cấp, server tính và chặn** (PO 07/10/2026) | Như mẫu: bài xong, bài đang học, bài khoá kèm toast "Hoàn thành bài trước để mở khoá." | Bài đầu cấp luôn mở; bài sau mở khi bài liền trước xong; bài đã có tiến độ không bao giờ bị khoá. `POST /learning/lessons/:id/start` bài khoá trả 409 `lesson_locked` (đổi contract M2.B3) |
| Q19 | **Lộ trình luôn hiện đủ 7 tab cấp; tab mặc định là cấp mục tiêu** (PO 07/10/2026) | Như mẫu (HSK 7–9 theo Q3) | Cấp chưa có bài sẵn sàng hiện "HSK n chưa mở." với lưới trống. Cấp khác cấp mục tiêu vẫn học được theo quy tắc Q18 |
| Q20 | **Ảnh minh hoạ bài học dùng ô chung** (PO 07/10/2026) | Bản demo dùng ảnh cắt riêng từng bài | API chưa trả ảnh bài. App dùng một ô minh hoạ chung; khi so pixel, vùng ảnh được che ở cả hai bên. Có ảnh thật thì thay vào đúng chỗ |
