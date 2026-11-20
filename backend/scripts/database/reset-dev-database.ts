import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

/**
 * `npm run db:reset` — dựng lại database dev từ migration đã commit.
 *
 * `prisma migrate reset` chỉ xoá schema nằm trong DATABASE_URL (`public`), trong
 * khi migration `20260929162559_pgboss_schema` tạo object ở schema riêng `pgboss`.
 * Schema đó sống sót qua reset, nên lần áp lại migration va chạm
 * (`type "job_state" already exists`, 42710). Sửa migration đã áp dụng sẽ đổi
 * checksum và làm Prisma báo drift trên mọi database hiện có; migration mới thì
 * chạy sau migration va chạm nên không cứu được. Vì vậy script xoá `pgboss`
 * trước rồi mới gọi `prisma migrate reset`, migration giữ nguyên forward-only.
 *
 * Cả hai bước dùng datasource trong `prisma/schema.prisma` (DATABASE_URL từ env
 * hoặc `backend/.env`), nên luôn nhắm cùng một database.
 *
 * Dùng: `npm run db:reset` (hỏi xác nhận) hoặc `npm run db:reset -- --force`.
 * Các cờ khác (`--skip-seed`, `--skip-generate`) được chuyển nguyên cho Prisma.
 */

const SCHEMA_ARGS = ['--schema', 'prisma/schema.prisma'];
const DROP_PGBOSS_SQL = 'DROP SCHEMA IF EXISTS pgboss CASCADE;';

function runPrisma(args: string[], input?: string): void {
  const result = spawnSync('npx', ['prisma', ...args], {
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
    input,
    encoding: 'utf8',
  });

  if (result.error) {
    throw new Error(`Unable to start prisma: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `prisma ${args.join(' ')} exited with ${String(result.status)}`,
    );
  }
}

async function confirm(): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error(
      'Refusing to reset without confirmation: stdin is not a TTY. Re-run with --force.',
    );
    return false;
  }

  const target = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL).pathname.slice(1)
    : 'DATABASE_URL from backend/.env';
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question(
      `Drop ALL data in "${target}" (schemas public and pgboss) and re-apply migrations? [y/N] `,
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset a database with NODE_ENV=production');
  }

  const args = process.argv.slice(2);
  const force = args.includes('--force') || args.includes('-f');
  const passthrough = args.filter((arg) => arg !== '--force' && arg !== '-f');

  if (!force && !(await confirm())) {
    process.exitCode = 1;
    return;
  }

  console.log('Dropping schema "pgboss"');
  runPrisma(['db', 'execute', '--stdin', ...SCHEMA_ARGS], DROP_PGBOSS_SQL);
  runPrisma(['migrate', 'reset', '--force', ...SCHEMA_ARGS, ...passthrough]);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
