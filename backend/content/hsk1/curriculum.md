# Kế hoạch bài học HSK1 (Pha 2, nháp)

Nguồn khung: danh sách từ cấp 1 chuẩn GF0025-2021 (qua `Word`/`WordLevel`, xem `docs/content/hsk1-audit.md`). Cách chia bài, thứ tự và điểm ngữ pháp do agent tự thiết kế, **người duyệt chốt**. Dữ liệu máy đọc: `curriculum.json` (cùng thư mục).

## Độ phủ

| Mốc | Số bài | Số từ mới | Độ phủ trên 498 từ học được |
|---|---|---|---|
| Pilot (bài 1–5) | 5 | 100 | 20.1% |
| P0 cho 23/11 (bài 1–10) | 10 | 200 | 40.2% |
| Chỉ tiêu ≈22 bài | 22 | 438 | 88.0% |
| Toàn bộ | 25 | 498 | 100.0% |

Mỗi từ là từ mới ở đúng một bài (script `cur.js` của agent đã kiểm: không trùng, không thiếu, 0 từ ngoài danh sách). Bài 25 chỉ có 18 từ (P11).

**Từ bị chặn bởi P4** (dấu thanh lưu sai, validator sẽ fail cho tới khi sửa dữ liệu): đánh dấu † trong bảng. Bài có từ †: 06, 07, 08, 12, 15, 16, 17, 18, 19, 21, 23, 24, 25. Nếu P4 chưa có quyết định trước 23/11, bài 06–08 không nạp được; bài 09–10 nạp được.

## Bảng bài

