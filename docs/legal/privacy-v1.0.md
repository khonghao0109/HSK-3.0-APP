# Chính sách bảo mật Hán Lộ

**Phiên bản 1.0 — Hiệu lực: [ngày publish]**

> **Ghi chú cho người duyệt (xoá khối này khi publish).** Đây là **bản nháp** do agent soạn
> theo quyết định Q186–Q193 ngày 02/11/2026, **không phải tư vấn pháp lý**. Mọi khẳng định về
> dữ liệu/tính năng bám theo mã nguồn đọc tại baseline `31ade07` (HEAD lúc chạy gate: `60496d6`, commit
> của session song song không đụng `docs/legal/**`); bằng chứng `file:dòng` nằm trong
> `docs/legal/data-inventory.md` (tài liệu nội bộ, không publish). Mã quyết định (Q…) và mã
> module (M…) **chỉ được phép** ở khối này, không xuất hiện trong thân văn bản.
>
> **Các quyết định phải chốt trước khi publish:**
>
> - `[CẦN PO/LEGAL]` tên pháp nhân, địa chỉ, mã số đăng ký của đơn vị vận hành Hán Lộ;
> - `[CẦN PO/LEGAL]` email/kênh liên hệ cho yêu cầu quyền riêng tư, khiếu nại và thời hạn phản hồi;
> - `[CẦN LEGAL]` căn cứ pháp lý cho từng mục đích xử lý (mục 3), luật áp dụng, cơ quan giải
>   quyết tranh chấp, trình tự khiếu nại;
> - `[CẦN LEGAL]` mốc thời gian và kênh thông báo khi xảy ra sự cố dữ liệu (mục 8);
> - `[CẦN PO]` nơi đặt server/DB, region object storage, nhà cung cấp mail production, xác nhận
>   cấu hình HTTPS/TLS tại edge (repo **không có** cấu hình `listen 443`/`ssl_certificate`; chỉ có
>   2 file nginx cho route media);
> - `[CẦN PO]` chính sách truy cập cơ sở dữ liệu và nhật ký truy cập nội bộ (mục 4);
> - `[CẦN PO]` thời gian giữ log máy chủ web và **chính sách backup/DB snapshot** (mục 5) — cần
>   nói rõ dữ liệu ẩn danh có thể còn trong backup tới khi hết vòng backup;
>
> **Điều kiện publish (Q197):** mục 6 (consent tuỳ chọn) và câu "đăng ký phải tự tick ô đồng
> ý" chỉ đúng sau khi M1.7b2 (Consent API + ô tick Q188) hoàn tất; M2.1f được gắn với M1.7b2
> (PLAN M2.1f). Cũng trong M1.7b2: bảng phiên bản văn bản pháp lý (loại, version, sha256, ngày
> hiệu lực) và bổ sung hash + kênh vào bản ghi consent theo Q192. Bản 1.0 chỉ publish khi các
> việc này xong.
>
> **Lưu ý thực thi Q199:** hiện `requestAccountDeletion` yêu cầu xác thực lại bằng mật khẩu của
> người dùng (`backend/src/modules/user/user.service.ts:184-190`); **chưa có** cơ chế để Hán Lộ
> chủ động chuyển tài khoản sang luồng xoá (admin chỉ tạm khoá). Cần task riêng (admin-triggered
> deletion hoặc quy trình thủ công có kiểm soát) trước publish — không tự chọn cách triển khai.
>
> **Quyết định đã áp (02/11/2026, Q195–Q202):** kênh xuất/xoá/sửa hồ sơ là kênh liên hệ ở mục 11
> (app sẽ có nút ở bản sau — Q195); chỉ số sản phẩm dạng tổng hợp theo lợi ích hợp pháp, lựa
> chọn đồng ý "phân tích sản phẩm" chỉ áp cho việc ghi sự kiện sử dụng chi tiết (Q200); dưới 16
> tuổi thì khoá tài khoản và chuyển luồng xoá (Q199); không purge dữ liệu học sau ẩn danh
> (Q201); "Dịch vụ" bản 1.0 là website (Q202).
>
> Không dùng placeholder "2.0, 19/10" của mockup MB-17. Số phiên bản và ngày hiệu lực điền thật
> tại lúc publish; mỗi bản lưu hash SHA-256 nội dung (Q187) tại bảng phiên bản văn bản pháp lý
> (Q197). Bản nháp này chưa tính hash.

---

Hán Lộ là ứng dụng học tiếng Trung theo chuẩn HSK 3.0. Chính sách này giải thích chúng tôi thu
thập dữ liệu gì, vì sao, giữ bao lâu và bạn kiểm soát dữ liệu của mình thế nào.

