---
name: legal-compliance-licensing
description: "Thiết lập checklist pháp lý, privacy, consent, retention, bản quyền và provenance cho nội dung, dữ liệu, AI, media và payment. Sử dụng trước khi ingest/publish dữ liệu, thu thập thông tin người dùng, dùng dịch vụ bên thứ ba hoặc chuẩn bị production/release store."
---

# Legal, Compliance & Licensing

## Mục tiêu

Phát hiện yêu cầu cần chuyên gia pháp lý và tạo bằng chứng tuân thủ có thể audit; không thay thế tư vấn luật chuyên nghiệp.

## Quy trình

1. Xác định thị trường, nhóm tuổi, loại dữ liệu, kênh phân phối và provider liên quan.
2. Lập data inventory/flow: collection, purpose, lawful basis/consent, processor, region, retention và deletion.
3. Lập content/media inventory: source, author, license, attribution, modification right, commercial use và expiry.
4. Review terms/privacy/cookie/consent, account export/deletion và contact mechanism.
5. Review hợp đồng/DPA và data processing của cloud, analytics, AI, speech, email, push và payment provider.
6. Định nghĩa quyền truy cập, audit, breach response, retention và deletion/anonymization job.
7. Với trẻ vị thành niên, chốt age gate, parental consent và hạn chế tracking theo tư vấn pháp lý.
8. Với AI, công bố giới hạn, nguồn citation, human review, opt-out/feedback và chính sách dữ liệu provider.
9. Với app store/payment, review subscription disclosure, renewal, cancellation, refund và tax.
10. Tạo evidence pack và legal sign-off trước production.

## Registry bắt buộc

- Dataset/content/media registry: source URL, version/hash, license text, attribution, owner và approval.
- Subprocessor registry: mục đích, loại dữ liệu, region, DPA, retention và deletion path.
- Data retention schedule theo category và business/legal basis.
- Consent/version log và privacy request audit.

## Điểm cần chú ý cho HSK System

- Xác minh quyền dùng danh sách HSK, CC-CEDICT hoặc dataset khác theo đúng license/version.
- Không cho rằng bản dịch tiếng Việt, câu ví dụ, audio hoặc đề thi công khai là tự do sử dụng.
- Tách dữ liệu core và AI/RAG; truyền permission context, không tạo foreign key xuyên owner.
- Khi xóa user, đồng bộ xóa/anonymize chat, recording, analytics và object storage theo policy.
- Giọng nói/ghi âm là dữ liệu nhạy cảm trong nhiều bối cảnh; thu thập tối thiểu và đặt retention rõ.

## Đầu ra bắt buộc

- Compliance matrix theo feature/jurisdiction/owner/status.
- Data map, retention schedule và privacy request procedure.
- License/provenance registry và attribution requirements.
- Danh sách legal questions, quyết định, sign-off và expiry/review date.

## Quality gate

- Không ingest hoặc publish asset thiếu quyền sử dụng được xác minh.
- Không thu dữ liệu nếu thiếu purpose, access control, retention và deletion path.
- Không khẳng định “tuân thủ hoàn toàn” nếu chưa có legal review phù hợp.
- Compliance requirement phải map tới schema, UI consent, log và test vận hành.

## Điều kiện dừng hoặc chuyển cấp

Chặn ingest/release và chuyển chuyên gia pháp lý khi license mơ hồ, xử lý dữ liệu trẻ em/giọng nói, chuyển dữ liệu xuyên biên giới, dùng dữ liệu cho AI training hoặc subscription terms chưa được phê duyệt.
