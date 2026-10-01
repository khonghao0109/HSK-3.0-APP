# Archive

Tài liệu trong thư mục này đã bị thay thế và không còn phản ánh trạng thái hiện tại.
Giữ lại để tra cứu chi tiết đặc tả hoặc bằng chứng theo ngày. Không dùng làm nguồn
trạng thái; xem `docs/PLAN.md`.

| File | Bị thay thế bởi | Vì sao còn giữ |
| --- | --- | --- |
| `PRODUCT_IMPLEMENTATION_MASTER_PLAN.md` | `../PLAN.md`, `../product/roadmap.md`, `../adr/ADR-008-TECHNOLOGY-STACK-DECISIONS.md`, `../process/engineering-process.md` | Đặc tả chi tiết các phase tương lai (exam §17, SRS §16, go-live §27, test strategy §25, security checklist §34, observability §35) vẫn hữu ích khi bắt tay vào milestone tương ứng. Bảng công nghệ §4 và baseline §1 đã sai. |
| `DATABASE_SCHEMA_COMPLETION_PLAN.md` | `../database/*`, 19 migration trong `backend/prisma/migrations`, mục "Schema backlog" trong `../PLAN.md` | Thiết kế model P1/P2 (reader, pronunciation, engagement, payment, AI DB) chưa có nơi khác. |
| `MEDIA_OBSERVABILITY_EDGE_SECURITY_CLOSEOUT.md` | `../operations/MEDIA_INGESTION_RELEASE_RUNBOOK.md`, ADR-006, ADR-007 | Bản ghi closeout ngày 13/08/2026 với các bảng typed outcome, edge matrix, secret lifecycle. |
| `reports/01-product-strategy-report.md` | Thư viện `skill/` đã rời khỏi repo | Bảy quyết định sản phẩm mở ở mục 6 đã chuyển vào `../PLAN.md`. |
| `reports/10-delivery-production-operations-report.md` | `../PLAN.md` mục M0 và M6 | Ma trận readiness và critical path ngày 13/08/2026. |

Các báo cáo nhóm 02–09 (placeholder "chưa thực hiện"), `implementation-process/`
(10 playbook gắn với `skill/`), `PROJECT_CONTEXT_FOR_AI.md` (gộp vào
`../architecture/overview.md`), `TEST_DATABASE_EVIDENCE_MANIFEST.md` (inventory
workstation đã hết hạn) và `erd.png` (file 0 byte) đã bị xoá ngày 04/09/2026;
lịch sử git còn giữ nội dung.