Câu ngắn gọn: **chúng tôi chỉ thu thập dữ liệu cần để tài khoản và việc học hoạt động; không
bán dữ liệu; không chạy quảng cáo hay analytics của bên thứ ba; bạn có thể xuất hoặc xoá dữ
liệu của mình.**

## 1. Ai chịu trách nhiệm

Đơn vị vận hành Hán Lộ và là bên kiểm soát dữ liệu: `[CẦN PO/LEGAL: tên pháp nhân, địa chỉ,
mã số đăng ký kinh doanh]`.

Liên hệ về dữ liệu cá nhân: `[CẦN PO/LEGAL: email/kênh liên hệ, thời hạn phản hồi]`.

## 2. Dữ liệu chúng tôi thu thập

Chúng tôi thu thập ba nhóm dữ liệu.

### 2.1. Dữ liệu tài khoản (bắt buộc để dùng dịch vụ)

| Dữ liệu | Ví dụ | Vì sao cần |
| --- | --- | --- |
| Email | `ban@example.com` (được chuẩn hoá: bỏ khoảng trắng, chữ thường) | Đăng nhập, xác thực email, đặt lại mật khẩu, thông báo về tài khoản |
| Mật khẩu | Chỉ lưu dạng băm Argon2id có "pepper"; không ai đọc được mật khẩu gốc | Bảo vệ tài khoản |
| Tên hiển thị | Tên bạn nhập khi đăng ký (hiện chỉ hiển thị lại trong Hồ sơ) | Chào bạn trong app |
| Trạng thái tài khoản | Vai trò, đang hoạt động/bị khoá/đang chờ xoá/đã ẩn danh, số lần đăng nhập sai, lần đăng nhập cuối | Chống dò mật khẩu, phân quyền, vận hành vòng đời tài khoản |
| Cài đặt hồ sơ | Ngôn ngữ `vi-VN`, múi giờ `Asia/Ho_Chi_Minh` | Hiển thị ngày giờ đúng |

Chúng tôi **không** thu thập số điện thoại, địa chỉ, ngày sinh, ảnh đại diện (tính năng ảnh
chưa có) và không yêu cầu giấy tờ tuỳ thân.

### 2.2. Dữ liệu học tập (bắt buộc để dịch vụ hoạt động)

| Dữ liệu | Ví dụ | Vì sao cần |
| --- | --- | --- |
| Mục tiêu học | Cấp HSK mục tiêu, band 7/8/9, số phút mỗi ngày, mục đích học | Cá nhân hoá lộ trình |
| Kế hoạch học | Cấp mục tiêu, danh sách bài, lịch học | Tạo và hiển thị lộ trình |
| Tiến độ | Bài đã học, % hoàn thành, thời gian học, hoạt động gần nhất | Hiển thị tiến độ, mở khoá bài |
| Bài tập đã làm | Câu trả lời, điểm, thời gian làm | Chấm điểm, xem lại |
| Từ đã lưu | Từ vựng bạn lưu vào sổ từ | Sổ từ cá nhân |
| Sự kiện học | Bắt đầu/kết thúc bài, nộp bài tập | Vận hành tiến độ; tính chỉ số tổng hợp nội bộ |
| Bài thi thử | Đề đã chốt tại thời điểm thi, câu trả lời, điểm, kết quả từng kỹ năng | Chạy và chấm bài thi thử |

Một số dữ liệu dự kiến khác **chưa có tính năng ghi nhận** nên chưa được thu thập: bài kiểm tra
đầu vào, lịch ôn tập ngắt quãng. Khi các tính năng này ra mắt, chính sách sẽ được cập nhật trước
khi thu thập.

### 2.3. Dữ liệu kỹ thuật (tối thiểu, để bảo mật và vận hành)

| Dữ liệu | Chi tiết | Giữ bao lâu |
| --- | --- | --- |
| Phiên đăng nhập | Chỉ lưu **mã băm một chiều** của mã phiên, thời hạn, thời điểm dùng gần nhất | Mặc định hết hạn sau 30 ngày (cấu hình được tới 90 ngày); dòng đã hết hạn được dọn muộn nhất 30 ngày sau khi hết hạn |
| Token đặt lại mật khẩu / xác thực email | Chỉ lưu **mã băm một chiều**; token sống 30 phút / 24 giờ | Mã băm nằm tới khi bạn xoá tài khoản; token hết hạn không dùng được |
| Giới hạn tần suất | Bộ đếm theo tài khoản hoặc theo địa chỉ IP cho khách chưa đăng nhập | Vài phút, tự xoá |
| Nhật ký kiểm toán | Thao tác nhạy cảm: yêu cầu xoá tài khoản, ẩn danh, khoá/mở tài khoản, đổi vai trò, thao tác nội dung | Giữ lâu dài để truy vết; không xoá |

