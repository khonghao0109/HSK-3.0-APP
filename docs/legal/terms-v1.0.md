# Điều khoản sử dụng Hán Lộ

**Phiên bản 1.0 — Hiệu lực: [ngày publish]**

> **Ghi chú cho người duyệt (xoá khối này khi publish).** Đây là **bản nháp** do agent soạn
> theo quyết định Q186–Q193 ngày 02/11/2026, **không phải tư vấn pháp lý**. Mọi khẳng định về
> tính năng bám theo mã nguồn đọc tại baseline `31ade07` (HEAD lúc chạy gate: `60496d6`, commit
> của session song song không đụng `docs/legal/**`); bằng chứng `file:dòng` ở
> `docs/legal/data-inventory.md` (tài liệu nội bộ, không publish). Mã quyết định (Q…) và mã
> module (M…) **chỉ được phép** ở khối này, không xuất hiện trong thân văn bản.
>
> **Các quyết định phải chốt trước khi publish:**
>
> - `[CẦN PO/LEGAL]` tên pháp nhân, địa chỉ, mã số đăng ký của đơn vị vận hành Hán Lộ;
> - `[CẦN LEGAL]` giới hạn trách nhiệm, miễn trừ bảo đảm (mục 7), luật áp dụng, cơ quan giải
>   quyết tranh chấp, trình tự khiếu nại (mục 8);
> - `[CẦN PO/LEGAL]` email/kênh liên hệ chính thức và thời hạn phản hồi (mục 9);
> - `[CẦN PO/LEGAL]` kênh và quy trình xử lý báo cáo vi phạm bản quyền (mục 3);
> - `[CẦN PO/LEGAL]` quy trình thông báo, thời hạn khiếu nại và hoàn trả khi chấm dứt quyền dùng
>   (mục 5);
> - `[CẦN PO/LEGAL]` xác nhận Q191 (tuổi tối thiểu 16, tự khai) và Q188 (tick đồng ý khi đăng ký)
>   trước khi publish;
>
> **Điều kiện publish (Q196):** frontend hiển thị ghi công CC-CEDICT đầy đủ — tên nguồn +
> giấy phép CC BY-SA 4.0 + liên kết — ở trang chi tiết từ và trang Giới thiệu; làm trong task
> M1.1 (hiện chi tiết từ chỉ hiện tên nguồn + phiên bản, và chỉ hiện khi từ có câu ví dụ:
> `frontend/src/features/learner-dictionary/word-detail.tsx:308,316-320`; API từ điển **đã** trả
> `license`/`attribution` (`backend/src/modules/dictionary/dto/dictionary-word-response.dto.ts:17-22`)
> nhưng contract frontend bỏ hai trường này
> (`frontend/src/features/learner-dictionary/dictionary-contract.ts:32`) → chỉ cần sửa hiển thị,
> không đổi schema). **Điều kiện publish (Q197):** bảng phiên bản văn bản pháp lý (loại, version,
> sha256, ngày hiệu lực) làm ở M1.7b2; câu "đăng ký phải tự tick ô đồng ý" chỉ đúng sau khi
> M1.7b2 (Consent API + ô tick Q188) hoàn tất; M2.1f được gắn với M1.7b2 (PLAN M2.1f).
>
> **Lưu ý thực thi Q199:** chưa có cơ chế để Hán Lộ chủ động chuyển tài khoản sang luồng xoá
> (admin chỉ tạm khoá; API xoá yêu cầu mật khẩu người dùng —
> `backend/src/modules/user/user.service.ts:184-190`); cần task riêng trước publish.
>
> **Quyết định đã áp (02/11/2026, Q195–Q202):** kênh xuất/xoá dữ liệu là kênh liên hệ ở mục 9
> (app sẽ có nút ở bản sau — Q195); bản 1.0 chỉ ghi "có thể huỷ kết quả khi phát hiện gian lận",
> không mô tả quy trình (Q198); dưới 16 tuổi thì khoá và chuyển luồng xoá (Q199); "Dịch vụ" bản
> 1.0 là website, ứng dụng di động bổ sung ở phiên bản sau của văn bản (Q202).
>
> Không dùng placeholder "2.0, 19/10" của mockup MB-17. Số phiên bản và ngày hiệu lực điền thật
> tại lúc publish; mỗi bản lưu hash SHA-256 nội dung (Q187) tại bảng phiên bản văn bản pháp lý
> (Q197). Bản nháp này chưa tính hash.

