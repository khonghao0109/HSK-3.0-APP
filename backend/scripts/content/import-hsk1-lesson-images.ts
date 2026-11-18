import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { ExamImportError } from '../../src/modules/content-hsk1/import-exam';
import {
  importLessonImages,
  type LessonImagesFile,
} from '../../src/modules/content-hsk1/import-lesson-images';

/**
 * Nạp ảnh Bài 1 và gán ảnh bìa, ảnh từ qua API CMS (Q350).
 *
 *   API_BASE_URL=... ADMIN_TOKEN=... npm run content:import:lesson-images -- \
 *     --file content/hsk1/media/lesson-01-images.json --lesson <slug> --ledger <ledger.json> \
 *     [--images <dir>] [--dry-run]
 */
function arg(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const file = arg(args, '--file');
  const ledger = arg(args, '--ledger');
  const lessonSlug = arg(args, '--lesson');
  const apiBaseUrl = process.env.API_BASE_URL;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!file || !ledger || !lessonSlug || !apiBaseUrl || !adminToken) {
    throw new ExamImportError(
      'usage',
      'Cần --file, --lesson, --ledger và API_BASE_URL, ADMIN_TOKEN trong environment',
    );
  }
  const result = await importLessonImages(
    { apiBaseUrl, adminToken, log: (line) => console.log(line) },
    {
      file: JSON.parse(readFileSync(file, 'utf8')) as LessonImagesFile,
      imagesDir: resolve(
        arg(args, '--images') ??
          join(homedir(), 'hsk-media/hsk1-slice/images/raw'),
      ),
      ledgerPath: resolve(ledger),
      lessonSlug,
      dataSourceCode: 'HSK30_IMG_FIGMA_AI_SLICE01',
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
