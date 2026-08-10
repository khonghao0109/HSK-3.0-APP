import { assertDisposableTestDatabase } from './assert-disposable-test-database';

const makeEnvironment = (databaseName: string) => ({
  NODE_ENV: 'test',
  DATABASE_URL: `postgresql://app:secret@localhost:5432/${databaseName}?schema=public`,
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

  it('rejects a DATABASE_URL that targets a different database', () => {
    expect(() =>
      assertDisposableTestDatabase({
        ...makeEnvironment('hsk_system_test'),
        DATABASE_URL:
          'postgresql://app:secret@localhost:5432/hsk_other_test?schema=public',
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
