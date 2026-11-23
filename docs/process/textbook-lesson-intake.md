# Mẫu nhập nội dung bài giáo trình

Tài liệu này dành cho người soạn nội dung (PO), không cần biết lập trình. Mỗi bài trong sách
giáo trình được điền theo mẫu dưới đây rồi gửi cho đội kỹ thuật. Đội kỹ thuật chuyển mẫu thành
file nạp và chạy bộ kiểm tra tự động trước khi đưa lên CMS ở trạng thái **nháp**. Người học chưa
thấy bài cho tới khi bài được duyệt và xuất bản.

Liên quan:
- Thiết kế khoá học: [ADR-009](../adr/ADR-009-COURSE-TEXTBOOK-CURRICULUM.md).
- Quy trình nạp hiện có cho bài chủ đề HSK1: [content-pipeline.md](content-pipeline.md).

> Trạng thái: mẫu đề xuất, đi cùng ADR-009 (Proposed). Tên cột có thể đổi nhẹ khi bộ nhập giáo
> trình được làm; mọi thay đổi sẽ ghi lại ở đây.

> **HSK 2.0 (23/11/2026):** giáo trình HSK chuẩn 2.0 đã có sẵn trong `seeddata/` (từ vựng,
> nghĩa tiếng Việt, bài khoá, ngữ pháp). PO **không cần điền mẫu này** cho HSK 2.0: đội kỹ thuật
> chạy bộ chuyển ở [content-pipeline.md §9](content-pipeline.md#9-profile-textbook-giáo-trình-hsk-20-m213a).
> Mẫu dưới đây dùng cho giáo trình chưa có dữ liệu (HSK 3.0 cấp 1–4, chuyên ngành).

## 1. Một bài gồm những gì

| Phần | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Thông tin bài | Có | Khoá, cấp, tập, số bài, tên bài tiếng Trung và tiếng Việt |
| Từ vựng | Có (ít nhất 1 từ) | Chỉ chữ Hán là bắt buộc; các cột khác để trống thì hệ thống tự lấy từ từ điển |
| Ngữ pháp | Không | Mỗi điểm ngữ pháp: tên, giải thích, ví dụ |
| Bài khoá | Không | Từng câu: người nói, chữ Hán, pinyin, dịch tiếng Việt |

Bài tập (trắc nghiệm, điền từ, sắp xếp câu, ghép cặp) không nằm trong mẫu này. Đội kỹ thuật soạn
bài tập từ nội dung bài, PO duyệt trên CMS.

### 1.1. Thông tin bài

| Trường | Bắt buộc | Ví dụ | Giải thích |
| --- | --- | --- | --- |
| `khoa_hoc` | Có | `HSK 2.0` | Tên khoá giáo trình: `HSK 2.0` hoặc `HSK 3.0` |
| `cap` | Có | `3` | Số cấp của sách: 1–6 với HSK 2.0, 1–4 với HSK 3.0 (cấp 5–9 khi sách ra) |
| `tap` | Không | `上` | Tập sách: `上`, `下`, hoặc để trống khi cấp đó chỉ có một quyển |
| `so_bai` | Có | `7` | Số thứ tự bài trong tập (hoặc trong cấp nếu không chia tập) |
| `ten_bai_zh` | Có | `周末去超市` | Tên bài bằng chữ Hán |
| `ten_bai_vi` | Có | `Cuối tuần đi siêu thị` | Tên bài tiếng Việt |

### 1.2. Từ vựng

Mỗi dòng một từ, theo thứ tự xuất hiện trong bài.

| Cột | Bắt buộc | Khi để trống |
| --- | --- | --- |
| `chu_han` | Có | — |
| `pinyin` | Không | Lấy từ từ điển. Nếu chữ có nhiều cách đọc (ví dụ 还 hái / huán) thì **phải** điền để hệ thống chọn đúng nghĩa |
| `tu_loai` | Không | Lấy từ từ điển nếu có, không thì để trống |
| `nghia_vi` | Không | Lấy nghĩa tiếng Việt đã duyệt trong từ điển |
| `cau_vi_du` | Không | Lấy câu ví dụ đã duyệt nếu có; không có thì thẻ từ không hiện ví dụ |
| `cau_vi_du_vi` | Khi có `cau_vi_du` | Dịch câu ví dụ |

Không cần ghi cấp HSK của từ: từ đi theo bài, nên bài cấp 3 có thể có từ cấp 4.

Từ chưa có trong từ điển của hệ thống: bộ kiểm tra báo danh sách. Đội kỹ thuật tạo bản nháp cho
các từ đó, PO duyệt nghĩa rồi bài mới xuất bản được (xem ADR-009, mục 6).

### 1.3. Ngữ pháp

| Cột | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `ma_diem` | Có | Mã ngắn trong bài: `g1`, `g2`… để các dòng ví dụ trỏ về |
| `ten_diem` | Có | Ví dụ `Động từ + 一下` |
| `cau_truc` | Không | Ví dụ `Chủ ngữ + động từ + 一下 (+ tân ngữ)` |
| `giai_thich_vi` | Có | Giải thích bằng tiếng Việt |
| `vi_du_zh` | Có (ít nhất 1) | Mỗi ví dụ một dòng, cùng `ma_diem` |
| `vi_du_pinyin` | Có | Pinyin có dấu thanh |
| `vi_du_vi` | Có | Dịch tiếng Việt |

### 1.4. Bài khoá

Mỗi câu một dòng, theo thứ tự hội thoại.

| Cột | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `doan` | Không | Số đoạn hội thoại (`1`, `2`…) khi bài có nhiều đoạn |
| `nguoi_noi` | Có | Tên hoặc vai: `A`, `B`, `小王`… |
| `chu_han` | Có | Một câu |
| `pinyin` | Có | Có dấu thanh, các âm tiết của một từ viết liền (Q354) |
| `dich_vi` | Có | Dịch tiếng Việt |

## 2. Hai cách nộp

### 2.1. Bảng tính (khuyến nghị)

Mỗi bài một file `.xlsx` hoặc Google Sheets, đặt tên theo dạng `HSK2-cap3-tap上-bai07.xlsx`. File có
bốn sheet. **Giữ nguyên tên sheet và tên cột**: hàng 1 là tên cột, không gộp ô, không thêm cột.

| Sheet | Cột (đúng thứ tự) |
| --- | --- |
| `thong_tin` | `truong`, `gia_tri` (mỗi trường ở mục 1.1 là một dòng) |
| `tu_vung` | `chu_han`, `pinyin`, `tu_loai`, `nghia_vi`, `cau_vi_du`, `cau_vi_du_vi` |
| `ngu_phap` | `ma_diem`, `ten_diem`, `cau_truc`, `giai_thich_vi`, `vi_du_zh`, `vi_du_pinyin`, `vi_du_vi` |
| `bai_khoa` | `doan`, `nguoi_noi`, `chu_han`, `pinyin`, `dich_vi` |

Ở sheet `ngu_phap`, dòng đầu của mỗi điểm điền đủ tên, cấu trúc và giải thích. Các dòng ví dụ tiếp
theo chỉ cần `ma_diem` và ba cột ví dụ.

### 2.2. Văn bản theo khuôn mẫu

Dùng khi không tiện mở bảng tính. Giữ nguyên các dòng tiêu đề `##` và ký hiệu `|` ngăn cột:

```text
## THÔNG TIN
khoa_hoc: ...
cap: ...
tap: ...
so_bai: ...
ten_bai_zh: ...
ten_bai_vi: ...

## TỪ VỰNG
chu_han | pinyin | tu_loai | nghia_vi | cau_vi_du | cau_vi_du_vi

## NGỮ PHÁP
[g1] ten_diem | cau_truc
giải thích tiếng Việt (có thể nhiều dòng)
- vi_du_zh | vi_du_pinyin | vi_du_vi

## BÀI KHOÁ
[đoạn 1]
nguoi_noi: chu_han | pinyin | dich_vi
```

## 3. Ví dụ điền sẵn

Nội dung dưới đây do đội kỹ thuật **tự soạn** để minh hoạ cách điền, không lấy từ sách giáo trình
nào. Số cấp, tập và số bài chỉ là ví dụ.

```text
## THÔNG TIN
khoa_hoc: HSK 2.0
cap: 3
tap: 上
so_bai: 7
ten_bai_zh: 周末去超市
ten_bai_vi: Cuối tuần đi siêu thị

## TỪ VỰNG
超市 | chāoshì | danh từ | siêu thị | 我家旁边有一个超市。 | Cạnh nhà tôi có một siêu thị.
周末 |  |  |  |  |
水果 | shuǐguǒ |  | hoa quả |  |
还 | hái | phó từ | còn, vẫn |  |
一下 |  |  |  |  |

## NGỮ PHÁP
[g1] Động từ + 一下 | Chủ ngữ + động từ + 一下 (+ tân ngữ)
Thêm 一下 sau động từ để nói hành động diễn ra nhanh, nhẹ nhàng, giọng mềm hơn.
- 你看一下这个。 | Nǐ kàn yíxià zhège. | Bạn xem cái này một chút.
- 我们休息一下吧。 | Wǒmen xiūxi yíxià ba. | Chúng ta nghỉ một chút nhé.

## BÀI KHOÁ
[đoạn 1]
A: 周末你想去哪儿？ | Zhōumò nǐ xiǎng qù nǎr? | Cuối tuần bạn muốn đi đâu?
B: 我想去超市买水果。 | Wǒ xiǎng qù chāoshì mǎi shuǐguǒ. | Tôi muốn đi siêu thị mua hoa quả.
A: 我也去，你等我一下。 | Wǒ yě qù, nǐ děng wǒ yíxià. | Tôi cũng đi, bạn đợi tôi một chút.
```

Dòng `周末` và `一下` chỉ có chữ Hán: hệ thống tự điền pinyin và nghĩa từ từ điển. Dòng `还` có
điền `pinyin` vì chữ này có hai cách đọc.

## 4. Kiểm tra tự động

Bộ kiểm tra chạy trước khi nạp, báo lỗi bằng tiếng Việt kèm vị trí (sheet, dòng). Bài có lỗi
không được nạp.

| Kiểm tra | Khi nào báo lỗi |
| --- | --- |
| Thiếu trường bắt buộc | Thiếu khoá, cấp, số bài, tên bài; dòng từ vựng không có chữ Hán; câu bài khoá thiếu người nói |
| Trùng từ trong bài | Cùng chữ Hán và cùng pinyin xuất hiện hai lần |
| Trùng số bài | Cùng khoá, cấp, tập đã có bài mang số này |
| Pinyin sai thanh | Pinyin không có dấu thanh, hoặc không khớp cách đọc nào của chữ đó trong từ điển |
| Chữ đa âm chưa chọn | Chữ có nhiều cách đọc nhưng cột `pinyin` để trống |
| Từ chưa có trong từ điển | Báo danh sách để tạo bản nháp và duyệt (không chặn bản nháp, chặn xuất bản) |
| Câu thiếu bản dịch | Câu bài khoá, ví dụ ngữ pháp hoặc câu ví dụ từ thiếu dịch tiếng Việt |
| Pinyin lệch chữ Hán | Số âm tiết pinyin khác số chữ Hán của câu (bỏ qua dấu câu) |
| Ký tự lạ | Chữ Hán phồn thể khi khoá dùng giản thể, ký tự điều khiển, khoảng trắng thừa |
| Điểm ngữ pháp không có ví dụ | Mã điểm không có dòng ví dụ nào |

## 5. Bản quyền

- PO đã quyết dùng **nguyên văn sách** cho bài khoá (23/11/2026).
- Mỗi khoá học có một công tắc bản quyền do PO hoặc admin bật/tắt trên CMS. Khi tắt, bài khoá của
  cả khoá bị ẩn với người học ngay lập tức, nhưng **không bị xoá**: nội dung, tiến độ và lịch sử
  làm bài vẫn được giữ, bật lại là hiện lại (ADR-001, ADR-009 mục 5).
- Công tắc không chặn việc nạp hay xuất bản. Trách nhiệm bản quyền của nội dung nguyên văn thuộc
  về quyết định của PO (rủi ro ghi ở ADR-009, mục Consequences).
