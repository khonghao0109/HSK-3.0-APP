# Quy trình kỹ thuật

Gộp từ mười playbook `implementation-process/01…10` (đã xoá 04/09/2026) và các
nguyên tắc phát hành trong master plan cũ. Chỉ giữ phần đặc thù cho dự án: nguyên
tắc, vai trò, thứ tự slice, gate và Definition of Done. Phần mô tả quy trình chung
đã bỏ.

## 1. Nguyên tắc phát hành

1. Phát hành theo vertical slice có giá trị; không hoàn thiện toàn bộ backend rồi mới
   làm UI.
2. Không đưa dữ liệu/content vào production nếu thiếu source, license, version,
   reviewer và rollback.
3. Không coi schema, API hay UI mockup là chức năng hoàn chỉnh nếu chưa có runtime và
   test end-to-end.
4. Không triển khai migration lớn trong một lần; dùng expand → backfill → verify →
   contract. Migration đã áp ở môi trường dùng chung không được sửa; fix bằng migration
   mới.
5. Không thêm microservice nếu modular monolith vẫn đáp ứng ownership, scale và
   delivery.
6. Không dùng client-side flag thay authorization hoặc entitlement phía server.
7. Mọi production capability phải có telemetry, owner, runbook và đường rollback/disable.

## 2. Vai trò

| Vai trò | Trách nhiệm chính |
| --- | --- |
| Product owner | Chốt outcome, ưu tiên, phạm vi và quyết định kinh doanh |
| Tech lead | Xác minh hiện trạng, feasibility, dependency và rủi ro kỹ thuật |
| UX designer | Kiểm chứng nhu cầu, hành trình và usability theo `docs/ui_image` |
| Curriculum/content lead | Chuẩn HSK, taxonomy, chất lượng và workflow nội dung |
| Data/analytics | Baseline, event và metric thành công |
| Legal/privacy | License, dữ liệu cá nhân, consent và provider |

Không tự gán người cụ thể khi tổ chức chưa phê duyệt; ghi vai trò trong `PLAN.md`.

## 3. Nguyên tắc triển khai backend

- Triển khai theo thứ tự DTO/guard → use case → persistence → event → test → docs.
- Controller mỏng; nghiệp vụ trong service và invariant ở transaction boundary.
- Không trả Prisma model trực tiếp nếu làm lộ field hoặc khoá contract vào persistence.
- Mọi write quan trọng có authorization, validation, audit và idempotency phù hợp.
- Exam: khi bắt đầu attempt phải snapshot đủ để chấm độc lập với content live; submit
  trong transaction; chống double submit và stale client.
- AI: backend chỉ là gateway (auth, quota, timeout, trace, redaction); retrieval,
  embedding và vector data nằm ở service AI riêng.

## 4. Thứ tự vertical slice cho frontend người học

1. Auth, onboarding, placement và account.
2. Level, lesson, activity, progress.
3. Dictionary, save word và Review Center/SRS.
4. Exam start → autosave → resume → review → submit → result.
5. Admin CMS, import, question bank, user management.
6. P1/P2: reader, pronunciation, engagement, AI, premium.

Mỗi slice gồm route, UI state (loading, empty, error/retry, forbidden), tích hợp API,
analytics, accessibility, test và feature flag khi cần.

## 5. Nguyên tắc dữ liệu

- Lưu raw source bất biến cùng manifest, hash, version, ngày và license.
- Pipeline `raw → parsed → normalized → validated → seeded`; transform idempotent,
  deterministic, có reject/quarantine output.
- Không publish HSK/dictionary/content nếu thiếu source/license.
- Mọi dataset/event có purpose, owner, retention và deletion path.

## 6. Gate theo lĩnh vực

