# Duyệt lát cắt Bài 1 + Đề thi thử HSK1

Người duyệt: PO (Q353). Agent không approve hay publish. File này được bổ sung dần theo từng bước.

## 1. Lời thoại 20 câu Nghe

**PO (Khổng Văn Hào) duyệt 18/11/2026**, kèm 2 sửa đã áp dụng: giọng dẫn riêng cho câu "问：…" (câu 16–20), pinyin 不客气 = "Bù kèqì" (câu 8, 10). Manifest ghi `review` approved với hash nội dung sau khi sửa. 37 ảnh cũng được duyệt cùng ngày.

Nguồn: `backend/content/hsk1/exam/mock-01.json`. Giọng nữ `zh-CN-XiaoxiaoNeural`, nam `zh-CN-YunxiNeural`, tốc độ chuẩn,
nghỉ 600 ms giữa các lượt; câu "问：…" ở Phần 4 đọc bằng giọng dẫn `zh-CN-YunyangNeural` (🎙). Manifest: `backend/content/hsk1/audio/slice-01.json` (60 file: 20 câu nghe, 20 từ, 20 câu
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
| 08 | ♂ 你喝茶还是喝水？<br>Nǐ hē chá háishi hē shuǐ?<br>*Bạn uống trà hay uống nước?* | 我是老师。 (Wǒ shì lǎoshī.) / 不客气。 (Bù kèqì.) / 我喝水。 (Wǒ hē shuǐ.) | C |
| 09 | ♀ 你家有几个人？<br>Nǐ jiā yǒu jǐ ge rén?<br>*Nhà bạn có mấy người?* | 五个人。 (Wǔ ge rén.) / 在北京。 (Zài Běijīng.) / 星期六。 (Xīngqīliù.) | A |
| 10 | ♂ 谢谢你！<br>Xièxie nǐ!<br>*Cảm ơn bạn!* | 没有。 (Méiyǒu.) / 不客气。 (Bù kèqì.) / 八点。 (Bā diǎn.) | B |

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
| 16 | ♀ 我今天很忙，没有时间看电影。<br>Wǒ jīntiān hěn máng, méiyǒu shíjiān kàn diànyǐng.<br>*Hôm nay tôi rất bận, không có thời gian xem phim.*<br>🎙 问：她今天怎么样？<br>Wèn: Tā jīntiān zěnmeyàng?<br>*Hỏi: Hôm nay cô ấy thế nào?* | 很忙 (hěn máng) / 很累 (hěn lèi) / 很高兴 (hěn gāoxìng) | A |
| 17 | ♂ 我儿子今年七岁，他是小学生。<br>Wǒ érzi jīnnián qī suì, tā shì xiǎoxuéshēng.<br>*Con trai tôi năm nay bảy tuổi, cháu là học sinh tiểu học.*<br>🎙 问：他儿子多大了？<br>Wèn: Tā érzi duō dà le?<br>*Hỏi: Con trai anh ấy bao nhiêu tuổi?* | 十七岁 (shíqī suì) / 七岁 (qī suì) / 四岁 (sì suì) | B |
| 18 | ♀ 明天是星期天，我想在家看书。<br>Míngtiān shì xīngqītiān, wǒ xiǎng zài jiā kàn shū.<br>*Ngày mai là chủ nhật, tôi muốn ở nhà đọc sách.*<br>🎙 问：她明天想做什么？<br>Wèn: Tā míngtiān xiǎng zuò shénme?<br>*Hỏi: Ngày mai cô ấy muốn làm gì?* | 上班 (shàngbān) / 去商店 (qù shāngdiàn) / 看书 (kàn shū) | C |
| 19 | ♂ 我的手机在桌子上，电脑在书包里。<br>Wǒ de shǒujī zài zhuōzi shang, diànnǎo zài shūbāo li.<br>*Điện thoại của tôi ở trên bàn, máy tính ở trong cặp sách.*<br>🎙 问：他的电脑在哪儿？<br>Wèn: Tā de diànnǎo zài nǎr?<br>*Hỏi: Máy tính của anh ấy ở đâu?* | 书包里 (shūbāo li) / 桌子上 (zhuōzi shang) / 床上 (chuáng shang) | A |
| 20 | ♀ 我坐飞机去北京，下午三点到。<br>Wǒ zuò fēijī qù Běijīng, xiàwǔ sān diǎn dào.<br>*Tôi đi máy bay đến Bắc Kinh, ba giờ chiều đến nơi.*<br>🎙 问：她怎么去北京？<br>Wèn: Tā zěnme qù Běijīng?<br>*Hỏi: Cô ấy đi Bắc Kinh bằng gì?* | 坐火车 (zuò huǒchē) / 坐飞机 (zuò fēijī) / 开车 (kāichē) | B |

Ảnh của phần Nghe 1 và Nghe 3: `~/hsk-media/hsk1-slice/images/img-l1-q01.png` … `img-l1-q05.png`, `img-l3.png`.

## 2. Ảnh

37 ảnh do Figma AI tạo (file Figma "HSK1 slice images (AI)"), 7 ảnh ghép bằng `backend/scripts/content/compose-exam-images.sh`.
Thư mục: `~/hsk-media/hsk1-slice/images/` (ảnh ghép) và `raw/` (tranh lẻ, ảnh Bài 1). Checksum:
`backend/content/hsk1/media/checksums.json`. Prompt và alt: `docs/content/slice-image-plan.md`.

Checklist: ảnh khớp nghĩa, không có chữ ngoài nhãn A–F, phong cách thống nhất.

## Đề demo "Đề thi thử HSK1 – Đọc" — danh sách câu để PO duyệt lần cuối

Bản nháp do AI soạn, chưa duyệt. Số câu theo đề đầy đủ (q0021–q0040); trong đề demo là câu 1–20. 20 câu, 20 phút, điểm đỗ tạm 60/100. Ảnh: Figma AI, ghép và gắn nhãn bằng ImageMagick (`compose-exam-images.sh`).

### Phần 1 — Đọc câu, chọn tranh phù hợp trong sáu tranh A–F. Có một tranh thừa.

Ảnh chung `img-r1` (file `img-r1.png` trong `~/hsk-media/hsk1-slice/images/`). Alt: A: Em bé uống cốc sữa bên bàn bếp; B: Người đàn ông nói chuyện điện thoại; C: Gia đình ngồi trên sofa xem tivi; D: Người phụ nữ chọn quần áo trong cửa hàng; E: Cô giáo đứng trước bảng, học sinh ngồi học; F: Máy bay bay trên trời xanh

| Câu | Đề | Lựa chọn | Đáp án | Ảnh/alt | Giải thích |
|---|---|---|---|---|---|
| 21 | 我们在看电视。 (Wǒmen zài kàn diànshì.) | A. A<br>B. B<br>C. C<br>D. D<br>E. E<br>F. F | C |  | "Chúng tôi đang xem tivi." Khớp với tranh C. |
| 22 | 他在打电话。 (Tā zài dǎ diànhuà.) | A. A<br>B. B<br>C. C<br>D. D<br>E. E<br>F. F | B |  | "Anh ấy đang gọi điện thoại." Khớp với tranh B. |
| 23 | 老师在上课。 (Lǎoshī zài shàngkè.) | A. A<br>B. B<br>C. C<br>D. D<br>E. E<br>F. F | E |  | "Thầy giáo đang lên lớp." Khớp với tranh E. |
| 24 | 小朋友在喝牛奶。 (Xiǎopéngyou zài hē niúnǎi.) | A. A<br>B. B<br>C. C<br>D. D<br>E. E<br>F. F | A |  | "Em bé đang uống sữa." Khớp với tranh A. |
| 25 | 她在商店买衣服。 (Tā zài shāngdiàn mǎi yīfu.) | A. A<br>B. B<br>C. C<br>D. D<br>E. E<br>F. F | D |  | "Cô ấy đang mua quần áo ở cửa hàng." Khớp với tranh D. |

### Phần 2 — Đọc câu hỏi, chọn câu trả lời phù hợp trong A–F. Mỗi đáp án dùng một lần, có một đáp án thừa.

| Câu | Đề | Lựa chọn | Đáp án | Ảnh/alt | Giải thích |
|---|---|---|---|---|---|
| 26 | 你是中国人吗？ (Nǐ shì Zhōngguórén ma?) | A. 他是我哥哥。 (Tā shì wǒ gēge.)<br>B. 在学校门口。 (Zài xuéxiào ménkǒu.)<br>C. 好的，明天见。 (Hǎo de, míngtiān jiàn.)<br>D. 我不饿。 (Wǒ bù è.)<br>E. 两个。 (Liǎng ge.)<br>F. 是的，我是中国人。 (Shì de, wǒ shì Zhōngguórén.) | F |  | "Bạn là người Trung Quốc à?" – Câu trả lời phù hợp: 是的，我是中国人。 (Shì de, wǒ shì Zhōngguórén.) – "Vâng, tôi là người Trung Quốc." (Phương án C không dùng.) |
| 27 | 那个人是谁？ (Nà ge rén shì shéi?) | A. 他是我哥哥。 (Tā shì wǒ gēge.)<br>B. 在学校门口。 (Zài xuéxiào ménkǒu.)<br>C. 好的，明天见。 (Hǎo de, míngtiān jiàn.)<br>D. 我不饿。 (Wǒ bù è.)<br>E. 两个。 (Liǎng ge.)<br>F. 是的，我是中国人。 (Shì de, wǒ shì Zhōngguórén.) | A |  | "Người kia là ai?" – Câu trả lời phù hợp: 他是我哥哥。 (Tā shì wǒ gēge.) – "Anh ấy là anh trai tôi." (Phương án C không dùng.) |
| 28 | 你想吃点儿什么？ (Nǐ xiǎng chī diǎnr shénme?) | A. 他是我哥哥。 (Tā shì wǒ gēge.)<br>B. 在学校门口。 (Zài xuéxiào ménkǒu.)<br>C. 好的，明天见。 (Hǎo de, míngtiān jiàn.)<br>D. 我不饿。 (Wǒ bù è.)<br>E. 两个。 (Liǎng ge.)<br>F. 是的，我是中国人。 (Shì de, wǒ shì Zhōngguórén.) | D |  | "Bạn muốn ăn chút gì?" – Câu trả lời phù hợp: 我不饿。 (Wǒ bù è.) – "Tôi không đói." (từ chối lời mời ăn) (Phương án C không dùng.) |
| 29 | 你要几个包子？ (Nǐ yào jǐ ge bāozi?) | A. 他是我哥哥。 (Tā shì wǒ gēge.)<br>B. 在学校门口。 (Zài xuéxiào ménkǒu.)<br>C. 好的，明天见。 (Hǎo de, míngtiān jiàn.)<br>D. 我不饿。 (Wǒ bù è.)<br>E. 两个。 (Liǎng ge.)<br>F. 是的，我是中国人。 (Shì de, wǒ shì Zhōngguórén.) | E |  | "Bạn muốn mấy cái bánh bao?" – Câu trả lời phù hợp: 两个。 (Liǎng ge.) – "Hai cái." (Phương án C không dùng.) |
| 30 | 我们在哪儿见面？ (Wǒmen zài nǎr jiànmiàn?) | A. 他是我哥哥。 (Tā shì wǒ gēge.)<br>B. 在学校门口。 (Zài xuéxiào ménkǒu.)<br>C. 好的，明天见。 (Hǎo de, míngtiān jiàn.)<br>D. 我不饿。 (Wǒ bù è.)<br>E. 两个。 (Liǎng ge.)<br>F. 是的，我是中国人。 (Shì de, wǒ shì Zhōngguórén.) | B |  | "Chúng ta gặp nhau ở đâu?" – Câu trả lời phù hợp: 在学校门口。 (Zài xuéxiào ménkǒu.) – "Ở cổng trường." (Phương án C không dùng.) |

### Phần 3 — Chọn từ thích hợp trong A–F điền vào chỗ trống. Mỗi từ dùng một lần, có một từ thừa.

| Câu | Đề | Lựa chọn | Đáp án | Ảnh/alt | Giải thích |
|---|---|---|---|---|---|
| 31 | 我很（ ）喝茶。 (Wǒ hěn ( ) hē chá.) | A. 冷 (lěng)<br>B. 名字 (míngzi)<br>C. 坐 (zuò)<br>D. 喜欢 (xǐhuan)<br>E. 本 (běn)<br>F. 医院 (yīyuàn) | D |  | Tôi rất thích uống trà. 很喜欢 + động từ: rất thích làm gì. (Từ 医院 không dùng.) |
| 32 | 请（ ），我给你拿水。 (Qǐng ( ), wǒ gěi nǐ ná shuǐ.) | A. 冷 (lěng)<br>B. 名字 (míngzi)<br>C. 坐 (zuò)<br>D. 喜欢 (xǐhuan)<br>E. 本 (běn)<br>F. 医院 (yīyuàn) | C |  | Mời ngồi, tôi lấy nước cho bạn. 请坐 – mời ngồi. (Từ 医院 không dùng.) |
| 33 | 今天很（ ），你多穿衣服。 (Jīntiān hěn ( ), nǐ duō chuān yīfu.) | A. 冷 (lěng)<br>B. 名字 (míngzi)<br>C. 坐 (zuò)<br>D. 喜欢 (xǐhuan)<br>E. 本 (běn)<br>F. 医院 (yīyuàn) | A |  | Hôm nay rất lạnh, bạn mặc thêm quần áo. 冷 – lạnh. (Từ 医院 không dùng.) |
| 34 | 这（ ）书是我的。 (Zhè ( ) shū shì wǒ de.) | A. 冷 (lěng)<br>B. 名字 (míngzi)<br>C. 坐 (zuò)<br>D. 喜欢 (xǐhuan)<br>E. 本 (běn)<br>F. 医院 (yīyuàn) | E |  | Quyển sách này là của tôi. 本 là lượng từ của sách. (Từ 医院 không dùng.) |
| 35 | 你叫什么（ ）？ (Nǐ jiào shénme ( )?) | A. 冷 (lěng)<br>B. 名字 (míngzi)<br>C. 坐 (zuò)<br>D. 喜欢 (xǐhuan)<br>E. 本 (běn)<br>F. 医院 (yīyuàn) | B |  | Bạn tên là gì? 叫什么名字 – tên là gì. (Từ 医院 không dùng.) |

### Phần 4 — Đọc đoạn văn ngắn rồi trả lời câu hỏi có dấu ★.

| Câu | Đề | Lựa chọn | Đáp án | Ảnh/alt | Giải thích |
|---|---|---|---|---|---|
| 36 | 小雨昨天去商店买了一些水果和面包。 (Xiǎoyǔ zuótiān qù shāngdiàn mǎi le yīxiē shuǐguǒ hé miànbāo.) ★ 小雨买了什么？ (Xiǎoyǔ mǎi le shénme?) | A. 衣服 (yīfu)<br>B. 水果 (shuǐguǒ)<br>C. 书 (shū) | B |  | Hôm qua Tiểu Vũ đi cửa hàng mua ít hoa quả và bánh mì. ★ Tiểu Vũ đã mua gì? → 水果 (hoa quả). |
| 37 | 我爸爸是医生，他在医院工作。 (Wǒ bàba shì yīshēng, tā zài yīyuàn gōngzuò.) ★ 爸爸在哪儿工作？ (Bàba zài nǎr gōngzuò?) | A. 医院 (yīyuàn)<br>B. 学校 (xuéxiào)<br>C. 饭店 (fàndiàn) | A |  | Bố tôi là bác sĩ, ông làm việc ở bệnh viện. ★ Bố làm việc ở đâu? → 医院 (bệnh viện). |
| 38 | 现在是上午十点，小雨十一点半去机场。 (Xiànzài shì shàngwǔ shí diǎn, Xiǎoyǔ shíyī diǎn bàn qù jīchǎng.) ★ 小雨几点去机场？ (Xiǎoyǔ jǐ diǎn qù jīchǎng?) | A. 十点 (shí diǎn)<br>B. 十点半 (shí diǎn bàn)<br>C. 十一点半 (shíyī diǎn bàn) | C |  | Bây giờ là 10 giờ sáng, Tiểu Vũ 11 rưỡi ra sân bay. ★ Mấy giờ Tiểu Vũ ra sân bay? → 十一点半; 十点 là giờ hiện tại (bẫy). |
| 39 | 我哥哥喜欢打球，他常常和朋友一起打球。 (Wǒ gēge xǐhuan dǎqiú, tā chángcháng hé péngyou yīqǐ dǎqiú.) ★ 哥哥喜欢做什么？ (Gēge xǐhuan zuò shénme?) | A. 打球 (dǎqiú)<br>B. 唱歌 (chànggē)<br>C. 看电影 (kàn diànyǐng) | A |  | Anh trai tôi thích chơi bóng, anh ấy thường chơi bóng cùng bạn bè. ★ Anh trai thích làm gì? → 打球 (chơi bóng). |
| 40 | 小雨家在学校后边，她常常走路去学校。 (Xiǎoyǔ jiā zài xuéxiào hòubian, tā chángcháng zǒulù qù xuéxiào.) ★ 小雨怎么去学校？ (Xiǎoyǔ zěnme qù xuéxiào?) | A. 坐汽车 (zuò qìchē)<br>B. 打车 (dǎchē)<br>C. 走路 (zǒulù) | C |  | Nhà Tiểu Vũ ở phía sau trường, cô ấy thường đi bộ đến trường. ★ Tiểu Vũ đến trường bằng cách nào? → 走路 (đi bộ). |
