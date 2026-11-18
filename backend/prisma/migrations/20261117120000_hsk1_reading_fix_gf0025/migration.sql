-- P4/P5 (PO 17/11/2026): sửa dấu thanh HSK1 theo GF0025-2021 và gỡ cấp HSK1 của cách đọc không thuộc HSK1.
-- Sinh bởi scripts/dictionary/audit-hsk1-readings.ts; mỗi UPDATE chỉ đổi khi giá trị cũ khớp. Không xoá dòng Word.

-- L1-0315 上: shang3 -> shang4
UPDATE "Word" SET "pinyinTone" = 'shang4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '上' AND "pinyin" = 'shang' AND "pinyinTone" = 'shang3';
-- L1-0032 不客气: bu4 ke4 qi5 -> bu4 ke4 qi4
UPDATE "Word" SET "pinyinTone" = 'bu4 ke4 qi4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '不客气' AND "pinyin" = 'bu ke qi' AND "pinyinTone" = 'bu4 ke4 qi5';
-- L1-0120 个: ge3 -> ge4
UPDATE "Word" SET "pinyinTone" = 'ge4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '个' AND "pinyin" = 'ge' AND "pinyinTone" = 'ge3';
-- L1-0165 几: ji1 -> ji3
UPDATE "Word" SET "pinyinTone" = 'ji3', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '几' AND "pinyin" = 'ji' AND "pinyinTone" = 'ji1';
-- L1-0027 别人: bie2 ren5 -> bie2 ren2
UPDATE "Word" SET "pinyinTone" = 'bie2 ren2', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '别人' AND "pinyin" = 'bie ren' AND "pinyinTone" = 'bie2 ren5';
-- L1-0020 北边: bei3 bian1 -> bei3 bian5
UPDATE "Word" SET "pinyinTone" = 'bei3 bian5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '北边' AND "pinyin" = 'bei bian' AND "pinyinTone" = 'bei3 bian1';
-- L1-0005 吧: ba1 -> ba5
UPDATE "Word" SET "pinyinTone" = 'ba5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '吧' AND "pinyin" = 'ba' AND "pinyinTone" = 'ba1';
-- L1-0117 告诉: gao4 su4 -> gao4 su5
UPDATE "Word" SET "pinyinTone" = 'gao4 su5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '告诉' AND "pinyin" = 'gao su' AND "pinyinTone" = 'gao4 su4';
-- L1-0227 吗: ma2 -> ma5
UPDATE "Word" SET "pinyinTone" = 'ma5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '吗' AND "pinyin" = 'ma' AND "pinyinTone" = 'ma2';
-- L1-0158 回来: hui2 lai5 -> hui2 lai2
UPDATE "Word" SET "pinyinTone" = 'hui2 lai2', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '回来' AND "pinyin" = 'hui lai' AND "pinyinTone" = 'hui2 lai5';
-- L1-0159 回去: hui2 qu5 -> hui2 qu4
UPDATE "Word" SET "pinyinTone" = 'hui2 qu4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '回去' AND "pinyin" = 'hui qu' AND "pinyinTone" = 'hui2 qu5';
-- L1-0071 地方: di4 fang1 -> di4 fang5
UPDATE "Word" SET "pinyinTone" = 'di4 fang5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '地方' AND "pinyin" = 'di fang' AND "pinyinTone" = 'di4 fang1';
-- L1-0095 多少: duo1 shao3 -> duo1 shao5
UPDATE "Word" SET "pinyinTone" = 'duo1 shao5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '多少' AND "pinyin" = 'duo shao' AND "pinyinTone" = 'duo1 shao3';
-- L1-0489 子: zi3 -> zi5
UPDATE "Word" SET "pinyinTone" = 'zi5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '子' AND "pinyin" = 'zi' AND "pinyinTone" = 'zi3';
-- L1-0419 学生: xue2 sheng5 -> xue2 sheng1
UPDATE "Word" SET "pinyinTone" = 'xue2 sheng1', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '学生' AND "pinyin" = 'xue sheng' AND "pinyinTone" = 'xue2 sheng5';
-- L1-0170 家里: jia1 li3 -> jia1 li5
UPDATE "Word" SET "pinyinTone" = 'jia1 li5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '家里' AND "pinyin" = 'jia li' AND "pinyinTone" = 'jia1 li3';
-- L1-0403 小姐: xiao3 jie5 -> xiao3 jie3
UPDATE "Word" SET "pinyinTone" = 'xiao3 jie3', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '小姐' AND "pinyin" = 'xiao jie' AND "pinyinTone" = 'xiao3 jie5';
-- L1-0037 差: cha1 -> cha4
UPDATE "Word" SET "pinyinTone" = 'cha4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '差' AND "pinyin" = 'cha' AND "pinyinTone" = 'cha1';
-- L1-0056 打: da2 -> da3
UPDATE "Word" SET "pinyinTone" = 'da3', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '打' AND "pinyin" = 'da' AND "pinyinTone" = 'da2';
-- L1-0175 教: jiao4 -> jiao1
UPDATE "Word" SET "pinyinTone" = 'jiao1', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '教' AND "pinyin" = 'jiao' AND "pinyinTone" = 'jiao4';
-- L1-0086 东西: dong1 xi1 -> dong1 xi5
UPDATE "Word" SET "pinyinTone" = 'dong1 xi5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '东西' AND "pinyin" = 'dong xi' AND "pinyinTone" = 'dong1 xi1';
-- L1-0472 正: zheng1 -> zheng4
UPDATE "Word" SET "pinyinTone" = 'zheng4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '正' AND "pinyin" = 'zheng' AND "pinyinTone" = 'zheng1';
-- L1-0192 看: kan1 -> kan4
UPDATE "Word" SET "pinyinTone" = 'kan4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '看' AND "pinyin" = 'kan' AND "pinyinTone" = 'kan1';
-- L1-0211 累: lei3 -> lei4
UPDATE "Word" SET "pinyinTone" = 'lei4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '累' AND "pinyin" = 'lei' AND "pinyinTone" = 'lei3';
-- L1-0375 网上: wang3 shang4 -> wang3 shang5
UPDATE "Word" SET "pinyinTone" = 'wang3 shang5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '网上' AND "pinyin" = 'wang shang' AND "pinyinTone" = 'wang3 shang4';
-- L1-0143 号: hao2 -> hao4
UPDATE "Word" SET "pinyinTone" = 'hao4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '号' AND "pinyin" = 'hao' AND "pinyinTone" = 'hao2';
-- L1-0385 西边: xi1 bian1 -> xi1 bian5
UPDATE "Word" SET "pinyinTone" = 'xi1 bian5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '西边' AND "pinyin" = 'xi bian' AND "pinyinTone" = 'xi1 bian1';
-- L1-0423 要: yao1 -> yao4
UPDATE "Word" SET "pinyinTone" = 'yao4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '要' AND "pinyin" = 'yao' AND "pinyinTone" = 'yao1';
-- L1-0168 记住: ji4 zhu5 -> ji4 zhu4
UPDATE "Word" SET "pinyinTone" = 'ji4 zhu4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '记住' AND "pinyin" = 'ji zhu' AND "pinyinTone" = 'ji4 zhu5';
-- L1-0289 起来: qi3 lai5 -> qi3 lai2
UPDATE "Word" SET "pinyinTone" = 'qi3 lai2', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '起来' AND "pinyin" = 'qi lai' AND "pinyinTone" = 'qi3 lai5';
-- L1-0283 跑: pao2 -> pao3
UPDATE "Word" SET "pinyinTone" = 'pao3', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '跑' AND "pinyin" = 'pao' AND "pinyinTone" = 'pao2';
-- L1-0131 过: guo1 -> guo4
UPDATE "Word" SET "pinyinTone" = 'guo4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '过' AND "pinyin" = 'guo' AND "pinyinTone" = 'guo1';
-- L1-0254 那: na1 -> na4
UPDATE "Word" SET "pinyinTone" = 'na4', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '那' AND "pinyin" = 'na' AND "pinyinTone" = 'na1';
-- L1-0256 那里: na4 li5 -> na4 li3
UPDATE "Word" SET "pinyinTone" = 'na4 li3', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '那里' AND "pinyin" = 'na li' AND "pinyinTone" = 'na4 li5';
-- L1-0255 那边: na4 bian5 -> na4 bian1
UPDATE "Word" SET "pinyinTone" = 'na4 bian1', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '那边' AND "pinyin" = 'na bian' AND "pinyinTone" = 'na4 bian5';
-- L1-0126 关上: guan1 shang4 -> guan1 shang5
UPDATE "Word" SET "pinyinTone" = 'guan1 shang5', "updatedAt" = CURRENT_TIMESTAMP WHERE "hanzi" = '关上' AND "pinyin" = 'guan shang' AND "pinyinTone" = 'guan1 shang4';

