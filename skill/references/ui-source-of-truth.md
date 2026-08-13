# UI Source of Truth

## Trước khi thay đổi UI

1. Liệt kê đầy đủ `docs/ui_image` và chọn đúng module.
2. Mở từng ảnh liên quan ở độ phân giải gốc.
3. Lập mapping route/page → ảnh → component hiện tại → component thay đổi.
4. Đọc `frontend/DESIGN.md`, token, shared component, breakpoint và accessibility contract.
5. Đọc/dùng `skill/skills/frontend-design/SKILL.md`, `skill/skills/design-system/SKILL.md` và `skill/skills/ui-ux-pro-max/SKILL.md`.

Ảnh mẫu là chuẩn cho IA, hierarchy, layout, action placement, color, typography, spacing, radius, shadow, density và states. Không redesign, không dựng UI generic, không dùng ảnh làm background thay HTML/CSS/component thật.

## Bản đồ module ảnh chính thức

| Ảnh | Module/screen phải đối chiếu |
|---|---|
| `01-onboarding-placement.png` | Welcome/register, mục tiêu, kế hoạch học, placement test và kết quả xếp trình độ |
| `02-learning-lesson.png` | Home learner, lộ trình HSK, lesson detail, exercise/listening và completion |
| `03-dictionary-review-reader.png` | Dictionary search/detail, SRS/review calendar, interactive reader và materials/offline |
| `04-exam-pronunciation-profile.png` | Exam list/player/review/result, pronunciation và profile/privacy/export/delete |
| `05-ai-hanzi-support.png` | AI assistant, scenario speaking, Hanzi/stroke, OCR, support và notification |
| `06-admin-cms-operations.png` | Admin dashboard, content/CMS, authoring/review, import, question bank, user và Ops |

Nếu một route kết hợp nhiều capability, đọc tất cả ảnh liên quan và ghi rõ ảnh nào quyết định shell, ảnh nào quyết định content state.

Sáu path trên là ảnh tổng hợp cấp module và phải được giữ ổn định. Source of truth
chi tiết theo page/screen nằm trong các thư mục con tương ứng:

### 01 — Onboarding & Placement

| Ảnh page-level | Page/screen |
| --- | --- |
| `docs/ui_image/01-onboarding-placement/01-man-hinh-chao.png` | Màn hình chào và entry action bắt đầu học/đăng nhập |
| `docs/ui_image/01-onboarding-placement/02-tao-tai-khoan.png` | Tạo tài khoản và lựa chọn social sign-in |
| `docs/ui_image/01-onboarding-placement/03-muc-tieu-hoc-tap.png` | Chọn mục tiêu học và cấp HSK mục tiêu |
| `docs/ui_image/01-onboarding-placement/04-ke-hoach-hoc-moi-ngay.png` | Chọn thời lượng, giờ học và nhắc nhở hằng ngày |
| `docs/ui_image/01-onboarding-placement/05-bai-kiem-tra-xep-trinh-do.png` | Placement test dạng nghe/chọn đáp án |
| `docs/ui_image/01-onboarding-placement/06-ket-qua-xep-trinh-do.png` | Kết quả placement, skill profile và lộ trình gợi ý |

### 02 — Learning & Lesson

| Ảnh page-level | Page/screen |
| --- | --- |
| `docs/ui_image/02-learning-lesson/01-trang-chu.png` | Trang chủ learner, daily goal, streak và tiếp tục học |
| `docs/ui_image/02-learning-lesson/02-lo-trinh-hoc.png` | Lộ trình HSK và trạng thái mở/khóa bài học |
| `docs/ui_image/02-learning-lesson/03-noi-dung-bai-hoc.png` | Lesson detail và tiến độ từng nhóm nội dung |
| `docs/ui_image/02-learning-lesson/04-luyen-tap.png` | Activity sắp xếp câu và feedback đúng/sai |
| `docs/ui_image/02-learning-lesson/05-nghe-hieu.png` | Listening activity, waveform, transcript và lựa chọn đáp án |
| `docs/ui_image/02-learning-lesson/06-hoan-thanh-bai-hoc.png` | Lesson completion, score, XP, achievement và next action |

### 03 — Dictionary, Review & Reader

