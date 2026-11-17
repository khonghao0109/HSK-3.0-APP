# Unslop 11/2026: kết quả

Nền `macdev` `b90c7b5`, nhánh `feat/ui-unslop`. Audit gốc: `docs/unslop-audit.md`. Chế độ đánh bóng: giữ thương hiệu Hán Lộ, tính năng, thứ tự khối theo `docs/ui_reference`.

Ảnh `before/` và `after/`: 53 trang × 2 khổ (`desktop-1440`, `mobile-390`), cùng tên tệp `<trang>-<khổ>.png`, dữ liệu e2e disposable (tài khoản `*.example.test`, không có dữ liệu cá nhân). Bộ chụp ở ngoài repo (scratch của phiên), chạy lại được bằng lệnh trong mục "Cách chụp lại".

## Commit

| Lượt | Commit |
| --- | --- |
| 1 Khoảng cách | `4d9641f` |
| 2 Màu | `e80ef2e` |
| 3 Icon | `c76d07e` |
| 4 Câu chữ | `b5781c5` |
| 5 Kiểu chữ | `c9e1a2d` |
| 6 Bố cục | `1e8c367` |
| 7 Chi tiết | `3b8bcf0` |
| 8 Hình ảnh và 田字格 | `4b651d2` |
| 9 Chuyển động | `a7746f2` |
| Sửa sau e2e | `66a5f59` |

## Số đo CSS (`scan.mjs`, mọi `src/**/*.css`)

| Chỉ số | Trước | Sau | Phần còn lại |
| --- | --- | --- | --- |
| padding/margin/gap lệch lưới 4px (bỏ qua ≤2px) | 386 | 8 | Cố ý: bù vùng chạm 44px (`-11px`, `-7.5px`, `-5px`, `12.5px` ở trang pháp lý) |
| Hex trần ngoài khối token | 152 | 5 | Chỉ là comment trong khối token `admin.css` |
| `font-weight` ≥ 700 | 177 | 5 | Chỉ ở chữ Hán lớn (`.word__hz`, `.fc-hz`, `.dict-item--top .dict-item__hz`, hero landing) |
| `text-transform: uppercase` | 11 | 0 | |
| Cỡ chữ lẻ hoặc < 12px | 104 | 0 | |
| `transition: all` | 0 | 0 | |

## Bảng dấu hiệu

| Mã | Kết quả | Ghi chú |
| --- | --- | --- |
| S1 | Đã sửa | Về `--sp-*`/`--adm-sp-*` hoặc bội 4; `th`/`td` admin cùng padding |
| S2 | Đã sửa | `.home-explore a` có kiểu thẻ, hover, focus-visible, forced-colors (mobile và web) |
| S3 | Đã sửa | Dưới 1024px thẻ ôn giãn lấp màn, hàng nút `.fc-rate` sticky đáy kèm `safe-area-inset-bottom` |
| S4 | Đã sửa | `.adm-record-list` dùng `minmax(0, 1fr)` và `min-width: 0` |
| Thanh bên | Một phần | Khoảng cách 2px, icon cùng cột. Dòng giữ cao **44px** (không xuống 32–40px) vì Q42/Q69 và e2e vùng chạm |
| M1 | Đã sửa | Một kiểu trung tính; chỉ ô Thi thử dùng `--text-brand` |
| M2 | Đã sửa | Ảnh PNG tím/xanh thành icon sprite trong ô trung tính |
| M3 | Đã sửa | Nút trung tính; "Chưa nhớ" `--text-danger` (thêm `--red-700`, 5,44:1), "Tốt" viền `--border-brand` |
| M4 | Đã sửa | Bỏ confetti và vòng nguyệt quế, nền navy đặc, số điểm Noto Serif, tabular-nums, jade-200 (12,5:1) |
| M5 | Đã sửa | Nút xoá ở mỗi dòng là nút viền; hộp xác nhận vẫn đỏ đặc |
| M6 | Đã sửa | Gồm `review-overview.css` ô ngày ngoài tháng → `--stone-600` |
| Gradient | Đã sửa | Bỏ ở `.exl-chip[aria-current]`, `.exl-item__icon`, `.done-hero`; giữ gradient cùng sắc |
| I1 | Đã sửa | `#i-flame` nét, `--text-muted`; số ngày `--text-strong` |
| I2 | Đã sửa | 4 icon nét trong ô trung tính; ô chọn viền `--border-brand`, nền `--jade-25` |
| I3 | Đã sửa | Bỏ mặt cười ở 4 nút |
| I4 | Đã sửa | `src/components/ui/icon.tsx` thay hàm Icon cục bộ ở 17 tệp; admin giữ `AdminIcon`; ✓/✕ thành `#i-check`/`#i-x` có `aria-hidden` |
| C1 | Đã sửa | H1 "Hôm nay", dòng phụ "Thứ Ba, 17/11/2026" (`home-date.ts`, có test). Timezone: Asia/Ho_Chi_Minh vì `/learning/home` chưa trả timezone hồ sơ |
| C2–C7 | Đã sửa | Đúng chuỗi trong prompt |
| C8 | Đã sửa | Bỏ thẻ "Điểm số của bạn", điểm chỉ ở huy chương |
| C9 | Đã sửa | Ôn tập và Thi thử HSK vào nhóm đã có; FAQ chỉ còn Phát âm và Trợ lý AI |
| C10 | Giữ | Nội dung pháp lý thuộc M2.1f |
| Dấu câu | Đã sửa | Không còn dấu chấm than trong chuỗi UI; nhãn/nút không có dấu chấm cuối; placeholder thanh trên "Tra từ" |
| T1 | Đã sửa | 11 rule thành viết hoa đầu câu, 12–13px, muted, 500 |
| T2 | Đã sửa | 700 → 600/500; bỏ 700 khỏi Inter và Noto Serif (learner, admin); thêm rule `h1–h6, th, strong, b { 600 }` |
| T3 | Đã sửa | Về `--fs-*`/`--adm-fs-*`; không letter-spacing âm |
| T4 | Đã sửa | `numberedToToneMarks` (ü, `ou`, a/e, thanh 5, giữ hoa, idempotent) ở mọi chỗ hiển thị pinyin từ điển và thẻ ôn, kèm unit test |
| Số | Đã sửa | `tabular-nums` cho điểm, phần trăm, đếm, đồng hồ |
| Bố cục | Đã sửa | Hoàn thành bài: "Bài tiếp theo" + "Ôn từ mới"; phiên ôn: "Ôn tiếp" + "Về Ôn tập"; hồ sơ web một thẻ tối đa 720px |
| K1 | Đã sửa | "Sắp có" thành chữ nhỏ không nền. Dùng `--text-muted` thay `--text-subtle` vì subtle chỉ 3,5–3,9:1 |
| K2 | Đã sửa | Bỏ icon và vòng tỷ lệ (màn đã có lịch tháng); thêm mô tả từ dữ liệu thật |
| Bo góc | Đã sửa | Giá trị lẻ về thang token; giữ bo lồng theo mẫu nơi công thức lệch mẫu |
| 田字格 | Đã thêm | CSS mask, không ảnh, chỉ 3 vị trí (thêm ô glyph của chi tiết từ web); ẩn ở forced-colors; `learner-css.spec.ts` chốt selector |
| A1 | Đã sửa | Bỏ confetti lặp |
| A2 | Giữ | Shimmer skeleton admin, thêm tắt khi `prefers-reduced-motion: reduce` |
| Hiệu ứng | Đã sửa | Một `done-rise` (fade + 8px, 360ms, `cubic-bezier(0.22, 1, 0.36, 1)`), tắt khi reduced motion |

