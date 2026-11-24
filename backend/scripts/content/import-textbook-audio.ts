import { PrismaClient } from '@prisma/client';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ExamImportError } from '../../src/modules/content-hsk1/import-exam';
import {
  ApiClient,
  PilotImportError,
} from '../../src/modules/content-pilot/import-pilot-content';
import { adminActorId } from '../../src/modules/content-pilot/import-textbook-grade';
import {
  importTextbookAudio,
  readTextbookAudioLessons,
} from '../../src/modules/content-pilot/textbook-audio';
import { TextbookSeeddataError } from '../../src/modules/content-pilot/textbook-seeddata.converter';

/**
 * M2.13c — audio từ vựng một cấp giáo trình HSK 2.0, bước riêng sau
 * `content:textbook:import-grade` (docs/process/content-pipeline.md §9).
 *
 *   npm run content:textbook:import-audio -- --seeddata-root <seeddata> --grade 1 \
 *     [--ledger <file>] [--dry-run]
 *
 * Biến môi trường (không đọc `.env`): `DATABASE_URL`; khi không dry-run thêm
 * `API_BASE_URL`, `ADMIN_TOKEN` (admin). File nạp qua media ingestion (5 file
 * /phút/admin, tự chờ khi 429); chỉ gắn Word chưa có audio. In summary JSON,
 * không in nội dung seeddata.
 */
function usage(): never {
  console.error(
    'Cách dùng: npm run content:textbook:import-audio -- --seeddata-root <dir> --grade <n> [--ledger <file>] [--dry-run]',
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]) {
  let seeddataRoot: string | null = null;
  let grade: number | null = null;
  let ledger: string | null = null;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--dry-run') {
      dryRun = true;
    } else if (argv[index] === '--seeddata-root' && value !== undefined) {
      seeddataRoot = resolve(process.cwd(), value);
      index += 1;
    } else if (argv[index] === '--grade' && value !== undefined) {
      grade = Number(value);
      index += 1;
    } else if (argv[index] === '--ledger' && value !== undefined) {
      ledger = resolve(process.cwd(), value);
      index += 1;
    } else {
      usage();
    }
  }
  if (
    seeddataRoot === null ||
    grade === null ||
    !Number.isSafeInteger(grade) ||
    grade < 1 ||
    grade > 9
  ) {
    usage();
  }
  return {
    seeddataRoot,
    grade,
    dryRun,
    ledgerPath:
      ledger ?? `/tmp/hsk-textbook/g${String(grade)}/audio-ledger.json`,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const apiBaseUrl = process.env.API_BASE_URL ?? '';
  const adminToken = process.env.ADMIN_TOKEN ?? '';
  if (
    !process.env.DATABASE_URL ||
    (!options.dryRun && (!apiBaseUrl || !adminToken))
  ) {
    console.error(
      'Thiếu DATABASE_URL / API_BASE_URL / ADMIN_TOKEN (không đọc .env).',
    );
    usage();
  }
  const { lessons, audioBaseDir, skippedLessons } = readTextbookAudioLessons(
    options.seeddataRoot,
    options.grade,
  );
  mkdirSync(dirname(options.ledgerPath), { recursive: true });
  const prisma = new PrismaClient();
  const log = (line: string) => console.log(line);
  try {
    const actorId = options.dryRun
      ? null
      : await adminActorId(
          new ApiClient({ apiBaseUrl, adminToken, prisma }, log),
        );
    const summary = await importTextbookAudio(
      { apiBaseUrl, adminToken, prisma, log },
      {
        lessons,
        seeddataRoot: options.seeddataRoot,
        audioBaseDir,
        ledgerPath: options.ledgerPath,
        dryRun: options.dryRun,
        actorId,
      },
    );
    console.log(
      JSON.stringify(
        { grade: options.grade, skippedLessons, ...summary },
        null,
        2,
      ),
    );
    if (summary.totals.errors > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ExamImportError || error instanceof PilotImportError) {
    console.error(`FAIL ${error.code}: ${error.message}`);
  } else if (error instanceof TextbookSeeddataError) {
    console.error(`FAIL ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
