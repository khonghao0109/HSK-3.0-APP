# Runbook đo năng lực luồng thi (M4.4)

Dành cho kỹ sư chạy lại harness capacity của luồng thi. Harness nằm ở
`backend/scripts/test/run-exam-capacity.ts` và thư mục
`backend/scripts/test/exam-capacity/`.

## 1. Mục đích và giới hạn

Harness dựng DB disposable, chạy `node dist/src/main.js` ở process riêng với
`NODE_ENV=production`, cho học viên ảo chạy qua API rồi đánh giá ngưỡng và
invariant.

Toàn bộ số liệu đo trên **một máy Mac**, server, PostgreSQL và client tải dùng
chung máy và chung với app của người dùng. Kết quả dùng để so sánh các lượt với
nhau và bắt lỗi tranh chấp. Đây **không phải năng lực production** và không được
dùng để suy ra số người dùng đồng thời trên hạ tầng thật.

## 2. An toàn DB

- `NODE_ENV=test`. Guard `assertDisposableTestDatabase` từ chối mọi giá trị khác.
- `TEST_DATABASE_URL` và `DATABASE_URL` đều được **gán trực tiếp** trong lệnh
  bằng **cùng một URL disposable** tên `hsk_m44_*`. Guard bắt hai biến trùng đích
  và tên DB có hậu tố `test`, `e2e`, `verify`, `disposable` hoặc `hardening`.
  Harness còn chỉ nhận tên khớp `^hsk_m44_[a-z0-9_]*$`.
- Không lấy URL từ `.env`, không đọc hay source `.env*`, không bao giờ trỏ vào DB
  dev.
- Harness `DROP DATABASE ... WITH (FORCE)` rồi tạo lại DB trước khi chạy, và drop
  khi kết thúc (trừ khi có `--keep-database`). Sau mỗi lượt, kiểm không còn DB:

  ```bash
  psql -h 127.0.0.1 -d postgres -Atc "select datname from pg_database where datname like 'hsk_m44%'"
  ```

## 3. Chuẩn bị máy

- Cắm sạc và mở nắp. `pmset -g batt` phải báo `AC Power`.
- Bọc lệnh bằng `caffeinate -dims`. Lệnh này **không chống ngủ khi dùng pin và
  gập nắp**: ngày 06/11 máy vào `Clamshell Sleep` giữa một lượt.
- Harness chạy `dist/src/main.js`: chạy `npm run build` trước, hoặc thêm `--build`.
- Sau lượt, kiểm máy có ngủ không. Lọc đúng cột sự kiện theo khoảng giờ chạy, vì
  grep thường khớp nhầm dòng `Assertions ... Wake Lock`:

  ```bash
  pmset -g log | awk '$1=="<YYYY-MM-DD>" && $2>="<HH:MM đầu>" && $2<="<HH:MM cuối>" && ($4=="Sleep"||$4=="Wake"||$4=="DarkWake")'
  ```

  Rỗng nghĩa là máy không ngủ.

## 4. Kịch bản

Mọi lệnh chạy trong `backend/`, với tiền tố sau (`<db>` là tên `hsk_m44_*`):

```bash
URL="postgresql://<user>@127.0.0.1:5432/<db>"
NODE_ENV=test TEST_DATABASE_URL="$URL" DATABASE_URL="$URL" caffeinate -dims \
  npm run test:capacity:exam -- <tham số bên dưới>
```

Artifact mỗi lượt là run dir `<timestamp>-<label>` chứa `result.json`,
`summary.md`, `server.log`. Exit khác 0 khi invariant sai hoặc có ngưỡng FAIL.

