-- Q178 (M2.9a Pha 2): nguồn dữ liệu cho nội dung pilot HSK1.
--
-- Chỉ có `GET /admin/cms/data-sources`, không có route tạo, nên nguồn được tạo
-- bằng migration forward idempotent theo `code` giống 8 nguồn từ điển
-- (`20260810092000_p0_cms_provenance_import_audit/migration.sql`).
--
-- Nội dung pilot do AI soạn gốc cho HSK 3.0 APP (Q172), nên license/attribution
-- phải trung thực ngay từ migration đầu: các field provenance bị trigger
-- `DataSource_media_provenance_guard` đóng băng khi nguồn bị media tham chiếu.
-- Migration không tạo endpoint, không đổi schema, không ghi bảng nào khác.

INSERT INTO "DataSource" (
  "code",
  "name",
  "version",
  "referenceUrl",
  "license",
  "attribution",
  "receivedAt",
  "importedAt",
  "contentHash",
  "notes",
  "createdAt",
  "updatedAt"
) VALUES (
  'HSK30_PILOT_ORIGINAL_V1',
  'HSK 3.0 pilot content (AI-authored)',
  '1.0.0',
  NULL,
  'Original content authored for HSK 3.0 APP',
  'HSK 3.0 APP (AI-authored draft; human review required before publish)',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL,
  'Q178/M2.9a: nguồn của 5 bài pilot HSK1 trong backend/content/pilot/hsk1. Mọi bản ghi ở draft cho tới khi PO/reviewer approve (Q172).',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
