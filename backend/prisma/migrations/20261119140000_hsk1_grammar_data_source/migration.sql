-- Q357 (PO 19/11/2026): nguồn cho danh sách điểm ngữ pháp HSK1 do Claude soạn theo
-- khung GF0025-2021 (diễn đạt và ví dụ tự viết, không chép văn bản chuẩn), PO duyệt
-- trước khi nạp. Migration forward idempotent theo `code`; không đổi schema.

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
  'HSK30_GRAMMAR_CLAUDE_DRAFT',
  'Điểm ngữ pháp HSK 3.0 do AI soạn theo khung GF0025-2021',
  '1.0.0',
  NULL,
  'First-party content for HSK 3.0 APP (AI draft, PO review)',
  'Tự soạn theo khung GF0025-2021',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL,
  'Q357: backend/content/hsk1/grammar/points.json; chỉ nạp khi review approved và contentSha256 khớp.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