| Scenario | Mục đích | Tham số đã dùng |
| --- | --- | --- |
| `w1` | Vòng đời đầy đủ ở mức mặc định: list, intro, start, attempt, save, submit, result | `--scenario w1 --label <nhãn>` (mặc định: 40 users, ramp 120 s, 80 câu, đề 90 phút, nhịp 54000 ms). Chưa đo trên `b04316c` |
| `w3` | 20% học viên reconnect giữa bài | `--scenario w3 --users 300 --ramp-seconds 120 --minutes 5 --questions 8 --answer-interval-ms 2000 --audio 0 --reconnect-ratio 0.2 --label <nhãn>` |
| `w4` | Sóng submit rải trong 300 s | `--scenario w4 --users 300 --ramp-seconds 120 --minutes 10 --questions 8 --answer-interval-ms 2000 --audio 0 --submit-window-seconds 300 --label <nhãn>` |
| `w5` | 30% học viên hết giờ, không submit | `--scenario w5 --users 300 --ramp-seconds 60 --minutes 1 --questions 8 --answer-interval-ms 300 --audio 0 --timeout-ratio 0.3 --label <nhãn>` |
| `w6` | Vòng đời đầy đủ kèm phục vụ media qua mock S3 và kiểm SHA-256 | `--scenario w6 --users 40 --ramp-seconds 120 --minutes 10 --questions 40 --answer-interval-ms 12000 --audio 10 --images 4 --label <nhãn>` |
| `w7` | Chỉ list và intro, không tạo attempt | `--scenario w7 --users 300 --ramp-seconds 60 --minutes 2 --questions 8 --answer-interval-ms 12000 --audio 0 --label <nhãn>` |
| `w45` | Kết hợp timeout và sóng submit | `--scenario w45 --users 300 --ramp-seconds 120 --minutes 10 --questions 8 --answer-interval-ms 2000 --audio 0 --timeout-ratio 0.3 --submit-window-seconds 300 --label <nhãn>` |
| `w8` | Soak dài, hành xử như `w1`, thêm P18 | `--scenario w8 --users 300 --ramp-seconds 900 --minutes 90 --questions 80 --answer-interval-ms 54000 --audio 0 --reconnect-ratio 0.2 --timeout-ratio 0.3 --submit-window-seconds 300 --label <nhãn>` |
| `probe429` | Dò biên rate limit: PUT answer vượt 240/phút/user và media vượt 600/phút/IP | `--scenario probe429 --users 2 --ramp-seconds 120 --minutes 2 --questions 15 --answer-interval-ms 6400 --audio 15 --label <nhãn>` |

`--reconnect-ratio` chỉ có tác dụng ở `w3`, `--timeout-ratio` ở `w5` và `w45`,
`--submit-window-seconds` ở `w4` và `w45`. Trên `w8` ba cờ này không đổi kế hoạch
học viên; chúng được giữ cho khớp cấu hình lượt đã đo.

## 5. Ngưỡng

Nguồn: `CAPACITY_THRESHOLDS` và `evaluateThresholds` trong
`exam-capacity/thresholds.ts`; mã bắt buộc theo scenario trong
`REQUIRED_THRESHOLD_CODES` ở `exam-capacity/scenarios.ts`. Mã bắt buộc mà không
có mẫu đo bị tính FAIL.

| Mã | Ý nghĩa | Ngưỡng |
| --- | --- | --- |
| P3 | Lock wait dài | `< 1000 ms`, tối đa 2 mẫu liên tiếp mỗi pid, 0 mẫu không có chi tiết, 0 bản ghi không rõ thời lượng |
| P5 | p95 đọc, lấy route xấu nhất | ≤ 300 ms |
| P6 | p99 đọc, lấy route xấu nhất | ≤ 800 ms |
| P7 | p95 autosave | ≤ 400 ms |
| P8 | p99 autosave | ≤ 1000 ms |
| P9 | p95 start | ≤ 1500 ms |
| P10 | p95 submit | ≤ 1500 ms |
| P11 | p95 result lần đầu | ≤ 2000 ms |
| P13 | Mất autosave | = 0 |
| P14 | Double terminal hoặc Result | = 0 |
| P15 | Biên 429, chỉ ở `probe429` | 240/phút/user và 600/phút/IP, envelope đúng, không lan sang user khác |
| P17 | Connection của server (pool) | ≤ 22 |
| P18 | Soak RSS, chỉ ở `w8` | Hồi quy RSS trên pha từ hết ramp tới request cuối, tăng ≤ 10%, pha ≥ 30 phút và ≥ 60 mẫu |
| RSS | RSS đỉnh của server | ≤ 512 MiB |
| P19 | Lặp lại | 3/3 lượt hợp lệ mỗi scenario trong ma trận. Mã này **không có trong code**, được tính thủ công theo mục 7 |

