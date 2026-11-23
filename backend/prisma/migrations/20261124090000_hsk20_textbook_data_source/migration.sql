-- M2.13a (ADR-009 §6, PO 23/11/2026): nguồn dữ liệu cho giáo trình HSK chuẩn 2.0.
--
-- Cùng cách với Q178 (`20261102150000_pilot_content_data_source`): chưa có route
-- tạo DataSource, nên tạo bằng migration forward idempotent theo `code`.
-- Từ, nghĩa tiếng Việt, bài khoá và ngữ pháp do PO cung cấp từ sách giáo trình
-- HSK chuẩn 2.0; bộ nhập textbook gắn nguồn này vào Word/WordMeaning/WordSource
-- nháp. Provenance phải đúng ngay từ đầu vì trigger
-- `DataSource_media_provenance_guard` đóng băng các field này khi có media tham
-- chiếu. Migration không đổi schema, không ghi bảng nào khác.

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
  'HSK20_TEXTBOOK_PO_V1',
  'HSK Standard Course 2.0 textbook (provided by PO)',
  '1.0.0',
  NULL,
  'Textbook content provided by the product owner for HSK 3.0 APP (PO decision 23/11/2026)',
  'HSK Standard Course (HSK 2.0) textbook series; vocabulary, key texts and grammar supplied by the product owner',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL,
  'M2.13a: nguồn của khoá HSK2_TEXTBOOK. Word tạo mới ở draft cho tới khi được duyệt; bài không publish khi còn từ nháp (ADR-009 §6).',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
