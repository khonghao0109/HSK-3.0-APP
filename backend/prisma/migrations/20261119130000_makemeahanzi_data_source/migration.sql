-- Q357 (PO 19/11/2026): nguồn dữ liệu nét chữ Make Me a Hanzi (graphics.txt).
--
-- Không có route tạo DataSource, nên tạo bằng migration forward idempotent theo
-- `code` (như 20261118120000_hsk1_slice_image_data_source). Chỉ dùng graphics.txt
-- (Arphic Public License); dictionary.txt (LGPL) không dùng. Không đổi schema.

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
  'MAKEMEAHANZI_GRAPHICS',
  'Make Me a Hanzi – dữ liệu nét chữ (graphics.txt)',
  'bddc96d41bef78427ed0e034e9f7e31d71fd1b92',
  'https://github.com/skishore/makemeahanzi',
  'Arphic Public License',
  'Make Me a Hanzi (Shaunak Kishore), từ font Arphic PL KaitiM GB / Arphic PL UKai của Arphic Technology Co., Ltd.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  'sha256:a28c478b5178e98f67f510b2d52fde08a69dc664654ef43498253b9b764d46ee',
  'Q357: chỉ graphics.txt; tập con HSK1 ở backend/content/hanzi/makemeahanzi (kèm ARPHICPL.TXT, SOURCE.md).',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;
