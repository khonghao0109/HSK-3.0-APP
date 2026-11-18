-- Q350 (PO 18/11/2026): nguồn cho ảnh minh hoạ lát cắt Bài 1 + đề thi thử HSK1.
--
-- Không có route tạo DataSource, nên tạo bằng migration forward idempotent theo
-- `code` (giống 20261102150000_pilot_content_data_source, Q178). Ảnh do AI tạo
-- bằng Figma AI theo prompt dự án tự viết; license/attribution phải trung thực
-- ngay từ đầu vì trigger `DataSource_media_provenance_guard` đóng băng provenance
-- khi media tham chiếu. Không đổi schema, không ghi bảng khác.

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
  'HSK30_IMG_FIGMA_AI_SLICE01',
  'Ảnh minh hoạ do AI tạo (Figma AI), lát cắt Bài 1 + đề thi thử HSK1',
  '1.0.0',
  NULL,
  'AI-generated illustration (Figma AI generate_image) for HSK 3.0 APP',
  'Minh hoạ do AI tạo (Figma AI)',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL,
  'Q350: 37 ảnh lẻ tạo bằng Figma AI, ảnh ghép đề thi bằng backend/scripts/content/compose-exam-images.sh; sha256 ở backend/content/hsk1/media/checksums.json. PO duyệt 18/11/2026.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
