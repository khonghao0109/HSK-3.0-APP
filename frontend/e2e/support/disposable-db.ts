import { execFileSync } from 'node:child_process';

const DISPOSABLE_DB_NAME = /_(test|e2e|verify|disposable|hardening)$/;

export function disposableDbUrl(): string {
  const rawUrl = process.env.TEST_DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      'TEST_DATABASE_URL is required: it must point to a disposable PostgreSQL test database.',
    );
  }
  // Same parsing as backend assert-disposable-test-database.ts: a libpq
  // keyword string such as "dbname=x application_name=y_test" must not pass.
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  let dbName: string;
  try {
    dbName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL must contain a valid database name.');
  }
  if (!dbName || dbName.includes('/')) {
    throw new Error(
      'TEST_DATABASE_URL must contain exactly one database name.',
    );
  }
  if (!DISPOSABLE_DB_NAME.test(dbName)) {
    throw new Error(
      `TEST_DATABASE_URL must point to a disposable test database (name matching ${DISPOSABLE_DB_NAME.source}), got "${dbName}".`,
    );
  }
  // psql rejects the Prisma-only ?schema= param; keep libpq ones (sslmode, host).
  url.searchParams.delete('schema');
  return url.toString();
}

export function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function queryDisposableDb(sql: string): string {
  return execFileSync(
    'psql',
    [
      disposableDbUrl(),
      '--no-psqlrc',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-c',
      sql,
    ],
    { encoding: 'utf8', timeout: 10_000 },
  ).trim();
}
