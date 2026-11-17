# Danh sách ảnh lát cắt Bài 1 + Đề thi thử HSK1 (chờ PO duyệt trước khi tạo)

Công cụ: Figma AI `generate_image` (Q350). Tổng **17 ảnh** (giới hạn 25): 10 cho Bài 1, 7 cho đề.
Ảnh lưu ở `~/hsk-media/hsk1-slice/images/` (PNG; media pipeline chỉ nhận PNG/JPG), sha256 ghi vào
`backend/content/hsk1/media/checksums.json`. Mỗi ảnh ghi "minh hoạ do AI tạo (Figma AI)" trong `Media.metadata` và
`DataSource`.

**Phong cách chung (gắn trước mọi prompt):**

> Flat vector illustration, simple geometric shapes, light cream paper background (#FBF7EF), deep navy (#0D3152) and jade green (#00A878) as main colors with soft neutral skin tones, friendly modern educational style, consistent line weight, no text, no letters, no numbers, no Chinese characters, no logos, no watermark.

Ảnh ghép của đề thêm: *"Composite image with N equal panels in a row (or 2 rows of 3), thin light gaps between
panels, each panel labelled with one capital letter (A, B, C…) in a small navy circle at its top-left corner; these
letters are the only text in the image."*

## Bài 1 (10 ảnh, khổ 1024×1024, ảnh bìa 1536×1024)

| # | Khoá | Nội dung | Prompt (sau phần phong cách) |
|---|---|---|---|
| 1 | `l01-cover` | Bìa Bài 1: chào hỏi | A young female teacher and a male student greeting each other with a smile and a small wave in a bright classroom, blank blackboard behind them. |
| 2 | `l01-laoshi` | 老师 (giáo viên) | A friendly female teacher standing beside a blank blackboard holding a book. |
| 3 | `l01-xuesheng` | 学生 (học sinh) | A student with a backpack holding a notebook, walking to school. |
| 4 | `l01-tongxue` | 同学 (bạn học) | Two classmates sitting side by side at school desks, looking at the same book. |
| 5 | `l01-pengyou` | 朋友 (bạn bè) | Two friends smiling and standing shoulder to shoulder in a park. |
| 6 | `l01-renshi` | 认识 (quen biết) | Two adults meeting for the first time and shaking hands, both smiling. |
| 7 | `l01-gaoxing` | 高兴 (vui) | A happy young person smiling widely with arms raised in joy. |
| 8 | `l01-xiexie` | 谢谢 (cảm ơn) | One person handing a small gift box to another person who bows slightly with a grateful smile. |
| 9 | `l01-zaijian` | 再见 (tạm biệt) | A person standing at a doorway waving goodbye to a friend who is leaving. |
| 10 | `l01-women` | 我们 (chúng tôi) | A small group of three friends standing together, each gesturing toward the group, cheerful. |

Ghi chú: không vẽ 中国/中国人 (tránh hình ảnh rập khuôn về quốc gia, cờ, trang phục); 名字, 什么, 是, đại từ không
vẽ được.

**Chặn kỹ thuật cần sửa trước khi ảnh hiện ở Bài 1:** `Word.imageId`, `Lesson.coverImageId` chưa có endpoint gán,
và trình hiển thị topic (M2.5f) chưa render ảnh. Phần này sẽ làm trong PR lát cắt, kèm test.

## Đề thi thử (7 ảnh ghép)

| # | Khoá | Dùng cho | Khổ | Các tranh |
|---|---|---|---|---|
| 11 | `img-l1-q01` | hsk1:q0001 | 1536×512 (3 tranh một hàng) | **A** A woman sitting at a table drinking tea from a cup<br>**B** A woman eating a bowl of noodles with chopsticks<br>**C** A woman reading a book on a sofa |
| 12 | `img-l1-q02` | hsk1:q0002 | 1536×512 (3 tranh một hàng) | **A** A sunny street with a bright sun in the sky<br>**B** A person holding an umbrella in heavy rain<br>**C** Trees bending in strong wind under grey clouds, no rain |
| 13 | `img-l1-q03` | hsk1:q0003 | 1536×512 (3 tranh một hàng) | **A** A man riding a bicycle on a road<br>**B** A man walking on a sidewalk<br>**C** A man driving a car, seen through the side window |
| 14 | `img-l1-q04` | hsk1:q0004 | 1536×512 (3 tranh một hàng) | **A** A school backpack on a shop shelf<br>**B** A pair of shoes on a shop shelf<br>**C** A wall clock on a shop shelf |
| 15 | `img-l1-q05` | hsk1:q0005 | 1536×512 (3 tranh một hàng) | **A** A woman cooking at a stove<br>**B** A woman sleeping in bed<br>**C** A woman watching television |
| 16 | `img-l3` | hsk1:q0011, hsk1:q0012, hsk1:q0013, hsk1:q0014, hsk1:q0015 | 1536×1024 (2 hàng × 3) | **A** A doctor in a white coat examining a sick man in a hospital room<br>**B** Two travellers with suitcases walking to a train at a railway platform<br>**C** A girl at a desk writing with a pen in a notebook, page shown blank from this angle<br>**D** A man paying a shopkeeper for a bag of fruit<br>**E** Two friends eating dinner together at a restaurant table with dishes<br>**F** A boy kicking a football on a grass field |
| 17 | `img-r1` | hsk1:q0021, hsk1:q0022, hsk1:q0023, hsk1:q0024, hsk1:q0025 | 1536×1024 (2 hàng × 3) | **A** A small child drinking a glass of milk at a kitchen table<br>**B** A man talking on a mobile phone<br>**C** A family sitting on a sofa watching television<br>**D** A woman choosing clothes on a rack in a clothing shop<br>**E** A teacher standing at a blank blackboard in front of students in a classroom<br>**F** An airplane flying in a blue sky |

## Việc của PO

1. Duyệt danh sách và prompt (sửa trực tiếp file này hoặc comment PR).
2. Sau khi duyệt, agent tạo ảnh, kiểm từng ảnh (không có chữ ngoài nhãn, khớp nghĩa), ghi checksum, rồi đưa vào
   `docs/content/slice-review.md` để PO xem lần cuối trước khi nạp.
