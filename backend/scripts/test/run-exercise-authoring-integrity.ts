import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { assertDisposableTestDatabase } from '../../src/common/utils/assert-disposable-test-database';

const { databaseName, testDatabaseUrl } = assertDisposableTestDatabase();
const testFile = resolve(
  process.cwd(),
  'test/database/exercise-authoring-integrity.integration.sql',
);

console.log(`Running Exercise Authoring integrity on "${databaseName}"`);

const result = spawnSync(
  'psql',
  [testDatabaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', testFile],
  { stdio: 'inherit' },
);

if (result.error) {
  throw new Error(`Unable to start psql: ${result.error.message}`);
}

if (result.status === null) {
  throw new Error(
    `psql terminated without an exit code${result.signal ? ` (${result.signal})` : ''}`,
  );
}

process.exitCode = result.status;
