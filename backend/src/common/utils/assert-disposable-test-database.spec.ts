import { assertDisposableTestDatabase } from './assert-disposable-test-database';

const makeEnvironment = (databaseName: string) => ({
  NODE_ENV: 'test',
  DATABASE_URL: `postgresql://app:secret@localhost:5432/${databaseName}?schema=public`,
  TEST_DATABASE_URL: `postgresql://app:secret@localhost:5432/${databaseName}`,
});

const makeEnvironmentWithoutSchema = (databaseName: string) => ({
  NODE_ENV: 'test',
  DATABASE_URL: `postgresql://app:secret@localhost:5432/${databaseName}`,
  TEST_DATABASE_URL: `postgresql://app:secret@localhost:5432/${databaseName}`,
});

describe('assertDisposableTestDatabase', () => {
  it.each([
    'hsk_system_test',
    'hsk-e2e',
    'hsk_verify_20260810',
    'hsk_p0_hardening',
    'hsk_disposable_12345',
  ])('accepts the disposable database name %s', (databaseName) => {
    expect(assertDisposableTestDatabase(makeEnvironment(databaseName))).toEqual(
      expect.objectContaining({ databaseName }),
    );
  });

  it('accepts matching URLs without a schema parameter', () => {
    expect(
      assertDisposableTestDatabase(
        makeEnvironmentWithoutSchema('hsk_system_test'),
      ),
    ).toEqual(expect.objectContaining({ databaseName: 'hsk_system_test' }));
  });

  it.each([
    [
      'DATABASE_URL schema other than public',
      {
        ...makeEnvironment('hsk_system_test'),
        DATABASE_URL:
          'postgresql://app:secret@localhost:5432/hsk_system_test?schema=tenant_a',
      },
      'DATABASE_URL schema must be public when specified',
    ],
    [
      'empty DATABASE_URL schema',
      {
        ...makeEnvironment('hsk_system_test'),
        DATABASE_URL:
          'postgresql://app:secret@localhost:5432/hsk_system_test?schema=',
      },
      'DATABASE_URL schema must be public when specified',
    ],
    [
      'multiple DATABASE_URL schemas',
      {
        ...makeEnvironment('hsk_system_test'),
        DATABASE_URL:
          'postgresql://app:secret@localhost:5432/hsk_system_test?schema=public&schema=public',
      },
      'DATABASE_URL must contain at most one schema parameter',
    ],
    [
      'TEST_DATABASE_URL Prisma schema parameter',
      {
        ...makeEnvironment('hsk_system_test'),
        TEST_DATABASE_URL:
          'postgresql://app:secret@localhost:5432/hsk_system_test?schema=public',
      },
      'TEST_DATABASE_URL must not contain a schema parameter',
    ],
  ])('rejects %s', (_caseName, environment, expectedMessage) => {
    expect(() => assertDisposableTestDatabase(environment)).toThrow(
      expectedMessage,
    );
  });

  it.each([
    'hsk_system',
    'hsk_latest',
    'contest_prod',
    'hsk_production',
    'production_test_backup_prod',
  ])('rejects the non-disposable database name %s', (databaseName) => {
    expect(() =>
      assertDisposableTestDatabase(makeEnvironment(databaseName)),
    ).toThrow('Refusing database write tests for non-disposable database');
  });

  it.each([
    [
      'host',
      'postgresql://app:secret@db.internal:5432/hsk_system_test?schema=public',
    ],
    [
      'port',
      'postgresql://app:secret@localhost:5433/hsk_system_test?schema=public',
    ],
    [
      'database',
      'postgresql://app:secret@localhost:5432/hsk_other_test?schema=public',
    ],
  ])('rejects a DATABASE_URL with a different %s', (_field, databaseUrl) => {
    expect(() =>
      assertDisposableTestDatabase({
        ...makeEnvironment('hsk_system_test'),
        DATABASE_URL: databaseUrl,
      }),
    ).toThrow(
      'DATABASE_URL and TEST_DATABASE_URL must point to the same database',
    );
  });

  it('rejects a missing TEST_DATABASE_URL', () => {
    expect(() =>
      assertDisposableTestDatabase({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://app:secret@localhost:5432/hsk_system_test',
        TEST_DATABASE_URL: undefined,
      }),
    ).toThrow('Database write tests require TEST_DATABASE_URL');
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() =>
      assertDisposableTestDatabase({
        NODE_ENV: 'test',
        DATABASE_URL: undefined,
        TEST_DATABASE_URL:
          'postgresql://app:secret@localhost:5432/hsk_system_test',
      }),
    ).toThrow('Database write tests require DATABASE_URL');
  });

  it('rejects a non-test NODE_ENV', () => {
    expect(() =>
      assertDisposableTestDatabase({
        ...makeEnvironment('hsk_system_test'),
        NODE_ENV: 'development',
      }),
    ).toThrow('Database write tests require NODE_ENV=test');
  });

  it.each([
    ['DATABASE_URL', 'not-a-url'],
    ['TEST_DATABASE_URL', 'not-a-url'],
  ] as const)('rejects an invalid %s', (variableName, invalidUrl) => {
    expect(() =>
      assertDisposableTestDatabase({
        ...makeEnvironment('hsk_system_test'),
        [variableName]: invalidUrl,
      }),
    ).toThrow(`${variableName} must be a valid PostgreSQL URL`);
  });

  it('does not expose credentials in an error', () => {
    const password = 'do-not-leak-this-password';
    let message = '';

    try {
      assertDisposableTestDatabase({
        NODE_ENV: 'test',
        DATABASE_URL: `postgresql://app:${password}@localhost:5432/hsk_system`,
        TEST_DATABASE_URL: `postgresql://app:${password}@localhost:5432/hsk_system`,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).not.toContain(password);
    expect(message).not.toContain('postgresql://');
  });
});
