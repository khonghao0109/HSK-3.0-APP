import { resolve } from 'node:path';

import { spawnSync } from 'node:child_process';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';

const database = assertDisposableTestDatabase();
const sqlFile = resolve(
  process.cwd(),
  'test/database/media-ingestion-integrity.integration.sql',
);
const result = spawnSync(
  'psql',
  [database.testDatabaseUrl, '-X', '-v', 'ON_ERROR_STOP=1', '-f', sqlFile],
  { stdio: 'inherit', env: process.env },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
