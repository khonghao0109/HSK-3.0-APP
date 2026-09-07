import { spawnSync } from 'node:child_process';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';
import { applyE2eEnvironmentDefaults } from '../../test/utils/e2e-environment';

/**
 * `pretest:e2e` — dựng database disposable rồi áp migration đã commit, để
 * `npm run test:e2e` chạy được từ một checkout mới bằng một lệnh (H.3b).
 *
 * Chỉ tạo database khi nó chưa tồn tại, sau đó chạy `prisma migrate deploy`.
 * Không reset, không `db push`, không truncate.
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
  const output = runPsql(
    maintenance,
    [
      '-v',
      `dbname=${databaseName}`,
      '-tAc',
      "SELECT 1 FROM pg_database WHERE datname = :'dbname'",
    ],
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

applyE2eEnvironmentDefaults();

const { databaseName, databaseUrl, testDatabaseUrl } =
  assertDisposableTestDatabase();

if (!SAFE_DATABASE_NAME.test(databaseName)) {
  throw new Error(
    `Refusing to create database with unsafe name "${databaseName}"`,
  );
}

const maintenance = maintenanceUrl(testDatabaseUrl);

if (databaseExists(maintenance, databaseName)) {
  console.log(`E2E database "${databaseName}" already exists`);
} else {
  console.log(`Creating E2E database "${databaseName}"`);
  runPsql(maintenance, ['-c', `CREATE DATABASE "${databaseName}"`]);
}

// `npm ci --ignore-scripts` (quy ước của repo và của CI) bỏ qua postinstall của
// @prisma/client, nên Prisma Client phải được sinh ở đây để e2e chạy một lệnh.
runPrisma(['generate'], databaseUrl);
runPrisma(['migrate', 'deploy'], databaseUrl);
