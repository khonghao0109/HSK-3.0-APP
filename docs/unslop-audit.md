# Unslop audit: Hán Lộ web người học và web admin

Ngày 17/11/2026 · macdev `b90c7b5` · 49 trang × 2 khổ (1440px, 390px) · quy trình theo skill unslop (heydamir/unslop, CC BY 4.0)

## Mức độ

**Light slop, áp dụng chế độ đánh bóng (polish).** Hán Lộ đã có thương hiệu thật: tên Hán Lộ 汉路, navy và jade, giấy kem, đèn lồng thuỷ mặc ở trang chào, Noto Serif cho tiêu đề và chữ Hán. Không có gradient tím, chữ gradient hay glow. Vì vậy định hướng lấy từ thương hiệu sẵn có và giữ nguyên palette, bố cục, minh hoạ. Chỉ sửa các dấu hiệu dưới đây. Phần admin gần như sạch, chỉ cần chỉnh nhỏ.

## Danh sách dấu hiệu

### Câu chữ
| # | Dấu hiệu | Vị trí |
|---|---|---|
| C1 | Tiêu đề chào hỏi "Chào bạn" kèm "Hôm nay cùng tiến bộ nhé!" | Trang chủ, `app/(learner)/learn/page.tsx:127` |
| C2 | Dấu chấm than trong giao diện: "Chúc mừng! Bạn đã hoàn thành bài học" | `learn/lessons/[id]/complete/page.tsx:121` |
| C3 | "Chúc mừng! Bạn đã hoàn thành phiên ôn tập" | `features/learner-review/review-session.tsx:673` |
| C4 | "Bạn đã đạt!" | `features/learner-exam/exam-result-model.ts:62` |
| C5 | "Chính xác!" và icon pháo hoa ở phản hồi bài tập | `features/learner-lesson/lesson-player.tsx:31` |
| C6 | "Làm tốt lắm!" | `features/learner-exam/exam-review-model.ts:127` |
| C7 | "Mẹo: Hãy ôn tập thường xuyên để ghi nhớ lâu hơn!" | Phiên ôn tập, khổ 390px |
| C8 | Điểm số lặp hai lần (90% trong huy chương và 90% trong thẻ "Điểm số của bạn") | Màn hoàn thành bài |
| C9 | Trang giới thiệu vẫn ghi Ôn tập và Thi thử là "Sắp có" | `features/learner-landing/learner-landing-content.ts:115-116` |
| C10 | Trang Điều khoản và Bảo mật chỉ có dòng "Nội dung đang được cập nhật" | `/terms`, `/privacy` |

### Màu sắc và bề mặt
| # | Dấu hiệu | Vị trí |
|---|---|---|
| M1 | Mỗi ô Khám phá có icon một màu riêng (đỏ, xanh, tím, vàng, cam), làm mọi thứ đều nổi | Trang chủ |
| M2 | Ba dòng Từ vựng / Ngữ pháp / Luyện tập có ô icon tím, tím nhạt, xanh dương nằm ngoài palette | Trang bài học |
| M3 | Bốn nút đánh giá ôn tập dùng bốn màu (đỏ, cam, xanh lá, xanh ngọc) kèm mặt cười | Phiên ôn tập |
| M4 | Màn hoàn thành bài: nền navy, confetti nhiều màu, vòng nguyệt quế vàng | `.done-hero`, `.done-confetti` |
| M5 | Nút "Xoá tài khoản" màu đỏ đặc lặp ở mọi dòng | Admin, Người dùng |
| M6 | Khoảng 145 mã màu hex viết thẳng ngoài token (nhiều nhất ở `learner.css`, `exam-list.css`, `review-overview.css`) | CSS |

### Icon và minh hoạ
| # | Dấu hiệu | Vị trí |
|---|---|---|
| I1 | Icon ngọn lửa nhiều màu cho chuỗi ngày học | Trang chủ, thanh trên |
| I2 | Icon 3D nhiều màu (bong bóng chat, mũ tốt nghiệp, sách, cặp) | Onboarding: mục tiêu |
| I3 | Mặt cười trong nút đánh giá ôn tập | Phiên ôn tập |
| I4 | 22 hàm `Icon` cục bộ viết lặp lại, không có bộ icon chung cho phía người học | `app/(learner)/**/page.tsx` |

### Kiểu chữ
| # | Dấu hiệu | Vị trí |
|---|---|---|
| T1 | Nhãn VIẾT HOA giãn chữ: nhóm "LUYỆN THÊM" ở thanh bên, dòng tên bài phía trên câu hỏi luyện tập, kicker trang thi, tiêu đề cột từ điển, mục lục trang pháp lý, bảng nhập dữ liệu admin | `.w-side__group`, `.pq-kicker`, `.exi-kicker`, `.exr-kicker`, `.exv-kicker`, `.tk-part`, `.dict-web__cols`, `.legal__toc-title`, `.adm-import-table th`, `.tst-panel__eyebrow` (11 rule) |
| T2 | Khoảng 150 rule dùng font-weight 700 cho tiêu đề, nhãn và số | Nhiều file |
| T3 | Cỡ chữ lẻ ngoài thang (10.56, 11.18, 12.32, 15.2, 20.8px) | `learner.css`, `admin.css` |
| T4 | Pinyin hiển thị dạng số ("xie4 xie5") ở từ điển, trong khi bài học dùng dấu thanh | `features/learner-dictionary/dictionary-display.ts:29` |