Địa chỉ IP: hệ thống **không lưu IP trong bản ghi đồng ý**. Với khách chưa đăng nhập, địa chỉ IP
chỉ được lưu trong bộ đếm chống lạm dụng **dưới dạng mã băm** (không lưu IP gốc; mã băm sống vài
phút). Log của máy chủ web có thể ghi IP để vận hành/điều tra sự cố (`[CẦN PO]` thời gian giữ
log hạ tầng). Chúng tôi không dùng IP để theo dõi hành vi học.

Chúng tôi **không** lưu: mật khẩu dạng đọc được, token gốc, hay mã đăng nhập trong
`localStorage`/`sessionStorage` của trình duyệt.

## 3. Mục đích và căn cứ xử lý

| Mục đích | Căn cứ (dự kiến) |
| --- | --- |
| Tạo và vận hành tài khoản, đăng nhập, bảo mật tài khoản | Thực hiện hợp đồng cung cấp dịch vụ; `[CẦN LEGAL]` xác nhận |
| Cung cấp tính năng học: lộ trình, bài học, ôn tập, thi thử | Thực hiện hợp đồng cung cấp dịch vụ; `[CẦN LEGAL]` xác nhận |
| Chống lạm dụng, chống dò mật khẩu, bảo vệ hệ thống | Lợi ích hợp pháp của chúng tôi và của người dùng; `[CẦN LEGAL]` xác nhận |
| Gửi mail giao dịch (xác thực email, đặt lại mật khẩu, thông báo xoá tài khoản) | Thực hiện hợp đồng; `[CẦN LEGAL]` xác nhận |
| Chỉ số sản phẩm **dạng tổng hợp** từ dữ liệu học có sẵn | Lợi ích hợp pháp. Lựa chọn đồng ý "phân tích sản phẩm" chỉ áp dụng cho việc ghi sự kiện sử dụng chi tiết (chưa có) |
| Phân tích sản phẩm bổ sung, thông báo/marketing, ghi âm phát âm | **Chỉ khi bạn đồng ý** — hiện chưa có, xem mục 6 |

Chúng tôi không bán dữ liệu cá nhân và không dùng dữ liệu học của bạn để chạy quảng cáo.

## 4. Dữ liệu được lưu ở đâu và ai xem được

- Dữ liệu chính nằm trong cơ sở dữ liệu PostgreSQL của Hán Lộ. `[CẦN PO: nơi đặt server/DB,
  region, nhà cung cấp hạ tầng]`.
- File media (audio, ảnh bài học) và file xuất dữ liệu của bạn nằm trong **kho lưu trữ riêng
  tư**, không phải URL công khai.
- Mail giao dịch đi qua dịch vụ gửi mail. Mã nguồn hỗ trợ Amazon SES và một dịch vụ nội bộ cho
  môi trường phát triển; **nhà cung cấp production `[CẦN PO]`**.
- Trong **giao diện quản trị**, quản trị viên chỉ xem được danh sách người dùng (email, tên, vai
  trò, trạng thái, lần đăng nhập cuối) và nhật ký kiểm toán; giao diện này **không có màn hình
  xem bài làm, câu trả lời hay mật khẩu**. `[CẦN PO]` chính sách phân quyền truy cập cơ sở dữ
  liệu và nhật ký truy cập nội bộ (mã nguồn không chứng minh được ai có quyền DB).
- Chúng tôi có thể phải cung cấp dữ liệu khi pháp luật yêu cầu, sau khi kiểm tra yêu cầu hợp lệ.
  `[CẦN LEGAL]` quy trình và luật áp dụng.

Không có công cụ analytics/quảng cáo của bên thứ ba trong ứng dụng; trang web chỉ tải script từ
chính Hán Lộ.

## 5. Thời gian lưu

