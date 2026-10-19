# Độ phủ thiết kế UI so với sản phẩm hoàn thiện

> Kiểm ngày 19/10/2026 · Nguồn thiết kế: bộ HTML mẫu `docs/ui_reference/` (local, gitignore;
> bản sắp xếp lại 13/10/2026 tách `mobile/`, `web/`, `admin/`), đã đưa lên Figma trang
> **Screens** của file `TXoIuJPEAd3BpAkfdE4ZZf` theo 3 section Mobile, Web, Admin.
> Đối chiếu với toàn bộ task chức năng trong [PLAN.md](../PLAN.md) (M1–M7, TN), gồm cả các
> mục bổ sung từ khảo sát đối thủ ngày 10/10/2026.

Mục tiêu: một bản thiết kế sản phẩm cuối cùng phủ mọi chức năng của dự án khi hoàn thiện.
Task PLAN tương ứng: M2.UXa–M2.UXd (GĐ5).

Ưu tiên:

| Mức | Ý nghĩa |
| --- | --- |
| P1 | Cần cho phạm vi đồ án (hạn 17/01/2027): web, mobile, AI, nhận diện |
| P2 | Sau bảo vệ (GĐ11–GĐ12) hoặc task PLAN đã hoãn (M5.5–M5.7, M2.1e) |

## 1. Đã có trong bộ mẫu (70 trang)

| Khu | Trang |
| --- | --- |
| Mobile 390 (40) | **01** welcome, sign-up, sign-in, forgot-password, reset-password, verify-email, onboarding-goal, onboarding-plan, placement-test, placement-result, terms, privacy · **02** home, path, lesson, lesson-locked, lesson-not-found, practice (sắp xếp câu), practice-mcq, practice-listening, listening, lesson-complete · **03** dictionary, word, flashcards, review-calendar, reader, library · **04** exams, exam-take, exam-review, exam-result, pronunciation, profile · **05** assistant, roleplay, hanzi, ocr, support, notifications |
| Web 1440 (20) | index (landing), sign-in, sign-up, forgot-password, reset-password, verify-email, terms, privacy, onboarding-goal, onboarding-plan, home, path, lesson, practice-mcq, practice-listening, lesson-complete, lesson-not-found, dictionary, word, profile |
| Admin 1440 (10) | dashboard, content, lesson-editor, question-bank, import, users-ops; 4 trang giữ chỗ chưa thiết kế: reports, ai-ops, feedback, settings |

Trạng thái phụ (lỗi, đang xử lý, hộp thoại xác nhận) nằm trong từng trang dưới dạng phần tử
ẩn do `shared/js/app.js` bật, chưa có trang riêng.

## 2. Mobile còn thiếu (M2.UXa)

| # | Màn | Task | Ưu tiên |
| --- | --- | --- | --- |
| MB-01 | Học từ vựng trong bài: thẻ từ, nghe phát âm, câu ví dụ | M2.5a, M7.7b | P1 |
| MB-02 | Giải thích điểm ngữ pháp trong bài | M2.5a, M7.7b | P1 |
| MB-03 | Bài tập điền chỗ trống (fill_blank) | M2.5b | P1 |
| MB-04 | Bài tập nghe chép chính tả (dictation) | M3.7 | P1 |
| MB-05 | Điều khiển tốc độ nghe 0,75x / 1x và nghe lại trên bài nghe và thi thử | M2.5e | P1 |
| MB-06 | Chi tiết từ đầy đủ: âm Hán Việt, bộ thủ, nhiều nghĩa, từ liên quan, audio | M3.4c, M3.4d | P1 |
| MB-07 | Sổ từ đã lưu | M2.6b, M3.4b | P1 |
| MB-08 | Sổ lỗi sai và phiên ôn lại câu làm sai | M3.6 | P1 |
| MB-09 | Tổng kết sau phiên ôn flashcard | M3.3 | P1 |
| MB-10 | Giới thiệu đề trước khi thi: cấu trúc, thời gian, quy định, bắt đầu | M4.2a, M4.5 | P1 |
| MB-11 | Lịch sử thi | M4.5 | P1 |
| MB-12 | Onboarding bước 3/4 và 4/4: chọn làm bài xếp trình độ hay bắt đầu từ đầu | M2.3b | P1 |
| MB-13 | Luyện viết chữ Hán theo thứ tự nét (đích của nút "Luyện tập viết" ở hanzi) | M7.5a | P1 |
| MB-14 | Chat AI: danh sách hội thoại, từ chối khi không có nguồn, hết hạn mức, AI tạm tắt | M7.4c, M7.4d | P1 |
| MB-15 | Xin quyền thông báo đẩy, micro, camera; đồng ý ghi âm cho chấm phát âm | M7.3, M7.2, M7.5b | P1 |
| MB-16 | Cài đặt tài khoản: sửa tên, ảnh đại diện, đổi mật khẩu, đăng xuất | M1.6, M2.1b | P1 |
| MB-17 | Đồng ý quyền riêng tư (consent) khi đăng ký và trong cài đặt | M1.7b2, M5.8 | P1 |
| MB-18 | Danh sách video YouTube theo cấp HSK | M3.8b | P1 |
| MB-19 | Trình xem video: phụ đề chữ Hán, pinyin, tiếng Việt; lặp câu, đổi tốc độ, shadowing; tab từ vựng lọc theo cấp, lưu từ | M3.8b | P1 |
| MB-20 | Hỗ trợ: tạo yêu cầu, chi tiết yêu cầu và trao đổi | M5.6 | P2 |