## Kiểm tra

Mọi lệnh chạy trong `frontend/`, theo khoá `/tmp/hsk-heavy.lock`.

- Sau mỗi lượt: `npm run lint` 0 lỗi (21–29 warning có sẵn), `npm run typecheck` exit 0, `npx vitest run` toàn bộ pass (lượt cuối: 160 file, 2013 test).
- `npm run test:e2e` lần 1 (sau lượt 9): 985 passed, 31 failed, 50 skipped. 31 lượt fail là 8 test: 2 do unslop làm hỏng thật (dòng thanh bên còn 40px, chip đề đang chọn mất vòng focus ở web), đã sửa ở `66a5f59`; 6 test đã sai từ trước `b90c7b5` (Thi thử và Ôn tập đã là link, tag câu hỏi bị seed đổi tên), đã sửa spec, không xoá hay skip.
- `npm run test:e2e` lần cuối, DB disposable dựng lại: **1016 passed, 0 failed, 50 skipped (30,0 phút), exit 0**, gồm axe `learner-a11y.spec.ts` ở 4 khổ.
- Ảnh SAU: 106/106 (lượt chính 84/88; 4 ảnh chờ chuỗi cũ "Chính xác!" trong bộ chụp, sửa bộ chụp rồi chụp lại 4/4).
- Build: `next build` lần đầu dừng với `SecurityFatalError` (khuyến nghị nâng Next.js 16.4.3 vì lỗ hổng đã biết), chạy lại thì qua. Chưa nâng Next.js.

Ảnh cặp đáng xem: `learn-home-*`, `lesson-complete-*`, `lesson-practice-correct-*`, `review-*`, `review-session-*`, `dictionary-*`, `onboarding-goal-*`, `learn-profile-desktop-1440`, `admin-users-*`, `admin-lesson-edit-mobile-390`, `learn-exam-*`.

Giới hạn đã biết: 田字格 với từ nhiều chữ là một ô giãn theo nội dung (không còn 1:1, xuống dòng khi hẹp); từ 1–2 chữ vẫn vuông.

## Cách chụp lại

Bộ chụp Playwright riêng (không commit): cấu hình `pw.config.ts` + `unslop.spec.ts`, chọn thư mục bằng `SHOTS_DIR`, chạy với backend test trên DB disposable.

## Cần PO quyết

Xem Q340 trong `docs/product/learner-ui-decisions.md`.
