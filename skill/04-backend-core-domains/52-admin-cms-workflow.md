---
name: admin-cms-workflow
description: "Thiết kế CMS authoring, revision, review, publish, archive, import và audit cho nội dung HSK. Sử dụng khi xây admin content/media workflow hoặc thay lifecycle."
---

# Admin CMS Workflow

1. State machine draft → revision → review decision → publish/archive; role/active admin recheck trong transaction.
2. Mỗi revision canonical snapshot + nonblank hash + author; revision/review/audit immutable.
3. Publish chỉ latest approved exact revision, copy live snapshot/version atomically; retry idempotent nhưng revalidate parent/media readiness.
4. Lock canonical User SHARE → parent/content UPDATE → Media SHARE; service CMS khác dùng order tương thích.
5. Import preview zero-write deterministic hash; commit revalidate current relational state, exact source keys, idempotency context/checksum và bounded batch.
6. Public visibility requires published/live parents/media; archive-only, history/snapshot retained.
7. Test RBAC downgrade, concurrent revise/publish/archive/submit/import, duplicate source, legacy replay và audit exact-once.

**Gate:** DB backstop + service contract + SQL/concurrency/E2E; UI bám ảnh admin operations và không hiển thị action chưa có backend.
