---
name: project-context-management
description: "Duy trì nguồn bối cảnh nhất quán giữa tài liệu, code, schema, UI và quyết định sản phẩm. Sử dụng sau thay đổi lớn, khi tài liệu mâu thuẫn với repo, khi bàn giao công việc hoặc khi một agent cần cập nhật context pack HSK System."
---

# Project Context Management

## Mục tiêu

Giữ cho người mới và AI agent có thể hiểu đúng trạng thái dự án từ các nguồn ngắn gọn, có chủ sở hữu và có ngày xác minh.

## Nguồn sự thật

- Bối cảnh tổng thể: `docs/PROJECT_CONTEXT_FOR_AI.md`.
- Phạm vi chức năng và ưu tiên: `docs/FUNCTIONAL_HIERARCHY.md`.
- Kế hoạch phát hành: `docs/roadmap.md`.
- API mục tiêu: `docs/api.md` và DTO/controller runtime.
- Dữ liệu: `backend/prisma/schema.prisma`, migrations và `docs/DATABASE_SCHEMA_COMPLETION_PLAN.md`.
- Trải nghiệm mục tiêu: `docs/ui_image/` và UI runtime.

## Quy trình

1. Phân loại thông tin thành `hiện trạng`, `mục tiêu`, `quyết định`, `giả định` hoặc `câu hỏi mở`.
2. Xác minh hiện trạng bằng code, migration, test hoặc lệnh chạy; không chỉ dựa vào roadmap.
3. Khi hai nguồn mâu thuẫn, ưu tiên runtime/schema cho “đã có” và ghi rõ tài liệu cần sửa.
4. Cập nhật tài liệu gần nguồn thay đổi nhất trước, sau đó đồng bộ context pack và roadmap.
5. Gắn owner hoặc nhóm chịu trách nhiệm cho quyết định có ảnh hưởng liên module.
6. Ghi ngày xác minh cho dữ liệu biến động như stack, module đã chạy, KPI và license.
7. Giữ nội dung cô đọng; liên kết tới tài liệu chi tiết thay vì sao chép dài dòng.
8. Rà soát các thuật ngữ dùng chung: level HSK, lesson, activity, attempt, review, entitlement và content status.

## Đầu ra bắt buộc

- Context diff: điều gì thay đổi và nguồn nào đã được cập nhật.
- Decision log ngắn cho các lựa chọn không hiển nhiên.
- Danh sách mâu thuẫn còn lại, owner và hạn xử lý.
- Handoff note gồm trạng thái, bằng chứng kiểm tra và bước tiếp theo.

## Quality gate

- Một capability không được đồng thời ghi “đã có” và “kế hoạch” ở hai tài liệu.
- API, schema, UI state và ưu tiên P0/P1/P2 không mâu thuẫn.
- Không đưa secret, dữ liệu cá nhân hoặc token thật vào context.
- Mỗi liên kết nội bộ phải tồn tại và dùng đường dẫn tương đối ổn định.

## Áp dụng cho HSK System

Giữ contract hiện hành `HSK7_9` với awarded/target band 7–9. Theo dõi như câu hỏi mở các phần chưa chốt thật sự: nghĩa tiếng Việt của từ điển, OAuth, role mở rộng, premium, mobile/offline và database riêng của AI/RAG.

## Điều kiện dừng hoặc chuyển cấp

Không tự chọn nguồn sự thật khi mâu thuẫn liên quan pháp lý, nội dung HSK chính thức, pricing hoặc quyền truy cập dữ liệu. Ghi rõ mâu thuẫn và yêu cầu product owner xác nhận.