## 3. Web học viên còn thiếu (M2.UXb)

Web hiện chỉ có vòng lõi. Thanh bên ghi "Sắp có" cho Ôn tập, Thi thử HSK, Phát âm, Đọc hiểu,
Trợ lý AI; tra từ ghi "Sắp có" cho viết tay, ảnh chụp, giọng nói. Theo PLAN, các chức năng
dưới đây chạy trên web trước rồi mới lên mobile, nên web cần bản thiết kế riêng ở 1440 và
1024px.

| # | Màn | Task | Ưu tiên |
| --- | --- | --- | --- |
| WB-01 | Bài học bị khoá | M2.4b | P1 |
| WB-02 | Học từ vựng và giải thích ngữ pháp trong bài | M2.5a | P1 |
| WB-03 | Bài tập sắp xếp câu, điền chỗ trống, bài nghe hiểu có tốc độ 0,75x / 1x | M2.5b, M2.5c, M2.5e | P1 |
| WB-04 | Bài nghe chép chính tả | M3.7 | P1 |
| WB-05 | Bài xếp trình độ và kết quả; bước chọn làm bài hay bắt đầu từ đầu | M2.3b | P1 |
| WB-06 | Ôn tập: flashcard, tổng kết phiên, lịch ôn | M3.3 | P1 |
| WB-07 | Sổ từ đã lưu, sổ lỗi sai | M2.6b, M3.6 | P1 |
| WB-08 | Chi tiết từ đầy đủ: âm Hán Việt, bộ thủ, nhiều nghĩa, từ liên quan | M3.4c, M3.4d | P1 |
| WB-09 | Chi tiết Hán tự (thứ tự nét) | M3.4d | P1 |
| WB-10 | Thi thử: danh sách đề, giới thiệu đề, làm bài, xem lại, kết quả, lịch sử | M4.5 | P1 |
| WB-11 | Trợ lý AI (chat có trích nguồn, báo cáo câu trả lời, các trạng thái giới hạn) | M7.4d | P1 |
| WB-12 | Video YouTube: danh sách và trình xem | M3.8b | P1 |
| WB-13 | Thông báo và tuỳ chọn thông báo | M5.8 | P1 |
| WB-14 | Cài đặt tài khoản: sửa hồ sơ, đổi mật khẩu, đăng xuất; consent | M1.6, M1.7b2 | P1 |
| WB-15 | Trung tâm hỗ trợ, gửi phản hồi, báo lỗi nội dung | M5.6 | P2 |
| WB-16 | Đọc tương tác và tài liệu học | M7.1 | P2 |

Phát âm, roleplay giọng nói, viết tay và OCR chỉ cần bản mobile (PLAN M7.2, M7.5 chạy trên
app). Cần chốt: web có giữ các mục này trong menu với trạng thái "Dùng trên app" hay ẩn đi.

## 4. Admin còn thiếu (M2.UXc)