### Khoảng cách
| # | Dấu hiệu | Vị trí |
|---|---|---|
| S1 | 457/1006 giá trị padding, margin, gap không nằm trên lưới 4px (ví dụ 3.7, 5.6, 7, 11, 13px), 314 giá trị trong số đó ở `learner.css` | CSS |
| S2 | Ô "Thi thử" ở mục Khám phá không có kiểu thẻ (CSS chỉ áp cho `button`) | `learner.css:2251`, `learner-web.css:628` |
| S3 | Thanh nút ôn tập nằm giữa màn ở 390px, nửa dưới bỏ trống | Phiên ôn tập |
| S4 | Màn admin sửa bài học tràn ngang 180px ở 390px | `admin-content-editor.css:64` |

### Chuyển động
| # | Dấu hiệu | Vị trí |
|---|---|---|
| A1 | Confetti lặp vô hạn (`done-confetti-float … infinite alternate`) | `learner.css:3819` |
| A2 | Skeleton admin có hiệu ứng shimmer lặp. Hợp lệ khi đang tải, giữ nguyên. | `admin.css:940` |

### Thành phần
| # | Dấu hiệu | Vị trí |
|---|---|---|
| K1 | Nhãn vàng "Sắp có" lặp ở thanh bên, ô tra từ (viết tay, ảnh chụp, giọng nói), tra gần đây | Thanh bên, Từ điển |
| K2 | Thẻ thống kê ôn tập có vòng tròn và icon trang trí cạnh con số | Ôn tập |

## Định hướng

- **Sản phẩm:** Hán Lộ giúp người Việt học, ôn và thi thử tiếng Trung theo chuẩn HSK 3.0, và cho người biên soạn quản trị nội dung bài học, câu hỏi, đề thi.
- **Tính cách:** điềm tĩnh, chuẩn mực, ấm như sách giáo khoa giấy.
- **Thế giới:** trang vở luyện chữ: giấy kem, mực navy, dấu son jade, tranh thuỷ mặc đã có ở trang chào.
- **Điểm nhấn:** (1) chính chữ Hán: chữ lớn ở thẻ từ, flashcard và đáp án, viết bằng Noto Serif SC trên nền giấy; (2) con số kết quả: điểm thi, phần trăm hoàn thành và thanh kỹ năng. Mọi thứ khác lùi về nền trung tính và chỉ dùng một màu nhấn jade.
- **Chi tiết đặc trưng:** ô chữ điền 田字格 (khung vuông có đường chia mảnh) phía sau chữ Hán lớn ở thẻ từ, flashcard và chi tiết từ. Chỉ dùng ở các vị trí này.

## Kế hoạch 9 lượt (khi được duyệt)
1. **Khoảng cách:** đưa giá trị lẻ về lưới 4px; sửa ô "Thi thử"; thanh nút ôn tập dính đáy ở 390px; sửa tràn ngang ở màn admin.
2. **Màu:** icon Khám phá và dòng nội dung bài học dùng màu chữ phụ trên nền trung tính; nút đánh giá ôn tập trung tính, chỉ "Chưa nhớ" có sắc đỏ nhẹ; màn hoàn thành bỏ confetti nhiều màu và vòng vàng; nút "Xoá tài khoản" ở admin thành nút viền; thay hex lẻ bằng token.
3. **Icon:** bỏ mặt cười ở nút đánh giá; ngọn lửa thành icon nét một màu; icon onboarding thành icon nét; gom 22 hàm `Icon` thành một component dùng chung.
4. **Câu chữ:** sửa C1–C9 (ví dụ "Chào bạn" thành tên trang hoặc ngày; bỏ dấu chấm than; điểm số chỉ hiện một lần); cập nhật trang giới thiệu; cập nhật test có chứa câu chữ cũ.
5. **Kiểu chữ:** nhãn viết hoa thành viết thường đầu câu; giảm độ đậm 700 xuống 600 hoặc 500; dùng thang cỡ chữ; pinyin hiển thị có dấu thanh.
6. **Bố cục:** giữ nguyên cấu trúc ui_reference đã được PO duyệt; chỉ cân lại màn hoàn thành bài và trang hồ sơ.
7. **Chi tiết:** nhãn "Sắp có" thành chữ mờ nhỏ, không dùng nền vàng; bo góc lồng nhau; bỏ vòng tròn trang trí ở thẻ thống kê ôn tập.
8. **Hình ảnh:** giữ đèn lồng thuỷ mặc ở trang chào; thêm ô 田字格 làm chi tiết đặc trưng.
9. **Chuyển động:** bỏ confetti lặp; giữ một hiệu ứng hiện nhẹ khi mở màn hoàn thành.

## Lưu ý
Nhiều điểm trên đến từ bản mẫu `docs/ui_reference` đã được PO duyệt (Q-number trong `docs/product/learner-ui-decisions.md`), ví dụ lời chào ở trang chủ hay confetti ở màn hoàn thành. Muốn đổi những điểm này cần PO đồng ý, và nên cập nhật bản mẫu ui_reference/Figma cho khớp.
