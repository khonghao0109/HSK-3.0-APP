import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  ExamImportError,
  importExam,
  type ExamFile,
} from '../../src/modules/content-hsk1/import-exam';

/**
 * Nạp đề thi thử HSK1 qua API CMS (ảnh → câu hỏi → đề), mọi bản ghi `draft`.
 *
 *   API_BASE_URL=... ADMIN_TOKEN=... npm run content:import:exam -- \
 *     --file content/hsk1/exam/mock-01.json --ledger <ledger.json> [--images <dir>] [--dry-run]
 *
 * Sổ (ledger) `sourceKey → id` riêng cho mỗi môi trường; giữ lại để nạp lại không tạo trùng.
 */
function arg(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const file = arg(args, '--file');
  const ledger = arg(args, '--ledger');
  const apiBaseUrl = process.env.API_BASE_URL;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!file || !ledger || !apiBaseUrl || !adminToken) {
    throw new ExamImportError(
      'usage',
      'Cần --file, --ledger và API_BASE_URL, ADMIN_TOKEN trong environment',
    );
  }
  const result = await importExam(
    { apiBaseUrl, adminToken, log: (line) => console.log(line) },
    {
      file: JSON.parse(readFileSync(file, 'utf8')) as ExamFile,
      imagesDir: resolve(
        arg(args, '--images') ?? join(homedir(), 'hsk-media/hsk1-slice/images'),
      ),
      ledgerPath: resolve(ledger),
      dataSourceCode: 'HSK30_IMG_FIGMA_AI_SLICE01',
      levelCode: 'HSK1',
      dryRun: args.includes('--dry-run'),
    },
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(
    error instanceof ExamImportError
      ? `FAIL ${error.code}: ${error.message}`
      : error,
  );
  process.exitCode = 1;
});