---

Chào mừng bạn đến với **Hán Lộ** — website học tiếng Trung theo chuẩn HSK 3.0, gọi chung là
"**Dịch vụ**". Bản 1.0 của văn bản này áp dụng cho website; ứng dụng di động sẽ được bổ sung ở
phiên bản sau của văn bản.

Khi tạo tài khoản, bạn phải **chủ động tick ô đồng ý** với Điều khoản này và Chính sách bảo mật
(`/privacy`); ô đồng ý **không được tick sẵn**. Nếu không đồng ý, bạn không tạo tài khoản và
không dùng Dịch vụ.

## 1. Tài khoản

- **Độ tuổi:** bạn phải từ **16 tuổi** trở lên. Bạn **tự khai** độ tuổi khi đăng ký; chúng tôi
  không xác minh bằng giấy tờ. Nếu bạn dưới 16 tuổi, không được tạo tài khoản. Nếu chúng tôi
  phát hiện tài khoản của người dưới 16 tuổi, tài khoản sẽ bị khoá và chuyển sang quy trình xoá
  tài khoản.
- **Thông tin đúng:** bạn cung cấp email đúng; tên hiển thị không bắt buộc nhưng nếu có thì phải
  đúng. Cập nhật khi thay đổi.
- **Một tài khoản:** mỗi người dùng một tài khoản cá nhân; không chia sẻ tài khoản cho người khác.
- **Bảo mật mật khẩu:** bạn tự bảo quản mật khẩu. Chúng tôi lưu mật khẩu dưới dạng băm Argon2id,
  không ai trong Hán Lộ đọc được mật khẩu của bạn. Bạn phải báo cho chúng tôi ngay khi nghi ngờ
  tài khoản bị truy cập trái phép.
- **Đăng nhập và thiết bị:** phiên đăng nhập có thời hạn và có thể bị thu hồi (ví dụ khi bạn
  đặt lại mật khẩu, khi tài khoản bị tạm khoá).
- **Rút lại đồng ý với văn bản bắt buộc:** tài khoản sẽ đi theo luồng xoá tài khoản. Trong thời
  gian chờ xoá, bạn vẫn đăng nhập để huỷ được; sau khi ẩn danh, bạn không thể đăng nhập lại.
- **Xoá tài khoản:** bạn có thể yêu cầu xoá tài khoản bất cứ lúc nào. Yêu cầu có **7 ngày chờ**;
  trong 7 ngày đó, đăng nhập lại bằng mật khẩu đúng sẽ huỷ yêu cầu. Sau 7 ngày, tài khoản bị ẩn
  danh và không thể đăng nhập lại. Chi tiết dữ liệu được giữ lại sau ẩn danh nằm trong Chính
  sách bảo mật mục 5. Khi trang Hồ sơ chưa có nút, bạn gửi yêu cầu qua kênh liên hệ ở mục 9;
  app sẽ có nút trong bản sau.

## 2. Nội dung học và giới hạn

- **Chương trình:** Hán Lộ dạy tiếng Trung theo chuẩn HSK 3.0; danh sách từ vựng tham chiếu
  chuẩn quốc gia Trung Quốc **GF0025-2021**. Lộ trình gồm các cấp HSK; cấp 7–9 học chung một lộ
  trình nhưng mục tiêu/kết quả giữ band 7, 8 hoặc 9.
- **Bài học, bài tập, ôn tập:** điểm và tiến độ được tính theo nội dung đã chốt tại thời điểm
  bạn làm. Chúng tôi có thể cập nhật nội dung; nội dung đã dùng cho bài đã làm được lưu lại để
  bảo toàn lịch sử.
- **Thi thử chỉ để tham khảo:** bài thi thử mô phỏng dạng đề HSK, dùng để luyện tập. **Kết quả
  thi thử không phải chứng chỉ HSK chính thức**, không có giá trị pháp lý, không thay thế kỳ thi
  HSK do cơ quan có thẩm quyền tổ chức. Điểm số phụ thuộc nội dung đề tại thời điểm thi và cách
  tính điểm của Hán Lộ.
- **Kết quả thi thử không cộng XP hay huy hiệu.** Hán Lộ hiện không có hệ thống XP/huy hiệu.
- **Không bảo đảm kết quả:** chúng tôi không cam kết bạn đạt một band HSK cụ thể, đỗ kỳ thi thật
  hay đạt một mục tiêu học nào.