| # | Màn | Task | Ưu tiên |
| --- | --- | --- | --- |
| AD-01 | Đăng nhập admin, không có quyền, hết phiên đăng nhập | M5.B1 | P1 |
| AD-02 | Thư viện media: tải lên, trạng thái xử lý, cách ly / lưu trữ, chi tiết | M5.B3, M5.2 | P1 |
| AD-03 | Soạn bài tập theo từng dạng (mcq, fill_blank, listening, arrange, dictation) và xem trước | M5.1b, M3.7 | P1 |
| AD-04 | Soạn đề thi: ghép đề từ ngân hàng câu hỏi theo cấu trúc HSK, xuất bản | M4.1 | P1 |
| AD-05 | Quản lý từ vựng và hàng đợi duyệt nghĩa tiếng Việt theo lô, hoàn tác lô | M1.2a, M5.4 | P1 |
| AD-06 | Soạn truyện, quản lý cấp độ | M5.4 | P1 |
| AD-07 | Quản lý video: nhập phụ đề, tách từ, gắn cấp HSK, duyệt, xuất bản | M3.8a | P1 |
| AD-08 | Chi tiết người dùng: hồ sơ, tiến độ, phiên đăng nhập, vai trò, khoá / mở, audit | M5.3 | P1 |
| AD-09 | AI Ops: pipeline nạp tài liệu RAG, chi phí, độ trễ, hạn mức, kill switch | M7.4b, M7.4c | P1 |
| AD-10 | Phản hồi và yêu cầu hỗ trợ: hàng đợi, gán người xử lý, chi tiết, SLA | M5.6 | P2 |
| AD-11 | Kiểm duyệt: báo cáo nội dung và câu trả lời AI, xử lý, khiếu nại | M5.7 | P2 |
| AD-12 | Báo cáo học tập, nội dung, vận hành; xuất CSV / PDF | M5.5 | P2 |
| AD-13 | Cài đặt hệ thống: vai trò và phân quyền, email, chính sách lưu trữ | M5.7 | P2 |

Admin hiện chạy trong code là bản workbench tiếng Anh (`frontend/DESIGN.md`); PO đã chốt
hướng "Hán Lộ Admin" tiếng Việt theo bộ mẫu, nên các màn AD-01, AD-02 và trang bài tập hiện
có cần thiết kế lại theo bộ mẫu.

## 5. Trạng thái dùng chung cho cả 3 khu (M2.UXd)

| # | Trạng thái | Task |
| --- | --- | --- |
| ST-01 | Mất mạng, lỗi tải trang, lỗi máy chủ, thử lại | M2.7 |
| ST-02 | Trống (chưa có dữ liệu) cho danh sách chính: lộ trình, sổ từ, sổ lỗi, lịch sử thi, thông báo, hội thoại AI | M2.7 |
| ST-03 | Đang tải (skeleton) cho trang có dữ liệu | M2.7 |
| ST-04 | Hết phiên đăng nhập, không có quyền | M1.4c, M5.B1 |
| ST-05 | Bảo trì, tính năng đang tắt (feature flag, AI kill switch) | M2.3a, M7.4c |

## 6. Điểm cần chốt trong thiết kế hiện có

1. Trang Điều khoản và Chính sách bảo mật mới có câu "Nội dung đang được cập nhật" (M2.1f).
2. Kế hoạch học ghi "Nhắc nhở sẽ được gửi khi tính năng ra mắt"; đổi khi có M2.B7 và M7.3.
3. FAQ trong trang Hỗ trợ có câu về thanh toán, trong khi thanh toán (M7.6) để sau beta;
   bỏ câu này hoặc thiết kế M7.6 khi tới GĐ12.
4. Hình minh hoạ cắt từ ảnh mẫu độ phân giải thấp (M2.1g).
5. Chưa có thiết kế cho thanh toán (M7.6) và cộng đồng (M7.8); đúng phạm vi vì thuộc GĐ12.

## 7. Tổng hợp

| Khu | Đã có | Còn thiếu P1 | Còn thiếu P2 |
| --- | --- | --- | --- |
| Mobile | 40 | 19 | 1 |
| Web | 20 | 14 nhóm (≈ 28 màn) | 2 |
| Admin | 6 (+4 giữ chỗ) | 9 | 4 |
| Trạng thái chung | trong từng trang | 5 nhóm | — |

Cách làm đề xuất: bổ sung trang HTML vào `docs/ui_reference/` cùng tokens, CSS và icon
sprite hiện có, rồi đưa lên Figma bằng quy trình chụp HTML (390px cho mobile, 1440px cho web
và admin). Thứ tự: Mobile P1 → Web P1 → Admin P1 → trạng thái chung → P2.