| Bài | Ưu tiên | Slug | Chủ đề | Điểm ngữ pháp | Từ mới |
|---|---|---|---|---|---|
| 01 | đã có | `hsk1-pilot-l01-chao-hoi-gioi-thieu` | Chào hỏi và giới thiệu bản thân | 是, 叫, 吗, 很, 也/都 | 我 你 您 他 她 我们 叫 名字 是 认识 高兴 老师 学生 同学 朋友 中国 人 什么 谢谢 再见 |
| 02 | đã có | `hsk1-pilot-l02-gia-dinh-tuoi-tac` | Gia đình và tuổi tác | 有/没有, 的, 几/多大, 和, 谁/都 | 爸爸 妈妈 哥哥 姐姐 弟弟 妹妹 儿子 爷爷 奶奶 孩子 岁 多 大 小 有 没有 和 的 家 谁 |
| 03 | đã có | `hsk1-pilot-l03-thoi-gian-ngay-thang` | Thời gian và ngày tháng | số đếm, giờ, ngày tháng, 星期, trật tự thời gian | 一 二 三 四 五 六 七 八 九 十 点 分 今天 明天 昨天 星期 月 日 年 现在 |
| 04 | đã có | `hsk1-pilot-l04-an-uong-mua-sam` | Ăn uống và mua sắm | 吃/喝, 喜欢, 多少钱/块, 早饭/午饭/晚饭, 没有 | 吃 喝 水 茶 米饭 菜 水果 牛奶 面包 鸡蛋 早饭 午饭 晚饭 喜欢 买 钱 块 多少 贵 商店 |
| 05 | đã có | `hsk1-pilot-l05-hoc-tap-truong-hoc` | Học tập và trường học | 学习/学, động từ + tân ngữ, 上课/下课, 问/知道, 见 | 学习 学 汉语 汉字 书 读 写 说 见 听 学校 课 课本 考试 字 问 知道 上课 下课 图书馆 |
| 06 | P0 | `hsk1-pilot-l06-loi-chao-lich-su` | Lời chào lịch sự, cảm ơn, xin lỗi | 不 + động từ/tính từ (phủ định); 呢 hỏi lại: …呢？ (còn … thì sao); 请 + động từ (mời, đề nghị); 们 sau đại từ chỉ số nhiều; 也/都 đứng trước động từ | 不 不客气 对不起 没关系 没事儿 没什么 请 请问 请坐 请进 好 吗† 呢 你们 他们 她们 们 也 很 都 (20) |
| 07 | P0 | `hsk1-pilot-l07-quoc-gia-noi-chon` | Đất nước, ngôn ngữ, nơi chốn | 这/那/哪 (đây/đó/nào); 哪儿/哪里 hỏi nơi chốn; 在 + nơi chốn (ở đâu); 住在 + nơi chốn; 来/去 + nơi chốn | 国 国家 外国 国外 中文 外语 北京 这 那† 哪 哪儿 这儿 那儿 哪里 这里 那里 在 住 来 去 (20) |
| 08 | P0 | `hsk1-pilot-l08-so-dem-luong-tu` | Số đếm và lượng từ | Số + lượng từ + danh từ (个/本/杯); 几 và 多少; 两 và 二; 第 + số (số thứ tự); Số + 次 (số lần) | 零 百 两 个† 几† 元 毛 本 杯 杯子 本子 第 次 号† 页 一些 这些 那些 哪些 有些 (20) |
| 09 | P0 | `hsk1-pilot-l09-thoi-gian-trong-ngay` | Thời gian trong ngày | Từ chỉ thời gian đứng trước động từ; Cách nói giờ: 点、分、半; 什么时候 hỏi thời điểm; 一会儿/马上 | 上午 中午 下午 早上 晚上 白天 早 晚 时候 时间 小时 半 一会儿 马上 前天 后天 今年 去年 明年 星期天 (20) |
| 10 | P0 | `hsk1-pilot-l10-sinh-hoat-hang-ngay` | Sinh hoạt hằng ngày | Trình tự thời gian + nơi chốn + hành động; 常常 + động từ; Câu liên động: 回家吃饭; 在家 + động từ | 起床 起来 睡 睡觉 洗 洗手间 上班 下班 上学 放学 工作 休息 回家 在家 吃饭 穿 衣服 做 事 常常 (20) |
| 11 | P1 | `hsk1-pilot-l11-phuong-huong` | Phương hướng và vị trí | Từ phương vị -边 (上边, 左边…); A 在 B 的 + phương vị; Nơi chốn + 有 + vật (tồn tại) | 上边 下边 前边 后边 左边 右边 里边 外边 旁边 东边 西边 南边 北边 中间 东 西 南 北 左 右 (20) |
| 12 | P1 | `hsk1-pilot-l12-vi-tri-trong-nha` | Vị trí trong nhà và nơi làm việc | Danh từ + 上/下/里 (桌子上); 是 và 有 chỉ tồn tại | 上† 下 前 后 里 外 中 地上 身上 路上 楼上 楼下 楼 门 门口 房子 房间 桌子 床 家里 (20) |
| 13 | P1 | `hsk1-pilot-l13-di-lai-phuong-tien` | Đi lại và phương tiện | 坐/开 + phương tiện; 怎么 + động từ (hỏi cách làm); 走路 + 去 + nơi chốn | 车 汽车 火车 飞机 飞 机场 车站 车票 机票 票 开车 打车 上车 下车 坐 走 走路 路 马路 路口 (20) |
| 14 | P1 | `hsk1-pilot-l14-noi-chon-thanh-pho` | Nơi chốn trong thành phố | 从…到…; 去 + nơi chốn + động từ (mục đích); 到/回到/来到 + nơi chốn | 医院 饭店 书店 商场 电影院 学院 大学 中学 小学 地方 地点 地图 远 门票 到 来到 回到 从 进 出 (20) |
| 15 | P1 | `hsk1-pilot-l15-thoi-tiet-cam-giac` | Thời tiết và cảm giác | 太 + tính từ + 了; 非常/真/最 + tính từ; Câu vị ngữ tính từ (天气很冷); 下雨了 (了 chỉ thay đổi) | 天气 天 雨 下雨 风 冷 热 渴 饿 累† 太 非常 真 真的 最 好看 好吃 好听 好玩儿 高 (20) |
| 16 | P1 | `hsk1-pilot-l16-di-chuyen-giup-do` | Di chuyển và giúp đỡ | Bổ ngữ xu hướng 来/去 (出去, 进来, 回来); 跟 + người + 一起 + động từ; 帮 + người + động từ; Động từ + 到 (找到) | 出去 出来 进去 进来 回去 回来 回 过† 跑† 送 跟 一起 一块儿 等 找 找到 拿 放 帮 帮忙 (20) |
| 17 | P1 | `hsk1-pilot-l17-do-vat-hang-ngay` | Đồ vật hằng ngày | 要 + danh từ/động từ; 的 làm định ngữ (新的手机); 多/少 làm vị ngữ | 东西 书包 钱包 手机 电脑 电视 电视机 电话 包 包子 面条儿 肉 饭 花 新 坏 用 有用 少 要† (20) |
| 18 | P1 | `hsk1-pilot-l18-con-nguoi-nghe-nghiep` | Con người và nghề nghiệp | 的 chỉ sở hữu, quan hệ; 男/女 + danh từ; 是 + nghề nghiệp | 男 女 男人 女人 男孩儿 女孩儿 男生 女生 男朋友 女朋友 小孩儿 小朋友† 小姐 先生 老人 工人 医生 病人 别人 家人 (20) |
| 19 | P1 | `hsk1-pilot-l19-so-thich-giai-tri` | Sở thích và giải trí | 会/能/想 + động từ; Bổ ngữ kết quả 到/见 (看到, 听见); 爱 + động từ | 爱 爱好 唱 唱歌 歌 球 打球 玩儿 电影 看† 看到 看见 听到 听见 开玩笑 笑 会 能 想 有时候 (20) |
| 20 | P1 | `hsk1-pilot-l20-suc-khoe-co-the` | Sức khoẻ, cơ thể và cảm nhận | 别 + động từ (cấm, khuyên); 觉得 + nhận xét; 记住/记得/忘; 快/慢 + động từ | 身体 病 生病 看病 手 口 动 动作 坐下 站 别 慢 快 生气 觉得 明白 记 记住 记得 忘 (20) |
| 21 | P1 | `hsk1-pilot-l21-lop-hoc-thi-cu` | Lớp học và thi cử | Câu hỏi chính phản: 对不对、难不难; 准备 + động từ; 对/错 làm vị ngữ | 课文 听写 读书 教† 教学楼 班 中学生 大学生 小学生 试 考 回答 错 对 不对 难 知识 认真 准备 开会 (20) |
| 22 | P1 | `hsk1-pilot-l22-hen-gap-ngay-le` | Hẹn gặp, ngày lễ, liên lạc | 给 + người + động từ (打电话); 先…再…; 最 + tính từ (最好、最后) | 见面 再 先 说话 话 告诉 介绍 给 打电话 请假 放假 新年 生日 开 关 关上 打开 有名 最后 最好 (20) |
| 23 | P1 | `hsk1-pilot-l23-tro-tu-dong-thai` | Trợ từ, thể và so sánh | 了 (hoàn thành); 着 (trạng thái kéo dài); 正在…呢; 比 (so sánh); A 和 B 一样; 还是 (câu hỏi lựa chọn); 吧 (gợi ý, phỏng đoán); 一点儿/一下儿; 是不是 | 了 着 吧 正† 正在 没 还(hai) 还是 还有 就 比 一样 一点儿 一下儿 是不是 怎么 地(de) 别的 有的 不大 (20) |
| 24 | P1 | `hsk1-pilot-l24-hoat-dong-thoi-han` | Hoạt động và khoảng thời gian | 一边…一边…; 上次/下次; 干什么 (làm gì); 半天/半年 (khoảng thời gian) | 打† 干† 干什么 干净 忙 忘记 得到 上网 网上 网友 上次 下次 一半 一边 半天 半年 日期 星期日 常 不用 (20) |
| 25 | P1 | `hsk1-pilot-l25-on-tap-bo-sung` | Ôn tập và từ bổ sung | Không thêm điểm mới; ôn 了、在、有、的 | 地(di) 女儿 奶 子 山 差† 树 电 白 老 行 起 还(huan) 这边 那边 重 重要 间 (18) |

## Ghi chú

- 5 bài pilot giữ nguyên, không sửa. Một số từ ngữ pháp của pilot (吗, 也, 都, 几) là từ mới chính thức ở bài 06/08; pilot đã dùng trong câu nhưng không là headword, nên không trùng.
- `orderIndex` bài 06–25 = 1006–1025; cần nới `pilotOrderIndexMax` (P8).
- Đa âm giữ hai cách đọc: 地 de (bài 23) / dì (bài 25), 还 hái (bài 23) / huán (bài 25).
- Không dùng mục lục hay cấu trúc bài của giáo trình có bản quyền; thứ tự chủ đề theo độ khó giao tiếp tăng dần.
