import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';

import {
  importPilotLesson,
  PilotImportError,
} from '../../src/modules/content-pilot/import-pilot-content';

/**
 * CLI nạp nội dung pilot HSK1 — `docs/process/content-pipeline.md` §3.
 *
 *   npm run content:import:pilot -- --file backend/content/pilot/hsk1/lesson-01.json [--dry-run]
 *
 * Biến môi trường (lấy từ environment của tiến trình, **không** đọc `.env`):
 * - `API_BASE_URL`: ví dụ `http://127.0.0.1:3000/api/v1`.
 * - `ADMIN_TOKEN`: bearer token của tài khoản admin (§3).
 * - `DATABASE_URL`: Prisma cần để ghi `LessonWord` (Q179).
 *
 * Script không publish, không archive, không chạm Story (Q177): mọi bản ghi ở
 * `draft`. `--dry-run` chỉ đọc (validate + preflight + preview nếu lesson đã tồn tại).
 */

interface CliOptions {
  readonly filePath: string;
  readonly dryRun: boolean;
}

function usage(): never {
  console.error(
    [
      'Cách dùng: npm run content:import:pilot -- --file <lesson-NN.json> [--dry-run]',
      '',
      'Bắt buộc có API_BASE_URL, ADMIN_TOKEN và DATABASE_URL trong environment.',
    ].join('\n'),
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): CliOptions {
  let filePath: string | null = null;
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (argument === '--file') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) usage();
      filePath = value;
      index += 1;
      continue;
    }
    usage();
  }
  if (filePath === null) usage();
  return { filePath: resolve(process.cwd(), filePath), dryRun };
}

function databaseTargetLabel(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    const database = parsed.pathname.replace(/^\//u, '');
    return `${parsed.host}/${database}`;
  } catch {
    return '<DATABASE_URL không parse được>';
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const apiBaseUrl = process.env.API_BASE_URL;
  const adminToken = process.env.ADMIN_TOKEN;
  const databaseUrl = process.env.DATABASE_URL;
  if (!apiBaseUrl || !adminToken || !databaseUrl) {
    console.error(
      'Thiếu API_BASE_URL / ADMIN_TOKEN / DATABASE_URL trong environment (không đọc .env).',
    );
    usage();
  }

  console.log(`api=${apiBaseUrl}`);
  console.log(`database=${databaseTargetLabel(databaseUrl)}`);
  console.log(`file=${options.filePath}`);
  console.log(`dry-run=${options.dryRun ? 'yes' : 'no'}`);

  const prisma = new PrismaClient();
  try {
    const result = await importPilotLesson(
      {
        apiBaseUrl,
        adminToken,
        prisma,
        logger: (line) => console.log(line),
      },
      {
        filePath: options.filePath,
        backendRoot: resolve(__dirname, '..', '..'),
        dryRun: options.dryRun,
      },
    );
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof PilotImportError) {
    console.error(`FAIL ${error.code}: ${error.message}`);
    if (error.details !== undefined) {
      console.error(JSON.stringify(error.details, null, 2));
    }
    process.exitCode = 1;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
