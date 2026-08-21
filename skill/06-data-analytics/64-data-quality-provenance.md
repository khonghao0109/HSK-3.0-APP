---
name: data-quality-provenance
description: "Quản trị chất lượng, lineage và provenance dữ liệu/nội dung HSK. Sử dụng khi ingest/publish dataset, điều tra sai dữ liệu hoặc đặt quality gate."
---

# Data Quality & Provenance

1. Xác định critical data elements và dimension: accuracy, completeness, validity, uniqueness, consistency, timeliness.
2. Registry source/license/version/hash/owner/lineage/transform; không publish asset thiếu quyền hoặc nguồn.
3. Data contract có schema/type/enum/range/nullability/semantic rule và compatibility policy.
4. Chạy profiling, cross-field/FK/duplicate/outlier/reconciliation; threshold theo HSK level/content type.
5. Quarantine lỗi; sửa qua revision/audit, không overwrite raw/history.
6. Dashboard quality/freshness, alert owner và incident path; sample human review cho translation/audio/exam.
7. Test pipeline với golden corpus, Unicode/collision, drift và late source version.

**Gate:** lineage truy tới public record, quality score/exception có owner/expiry và publish fail-closed cho rule P0.
