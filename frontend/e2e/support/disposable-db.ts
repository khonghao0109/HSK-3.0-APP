import { execFileSync } from 'node:child_process';

// Same name pattern as backend/src/common/utils/assert-disposable-test-database.ts.
const DISPOSABLE_DB_NAME =
  /(?:^|[_-])(test|e2e|verify|disposable|hardening)(?:[_-]\d+)?$/i;

// psql honours every libpq query parameter, and most of them (dbname, host,
// port, service, options, …) can redirect or alter the connection, so only
// sslmode passes through. schema is Prisma-only and psql rejects it.
const ALLOWED_QUERY_PARAMETERS = new Set(['sslmode']);
const DROPPED_QUERY_PARAMETERS = new Set(['schema']);

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
  // libpq has no fragment: it still reads "#?dbname=…" as query parameters,
  // while URL hides them in hash. Refuse instead of relying on the rebuild.
  if (url.hash !== '' || rawUrl.includes('#')) {
    throw new Error('TEST_DATABASE_URL must not contain a fragment.');
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
  // Rebuild the query by hand: URLSearchParams.toString() would turn %20 into +.
  const keptPairs: string[] = [];
  for (const pair of url.search.slice(1).split('&')) {
    if (!pair) continue;
    let name: string;
    try {
      name = decodeURIComponent(pair.split('=')[0] ?? '');
    } catch {
      throw new Error('TEST_DATABASE_URL must contain valid query parameters.');
    }
    if (DROPPED_QUERY_PARAMETERS.has(name)) continue;
    if (!ALLOWED_QUERY_PARAMETERS.has(name)) {
      throw new Error(
        `TEST_DATABASE_URL must not contain the ${name} parameter.`,
      );
    }
    keptPairs.push(pair);
  }
  const userInfo = url.username
    ? `${url.username}${url.password ? `:${url.password}` : ''}@`
    : '';
  const query = keptPairs.length ? `?${keptPairs.join('&')}` : '';
  return `${url.protocol}//${userInfo}${url.host}${url.pathname}${query}`;
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