- **Tính năng chưa có:** một số tính năng đang được phát triển (ví dụ luyện phát âm có ghi âm,
  trợ lý AI, đăng nhập mạng xã hội, thông báo/nhắc học, thanh toán). Chúng tôi sẽ thông báo khi
  tính năng ra mắt và xin các đồng ý riêng nếu cần.

## 3. Quyền sở hữu nội dung và ghi nguồn

- **Nội dung của Hán Lộ:** giao diện, bài học, bài tập, đề thi thử, hình ảnh, âm thanh, nhãn
  hiệu và mã nguồn do Hán Lộ tạo hoặc được cấp phép thuộc quyền của Hán Lộ hoặc bên cấp phép.
  Bạn được dùng cho việc học cá nhân; không được sao chép, bán lại, tái phát hành hay dùng để
  huấn luyện sản phẩm khác nếu không có văn bản đồng ý — **trừ phần nội dung của bên thứ ba được
  phân phối theo giấy phép riêng** (xem dưới).
- **Nguồn mở và ghi nguồn:**
  - **CC-CEDICT** (từ điển Trung–Anh, giấy phép **CC BY-SA 4.0**, do MDBG công bố): Hán Lộ dùng
    **nghĩa tiếng Anh** của một số từ vựng từ CC-CEDICT. Phần nghĩa tiếng Anh này được phân phối
    theo **CC BY-SA 4.0**; bạn được dùng lại phần đó nếu tuân thủ CC BY-SA 4.0 (kể cả ghi công
    và chia sẻ tương tự). Hán Lộ hiển thị tên nguồn, giấy phép CC BY-SA 4.0 và liên kết tại
    trang **Giới thiệu** và trang **chi tiết từ**. Nghĩa tiếng Việt không dịch lại từ
    CC-CEDICT.
  - **Danh sách từ vựng HSK** tham chiếu chuẩn quốc gia Trung Quốc **GF0025-2021**; nguồn và
    giấy phép của từng bộ dữ liệu được ghi trong phần quản trị nội dung.
- **Nội dung bạn tạo:** câu trả lời và từ đã lưu của bạn thuộc về bạn. Bạn cấp Hán Lộ quyền lưu,
  xử lý và hiển thị nội dung đó **chỉ để vận hành Dịch vụ cho chính bạn** (ví dụ chấm bài, hiện
  lại lịch sử). Chúng tôi không công khai nội dung của bạn cho người khác.
- **Báo cáo vi phạm bản quyền:** `[CẦN PO/LEGAL: kênh và quy trình xử lý báo cáo bản quyền]`.

## 4. Hành vi bị cấm

Bạn không được:

1. Dùng Dịch vụ để vi phạm pháp luật, xâm phạm quyền của người khác.
2. Chia sẻ, bán, cho thuê tài khoản; mạo danh người khác.
3. Sao chép, bóc tách, dịch ngược, gỡ bảo vệ hay tự động hoá Dịch vụ để lấy nội dung/dữ liệu.
4. Tấn công, dò quét, thử vượt giới hạn tần suất, chèn mã độc, gây quá tải hệ thống.
5. Gian lận trong thi thử: dùng nhiều tài khoản để làm lại, sửa dữ liệu bài làm, hoặc can thiệp
   vào quá trình chấm.
6. Đăng tải nội dung trái pháp luật, thù địch, quấy rối (khi tính năng cho phép nội dung do
   người dùng tạo ra mắt).
7. Dùng nội dung của Hán Lộ cho mục đích thương mại khi chưa được phép.

## 5. Tạm khoá và chấm dứt

- **Bạn có thể dừng bất cứ lúc nào:** đăng xuất, hoặc yêu cầu xoá tài khoản (mục 1).
- **Hán Lộ có thể tạm khoá tài khoản** khi có dấu hiệu vi phạm Điều khoản, gian lận thi, hoặc
  khi cần bảo vệ hệ thống/người dùng khác. Khi tài khoản bị khoá, mọi phiên đăng nhập bị thu hồi
  ngay và thao tác được ghi vào nhật ký kiểm toán nội bộ.
