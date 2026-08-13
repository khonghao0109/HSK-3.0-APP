# UI Design References

`docs/ui_image` là nguồn tham chiếu thiết kế chính thức của HSK 3.0.

## Hai cấp độ tham chiếu

- Sáu file PNG ở ngay trong thư mục này là ảnh tổng hợp cấp module. Các đường dẫn
  này được giữ ổn định để tài liệu và quy trình hiện hữu tiếp tục hoạt động.
- Ba mươi sáu PNG trong sáu thư mục con là source of truth chi tiết cho từng
  page/screen. Khi triển khai hoặc review một page, ảnh page-level tương ứng được ưu
  tiên hơn ảnh tổng hợp để xác định information architecture, hierarchy, layout,
  vị trí action và visual language.

## Catalog page-level

| Module                        | Page/screen               | Ảnh chi tiết                                               |
| ----------------------------- | ------------------------- | ---------------------------------------------------------- |
| Onboarding & Placement        | Màn hình chào             | `01-onboarding-placement/01-man-hinh-chao.png`             |
| Onboarding & Placement        | Tạo tài khoản             | `01-onboarding-placement/02-tao-tai-khoan.png`             |
| Onboarding & Placement        | Mục tiêu học tập          | `01-onboarding-placement/03-muc-tieu-hoc-tap.png`          |
| Onboarding & Placement        | Kế hoạch học mỗi ngày     | `01-onboarding-placement/04-ke-hoach-hoc-moi-ngay.png`     |
| Onboarding & Placement        | Bài kiểm tra xếp trình độ | `01-onboarding-placement/05-bai-kiem-tra-xep-trinh-do.png` |
| Onboarding & Placement        | Kết quả xếp trình độ      | `01-onboarding-placement/06-ket-qua-xep-trinh-do.png`      |
| Learning & Lesson             | Trang chủ learner         | `02-learning-lesson/01-trang-chu.png`                      |
| Learning & Lesson             | Lộ trình học              | `02-learning-lesson/02-lo-trinh-hoc.png`                   |
| Learning & Lesson             | Nội dung bài học          | `02-learning-lesson/03-noi-dung-bai-hoc.png`               |
| Learning & Lesson             | Luyện tập                 | `02-learning-lesson/04-luyen-tap.png`                      |
| Learning & Lesson             | Nghe hiểu                 | `02-learning-lesson/05-nghe-hieu.png`                      |
| Learning & Lesson             | Hoàn thành bài học        | `02-learning-lesson/06-hoan-thanh-bai-hoc.png`             |
| Dictionary, Review & Reader   | Tìm kiếm từ điển          | `03-dictionary-review-reader/01-tim-kiem-tu-dien.png`      |
| Dictionary, Review & Reader   | Chi tiết từ vựng          | `03-dictionary-review-reader/02-chi-tiet-tu-vung.png`      |
| Dictionary, Review & Reader   | Ôn tập flashcard          | `03-dictionary-review-reader/03-on-tap-flashcard.png`      |
| Dictionary, Review & Reader   | Lịch ôn tập               | `03-dictionary-review-reader/04-lich-on-tap.png`           |
| Dictionary, Review & Reader   | Đọc tương tác             | `03-dictionary-review-reader/05-doc-tuong-tac.png`         |
| Dictionary, Review & Reader   | Tài liệu học              | `03-dictionary-review-reader/06-tai-lieu-hoc.png`          |
| Exam, Pronunciation & Profile | Danh sách thi thử         | `04-exam-pronunciation-profile/01-danh-sach-thi-thu.png`   |
| Exam, Pronunciation & Profile | Đang làm bài thi          | `04-exam-pronunciation-profile/02-dang-lam-bai-thi.png`    |
| Exam, Pronunciation & Profile | Xem lại bài thi           | `04-exam-pronunciation-profile/03-xem-lai-bai-thi.png`     |
| Exam, Pronunciation & Profile | Kết quả bài thi           | `04-exam-pronunciation-profile/04-ket-qua-bai-thi.png`     |
| Exam, Pronunciation & Profile | Luyện phát âm             | `04-exam-pronunciation-profile/05-luyen-phat-am.png`       |
| Exam, Pronunciation & Profile | Hồ sơ                     | `04-exam-pronunciation-profile/06-ho-so.png`               |
| AI, Hanzi & Support           | Trợ lý Hán Lộ             | `05-ai-hanzi-support/01-tro-ly-han-lo.png`                 |
| AI, Hanzi & Support           | Gọi món ở nhà hàng        | `05-ai-hanzi-support/02-goi-mon-o-nha-hang.png`            |
| AI, Hanzi & Support           | Chi tiết Hán tự           | `05-ai-hanzi-support/03-chi-tiet-han-tu.png`               |
| AI, Hanzi & Support           | Nhận diện chữ viết/OCR    | `05-ai-hanzi-support/04-nhan-dien-chu-viet-ocr.png`        |
| AI, Hanzi & Support           | Trung tâm hỗ trợ          | `05-ai-hanzi-support/05-trung-tam-ho-tro.png`              |
| AI, Hanzi & Support           | Thông báo                 | `05-ai-hanzi-support/06-thong-bao.png`                     |
| Admin CMS & Operations        | Tổng quan                 | `06-admin-cms-operations/01-tong-quan.png`                 |
| Admin CMS & Operations        | Nội dung                  | `06-admin-cms-operations/02-noi-dung.png`                  |
| Admin CMS & Operations        | Tạo/sửa bài học           | `06-admin-cms-operations/03-tao-sua-bai-hoc.png`           |
| Admin CMS & Operations        | Nhập dữ liệu              | `06-admin-cms-operations/04-nhap-du-lieu.png`              |
| Admin CMS & Operations        | Ngân hàng câu hỏi         | `06-admin-cms-operations/05-ngan-hang-cau-hoi.png`         |
| Admin CMS & Operations        | Người dùng và Ops         | `06-admin-cms-operations/06-nguoi-dung-va-ops.png`         |

## Quy trình bắt buộc khi làm UI

1. Xác định đúng module và page/screen trong catalog.
2. Mở ảnh page-level ở độ phân giải gốc trước khi đọc hoặc sửa UI code.
3. Lập mapping `route/page → ảnh tham chiếu → component hiện tại → component/state
cần thay đổi`.
4. Đối chiếu thêm `frontend/DESIGN.md`, design tokens, shared components,
   breakpoints và accessibility contract hiện hành.
5. Không redesign tùy ý, không dựng một giao diện generic thay cho specification và
   không dùng PNG làm background để giả giao diện. UI phải được triển khai bằng
   component, HTML/CSS và token production-ready.
6. Ảnh định nghĩa intent thiết kế nhưng không thay thế behavior contract. Mọi
   implementation vẫn phải responsive, accessible, secure và bao phủ đầy đủ state
   như loading, empty, error/retry, forbidden, disabled, validation, processing,
   success và long content.
7. Visual QA phải chạy trên page thật ở production build và so sánh ít nhất desktop,
   tablet, mobile; ghi rõ mọi khác biệt còn lại.

Khi công việc không liên quan UI, không bắt buộc đọc hoặc sử dụng `docs/ui_image`.

Nếu ảnh mẫu mâu thuẫn với security, accessibility hoặc business/data invariant, phải
bảo toàn invariant. Không tự sửa flow để khớp ảnh; ghi rõ khác biệt, tác động và xin
Product Owner phê duyệt.
