# Hán Lộ Admin — Design Brief V1.2 (sau M5.0)

> **Product decision (2026-10-01): hướng admin đích.** Product Owner chọn admin
> trong `docs/ui_image/06-admin-cms-operations/`: console tiếng Việt tên "Hán Lộ
> Admin" có Tổng quan (dashboard), soạn/sửa bài có duyệt, và nhập dữ liệu. Quyết
> định này thay quy tắc "tiếng Anh only" cũ. Không vẽ UI cho tính năng API chưa
> hỗ trợ.
>
> **M5.0 (15/10/2026, Q88–Q92):** khung + ngôn ngữ của bản mẫu
> `docs/ui_reference/admin/` đã áp cho toàn bộ `/admin/**`, `/login`,
> `/forbidden` và trang lỗi/loading/not-found của admin. Trang Bài tập và Thư
> viện media (danh sách + chi tiết) dùng thành phần của mẫu `content.html`.
> Dashboard (M5.5), soạn bài (M5.1a, Q89–Q91), upload media (M5.2) vẫn là task
> riêng với backend kèm theo.

Quyết định PO cho learner app: `docs/product/learner-ui-decisions.md` (cùng bảng
Q với admin: Q4, Q88–Q92).

## Sản phẩm và người dùng

Console vận hành nội dung cho quản trị viên HSK, hoàn toàn tiếng Việt. Việc
duy nhất ở V1: xem kho `LessonExercise`, chi tiết và lịch sử bản sửa, và thao
tác an toàn trên media (cách ly/lưu trữ có audit), không lộ credential storage,
không gợi ý pipeline upload/import chưa mở.

## Kiến trúc thông tin

```text
Đăng nhập (/login, thẻ giữa trang, TL-9)
└── Khung admin (sidebar + thanh trên, TL-6/TL-7)
    ├── Bài tập (/admin/exercises): danh sách lọc server + phân trang, chi tiết + lịch sử bản sửa
    ├── Thư viện media (/admin/media): danh sách lọc theo URL, chi tiết metadata an toàn, cách ly/lưu trữ có audit
    └── Tổng quan · Nội dung · Ngân hàng câu hỏi · Nhập dữ liệu · Người dùng ·
        Báo cáo · AI Ops · Phản hồi · Cài đặt hệ thống — mục chưa có trang:
        không link, aria-disabled, nhãn "Sắp có" (Q88)
```

`/forbidden` và trạng thái hết phiên nằm ngoài khung admin được bảo vệ. URL là
nguồn đúng duy nhất cho trang/bộ lọc; bảng desktop trở thành danh sách bản ghi
có nhãn ở màn hẹp (không cuộn ngang cấp trang).

## Hướng thị giác

**Nguồn đúng:** `docs/ui_reference/admin/` (bản HTML mẫu, PO 01/10/2026 + Q88),
không phải ảnh PNG. Cụ thể khung ở `admin/css/admin.css` + `m06.css`, thành
phần danh sách ở `admin/content.html`.

- **Dấu ấn:** brand "Hán Lộ Admin" với dấu tròn jade chứa icon lá
  (`#i-leaf`), nhãn mono/tabular cho ID nội dung và phiên bản.
- **Palette:** navy-850 `#0a224a` cho sidebar; jade-800 `#067a60` cho mục đang
  chọn và nút chính (Q92, chữ trắng 5,3:1); nền canvas slate-50; mặt làm việc
  trắng; amber/red chỉ cho trạng thái cảnh báo/lỗi có tên.
- **Typography:** Inter (400/500/600/700, subset vietnamese) cho toàn bộ chữ
  vận hành — cùng họ/weight learner nạp (không thêm họ font); Noto Sans SC dự
  phòng chữ Hán; mono hệ thống cho ID/hash.
- **Mật độ:** compact như mẫu: nút admin desktop 40px, ≤900px 44px (quy ước
  README của bộ mẫu), nhịp 4/8px.
- **Hình khối:** bo góc 8–12px, viền hairline, một tầng đổ bóng thấp; không
  gradient trang trí.
- **Chuyển động:** 150–200ms; tôn trọng `prefers-reduced-motion` (rule global
  của styles.css).

## Kiến trúc token

- Token admin nằm ở `src/app/admin/admin.css`, scope `.admin-app`, tiền tố
  `--adm-*` (copy từ `docs/ui_reference/shared/css/tokens.css`, chỉ biến dùng
  đến). Component dùng semantic/token, không hex trần ngoài khối token.
- Lệch mẫu có chủ đích vì WCAG AA (axe color-contrast): muted text
  `--adm-slate-500: #5f6b7f` (mẫu #6b7686 chỉ 4,3:1 trên slate-50), badge ok
  jade-800 trên jade-50 (4,97:1), badge draft #9a5b00 (4,95:1), nút danger
  #c73429 (5,31:1), link nội dung jade-800 (5,3:1, cùng hướng Q74/Q80).
- Font nạp một lần qua `src/features/admin-shell/admin-fonts.ts` (dùng chung
  cho `admin/layout.tsx` và `(auth)/layout.tsx`).

## Hợp đồng accessibility và responsive

- WCAG AA cho cặp chữ/nền (0 vi phạm axe trong e2e), vòng focus jade-700 đặc
  3px cho mọi control (Q12).
- Skip link "Đến nội dung chính", landmark header/nav/main, nhãn form tường
  minh (sr-only trong hàng lọc), lỗi inline `role="alert"`, trạng thái có chữ
  kèm màu.
- Thanh trên (TL-7): không ô tìm kiếm, chuông, badge phản hồi — vẽ khi có API.
- `>900px`: sidebar cố định 232px navy-850, nút "Thu gọn" thu về 72px
  (aria-expanded, không nhớ trạng thái).
- `≤900px`: sidebar thành drawer 260px (nút menu ở thanh trên navy, backdrop,
  Esc đóng và trả focus về nút menu; drawer đóng khuất khỏi tab order bằng
  `visibility`).
- `≤430px`: lọc và nội dung một cột; khối chữ người dùng ẩn (giữ avatar + nút
  Đăng xuất).
- Viewport kiểm chứng: 390, 768, 1024, 1440 (e2e 4 project + axe).

## Loại trừ tường minh (cập nhật sau Q88)

- Không upload/transcode/cấu hình provider UI cho tới M5.2; V1 chỉ đọc kho,
  chi tiết, tham chiếu, cách ly, lưu trữ.
- Không dark theme trong V1.
- (Đã bỏ 15/10/2026 theo Q4/Q88: loại trừ "không dashboard" và "không
  create/review/publish/import" — dashboard thuộc M5.5, soạn bài có duyệt
  M5.1a theo Q89–Q91, nhập dữ liệu theo lộ trình M5. Các mục sidebar tương ứng
  hiện "Sắp có" cho tới khi task đó ship.)
