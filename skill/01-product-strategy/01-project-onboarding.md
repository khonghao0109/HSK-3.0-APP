---
name: project-onboarding
description: "Thiết lập hiểu biết ban đầu về dự án, phạm vi, kiến trúc, cách chạy và quy tắc làm việc. Sử dụng khi bắt đầu một phiên làm việc mới, tiếp nhận thành viên mới, khởi động epic hoặc trước khi thay đổi nhiều module trong HSK System."
---

# Project Onboarding

## Mục tiêu

Nắm đủ bối cảnh để làm việc an toàn trong HSK System mà không suy đoán sai phạm vi, trạng thái triển khai hoặc nguồn dữ liệu.

## Đầu vào bắt buộc

- Yêu cầu hiện tại và tiêu chí hoàn thành của người giao việc.
- `docs/PROJECT_CONTEXT_FOR_AI.md`, `docs/FUNCTIONAL_HIERARCHY.md` và `docs/roadmap.md`.
- Cấu trúc repo, trạng thái Git, hướng dẫn trong `AGENTS.md` nếu có.
- README, manifest, file cấu hình và lệnh test/build của service liên quan.

## Quy trình

1. Đọc yêu cầu và viết lại mục tiêu thành một kết quả kiểm chứng được.
2. Xác định phạm vi service: `frontend`, `backend`, `ai`, `docs`, dữ liệu hoặc hạ tầng.
3. Kiểm tra trạng thái Git; coi mọi thay đổi không do mình tạo là tài sản của người dùng.
4. Đọc tài liệu nền theo thứ tự: context → phân cấp chức năng → roadmap → API/schema liên quan.
5. Lập bản đồ nhanh entry point, module, dữ liệu, test và lệnh chạy của phạm vi.
6. Đối chiếu tài liệu với code; ghi rõ điểm nào là hiện trạng, mục tiêu hoặc giả định.
7. Xác nhận các ràng buộc HSK: cấp 1–9, vai trò user/admin, nguồn nội dung, privacy và ranh giới AI.
8. Chọn kiểm tra baseline tỷ lệ thuận với rủi ro: build, unit test, schema validate hoặc smoke test.
9. Ghi lại câu hỏi mở chỉ khi câu trả lời có thể thay đổi đáng kể hướng triển khai.

## Đầu ra bắt buộc

- Tóm tắt mục tiêu, phạm vi trong/ngoài yêu cầu và tiêu chí hoàn thành.
- Bản đồ thành phần bị ảnh hưởng và nguồn sự thật tương ứng.
- Baseline kỹ thuật cùng kết quả kiểm tra.
- Danh sách giả định, rủi ro và quyết định cần xác nhận.

## Quality gate

- Không bắt đầu sửa code khi chưa biết owner dữ liệu và luồng người dùng liên quan.
- Không mô tả scaffold là chức năng đã hoàn thiện.
- Không ghi đè thay đổi có sẵn hoặc mở rộng phạm vi ngoài yêu cầu.
- Mỗi kết luận quan trọng phải truy được về file, code, schema hoặc kết quả lệnh.

## Áp dụng cho HSK System

- Coi backend NestJS/Prisma/PostgreSQL là phần có runtime rõ nhất; frontend và AI có thể còn ở mức scaffold.
- Dùng `docs/DATABASE_SCHEMA_COMPLETION_PLAN.md` khi thay đổi chạm tới dữ liệu.
- Dùng `docs/api.md` khi thay đổi chạm tới contract `/api/v1`.
- Kiểm tra sự nhất quán giữa HSK 1–9, UI, schema và seed trước khi kết luận.

## Điều kiện dừng hoặc chuyển cấp

Dừng và báo rõ khi thiếu quyền truy cập, thiếu dữ liệu nguồn, có xung đột thay đổi người dùng, hoặc một quyết định sản phẩm chưa chốt sẽ làm thay đổi đáng kể giải pháp.