- **Huỷ kết quả thi:** chúng tôi có thể huỷ kết quả bài thi khi phát hiện gian lận.
- **Chấm dứt:** với vi phạm nghiêm trọng hoặc lặp lại, chúng tôi có thể chấm dứt quyền dùng
  Dịch vụ. `[CẦN PO/LEGAL]` quy trình thông báo, thời hạn khiếu nại và hoàn trả (nếu có gói trả
  phí trong tương lai — hiện chưa có thanh toán).
- **Hiệu lực của việc chấm dứt:** các mục về sở hữu trí tuệ, giới hạn trách nhiệm, luật áp dụng
  và các nghĩa vụ đã phát sinh vẫn còn hiệu lực sau khi chấm dứt.
- **Dữ liệu sau chấm dứt:** xử lý theo Chính sách bảo mật (ẩn danh sau 7 ngày chờ; dữ liệu học
  còn lại gắn với mã người dùng giả danh).

## 6. Thay đổi Điều khoản

- Bản chính thức đầu tiên là **phiên bản 1.0**, hiệu lực từ **ngày publish**. Mỗi bản lưu
  **hash SHA-256 nội dung** trong bảng phiên bản văn bản pháp lý (loại văn bản, version, sha256,
  ngày hiệu lực); văn bản ghi rõ số phiên bản và ngày hiệu lực.
- Khi có phiên bản mới, chúng tôi thông báo trong app và yêu cầu bạn đồng ý lại:
  - trong **14 ngày trước ngày hiệu lực**, bạn có thể chọn **"Để sau"**;
  - quá 14 ngày đó mà chưa đồng ý, ứng dụng sẽ **chặn sử dụng**;
  - khi bị chặn, bạn **vẫn** xuất được dữ liệu, xoá tài khoản và đăng xuất.
- Nếu không đồng ý với thay đổi, bạn có thể ngừng dùng Dịch vụ và xoá tài khoản.

## 7. Giới hạn trách nhiệm

`[CẦN LEGAL: toàn bộ mục này do Legal soạn/chốt]`. Nội dung dự kiến cần bao gồm:

- Dịch vụ được cung cấp **"nguyên trạng"**; trong phạm vi pháp luật cho phép, Hán Lộ không bảo
  đảm Dịch vụ luôn liên tục, không lỗi, hoặc phù hợp với một mục đích cụ thể.
- Hán Lộ không chịu trách nhiệm với thiệt hại gián tiếp, ngẫu nhiên, hệ quả (mất lợi nhuận, mất
  dữ liệu do phía người dùng, mất cơ hội) trong phạm vi pháp luật cho phép.
- Kết quả thi thử, gợi ý lộ trình và nội dung học **không phải cam kết đạt kết quả**; xem mục 2.
- Giới hạn trách nhiệm không loại trừ trách nhiệm mà pháp luật không cho phép loại trừ.
- `[CẦN LEGAL]` mức giới hạn tiền, cách tính, ngoại lệ.

## 8. Luật áp dụng và giải quyết tranh chấp

`[CẦN LEGAL: luật áp dụng, cơ quan giải quyết tranh chấp, ngôn ngữ ưu tiên, trình tự thương
lượng trước khi khởi kiện]`. Các bên nỗ lực giải quyết tranh chấp bằng thương lượng trước.

## 9. Liên hệ

`[CẦN PO/LEGAL: email/kênh liên hệ chính thức, địa chỉ, thời hạn phản hồi]`.

## Phụ lục A — Ghi nguồn nội dung mở

| Nguồn | Dùng cho | Giấy phép / ghi công |
| --- | --- | --- |
| CC-CEDICT (MDBG, https://www.mdbg.net/chinese/dictionary?page=cc-cedict) | Nghĩa tiếng Anh của một số từ vựng | CC BY-SA 4.0 — ghi công tại trang Giới thiệu và chi tiết từ |
| Danh sách từ vựng HSK 3.0 theo chuẩn GF0025-2021 | Phân cấp từ vựng HSK 1–9 | Nguồn chuẩn quốc gia Trung Quốc; thông tin nguồn/giấy phép ghi trong quản trị nội dung |

## Phụ lục B — Lịch sử phiên bản

| Phiên bản | Ngày hiệu lực | Ghi chú |
| --- | --- | --- |
| 1.0 | `[ngày publish]` | Bản chính thức đầu tiên. Hash SHA-256 nội dung: tính và lưu tại lúc publish trong bảng phiên bản văn bản pháp lý, không tính trong bản nháp |