Mã bắt buộc:

- `w1`, `w3`, `w4`, `w6`, `w45`: P3, P5–P11, P13, P14, P17, RSS.
- `w8`: như trên, thêm P18.
- `w5`: như trên nhưng không có P10.
- `w7`: P3, P5, P6, P17, RSS.
- `probe429`: P3, P5–P9, P14, P15, P17, RSS.

## 6. Thời lượng W8

Tải kết thúc sau `rampSeconds + (questions − 1) × answerIntervalMs`. Với tham số
đã dùng: `900 + 79 × 54 = 5166 s`, tức **86.1 phút**. `minutes` là thời lượng đề
thi trong fixture, không phải thời lượng tải; đừng chờ đủ 90 phút. P18 tính trên
pha `[hết ramp, request cuối]`, là 71.1 phút ở lượt đã đo.

## 7. Quy trình ma trận

1. **Một job nặng một lúc.** Giữ khoá `/tmp/hsk-heavy.lock` (`mkdir`) suốt lượt.
   File `owner` trong khoá ghi pid, started, task, job-pid, job. Nhả bằng
   `trap ... EXIT` trong cùng shell chạy job.
2. **Cổng load trước lượt.** Chờ load1 ≤ 5 trong 12 mẫu liên tiếp cách nhau
   10 giây, tối đa 30 phút. Quá hạn thì ghi `sysctl -n vm.loadavg` và
   `ps -Ao pid,pcpu,comm -r | head -8`, không chạy, không nới cổng.
3. **Mỗi lượt một DB riêng.** Tên theo mục 2, drop khi xong.
4. **Xếp loại sau lượt.** Lượt hợp lệ khi đạt đủ: exit 0, 5xx bằng 0, mọi invariant
   ok, `grep -c FAIL summary.md` bằng 0, mọi mã bắt buộc PASS, load1 cuối lượt
   ≤ 8, và không có Sleep chen giữa.
5. **Nhiễu.** Load1 cuối lượt > 8 là nhiễu: ghi lại, không tính, không chạy lại
   trong cùng ma trận trừ khi người phụ trách yêu cầu.
6. **Báo cáo mọi lượt**, kể cả FAIL, nhiễu và lượt hỏng, kèm tên run dir.
7. **P19.** Đếm số lượt hợp lệ theo từng scenario, đủ 3 thì đạt.

Script ma trận từng dùng trong `/tmp` chỉ là công cụ tạm, không phải nguồn chính
thức. Runbook này và code harness mới là nguồn.

## 8. Quy tắc máy ngủ

Lượt có Sleep chen giữa khi còn request là **không hợp lệ**, kể cả khi mọi ngưỡng
PASS. Latency thấp không phải bằng chứng máy không ngủ: lượt `p3r2-w45` dưới đây
vẫn có max latency thấp dù máy đã ngủ gần 10 phút giữa lượt. Luôn kiểm `pmset` theo mục 3.

Ví dụ: lượt `2026-11-06_13-38-18-846-m44-p3r2-w45` chạy từ 20:38 đến 21:00 (+07).
`pmset` ghi `Clamshell Sleep` lúc 20:50:36 kéo dài 592 giây, `connectionSeries` có
khoảng trống 591 giây. Max latency vẫn ≤ 206 ms và mọi ngưỡng PASS, nhưng lượt này
không được tính.

## 9. Ngoại lệ W8 ngày 09/11

