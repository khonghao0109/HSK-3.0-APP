import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';

import { PilotImportError } from '../../src/modules/content-pilot/import-pilot-content';
import {
  importTextbookGrade,
  summarizeTextbookGrade,
} from '../../src/modules/content-pilot/import-textbook-grade';
import { TextbookSeeddataError } from '../../src/modules/content-pilot/textbook-seeddata.converter';

/**
 * Nạp cả một cấp giáo trình HSK 2.0 — `docs/process/content-pipeline.md` §9.
 *
 *   npm run content:textbook:import-grade -- --seeddata-root <seeddata> --grade 1 \
 *     [--dry-run] [--continue-on-error] [--publish]
 *
 * `--continue-on-error`: bài lỗi ghi vào summary rồi chạy tiếp; exit 1 nếu có bài
 * lỗi. `--publish`: publish unit, khoá, topic, bài tập và bài; bài còn từ nháp
 * thành `blocked_draft_words` (không phải lỗi). Cuối cùng in summary JSON.
 *
 * Biến môi trường (không đọc `.env`): `API_BASE_URL`, `ADMIN_TOKEN`,
 * `DATABASE_URL`. File nạp ghi vào `/tmp/hsk-textbook/g<cấp>/`. Mọi bản ghi ở
 * `draft`; chạy lại không tạo trùng.
 */

function usage(): never {
  console.error(
    'Cách dùng: npm run content:textbook:import-grade -- --seeddata-root <dir> --grade <n> [--dry-run] [--continue-on-error] [--publish]',
  );
  process.exit(2);
}

function parseArgs(argv: readonly string[]): {
  seeddataRoot: string;
  grade: number;
  dryRun: boolean;
  continueOnError: boolean;
  publish: boolean;
} {
  let seeddataRoot: string | null = null;
  let grade: number | null = null;
  let dryRun = false;
  let continueOnError = false;
  let publish = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index + 1];
    if (argv[index] === '--dry-run') {
      dryRun = true;
    } else if (argv[index] === '--continue-on-error') {
      continueOnError = true;
    } else if (argv[index] === '--publish') {
      publish = true;
    } else if (argv[index] === '--seeddata-root' && value !== undefined) {
      seeddataRoot = resolve(process.cwd(), value);
      index += 1;
    } else if (argv[index] === '--grade' && value !== undefined) {
      grade = Number(value);
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
  if (dryRun && publish) usage();
  return { seeddataRoot, grade, dryRun, continueOnError, publish };
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
    const lessons = await importTextbookGrade(
      { apiBaseUrl, adminToken, prisma, logger: (line) => console.log(line) },
      { ...options, outRoot: '/tmp/hsk-textbook' },
    );
    const summary = summarizeTextbookGrade(
      options.grade,
      options.dryRun,
      lessons,
    );
    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (
    error instanceof PilotImportError ||
    error instanceof TextbookSeeddataError
  ) {
    console.error(`FAIL ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
