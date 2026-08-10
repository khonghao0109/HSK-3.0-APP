# Quy trình 06 — Data & Analytics

## 1. Mục tiêu

Xây pipeline dữ liệu, provenance, analytics, reporting, privacy/retention và backup/recovery để sản phẩm đo được outcome và vận hành dữ liệu có trách nhiệm.

## 2. Phạm vi skill

Gồm 6 skill từ `63-seed-data-pipeline` đến `68-backup-recovery` trong `skill/06-data-analytics/`.

## 3. Điều kiện đầu vào

- Domain/data ownership, event plan, KPI, privacy classification và retention requirement.
- Source dataset có license/version/hash và người phê duyệt.
- Schema/migration contract, môi trường staging và volume assumption.

## 4. Trình tự thực hiện

### Giai đoạn 1 — Seed và ingestion pipeline

1. Lưu raw source bất biến cùng manifest, hash, version, ngày và license.
2. Tách pipeline `raw → parsed → normalized → validated → seeded`.
3. Thiết kế transform idempotent, deterministic và có reject/quarantine output.
4. Preview diff trước load; dùng batch/upsert có transaction phù hợp.
5. Ghi run metadata, input/output count, error và code/schema version.

**Gate D1:** Cùng input/version tạo cùng output; batch lỗi có thể rollback hoặc chạy lại an toàn.

### Giai đoạn 2 — Data quality và provenance

1. Định nghĩa rule completeness, uniqueness, validity, consistency, referential integrity và freshness.
2. Đặt threshold theo dataset/capability; phân loại warning và blocker.
3. Lưu provenance từ record published về source/batch/reviewer.
4. Tạo reconciliation và quality dashboard; có owner cho mỗi rule thất bại.

**Gate D2:** Không publish HSK/dictionary/content nếu thiếu source/license hoặc vi phạm blocker.

### Giai đoạn 3 — Analytics event design

1. Chuyển product metric thành event/taxonomy và semantic definition.
2. Định nghĩa event name, trigger, actor, timestamp, properties, consent và version.
3. Không gửi PII/content nhạy cảm nếu không cần; hash/pseudonymize theo policy.
4. Tạo schema validation và test event ở client/server.
5. Lập identity/session stitching và late/duplicate event policy.

**Gate D3:** Metric quan trọng truy được về event hợp lệ và có data owner.

### Giai đoạn 4 — Reporting và BI

1. Xây metric layer với định nghĩa duy nhất cho DAU, completion, retention, score và review.
2. Thiết kế aggregate/materialized view theo freshness và cost target.
3. Gắn dashboard với owner, audience, filter, freshness và limitation.
4. Kiểm tra reconciliation giữa source transaction và report.

### Giai đoạn 5 — Privacy và retention

1. Lập inventory theo data category, purpose, lawful basis/consent và region.
2. Đặt retention/deletion/anonymization cho core, analytics, audio, chat, logs và backup.
3. Hiện thực export/delete request và propagation sang provider/AI/storage.
4. Audit access và kiểm tra dữ liệu hết hạn định kỳ.

**Gate D4:** Không có dataset/event thiếu purpose, owner, retention hoặc deletion path.

### Giai đoạn 6 — Backup và recovery

1. Chốt RPO/RTO theo data criticality.
2. Thiết kế backup encrypted, retention, access và off-site/independent copy.
3. Kiểm tra restore trên môi trường cô lập và xác minh application consistency.
4. Viết runbook, escalation và lịch restore drill.

**Gate D5:** Restore drill đạt RPO/RTO và tạo hệ thống dùng được, không chỉ tạo file backup.

## 5. Artifact bắt buộc

- Source manifest, pipeline code/config, seed report và reject report.
- Data dictionary, lineage/provenance và quality rules/dashboard.
- Event catalog, metric definitions và BI/dashboard specs.
- Data map, retention/deletion jobs và privacy evidence.
- Backup architecture, restore runbook và drill report.

## 6. Chỉ số kiểm soát

- Pipeline success/retry, reject rate và reconciliation delta.
- Completeness/duplicate/freshness theo dataset.
- Event validation/coverage và dashboard freshness.
- Privacy deletion SLA và expired-data backlog.
- Backup success, restore success, RPO/RTO thực đo.

## 7. Definition of Done

Nhóm 6 hoàn tất khi dữ liệu có thể tái tạo và truy nguồn, metric có định nghĩa/owner, privacy lifecycle được thực thi, dashboard được reconciliation và restore drill chứng minh dữ liệu có thể phục hồi trong mục tiêu.
