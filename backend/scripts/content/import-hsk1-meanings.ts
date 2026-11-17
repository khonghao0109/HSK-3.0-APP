import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import {
  importMeaningBatch,
  MeaningImportError,
  rollbackMeaningBatch,
} from '../../src/modules/content-hsk1/import-meaning-batch';
import {
  loadHsk1Lexicon,
  type MeaningBatch,
} from '../../src/modules/content-hsk1/meaning-batch';

/**
 * Nạp hoặc gỡ một lô nghĩa tiếng Việt HSK1 (P1–P2, PO 17/11/2026).
 *
 *   npm run content:import:meanings -- --file content/hsk1/meanings/batch-01.json [--dry-run]
 *   npm run content:import:meanings -- --rollback HSK30_VI_HSK1_B01 [--dry-run]
 *
 * Cần `DATABASE_URL`. Chỉ nạp lô `review.status = "approved"`.
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const file = value('--file');
  const rollback = value('--rollback');
  if ((file === undefined) === (rollback === undefined)) {
    throw new MeaningImportError(
      'Dùng đúng một trong --file <batch.json> hoặc --rollback <DataSource.code>',
    );
  }
  const prisma = new PrismaClient();
  try {
    if (rollback !== undefined) {
      const result = await rollbackMeaningBatch(prisma, rollback, { dryRun });
      console.log(JSON.stringify({ rollback, dryRun, ...result }, null, 2));
      return;
    }
    const path = resolve(process.cwd(), file as string);
    const batch = JSON.parse(readFileSync(path, 'utf8')) as MeaningBatch;
    const plan = await importMeaningBatch(
      prisma,
      batch,
      loadHsk1Lexicon(resolve(__dirname, '../..')),
      {
        fileName: basename(path),
        dryRun,
      },
    );
    console.log(JSON.stringify({ dryRun, ...plan }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof MeaningImportError ? error.message : error);
  process.exitCode = 1;
});