-- gỡ HSK1: 了 liao3
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '了' AND w."pinyin" = 'liao';
-- gỡ HSK1: 六 lu4
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '六' AND w."pinyin" = 'lu';
-- gỡ HSK1: 南 na1
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '南' AND w."pinyin" = 'na';
-- gỡ HSK1: 吧 bia1
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '吧' AND w."pinyin" = 'bia';
-- gỡ HSK1: 听 yin3
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '听' AND w."pinyin" = 'yin';
-- gỡ HSK1: 呢 ni2
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '呢' AND w."pinyin" = 'ni';
-- gỡ HSK1: 和 hu2
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '和' AND w."pinyin" = 'hu';
-- gỡ HSK1: 和 huo2
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '和' AND w."pinyin" = 'huo';
-- gỡ HSK1: 哪 ne2
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '哪' AND w."pinyin" = 'ne';
-- gỡ HSK1: 哪 nei3
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '哪' AND w."pinyin" = 'nei';
-- gỡ HSK1: 大 dai4
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '大' AND w."pinyin" = 'dai';
-- gỡ HSK1: 女 ru3
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '女' AND w."pinyin" = 'ru';
-- gỡ HSK1: 差 chai1
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '差' AND w."pinyin" = 'chai';
-- gỡ HSK1: 差 ci1
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '差' AND w."pinyin" = 'ci';
-- gỡ HSK1: 会 kuai4
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '会' AND w."pinyin" = 'kuai';
-- gỡ HSK1: 没 mo4
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '没' AND w."pinyin" = 'mo';
-- gỡ HSK1: 洗 xian3
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '洗' AND w."pinyin" = 'xian';
-- gỡ HSK1: 的 di1
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '的' AND w."pinyin" = 'di';
-- gỡ HSK1: 着 zhao1
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '着' AND w."pinyin" = 'zhao';
-- gỡ HSK1: 着 zhuo2
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '着' AND w."pinyin" = 'zhuo';
-- gỡ HSK1: 给 ji3
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '给' AND w."pinyin" = 'ji';
-- gỡ HSK1: 行 hang2
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '行' AND w."pinyin" = 'hang';
-- gỡ HSK1: 行 heng2
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '行' AND w."pinyin" = 'heng';
-- gỡ HSK1: 见 xian4
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '见' AND w."pinyin" = 'xian';
-- gỡ HSK1: 说 shui4
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '说' AND w."pinyin" = 'shui';
-- gỡ HSK1: 读 dou4
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '读' AND w."pinyin" = 'dou';
-- gỡ HSK1: 车 ju1
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '车' AND w."pinyin" = 'ju';
-- gỡ HSK1: 这 zhei4
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '这' AND w."pinyin" = 'zhei';
-- gỡ HSK1: 那 nuo2
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '那' AND w."pinyin" = 'nuo';
-- gỡ HSK1: 都 du1
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '都' AND w."pinyin" = 'du';
-- gỡ HSK1: 重 chong2
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '重' AND w."pinyin" = 'chong';
-- gỡ HSK1: 页 xie2
DELETE FROM "WordLevel" wl USING "Word" w, "Level" l WHERE wl."wordId" = w."id" AND wl."levelId" = l."id" AND l."code" = 'HSK1' AND w."hanzi" = '页' AND w."pinyin" = 'xie';
