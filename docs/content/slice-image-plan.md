# Danh sách ảnh lát cắt Bài 1 + Đề thi thử HSK1

PO duyệt 18/11/2026, kèm hai sửa: (a) AI **không** vẽ nhãn chữ; mỗi tranh tạo riêng, script ghép và tự thêm nhãn
A/B/C, ô bằng nhau; (b) mỗi ảnh có alt tiếng Việt, ảnh ghép thì alt liệt kê từng tranh. Giới hạn Figma AI: 40 ảnh.

Công cụ: Figma AI `generate_image` (Q350). Số lần tạo: **37** (10 cho Bài 1, 27 tranh lẻ cho
7 ảnh ghép của đề). Ảnh lẻ lưu ở `~/hsk-media/hsk1-slice/images/raw/`, ảnh ghép ở
`~/hsk-media/hsk1-slice/images/` (PNG; media pipeline chỉ nhận PNG/JPG). Ghép bằng
`backend/scripts/content/compose-exam-images.sh` (ImageMagick). Sha256 ghi vào `backend/content/hsk1/media/checksums.json`.
Mỗi ảnh ghi "minh hoạ do AI tạo (Figma AI)" trong `Media.metadata` và `DataSource`. Nguồn máy đọc:
`backend/content/hsk1/media/lesson-01-images.json` và mục `images` trong `backend/content/hsk1/exam/mock-01.json`.

**Phong cách chung (gắn trước mọi prompt):**

