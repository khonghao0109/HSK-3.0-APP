# Nhà cung cấp TTS cho audio HSK (Pha 5b, Q184)

**Kết luận: Azure AI Speech, giọng zh-CN neural dựng sẵn (prebuilt).** PO chọn 17/11/2026 và chấp nhận
điều khoản ngày 18/11/2026 (Q348). Dự phòng: PO tự thu âm nếu điều khoản thay đổi.

Ngày đọc mọi trang dưới đây: **18/11/2026**.

## 1. Điều khoản Azure đã trích

| # | Nội dung (trích nguyên văn) | Trang, mục |
|---|---|---|
| 1 | "Microsoft doesn't store audio or video content generated with the real-time synthesis API." | [Data, privacy, and security for text to speech](https://learn.microsoft.com/en-us/legal/cognitive-services/speech-service/text-to-speech/data-privacy-security), mục "Data storage and retention" › "Prebuilt voice / avatar" |
| 2 | "Neither input text nor output audio content is stored in Microsoft logs." | Cùng trang, mục "How do text to speech services process data?" › "Prebuilt neural voice" |
| 3 | "You're also responsible for obtaining any licenses, permissions, or other rights necessary for the content you input to the text to speech service to generate audio, image, and/or video output." | Cùng trang, phần mở đầu |
| 4 | "Output Content is Customer Data. Microsoft does not own Customer's Output Content." | [Universal License Terms for Online Services](https://www.microsoft.com/licensing/terms/product/ForOnlineServices/all), mục "Microsoft Generative AI Services" › "Output Content" |
| 5 | "Customer must use Microsoft AI Services in accordance with the Acceptable Use Policy and the Microsoft Enterprise AI Services Code of Conduct" | Cùng trang, mục "Responsible Use of Microsoft AI Services" |
| 6 | "Prebuilt neural voice may also be used for the custom neural voice use cases above, as well as additional use cases selected by customers and consistent with the Azure Acceptable Use Policy" và "No registration or pre-approval is required for additional use cases for prebuilt neural voice that meet all applicable terms and conditions." | [Transparency note: text to speech](https://learn.microsoft.com/en-us/legal/cognitive-services/speech-service/text-to-speech/transparency-note), mục "Use cases" |
| 7 | "Disclosure: Disclose the synthetic nature of voices, images, and/or videos to users such that users are not likely to be deceived or duped" | Cùng trang, mục "Considerations when choosing use cases" |

Đánh giá:

- **Lưu file và phát lại trong ứng dụng:** không trang nào đã đọc cấm. Audio thuộc dữ liệu của khách hàng (4) và
  Microsoft không giữ bản sao (1, 2). Câu (4) nằm ở mục "Generative AI Services"; trang không nói rõ dịch vụ Speech
  có thuộc nhóm này không.
- **Ghi công:** không thấy yêu cầu ghi công Microsoft hay tên giọng.
- **Công bố giọng tổng hợp:** có yêu cầu (7). Ứng dụng hiện dòng "Âm thanh được tạo bằng giọng đọc tổng hợp
  (Azure AI Speech)." ở trình phát audio (Q349).
- **Chưa đọc được:** [Microsoft Product Terms — Azure](https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/MCA)
  (trang quá lớn với công cụ của agent). PO chấp nhận rủi ro này (18/11/2026).
- Nội dung đầu vào (từ, câu ví dụ, hội thoại, câu hỏi) do dự án tự soạn, nên dự án có quyền với văn bản đầu vào (3).

## 2. So sánh

| Tiêu chí | Azure AI Speech | Google Cloud TTS | Amazon Polly |
|---|---|---|---|
| Lưu file, phát lại | Không cấm (mục 1) | Chưa kiểm điều khoản | Chưa kiểm điều khoản |
| Ghi công | Không yêu cầu; phải công bố giọng tổng hợp | Chưa kiểm | Chưa kiểm |
| Giọng zh-CN | Nhiều giọng neural nam và nữ (dùng `zh-CN-XiaoxiaoNeural` nữ, `zh-CN-YunxiNeural` nam) | Có | Có |
| SSML | Có: `<voice>` đổi giọng theo lượt, `<prosody rate>`, `<break>`, `<phoneme>` | Có | Có |
| Tài khoản | Cần Azure subscription và tài nguyên Speech (key + region) | Cần tài khoản GCP có thanh toán | Cần tài khoản AWS |

Chỉ cột Azure được kiểm với nguồn chính thức; hai cột còn lại để tham khảo, không dùng làm căn cứ. Khối lượng
lát cắt Bài 1 + đề thử khoảng vài nghìn ký tự; HSK1 đầy đủ (≈ 500 từ + câu ví dụ + bài nghe) ước dưới 100 nghìn
ký tự. Giá theo bảng giá Azure tại thời điểm sinh, PO kiểm trên hoá đơn.

## 3. Cách dùng trong repo

- Key và region đọc từ biến môi trường `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` trên máy chạy script; không ghi
  vào repo, log hay `.env` được commit.
- Script `npm run content:tts -- --manifest <file> [--dry-run]` (backend), chạy offline, không thêm service runtime
  (ADR-008). Đầu ra mp3 (media pipeline chỉ nhận mp3/wav) ở `~/hsk-media/hsk1-slice/`, `checksums.json` commit
  vào repo.
- Mỗi lô audio có `DataSource` riêng ghi nhà cung cấp, giọng, ngày sinh.
- Tốc độ chuẩn; bản 0,75x do trình phát xử lý, không sinh riêng.