| Dữ liệu | Thời gian lưu |
| --- | --- |
| Tài khoản, hồ sơ | Tới khi bạn xoá tài khoản và quá thời gian chờ 7 ngày |
| Dữ liệu học, bài thi, kết quả, bản ghi đồng ý, nhật ký kiểm toán | Giữ lại sau khi ẩn danh tài khoản để bảo toàn lịch sử học và đối soát; không còn gắn với email/tên của bạn |
| Phiên đăng nhập | Mặc định hết hạn sau 30 ngày (cấu hình tới 90); xoá muộn nhất 30 ngày sau khi hết hạn; xoá ngay khi xoá tài khoản |
| Token đặt lại mật khẩu / xác thực email | Token sống 30 phút / 24 giờ; mã băm bị xoá khi xoá tài khoản |
| File xuất dữ liệu của bạn | Tải được trong 24 giờ; file bị xoá sau 7 ngày |
| Bộ đếm chống lạm dụng | Vài phút |
| Log máy chủ web | `[CẦN PO]` |
| Bản sao lưu (backup) hệ thống | `[CẦN PO: chính sách backup và thời gian giữ; nêu rõ dữ liệu đã ẩn danh có thể còn trong backup tới khi hết vòng backup]` |

Khi bạn xoá tài khoản, chúng tôi **ẩn danh** thay vì xoá cứng toàn bộ: email được thay bằng
địa chỉ không gửi được thư, tên và ảnh đại diện bị xoá, mật khẩu bị thay bằng giá trị ngẫu
nhiên. Dữ liệu học (tiến độ, bài làm, kết quả, bản ghi đồng ý) **được giữ lại** dưới một định
danh giả; dữ liệu này không còn liên kết tới email hay tên của bạn. Bản 1.0 **không xoá** dữ
liệu học sau khi ẩn danh.

## 6. Đồng ý tuỳ chọn (tách riêng, mặc định tắt)

Ngoài việc đồng ý với Điều khoản và Chính sách bảo mật khi đăng ký, Hán Lộ sẽ có các lựa chọn
**tuỳ chọn**. Mỗi lựa chọn:

- tách riêng, **mặc định tắt**, không tick sẵn;
- chỉ bật khi tính năng tương ứng ra mắt;
- **rút lại được bất cứ lúc nào**, và việc rút lại không làm mất quyền dùng các tính năng bắt buộc.

| Lựa chọn tuỳ chọn | Trạng thái hiện tại | Khi ra mắt |
| --- | --- | --- |
| Phân tích sản phẩm | **Chưa có** lựa chọn này trong app | Sẽ xin đồng ý riêng trước khi ghi sự kiện sử dụng chi tiết. Chỉ số tổng hợp từ dữ liệu học có sẵn không cần lựa chọn này |
| Thông báo, nhắc học và marketing | **Chưa có**; hiện không gửi thông báo hay marketing | Sẽ xin đồng ý riêng; có thể tắt từng loại |
| Ghi âm phát âm | **Chưa có** tính năng ghi âm | Sẽ xin quyền micro và đồng ý riêng trước lần ghi đầu; bản ghi bị xoá sau 30 ngày |

Nếu bạn rút lại đồng ý với văn bản bắt buộc, tài khoản không thể tiếp tục hoạt động: chúng tôi
hướng bạn sang luồng xoá tài khoản. Trong thời gian chờ xoá, bạn vẫn đăng nhập để huỷ được. Sau
khi tài khoản bị ẩn danh, bạn không thể đăng nhập lại.

Khi chúng tôi đổi phiên bản văn bản, bạn sẽ được yêu cầu đồng ý lại (xem mục 10).

## 7. Quyền của bạn

| Quyền | Cách thực hiện | Ghi chú |
| --- | --- | --- |
| Xem dữ liệu tài khoản | Tab **Hồ sơ** trong app hiển thị tên và email | Các dữ liệu khác xem qua bản xuất dữ liệu |
| Sửa hồ sơ | Hiện **chưa có màn hình sửa**. Gửi yêu cầu qua kênh liên hệ ở mục 11; app sẽ có nút trong bản sau | Backend đã có khả năng cập nhật tên hiển thị/ngôn ngữ/múi giờ |
| Xuất dữ liệu | Gửi yêu cầu xuất: hệ thống tạo **một file JSON** gồm dữ liệu tài khoản, học tập, thi, bản ghi đồng ý, nhật ký liên quan. File tải được trong **24 giờ**, bị xoá sau **7 ngày**. Tối đa 1 yêu cầu/24 giờ | Gửi yêu cầu qua kênh liên hệ ở mục 11; app sẽ có nút trong bản sau |
| Xoá tài khoản | Gửi yêu cầu xoá (xác thực lại bằng mật khẩu). Tài khoản chờ **7 ngày**; đăng nhập lại trong 7 ngày sẽ huỷ yêu cầu. Sau 7 ngày, tài khoản bị ẩn danh | Gửi yêu cầu qua kênh liên hệ ở mục 11; app sẽ có nút trong bản sau |
| Rút lại đồng ý tuỳ chọn | Tắt trong phần cài đặt quyền riêng tư khi tính năng tương ứng ra mắt | Hiện chưa có tính năng tuỳ chọn nào |
| Đăng xuất | Nút đăng xuất trong Hồ sơ; xoá phiên trên trình duyệt | |