Lượt `2026-11-09_08-33-37-333-m44-p3w8-w8` có load1 cuối 10.63, là nhiễu theo mục
7. TL tính riêng lượt này cho **P18**, vì P18 là chỉ số RSS và tải chỉ tăng cuối
lượt. Độ trễ của lượt này **không dùng làm con số năng lực**. Ngoại lệ này **không
tạo tiền lệ** cho kịch bản khác.

## 10. Bằng chứng

macOS xoá file trong `/tmp` không được truy cập quá 3 ngày. Cuối mỗi pha đo:

```bash
ditto /tmp/hsk-<task> ~/hsk-evidence/hsk-<task>
find /tmp/hsk-<task> -type f | wc -l
find ~/hsk-evidence/hsk-<task> -type f | wc -l
```

Hai số phải bằng nhau.

## 11. Kết quả hiện tại

Commit `b04316c`. Các lượt đã thu thập ngày 06/11 và 09/11/2026.
Lượt `p3r5-w45` chạy trên `b04316c` kèm thay đổi chưa commit ở harness, chỉ là danh
sách mã bắt buộc của `probe429` (thêm P15).

| Scenario | Lượt hợp lệ | Run dir hợp lệ |
| --- | --- | --- |
| `w1` | 0, không thuộc ma trận P19 | — |
| `w3` | 3 | `2026-11-06_13-24-39-413-m44-p3r2-w3`, `2026-11-09_04-46-57-334-m44-p3r3-w3`, `2026-11-09_07-29-35-226-m44-p3r4-w3c` |
| `w4` | 3 | `2026-11-06_04-39-21-057-m44-p3r1-w4`, `2026-11-06_13-28-58-222-m44-p3r2-w4`, `2026-11-09_04-57-35-627-m44-p3r3-w4` |
| `w5` | 3 | `2026-11-06_04-17-26-013-m44-p3r1-w5`, `2026-11-06_13-20-26-920-m44-p3r2-w5`, `2026-11-09_04-40-04-327-m44-p3r3-w5` |
| `w6` (images 4) | 3 | `2026-11-09_03-36-22-319-m44-p3r2-w6i4a`, `2026-11-09_04-04-31-805-m44-p3r2-w6i4b`, `2026-11-09_05-46-46-567-m44-p3r3-w6i4a` |
| `w7` | 3 | `2026-11-06_04-10-59-650-m44-p3r1-w7`, `2026-11-06_13-17-21-778-m44-p3r2-w7`, `2026-11-09_04-32-48-424-m44-p3r3-w7` |
| `w45` | 3 | `2026-11-06_04-48-41-294-m44-p3r1-w45`, `2026-11-09_05-07-25-920-m44-p3r3-w45`, `2026-11-09_10-14-59-184-m44-p3r5-w45` |
| `probe429` | 3 | `2026-11-06_05-03-05-872-m44-p3r1-probe429`, `2026-11-09_03-30-41-729-m44-p3r2-probe429`, `2026-11-09_05-28-01-162-m44-p3r3-probe429` |
| `w8` | 0 theo quy tắc load; tính riêng cho P18 theo mục 9 | `2026-11-09_08-33-37-333-m44-p3w8-w8` (P18: 853 mẫu, pha 71.1 phút, RSS −5.2%) |

Lượt không tính:

| Run dir | Lý do |
| --- | --- |
| `2026-11-06_04-29-10-557-m44-p3r1-w3` | Nhiễu, load1 cuối 9.29 |
| `2026-11-09_04-51-16-192-m44-p3r3-w3b` | Nhiễu, load1 cuối 8.42 |
| `2026-11-06_05-08-18-766-m44-p3r1-w6` | Chạy với images 0, khác cấu hình images 4 |
| `2026-11-06_13-38-18-846-m44-p3r2-w45` | Máy ngủ chen giữa, mục 8 |

**PO chưa ký phạm vi P19.** Bảng trên chỉ ghi số lượt đo được, chưa phải kết luận
đạt P19.