> Flat vector illustration, simple geometric shapes, light cream paper background (#FBF7EF), deep navy (#0D3152) and jade green (#00A878) as main colors with soft neutral skin tones, friendly modern educational style, consistent line weight, no text, no letters, no numbers, no Chinese characters, no logos, no watermark.

## Bài 1 (10 ảnh)

| # | Khoá | Từ | Prompt (sau phần phong cách) | Alt |
|---|---|---|---|---|
| 1 | `l01-cover` | bìa bài | A young female teacher and a male student greeting each other with a smile and a small wave in a bright classroom, blank blackboard behind them. | Cô giáo và nam học sinh mỉm cười chào nhau trong lớp học. |
| 2 | `l01-laoshi` | 老师 | A friendly female teacher standing beside a blank blackboard holding a book. | Cô giáo đứng cạnh bảng, tay cầm sách. |
| 3 | `l01-xuesheng` | 学生 | A student with a backpack holding a notebook, walking to school. | Học sinh đeo cặp, cầm vở đi học. |
| 4 | `l01-tongxue` | 同学 | Two classmates sitting side by side at school desks, looking at the same book. | Hai bạn học ngồi cạnh nhau cùng xem một quyển sách. |
| 5 | `l01-pengyou` | 朋友 | Two friends smiling and standing shoulder to shoulder in a park. | Hai người bạn đứng cạnh nhau mỉm cười trong công viên. |
| 6 | `l01-renshi` | 认识 | Two adults meeting for the first time and shaking hands, both smiling. | Hai người lần đầu gặp nhau, bắt tay và mỉm cười. |
| 7 | `l01-gaoxing` | 高兴 | A happy young person smiling widely with arms raised in joy. | Một bạn trẻ cười tươi, giơ hai tay vui mừng. |
| 8 | `l01-xiexie` | 谢谢 | One person handing a small gift box to another person who bows slightly with a grateful smile. | Một người tặng hộp quà, người kia cúi nhẹ cảm ơn. |
| 9 | `l01-zaijian` | 再见 | A person standing at a doorway waving goodbye to a friend who is leaving. | Một người đứng ở cửa vẫy tay tạm biệt bạn. |
| 10 | `l01-women` | 我们 | A small group of three friends standing together, each gesturing toward the group, cheerful. | Ba người bạn đứng cùng nhau, vui vẻ. |

Không vẽ 中国/中国人 (tránh hình rập khuôn quốc gia); 名字, 什么, 是, đại từ không vẽ được.

## Đề thi thử (7 ảnh ghép từ 27 tranh)

Mỗi tranh lẻ 1024×1024. Ảnh 3 tranh: một hàng, ô bằng nhau; ảnh 6 tranh: 2 hàng × 3. Nhãn A–F do script vẽ.

| Ảnh ghép | Dùng cho | Tranh | Prompt (sau phần phong cách) | Alt |
|---|---|---|---|---|
| `img-l1-q01` | hsk1:q0001 | A | A woman sitting at a table drinking tea from a cup | Người phụ nữ ngồi bên bàn uống trà |
| `img-l1-q01` | hsk1:q0001 | B | A woman eating a bowl of noodles with chopsticks | Người phụ nữ ăn bát mì bằng đũa |
| `img-l1-q01` | hsk1:q0001 | C | A woman reading a book on a sofa | Người phụ nữ đọc sách trên ghế sofa |
| `img-l1-q02` | hsk1:q0002 | A | A sunny street with a bright sun in the sky | Con phố ngày nắng, mặt trời sáng |
| `img-l1-q02` | hsk1:q0002 | B | A person holding an umbrella in heavy rain | Một người cầm ô dưới mưa to |
| `img-l1-q02` | hsk1:q0002 | C | Trees bending in strong wind under grey clouds, no rain | Cây nghiêng trong gió mạnh, trời nhiều mây, không mưa |
| `img-l1-q03` | hsk1:q0003 | A | A man riding a bicycle on a road | Người đàn ông đạp xe trên đường |
| `img-l1-q03` | hsk1:q0003 | B | A man walking on a sidewalk | Người đàn ông đi bộ trên vỉa hè |
| `img-l1-q03` | hsk1:q0003 | C | A man driving a car, seen through the side window | Người đàn ông lái ô tô |
| `img-l1-q04` | hsk1:q0004 | A | A school backpack on a shop shelf | Chiếc cặp sách trên kệ cửa hàng |
| `img-l1-q04` | hsk1:q0004 | B | A pair of shoes on a shop shelf | Đôi giày trên kệ cửa hàng |
| `img-l1-q04` | hsk1:q0004 | C | A round wall clock without numbers on a shop shelf | Đồng hồ treo tường trên kệ cửa hàng |
| `img-l1-q05` | hsk1:q0005 | A | A woman cooking at a stove | Người phụ nữ nấu ăn bên bếp |
| `img-l1-q05` | hsk1:q0005 | B | A woman sleeping in bed | Người phụ nữ ngủ trên giường |
| `img-l1-q05` | hsk1:q0005 | C | A woman watching a television with a plain blank screen | Người phụ nữ xem tivi |
| `img-l3` | hsk1:q0011, hsk1:q0012, hsk1:q0013, hsk1:q0014, hsk1:q0015 | A | A doctor in a white coat examining a sick man in a hospital room | Bác sĩ áo trắng khám cho người đàn ông bị ốm |
| `img-l3` | hsk1:q0011, hsk1:q0012, hsk1:q0013, hsk1:q0014, hsk1:q0015 | B | Two travellers with suitcases walking to a train at a railway platform | Hai hành khách kéo vali ra tàu hoả ở sân ga |
| `img-l3` | hsk1:q0011, hsk1:q0012, hsk1:q0013, hsk1:q0014, hsk1:q0015 | C | A girl at a desk writing with a pen in a notebook, page shown blank from this angle | Bé gái ngồi viết vào vở |
| `img-l3` | hsk1:q0011, hsk1:q0012, hsk1:q0013, hsk1:q0014, hsk1:q0015 | D | A man paying a shopkeeper for a bag of fruit | Người đàn ông trả tiền mua túi hoa quả |
| `img-l3` | hsk1:q0011, hsk1:q0012, hsk1:q0013, hsk1:q0014, hsk1:q0015 | E | Two friends eating dinner together at a restaurant table with dishes | Hai người bạn ăn tối ở nhà hàng |
| `img-l3` | hsk1:q0011, hsk1:q0012, hsk1:q0013, hsk1:q0014, hsk1:q0015 | F | A boy kicking a football on a grass field | Cậu bé đá bóng trên sân cỏ |
| `img-r1` | hsk1:q0021, hsk1:q0022, hsk1:q0023, hsk1:q0024, hsk1:q0025 | A | A small child drinking a glass of milk at a kitchen table | Em bé uống cốc sữa bên bàn bếp |
| `img-r1` | hsk1:q0021, hsk1:q0022, hsk1:q0023, hsk1:q0024, hsk1:q0025 | B | A man talking on a mobile phone | Người đàn ông nói chuyện điện thoại |
| `img-r1` | hsk1:q0021, hsk1:q0022, hsk1:q0023, hsk1:q0024, hsk1:q0025 | C | A family sitting on a sofa watching a television with a plain blank screen | Gia đình ngồi trên sofa xem tivi |
| `img-r1` | hsk1:q0021, hsk1:q0022, hsk1:q0023, hsk1:q0024, hsk1:q0025 | D | A woman choosing clothes on a rack in a clothing shop | Người phụ nữ chọn quần áo trong cửa hàng |
| `img-r1` | hsk1:q0021, hsk1:q0022, hsk1:q0023, hsk1:q0024, hsk1:q0025 | E | A teacher standing at a blank blackboard in front of students in a classroom | Cô giáo đứng trước bảng, học sinh ngồi học |
| `img-r1` | hsk1:q0021, hsk1:q0022, hsk1:q0023, hsk1:q0024, hsk1:q0025 | F | An airplane flying in a blue sky | Máy bay bay trên trời xanh |

Alt ảnh ghép = các alt tranh nối theo nhãn, ví dụ "A: …; B: …; C: …" (trường `altVi` của ảnh).
