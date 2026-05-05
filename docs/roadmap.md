# Product Roadmap - HSK System

## 1. Vision

Xây nền tảng ôn thi HSK 1-9 gồm:

- Học kiến thức theo cấp độ.
- Luyện tập 4 kỹ năng.
- Thi thử, chấm điểm, giải thích.
- Tài liệu học tập tập trung.
- Trợ lý AI cá nhân hóa học tập.

## 2. Architecture Goal

- `frontend/`: web app cho user + admin.
- `backend/`: core business API.
- `ai/`: RAG + embeddings service độc lập.
- PostgreSQL cho dữ liệu nghiệp vụ.
- Vector store cho truy xuất ngữ nghĩa.

## 3. Release Phases

## Phase 0 - Foundation (Done/In Progress)

Mục tiêu:

- Khung dự án chuẩn production.
- DB schema ổn định cho domain chính.
- Data pipeline dictionary + levels.

Deliverables:

- Monorepo `backend/frontend/ai`.
- Prisma migrations cơ bản.
- Module skeleton theo domain.
- `.env.example` cho mọi service.

Exit criteria:

- Local run được từng service.
- Seed dữ liệu từ scripts hoạt động.

## Phase 1 - Core Learning MVP

Mục tiêu:

- User có thể học theo cấp độ và bài học.

Scope:

- Auth: register/login/me.
- Levels, lessons, topics, stories (read-first).
- Dictionary tra từ + save từ.
- Progress theo lesson.

Deliverables:

- API v1 cho các module cốt lõi.
- UI public: Home, Knowledge, Account cơ bản.

KPI:

- `P95 API < 400ms` với read endpoints.
- `>= 1,000` từ vựng có thể tra cứu.

## Phase 2 - Exam Engine MVP

Mục tiêu:

- Thi thử trọn flow: làm bài -> nộp bài -> xem kết quả.

Scope:

- Domain `exam/question/test/result`.
- Chấm điểm tự động.
- Lưu `detailJson` kết quả.

Deliverables:

- UI làm bài thi.
- UI kết quả + giải thích.

KPI:

- Submit test ổn định với `>= 500` concurrent submissions.
- Tỷ lệ lỗi submit `< 0.5%`.

## Phase 3 - Materials + Admin Panel

Mục tiêu:

- Quản trị nội dung tập trung cho đội vận hành.

Scope:

- Module `materials`.
- Admin module: users, content, reports.
- Upload tài liệu/audio/images.

Deliverables:

- UI admin dashboard.
- CRUD cho materials, questions, tests.

KPI:

- Thời gian publish nội dung mới `< 10 phút`.
- 100% thao tác admin có audit log.

## Phase 4 - Analytics & Reporting

Mục tiêu:

- Có dữ liệu để ra quyết định sản phẩm.

Scope:

- Module `analytics`.
- Dashboard: DAU, completion rate, score distribution.
- Report theo level/test/skill.

Deliverables:

- API analytics.
- Biểu đồ dashboard user/admin.

KPI:

- Dữ liệu dashboard chậm tối đa `T+5 phút`.
- Tracking event coverage `>= 95%`.

## Phase 5 - AI Assistant Beta (RAG)

Mục tiêu:

- Trợ lý AI hỗ trợ giải thích từ vựng, ngữ pháp, câu hỏi.

Scope:

- `ai/services/rag-api`: ingest, retrieval, chat.
- Embedding pipeline cho dictionary + materials.
- Backend `modules/ai/chat` làm gateway.

Deliverables:

- Endpoint `POST /api/v1/ai/chat`.
- Source citation trong câu trả lời AI.

KPI:

- Response time AI `P95 < 4s`.
- Hallucination rate (manual sample) `< 10%`.

## Phase 6 - Personalization

Mục tiêu:

- Cá nhân hóa lộ trình học và đề xuất bài tập.

Scope:

- Recommendation theo điểm yếu (skill/topic).
- Ôn tập từ theo spaced repetition.
- Next-best-lesson suggestion.

Deliverables:

- Personal learning plan endpoint.
- Dashboard tiến độ cá nhân nâng cao.

KPI:

- Weekly retention tăng `>= 15%`.
- Lesson completion tăng `>= 20%`.

## Phase 7 - Scale & Reliability

Mục tiêu:

- Sẵn sàng scale traffic và vận hành dài hạn.

Scope:

- Storage cloud (S3/Cloudinary), bỏ local uploads.
- Redis cache + queue worker.
- Infra hardening: CI/CD, monitoring, alerting.

Deliverables:

- Blue-green deployment.
- Backup/restore + runbook sự cố.

KPI:

- Uptime `>= 99.9%`.
- MTTR `< 30 phút`.

## 4. Cross-Cutting Workstreams

## 4.1 Security

- JWT rotate + secret management.
- Rate limit endpoints nhạy cảm.
- RBAC hoàn chỉnh cho admin/user.
- Kiểm tra OWASP Top 10 định kỳ.

## 4.2 Quality

- Unit tests cho service layer.
- Integration tests cho API chính.
- Contract tests backend-ai service.

Target:

- Coverage `>= 70%` business critical.

## 4.3 Observability

- Structured logging + requestId.
- Metrics: latency, error rate, throughput.
- Tracing cho flow `frontend -> backend -> ai`.

## 4.4 Data Governance

- Data dictionary cho các bảng chính.
- Version hóa pipeline parse/seed.
- Chính sách xóa dữ liệu người dùng.

## 5. Team Plan (Suggested)

- 1 Backend lead.
- 1 Frontend lead.
- 1 AI engineer.
- 1 QA/Automation.
- 1 Product owner (part-time).

## 6. Milestone Timeline (Suggested)

- M1 (2-3 tuần): Phase 1 xong.
- M2 (2-3 tuần): Phase 2 xong.
- M3 (2-3 tuần): Phase 3 xong.
- M4 (2 tuần): Phase 4 xong.
- M5 (3-4 tuần): Phase 5 beta.
- M6+ (liên tục): Phase 6-7 theo tăng trưởng.

## 7. Definition of Done

Một phase được coi là hoàn thành khi:

- Tất cả endpoint trong scope đã có test pass.
- Có tài liệu update trong `docs/api.md`.
- Có dashboard theo dõi lỗi/latency.
- Có rollback plan khi deploy production.

## 8. Risks & Mitigations

- Rủi ro chất lượng dữ liệu seed thấp.
- Giảm thiểu: validation pipeline + review batch.

- Rủi ro AI trả lời sai.
- Giảm thiểu: bắt buộc source citation + guardrails prompt.

- Rủi ro nghẽn hiệu năng khi thi đồng thời.
- Giảm thiểu: cache read endpoints + queue xử lý nền.

## 9. Immediate Next Actions (2 tuần tới)

1. Hoàn thiện Auth + Users + Levels/Lessons API.
2. Hoàn thiện CRUD Question/Test.
3. Hoàn thiện submit exam + result detail.
4. Kết nối frontend với backend qua `/api/v1`.
5. Thiết lập CI kiểm tra lint + test + build.