| Ảnh page-level | Page/screen |
| --- | --- |
| `docs/ui_image/03-dictionary-review-reader/01-tim-kiem-tu-dien.png` | Tìm kiếm từ điển bằng text/handwriting/camera/voice |
| `docs/ui_image/03-dictionary-review-reader/02-chi-tiet-tu-vung.png` | Chi tiết từ, phát âm, nghĩa, ví dụ và lưu ôn tập |
| `docs/ui_image/03-dictionary-review-reader/03-on-tap-flashcard.png` | Flashcard review và đánh giá mức độ nhớ |
| `docs/ui_image/03-dictionary-review-reader/04-lich-on-tap.png` | Review dashboard, calendar và lịch sử ôn tập |
| `docs/ui_image/03-dictionary-review-reader/05-doc-tuong-tac.png` | Interactive reader, inline dictionary và audio timeline |
| `docs/ui_image/03-dictionary-review-reader/06-tai-lieu-hoc.png` | Materials library, download và offline state |

### 04 — Exam, Pronunciation & Profile

| Ảnh page-level | Page/screen |
| --- | --- |
| `docs/ui_image/04-exam-pronunciation-profile/01-danh-sach-thi-thu.png` | Danh sách thi thử theo HSK/kỹ năng và lịch sử điểm |
| `docs/ui_image/04-exam-pronunciation-profile/02-dang-lam-bai-thi.png` | Exam player, autosave, question navigator và đánh dấu |
| `docs/ui_image/04-exam-pronunciation-profile/03-xem-lai-bai-thi.png` | Review trạng thái câu hỏi trước khi nộp bài |
| `docs/ui_image/04-exam-pronunciation-profile/04-ket-qua-bai-thi.png` | Exam result, breakdown kỹ năng và giải thích |
| `docs/ui_image/04-exam-pronunciation-profile/05-luyen-phat-am.png` | Pronunciation score, tone practice và shadowing |
| `docs/ui_image/04-exam-pronunciation-profile/06-ho-so.png` | Profile, mục tiêu/streak/XP, privacy, export và account deletion |

### 05 — AI, Hanzi & Support

| Ảnh page-level | Page/screen |
| --- | --- |
| `docs/ui_image/05-ai-hanzi-support/01-tro-ly-han-lo.png` | AI learning assistant, sources và answer feedback/report |
| `docs/ui_image/05-ai-hanzi-support/02-goi-mon-o-nha-hang.png` | Scenario speaking và voice interaction |
| `docs/ui_image/05-ai-hanzi-support/03-chi-tiet-han-tu.png` | Hanzi detail, radical, structure và stroke practice |
| `docs/ui_image/05-ai-hanzi-support/04-nhan-dien-chu-viet-ocr.png` | OCR/handwriting capture, candidates và dictionary lookup |
| `docs/ui_image/05-ai-hanzi-support/05-trung-tam-ho-tro.png` | Support center, FAQ, feedback/report và ticket status |
| `docs/ui_image/05-ai-hanzi-support/06-thong-bao.png` | Notification inbox và notification preferences |

### 06 — Admin CMS & Operations

| Ảnh page-level | Page/screen |
| --- | --- |
| `docs/ui_image/06-admin-cms-operations/01-tong-quan.png` | Admin overview, learning KPIs và recent activity |
| `docs/ui_image/06-admin-cms-operations/02-noi-dung.png` | CMS content list, filter, moderation state và actions |
| `docs/ui_image/06-admin-cms-operations/03-tao-sua-bai-hoc.png` | Lesson authoring và publish workflow |
| `docs/ui_image/06-admin-cms-operations/04-nhap-du-lieu.png` | Import mapping, preview, validation và commit summary |
| `docs/ui_image/06-admin-cms-operations/05-ngan-hang-cau-hoi.png` | Question bank, version history và test composition |
| `docs/ui_image/06-admin-cms-operations/06-nguoi-dung-va-ops.png` | User management, audit, incident queue và Ops health |

Catalog canonical và quy trình sử dụng asset được duy trì tại
`docs/ui_image/README.md`.

## State và responsive

- Bao phủ loading/skeleton, empty, error/retry, forbidden, disabled, validation, upload/processing, success, long content và filter không kết quả.
- Kiểm tra 1440×900, 768×1024, 390×844; không horizontal overflow, mất primary action hay sticky overlap.
- Nếu chỉ có desktop, bảo toàn hierarchy/identity và chọn adaptive pattern có chủ đích.

## Visual/accessibility QA

- Chạy production build và kiểm tra page thật bằng browser; chụp screenshot ba viewport.
- So sánh proportions, type, token, spacing, alignment, state, responsive và overflow với ảnh.
- Kiểm tra keyboard, screen reader semantics, focus, contrast WCAG 2.2 AA, zoom và reduced motion.
- Console phải sạch hydration/CSP/runtime error; khác biệt còn lại phải có lý do và phê duyệt.
