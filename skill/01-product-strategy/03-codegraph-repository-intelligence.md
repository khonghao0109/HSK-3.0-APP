---
name: codegraph-repository-intelligence
description: "Khảo sát repo theo đồ thị phụ thuộc để tìm entry point, quan hệ module, call path và vùng ảnh hưởng. Sử dụng trước refactor, thay đổi contract/schema, điều tra bug liên module hoặc khi cần chứng minh một chức năng thực sự đã được nối vào runtime."
---

# CodeGraph Repository Intelligence

## Mục tiêu

Tạo bản đồ phụ thuộc đủ chính xác để dự báo tác động và tránh kết luận từ tên thư mục hoặc scaffold chưa được sử dụng.

## Quy trình ưu tiên

1. Kiểm tra index CodeGraph hiện có và độ mới so với worktree.
2. Truy vấn symbol, caller, callee, module import và đường đi từ entry point tới persistence.
3. Với backend, lần theo `main.ts` → module → controller → service → Prisma.
4. Với frontend, lần theo route → page → feature/component → API client → state.
5. Với AI, lần theo API boundary → retrieval/ingest → vector store và citation path.
6. Xác minh phát hiện bằng tìm kiếm văn bản `rg` và đọc file tại vị trí cụ thể.
7. Khi CodeGraph thiếu hoặc stale, dùng `rg --files`, `rg`, manifest và compiler/test làm fallback.
8. Tạo impact map gồm trực tiếp, gián tiếp, contract, migration, test và tài liệu.

## Truy vấn mẫu

- “Symbol này được gọi từ route nào?”
- “Model Prisma này được service nào đọc/ghi?”
- “Endpoint này có guard, validation và test nào?”
- “Nếu đổi DTO này, client hoặc tài liệu nào bị ảnh hưởng?”
- “Thư mục này là runtime hay chỉ là scaffold?”

## Đầu ra bắt buộc

- Entry points và call path liên quan.
- Danh sách file/symbol bị tác động theo mức trực tiếp và gián tiếp.
- Contract boundary: API, event, database hoặc external service.
- Test hiện có, khoảng trống kiểm thử và lệnh xác minh.
- Mức tin cậy cùng nguyên nhân nếu index không đầy đủ.

## Quality gate

- Không coi tên file là bằng chứng runtime nếu không có import/call path.
- Không dựa duy nhất vào CodeGraph; xác minh thay đổi quan trọng bằng code thực tế.
- Không bỏ qua dynamic import, reflection NestJS, Prisma relation hoặc config theo môi trường.
- Impact map phải bao gồm migration, seed, API docs và UI state khi liên quan.

## Áp dụng cho HSK System

Ưu tiên xác minh các chuỗi `auth/RBAC`, `learning/progress`, `dictionary/import`, `exam/attempt/result` và `backend AI gateway → AI service`. Đánh dấu rõ frontend hoặc AI scaffold chưa có đường chạy hoàn chỉnh.

## Điều kiện dừng hoặc chuyển cấp

Nếu index không đọc được repo, sai revision hoặc bỏ sót framework metadata, chuyển sang khảo sát tĩnh bằng `rg` và build/test; không khẳng định độ phủ CodeGraph khi chưa kiểm chứng.