Nếu bạn cho rằng chúng tôi xử lý dữ liệu sai, hãy liên hệ trước để chúng tôi kiểm tra. Bạn cũng
có quyền khiếu nại tới cơ quan bảo vệ dữ liệu có thẩm quyền. `[CẦN LEGAL: cơ quan, trình tự]`.

## 8. Bảo mật

- Mật khẩu được băm bằng **Argon2id** (hàm băm một chiều có muối) kèm một khoá bí mật phụ; hệ
  thống từ chối giá trị không đúng định dạng này.
- Mã phiên đăng nhập, mã đặt lại mật khẩu và mã xác thực email **chỉ được lưu dưới dạng băm**,
  không lưu mã gốc.
- Trình duyệt **không giữ mã đăng nhập** trong vùng nhớ đọc được: mã nằm trong cookie
  `HttpOnly` (JavaScript không đọc được), `SameSite=Lax`, và `Secure` (chỉ gửi qua HTTPS) ở môi
  trường production; máy chủ của Hán Lộ gắn mã khi gọi hệ thống nội bộ.
- Kết nối được mã hoá bằng HTTPS. `[CẦN PO: xác nhận cấu hình TLS/HTTPS tại edge — repo không
  có cấu hình này]`. API đặt các header bảo vệ (chặn nhúng iframe, chặn đoán kiểu nội dung,
  chính sách nội dung), chỉ cho phép origin đã cấu hình.
- Có giới hạn tần suất theo tài khoản hoặc theo IP cho khách chưa đăng nhập, để chống dò mật
  khẩu và lạm dụng.
- Quyền quản trị là riêng biệt; khoá tài khoản sẽ thu hồi mọi phiên đăng nhập ngay.
- Khi phát hiện sự cố ảnh hưởng dữ liệu cá nhân, chúng tôi sẽ thông báo theo luật áp dụng.
  `[CẦN LEGAL: mốc thời gian, kênh thông báo]`.

Không hệ thống nào an toàn tuyệt đối. Bạn nên dùng mật khẩu riêng cho Hán Lộ và không chia sẻ
mật khẩu.

## 9. Trẻ em và độ tuổi tối thiểu

Hán Lộ dành cho người từ **16 tuổi trở lên**. Khi đăng ký, bạn **tự khai** rằng mình đủ 16 tuổi;
chúng tôi không xác minh tuổi bằng giấy tờ. Nếu bạn dưới 16 tuổi, không được tạo tài khoản.
Nếu chúng tôi phát hiện tài khoản của người dưới 16 tuổi, tài khoản sẽ bị **khoá** và chuyển
sang quy trình xoá tài khoản (7 ngày chờ, sau đó ẩn danh như mục 5). Người giám hộ có thể báo
qua kênh liên hệ ở mục 11.

## 10. Thay đổi chính sách

- Bản chính thức đầu tiên là **phiên bản 1.0**; hiệu lực từ **ngày publish**.
- Mỗi phiên bản được lưu kèm **hash SHA-256 nội dung** để đối chiếu, trong bảng phiên bản văn
  bản pháp lý (loại văn bản, version, sha256, ngày hiệu lực); văn bản ghi rõ số phiên bản và
  ngày hiệu lực.
- Khi có phiên bản mới, chúng tôi thông báo trong app và yêu cầu bạn đồng ý lại:
  - trong **14 ngày trước ngày hiệu lực**, bạn có thể chọn **"Để sau"**;
  - quá 14 ngày đó mà chưa đồng ý, ứng dụng sẽ **chặn sử dụng**;
  - khi bị chặn, bạn **vẫn** xuất được dữ liệu, xoá tài khoản và đăng xuất.
- Nếu bạn không đồng ý với thay đổi, bạn có thể ngừng dùng dịch vụ và xoá tài khoản.

## 11. Liên hệ

`[CẦN PO/LEGAL: email/kênh liên hệ chính thức, địa chỉ, thời hạn phản hồi]`.

## Phụ lục A — Lịch sử phiên bản

| Phiên bản | Ngày hiệu lực | Ghi chú |
| --- | --- | --- |
| 1.0 | `[ngày publish]` | Bản chính thức đầu tiên. Hash SHA-256 nội dung: tính và lưu tại lúc publish trong bảng phiên bản văn bản pháp lý, không tính trong bản nháp |
