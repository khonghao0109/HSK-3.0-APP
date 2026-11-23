import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';

import { PilotImportError } from '../../src/modules/content-pilot/import-pilot-content';
import { importTextbookLesson } from '../../src/modules/content-pilot/import-textbook-content';

/**
 * CLI nạp bài giáo trình (profile `textbook`) — `docs/process/content-pipeline.md` §9.
 *
 *   npm run content:import:textbook -- --file /tmp/hsk-textbook/lesson-01.json [--dry-run]
 *
 * Biến môi trường (lấy từ environment của tiến trình, **không** đọc `.env`):
 * `API_BASE_URL`, `ADMIN_TOKEN`, `DATABASE_URL` (Prisma ghi Word nháp và LessonWord).
 * Mọi bản ghi ở `draft`; `--dry-run` chỉ đọc.
 */

function usage(): never {
  console.error(
    'Cách dùng: npm run content:import:textbook -- --file <lesson-NN.json> [--dry-run]',
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): {
  filePath: string;
  dryRun: boolean;
} {
  let filePath: string | null = null;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') {
      dryRun = true;
    } else if (argv[index] === '--file' && argv[index + 1] !== undefined) {
      filePath = argv[index + 1];
      index += 1;
    } else {
      usage();
    }
  }
  if (filePath === null) usage();
  return { filePath: resolve(process.cwd(), filePath), dryRun };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const apiBaseUrl = process.env.API_BASE_URL;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!apiBaseUrl || !adminToken || !process.env.DATABASE_URL) {
    console.error(
      'Thiếu API_BASE_URL / ADMIN_TOKEN / DATABASE_URL (không đọc .env).',
    );
    usage();
  }
  const prisma = new PrismaClient();
  try {
    const result = await importTextbookLesson(
      { apiBaseUrl, adminToken, prisma, logger: (line) => console.log(line) },
      options,
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof PilotImportError) {
    console.error(`FAIL ${error.code}: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
