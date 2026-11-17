# Duyệt lát cắt Bài 1 + Đề thi thử HSK1

Người duyệt: PO (Q353). Agent không approve hay publish. File này được bổ sung dần theo từng bước.

## 1. Lời thoại 20 câu Nghe (duyệt trước khi sinh audio)

Nguồn: `backend/content/hsk1/exam/mock-01.json`. Giọng nữ `zh-CN-XiaoxiaoNeural`, nam `zh-CN-YunxiNeural`, tốc độ chuẩn,
nghỉ 600 ms giữa các lượt. Manifest: `backend/content/hsk1/audio/slice-01.json` (60 file: 20 câu nghe, 20 từ, 20 câu
ví dụ Bài 1). Dry-run: `npm run content:tts -- --manifest content/hsk1/audio/slice-01.json --dry-run` → 60 file sẽ sinh.

Checklist mỗi câu: đúng chữ Hán, đúng pinyin và thanh, câu tự nhiên, bản dịch đúng, đáp án duy nhất.

### Phần 1 (L1) — Nghe một câu, chọn tranh đúng trong ba tranh A, B, C.

| Câu | Lời thoại | Lựa chọn | Đáp án |
|---|---|---|---|
| 01 | ♀ 我在喝茶。<br>Wǒ zài hē chá.<br>*Tôi đang uống trà.* | A / B / C | A |
| 02 | ♂ 今天下雨了。<br>Jīntiān xià yǔ le.<br>*Hôm nay trời mưa rồi.* | A / B / C | B |
| 03 | ♀ 他在开车。<br>Tā zài kāichē.<br>*Anh ấy đang lái xe.* | A / B / C | C |
| 04 | ♂ 我想买一个书包。<br>Wǒ xiǎng mǎi yī ge shūbāo.<br>*Tôi muốn mua một cái cặp sách.* | A / B / C | A |
| 05 | ♀ 妈妈在睡觉。<br>Māma zài shuìjiào.<br>*Mẹ đang ngủ.* | A / B / C | B |

### Phần 2 (L2) — Nghe một câu hỏi, chọn câu trả lời phù hợp.

| Câu | Lời thoại | Lựa chọn | Đáp án |
|---|---|---|---|
| 06 | ♂ 你叫什么名字？<br>Nǐ jiào shénme míngzi?<br>*Bạn tên là gì?* | 我二十岁。 (Wǒ èrshí suì.) / 我叫小雨。 (Wǒ jiào Xiǎoyǔ.) / 我去学校。 (Wǒ qù xuéxiào.) | B |
| 07 | ♀ 你今天去哪儿？<br>Nǐ jīntiān qù nǎr?<br>*Hôm nay bạn đi đâu?* | 去医院。 (Qù yīyuàn.) / 三点。 (Sān diǎn.) / 很好吃。 (Hěn hǎochī.) | A |
| 08 | ♂ 你喝茶还是喝水？<br>Nǐ hē chá háishi hē shuǐ?<br>*Bạn uống trà hay uống nước?* | 我是老师。 (Wǒ shì lǎoshī.) / 不客气。 (Bù kèqi.) / 我喝水。 (Wǒ hē shuǐ.) | C |
| 09 | ♀ 你家有几个人？<br>Nǐ jiā yǒu jǐ ge rén?<br>*Nhà bạn có mấy người?* | 五个人。 (Wǔ ge rén.) / 在北京。 (Zài Běijīng.) / 星期六。 (Xīngqīliù.) | A |
| 10 | ♂ 谢谢你！<br>Xièxie nǐ!<br>*Cảm ơn bạn!* | 没有。 (Méiyǒu.) / 不客气。 (Bù kèqi.) / 八点。 (Bā diǎn.) | B |

### Phần 3 (L3) — Nghe đoạn hội thoại ngắn, chọn tranh phù hợp trong sáu tranh A–F. Mỗi tranh dùng tối đa một lần, có một tranh thừa.

