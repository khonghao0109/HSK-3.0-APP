import { spawnSync } from 'node:child_process';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import {
  applyE2eEnvironmentDefaults,
  DEFAULT_DATABASE_URL,
} from '../../test/utils/e2e-environment';

/**
 * `pretest:e2e` — dựng database disposable rồi áp migration đã commit, để
 * `npm run test:e2e` chạy được từ một checkout mới bằng một lệnh (H.3b).
 *
 * Các suite e2e dùng chung một database và cùng upsert Level theo `code`, nên
 * fixture của lần chạy trước làm hỏng lần chạy sau. Vì vậy database mặc định do
 * chính tooling này sở hữu (`DEFAULT_DATABASE_URL`) được dựng lại mỗi lần chạy.
 *
 * Việc dựng lại chỉ xảy ra khi cả DATABASE_URL và TEST_DATABASE_URL đều chưa được
 * set và URL đúng bằng default nội bộ: người gọi tự chỉ định database (CI, hoặc
 * dev trỏ vào DB của mình) thì script chỉ tạo khi thiếu và giữ nguyên dữ liệu.
 * Không `migrate reset`, không `db push`, không truncate.
 */

// CREATE DATABASE không nhận tham số bind. Guard disposable chỉ kiểm tra phần
// đuôi của tên, nên chặn thêm mọi ký tự không an toàn trước khi nội suy identifier.
const SAFE_DATABASE_NAME = /^[A-Za-z0-9_]+$/;

function runPsql(
  connectionUrl: string,
  args: string[],
  capture = false,
): string {
  const result = spawnSync(
    'psql',
    [connectionUrl, '-v', 'ON_ERROR_STOP=1', ...args],
    {
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      encoding: 'utf8',
    },
  );

  if (result.error) {
    throw new Error(`Unable to start psql: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`psql exited with code ${String(result.status)}`);
  }

  return result.stdout ?? '';
}

function maintenanceUrl(testDatabaseUrl: string): string {
  const parsed = new URL(testDatabaseUrl);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

function databaseExists(maintenance: string, databaseName: string): boolean {
  // psql không nội suy biến `:'name'` trong lệnh truyền qua -c, nên tên được nội
  // suy trực tiếp; SAFE_DATABASE_NAME đã chặn mọi ký tự ngoài [A-Za-z0-9_] trước
  // khi hàm này được gọi.
  const output = runPsql(
    maintenance,
    ['-tAc', `SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`],
    true,
  );

  return output.trim() === '1';
}

function runPrisma(args: string[], databaseUrl: string): void {
  const result = spawnSync('npx', ['prisma', ...args], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
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

const { usesBuiltInDatabase } = applyE2eEnvironmentDefaults();

const { databaseName, databaseUrl, testDatabaseUrl } =
  assertDisposableTestDatabase();

if (!SAFE_DATABASE_NAME.test(databaseName)) {
  throw new Error(
    `Refusing to create database with unsafe name "${databaseName}"`,
  );
}

const maintenance = maintenanceUrl(testDatabaseUrl);

// Ba điều kiện độc lập phải cùng đúng thì mới được xoá: guard disposable đã chạy
// ở trên, tên chỉ gồm ký tự an toàn, và đây đúng là database mặc định nội bộ mà
// người gọi không hề chỉ định.
const ownsDatabase =
  usesBuiltInDatabase && databaseUrl === DEFAULT_DATABASE_URL;

if (ownsDatabase) {
  console.log(`Recreating built-in E2E database "${databaseName}"`);
  runPsql(maintenance, [
    '-c',
    `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
  ]);
  runPsql(maintenance, ['-c', `CREATE DATABASE "${databaseName}"`]);
} else if (databaseExists(maintenance, databaseName)) {
  console.log(`E2E database "${databaseName}" already exists`);
} else {
  console.log(`Creating E2E database "${databaseName}"`);
  runPsql(maintenance, ['-c', `CREATE DATABASE "${databaseName}"`]);
}

// `npm ci --ignore-scripts` (quy ước của repo và của CI) bỏ qua postinstall của
// @prisma/client, nên Prisma Client phải được sinh ở đây để e2e chạy một lệnh.
runPrisma(['generate'], databaseUrl);
runPrisma(['migrate', 'deploy'], databaseUrl);