| Mã | Gate |
| --- | --- |
| G1 | Có baseline được kiểm chứng, nguồn sự thật và danh sách quyết định mở có owner. |
| G2 | Mỗi capability đề xuất có persona, outcome, bằng chứng và metric kiểm chứng. |
| G3 | P0 có acceptance criteria, owner, dependency và Definition of Done. |
| G4 | Không có P0 thiếu metric, dependency, risk owner hoặc người quyết định. |
| G5 | Mọi lesson/activity/question truy được về objective và source; published content có owner, review và version. |
| G6 | Không có dữ liệu/content/payment flow thiếu owner, lawful basis/license, retention và đường xoá. |
| U1 | Người dùng tìm được chức năng cốt lõi; navigation không phản ánh cấu trúc backend. |
| U2 | Mỗi P0 có happy path, alternate path và recovery path. |
| U3 | Insight có bằng chứng, sample/context và quyết định thiết kế đi kèm. |
| U4 | Task P0 đạt tiêu chí usability đã chốt, không còn blocker critical. |
| U5 | Component dùng token, có đủ variant/state, không tạo pattern trùng lặp. |
| U6 | P0 đáp ứng WCAG target và hoạt động ở breakpoint/device mục tiêu. |
| A1 | Driver đo được, constraint có nguồn và baseline khớp runtime. |
| A2 | Mỗi module có owner, public contract và dependency direction hợp lệ. |
| A3 | Contract có test strategy; schema có owner, lifecycle, integrity và migration path. |
| A4 | Không có remote call quan trọng thiếu timeout/retry/idempotency/trace. |
| A5 | Threat high/critical có control, owner, test và residual-risk approval. |
| A6 | Mỗi câu trả lời AI có citation/trace; không có embedding/chat data thiếu owner/retention. |
| B1 | Build, schema validate, migration fresh DB và seed tối thiểu đều pass. |
| B2 | Endpoint protected có guard, policy test và không rò field nhạy cảm. |
| B3 | Search P95 đạt target, upload an toàn, content chỉ trả bản published/authorized. |
| B4 | Luồng start → autosave → resume → submit → result ổn định và truy vết được. |
| B5 | Payment/AI failure có retry/fallback, audit và không lộ dữ liệu/secret. |
| F1 | Route/feature boundary rõ, build baseline pass và config sai fail sớm. |
| F2 | Auth/session test bao phủ login/logout/expiry/revocation/role change. |
| F3 | Slice demo end-to-end trên staging, không dùng mock cho acceptance cuối. |
| F4 | Performance budget và accessibility critical/high đều đạt. |
| D1 | Cùng input/version tạo cùng output; batch lỗi rollback hoặc chạy lại an toàn. |
| D2 | Không publish HSK/dictionary/content nếu thiếu source/license. |
| D3 | Metric quan trọng truy được về event hợp lệ và có data owner. |
| D4 | Không có dataset/event thiếu purpose, owner, retention hoặc deletion path. |
| D5 | Restore drill đạt RPO/RTO và tạo hệ thống dùng được, không chỉ tạo file backup. |
| Q1 | Mọi P0/high risk có test owner, level và acceptance oracle rõ. |
| Q2 | Invariant và failure path quan trọng có test tái hiện được. |
| Q3 | SLO workload P0 đạt trên dữ liệu/môi trường đại diện. |
| Q4 | Không còn security/accessibility critical/high chưa xử lý hoặc chưa được chấp thuận đúng thẩm quyền. |
| O1 | Môi trường bootstrap được từ tài liệu, không cần secret truyền tay. |
| O2 | Production change có plan/review/audit; không console mutation ngoài break-glass. |
| O3 | Artifact, migration, config và rollback được xác minh trước production. |
| O4 | Dịch vụ critical có on-call/runbook/alert và đã diễn tập incident chính. |
| E1 | Mọi thay đổi production truy được về PR, review, test và release. |
| E2 | Không merge breaking contract vô tình hoặc endpoint thiếu auth/error/example; docs sửa trong cùng PR. |
| E3 | Không có permanent flag vô chủ hoặc dùng client flag thay authorization. |
| P1 | Milestone có outcome, exit criteria, owner, dependency và release target khả thi. |
| P2 | Không release khi rollback, monitoring, owner hoặc blocker critical chưa xử lý. |
| P3 | Ticket high-impact có escalation và user communication phù hợp. |
| P4 | DR drill chứng minh recovery trong mục tiêu; business process quan trọng có workaround. |

## 7. Definition of Done

### Một thay đổi code

- Chạy end-to-end bằng database thật (e2e hoặc test DB), không chỉ mock.
- Contract, `docs/api/api.md`, ADR liên quan và `PLAN.md` được cập nhật cùng PR.
- Migration tái tạo được trên DB rỗng; forward-only; có preflight nếu đụng dữ liệu.
- Authorization và failure path có test; không rò field nhạy cảm.
- Lint, format, typecheck, unit test xanh ở cả backend và frontend.

### Một milestone (theo roadmap §10)

- Outcome, scope, owner, dependency và acceptance criteria rõ.
- Functional flow chạy end-to-end; schema hoặc mockup riêng không đủ.
- API/schema/UI/docs và ADR đồng bộ.
- Unit, integration, database/concurrency, E2E và production build đạt theo rủi ro.
- Security, privacy, accessibility, performance/capacity và cost được review.
- Telemetry, dashboard, alert và runbook tồn tại cho critical journey.
- Release artifact immutable; staging/live gate ghi riêng; không nâng CODE_READY thành
  PRODUCTION_READY.
- Rủi ro mở có severity, owner, deadline và approval.

### Production (nhóm delivery)

- Một release production thật đã triển khai progressive và quan sát an toàn.
- Release manifest/artifact/migration/config/flag có traceability và rollback/roll-forward
  evidence.
- Support tiếp nhận và xử lý được vấn đề thật với SLA, privacy và audit.
- Backup restore và DR drill đạt RPO/RTO.