| Câu | Lời thoại | Lựa chọn | Đáp án |
|---|---|---|---|
| 11 | ♂ 你在做什么？<br>Nǐ zài zuò shénme?<br>*Bạn đang làm gì thế?*<br>♀ 我在写汉字。<br>Wǒ zài xiě Hànzì.<br>*Tôi đang viết chữ Hán.* | A / B / C / D / E / F | C |
| 12 | ♀ 你身体怎么样？<br>Nǐ shēntǐ zěnmeyàng?<br>*Sức khỏe bạn thế nào?*<br>♂ 我病了，想去医院看医生。<br>Wǒ bìng le, xiǎng qù yīyuàn kàn yīshēng.<br>*Tôi ốm rồi, muốn đi bệnh viện khám bác sĩ.* | A / B / C / D / E / F | A |
| 13 | ♂ 这些水果多少钱？<br>Zhèxiē shuǐguǒ duōshao qián?<br>*Chỗ hoa quả này bao nhiêu tiền?*<br>♀ 十块钱。<br>Shí kuài qián.<br>*Mười đồng.* | A / B / C / D / E / F | D |
| 14 | ♀ 我们几点的火车？<br>Wǒmen jǐ diǎn de huǒchē?<br>*Chúng ta đi chuyến tàu hỏa mấy giờ?*<br>♂ 九点，我们快走吧。<br>Jiǔ diǎn, wǒmen kuài zǒu ba.<br>*Chín giờ, chúng ta đi nhanh lên.* | A / B / C / D / E / F | B |
| 15 | ♂ 这个饭店的菜很好吃。<br>Zhège fàndiàn de cài hěn hǎochī.<br>*Món ăn của nhà hàng này rất ngon.*<br>♀ 是，我们明天再来吃吧。<br>Shì, wǒmen míngtiān zài lái chī ba.<br>*Đúng vậy, ngày mai chúng ta lại đến ăn nhé.* | A / B / C / D / E / F | E |

### Phần 4 (L4) — Nghe một đoạn nói và câu hỏi, chọn đáp án đúng.

| Câu | Lời thoại | Lựa chọn | Đáp án |
|---|---|---|---|
| 16 | ♀ 我今天很忙，没有时间看电影。<br>Wǒ jīntiān hěn máng, méiyǒu shíjiān kàn diànyǐng.<br>*Hôm nay tôi rất bận, không có thời gian xem phim.*<br>♀ 问：她今天怎么样？<br>Wèn: Tā jīntiān zěnmeyàng?<br>*Hỏi: Hôm nay cô ấy thế nào?* | 很忙 (hěn máng) / 很累 (hěn lèi) / 很高兴 (hěn gāoxìng) | A |
| 17 | ♂ 我儿子今年七岁，他是小学生。<br>Wǒ érzi jīnnián qī suì, tā shì xiǎoxuéshēng.<br>*Con trai tôi năm nay bảy tuổi, cháu là học sinh tiểu học.*<br>♂ 问：他儿子多大了？<br>Wèn: Tā érzi duō dà le?<br>*Hỏi: Con trai anh ấy bao nhiêu tuổi?* | 十七岁 (shíqī suì) / 七岁 (qī suì) / 四岁 (sì suì) | B |
| 18 | ♀ 明天是星期天，我想在家看书。<br>Míngtiān shì xīngqītiān, wǒ xiǎng zài jiā kàn shū.<br>*Ngày mai là chủ nhật, tôi muốn ở nhà đọc sách.*<br>♀ 问：她明天想做什么？<br>Wèn: Tā míngtiān xiǎng zuò shénme?<br>*Hỏi: Ngày mai cô ấy muốn làm gì?* | 上班 (shàngbān) / 去商店 (qù shāngdiàn) / 看书 (kàn shū) | C |
| 19 | ♂ 我的手机在桌子上，电脑在书包里。<br>Wǒ de shǒujī zài zhuōzi shang, diànnǎo zài shūbāo li.<br>*Điện thoại của tôi ở trên bàn, máy tính ở trong cặp sách.*<br>♂ 问：他的电脑在哪儿？<br>Wèn: Tā de diànnǎo zài nǎr?<br>*Hỏi: Máy tính của anh ấy ở đâu?* | 书包里 (shūbāo li) / 桌子上 (zhuōzi shang) / 床上 (chuáng shang) | A |
| 20 | ♀ 我坐飞机去北京，下午三点到。<br>Wǒ zuò fēijī qù Běijīng, xiàwǔ sān diǎn dào.<br>*Tôi đi máy bay đến Bắc Kinh, ba giờ chiều đến nơi.*<br>♀ 问：她怎么去北京？<br>Wèn: Tā zěnme qù Běijīng?<br>*Hỏi: Cô ấy đi Bắc Kinh bằng gì?* | 坐火车 (zuò huǒchē) / 坐飞机 (zuò fēijī) / 开车 (kāichē) | B |

Ảnh của phần Nghe 1 và Nghe 3: `~/hsk-media/hsk1-slice/images/img-l1-q01.png` … `img-l1-q05.png`, `img-l3.png`.

## 2. Ảnh

37 ảnh do Figma AI tạo (file Figma "HSK1 slice images (AI)"), 7 ảnh ghép bằng `backend/scripts/content/compose-exam-images.sh`.
Thư mục: `~/hsk-media/hsk1-slice/images/` (ảnh ghép) và `raw/` (tranh lẻ, ảnh Bài 1). Checksum:
`backend/content/hsk1/media/checksums.json`. Prompt và alt: `docs/content/slice-image-plan.md`.

Checklist: ảnh khớp nghĩa, không có chữ ngoài nhãn A–F, phong cách thống nhất.
