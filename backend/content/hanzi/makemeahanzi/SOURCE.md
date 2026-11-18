# Make Me a Hanzi – dữ liệu nét chữ (graphics.txt)

- Nguồn: https://github.com/skishore/makemeahanzi, commit `bddc96d41bef78427ed0e034e9f7e31d71fd1b92`.
- File gốc `graphics.txt`: sha256 `a28c478b5178e98f67f510b2d52fde08a69dc664654ef43498253b9b764d46ee`, 9574 dòng.
- Giấy phép: **Arphic Public License** (`ARPHICPL.TXT` trong thư mục này, giữ nguyên văn theo điều 1–2).
  `graphics.txt` dựng từ font Arphic PL KaitiM GB và Arphic PL UKai của Arphic Technology Co., Ltd.
- Ghi nguồn hiển thị: "Dữ liệu nét chữ: Make Me a Hanzi (Shaunak Kishore), từ font Arphic PL KaitiM GB / UKai, Arphic Public License".
- Không dùng `dictionary.txt` (LGPL, giấy phép khác) – pinyin, Hán Việt của `Character` không lấy từ đây.

`graphics-hsk1.jsonl`: các dòng **giữ nguyên** của `graphics.txt` cho 300 chữ xuất hiện trong từ vựng HSK1
(`scripts/dictionary/raw/hsk1.json`), sắp theo mã Unicode; sha256
`df3362a1b0589ef949b7a180957439126405f869a8c74b39930c5ccb5e49bb8a`. Mỗi dòng `{character, strokes[], medians[]}`
(SVG path và trung tuyến nét, hệ toạ độ 1024×1024, trục y lật – xem README của dự án nguồn).

PO đồng ý dùng 19/11/2026 (Q357). Nạp: `npm run dictionary:import:strokes -- --file content/hanzi/makemeahanzi/graphics-hsk1.jsonl`.
