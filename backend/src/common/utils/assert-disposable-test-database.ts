const DISPOSABLE_DATABASE_NAME_PATTERN =
  /(?:^|[_-])(test|e2e|verify|disposable|hardening)(?:[_-]\d+)?$/i;

type TestDatabaseEnvironment = {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  TEST_DATABASE_URL?: string;
};

type ParsedDatabaseTarget = {
  databaseName: string;
  identity: string;
};

export type DisposableTestDatabase = {
  databaseName: string;
  databaseUrl: string;
  testDatabaseUrl: string;
};

function parseDatabaseTarget(
  value: string,
  variableName: 'DATABASE_URL' | 'TEST_DATABASE_URL',
): ParsedDatabaseTarget {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL`);
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error(`${variableName} must be a valid PostgreSQL URL`);
  }

  const schemaParameters = parsed.searchParams.getAll('schema');
  if (variableName === 'DATABASE_URL') {
    if (schemaParameters.length > 1) {
      throw new Error('DATABASE_URL must contain at most one schema parameter');
    }
    if (schemaParameters.length === 1 && schemaParameters[0] !== 'public') {
      throw new Error('DATABASE_URL schema must be public when specified');
    }
  } else if (schemaParameters.length > 0) {
    throw new Error('TEST_DATABASE_URL must not contain a schema parameter');
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  } catch {
    throw new Error(`${variableName} must contain a valid database name`);
  }

  if (!databaseName || databaseName.includes('/')) {
    throw new Error(`${variableName} must contain exactly one database name`);
  }

  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || '5432';

  return {
    databaseName,
    identity: `${host}:${port}/${databaseName}`,
  };
}

export function assertDisposableTestDatabase(
  environment: TestDatabaseEnvironment = process.env,
): DisposableTestDatabase {
  if (environment.NODE_ENV !== 'test') {
    throw new Error('Database write tests require NODE_ENV=test');
  }

  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Database write tests require DATABASE_URL');
  }

  const testDatabaseUrl = environment.TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    throw new Error('Database write tests require TEST_DATABASE_URL');
  }

  const databaseTarget = parseDatabaseTarget(databaseUrl, 'DATABASE_URL');
  const testDatabaseTarget = parseDatabaseTarget(
    testDatabaseUrl,
    'TEST_DATABASE_URL',
  );

  if (databaseTarget.identity !== testDatabaseTarget.identity) {
    throw new Error(
      'DATABASE_URL and TEST_DATABASE_URL must point to the same database',
    );
  }

  if (!DISPOSABLE_DATABASE_NAME_PATTERN.test(databaseTarget.databaseName)) {
    throw new Error(
      `Refusing database write tests for non-disposable database "${databaseTarget.databaseName}"`,
    );
  }

  return {
    databaseName: databaseTarget.databaseName,
    databaseUrl,
    testDatabaseUrl,
  };
}
