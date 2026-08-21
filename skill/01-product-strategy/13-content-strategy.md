---
name: content-strategy
description: "Lập chiến lược tạo, mua, chuẩn hóa, bản địa hóa, duyệt, phát hành và duy trì nội dung học HSK. Sử dụng khi thiết kế CMS/workflow, lập kế hoạch dữ liệu, giải quyết content gap hoặc chuẩn bị scale đội biên tập."
---

# Content Strategy

## Mục tiêu

Đảm bảo nội dung đúng học thuật, có nguồn hợp pháp, nhất quán, tìm được, tái sử dụng được và vận hành với chi phí có thể kiểm soát.

## Quy trình

1. Kiểm kê asset: từ, nghĩa, ví dụ, grammar, lesson, story, question, audio, image, PDF và AI knowledge.
2. Gán owner, source, license, language, HSK version, quality status và lifecycle cho mỗi loại.
3. Chọn chiến lược `create`, `license`, `partner`, `open data` hoặc `AI-assisted with human review`.
4. Định nghĩa content model/taxonomy độc lập với màn hình.
5. Thiết kế workflow `draft → review → approved → published → archived`, có revision và audit.
6. Viết style guide cho simplified/traditional, Pinyin, tiếng Việt/Anh, tone mark, punctuation và terminology.
7. Thiết kế import preview, validation, duplicate detection, provenance và rollback.
8. Đặt quality rubric và sampling plan cho linguistic, pedagogical, media và accessibility QA.
9. Lập localization workflow; không dịch máy trực tiếp rồi publish.
10. Theo dõi coverage, freshness, lỗi báo cáo, throughput và cost per approved asset.

## Quy tắc AI-assisted content

- Gắn trạng thái AI-generated/AI-assisted và model/prompt version khi cần audit.
- Bắt buộc human review trước publish cho nội dung học, đáp án và lời giải.
- Không gửi dữ liệu có bản quyền hoặc dữ liệu cá nhân vào provider trái chính sách.
- Dùng AI để hỗ trợ nháp/kiểm tra, không coi output là nguồn học thuật.

## Đầu ra bắt buộc

- Content inventory và gap matrix theo level/skill/objective.
- Content model, taxonomy, metadata dictionary và style guide.
- Workflow/RACI, SLA review và quality rubric.
- Sourcing/licensing plan và content operations dashboard.

## Quality gate

- Không có asset published thiếu source/license/version/owner.
- Dictionary tiếng Việt phải có QA ngôn ngữ và provenance, không chỉ field trống hoặc dịch máy.
- Audio có speaker/language/quality/consent hoặc license phù hợp.
- Nội dung sửa sau publish tạo revision; không làm sai lịch sử exam/progress.

## Áp dụng cho HSK System

Ưu tiên hoàn thiện dictionary detail, nghĩa tiếng Việt, HSK 1–9, CMS Lite, import/validate/publish và version câu hỏi trước capability nội dung P1/P2.

## Điều kiện dừng hoặc chuyển cấp

Dừng publish khi thiếu quyền sử dụng, source mơ hồ, review học thuật thất bại hoặc pipeline không thể rollback một batch lỗi.
