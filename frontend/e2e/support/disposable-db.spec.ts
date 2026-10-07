// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { disposableDbUrl } from './disposable-db';

const withUrl = (value: string | undefined) => {
  vi.stubEnv('TEST_DATABASE_URL', value);
  return () => disposableDbUrl();
};

describe('disposableDbUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a missing TEST_DATABASE_URL', () => {
    expect(withUrl(undefined)).toThrow('TEST_DATABASE_URL is required');
  });

  it('rejects a libpq keyword string even when a value ends in _test', () => {
    expect(withUrl('dbname=x application_name=y_test')).toThrow(
      'TEST_DATABASE_URL must be a valid PostgreSQL URL.',
    );
  });

  it('rejects a non-PostgreSQL protocol', () => {
    expect(withUrl('mysql://u@127.0.0.1:3306/hsk_test')).toThrow(
      'TEST_DATABASE_URL must be a valid PostgreSQL URL.',
    );
  });

  it('rejects a non-disposable database name', () => {
    expect(withUrl('postgresql://u@127.0.0.1:5432/hsk_system')).toThrow(
      'got "hsk_system"',
    );
  });

  it('rejects an encoded slash in the database name', () => {
    expect(withUrl('postgresql://u@127.0.0.1:5432/a%2Fb_test')).toThrow(
      'TEST_DATABASE_URL must contain exactly one database name.',
    );
  });

  it.each([
    ['dbname', 'postgresql://u@127.0.0.1:5432/x_test?dbname=postgres'],
    ['host', 'postgresql://u@127.0.0.1:5432/x_test?host=prod'],
    ['service', 'postgresql://u@127.0.0.1:5432/x_test?service=prod'],
    ['options', 'postgresql://u@127.0.0.1:5432/x_test?options=-c%20a'],
  ])('rejects the %s query parameter', (parameter, url) => {
    expect(withUrl(url)).toThrow(
      `TEST_DATABASE_URL must not contain the ${parameter} parameter.`,
    );
  });

  it.each([
    [
      'connect_timeout',
      'postgresql://u@127.0.0.1:5432/x_test?connect_timeout=5',
    ],
    [
      'application_name',
      'postgresql://u@127.0.0.1:5432/x_test?application_name=x',
    ],
    ['SSLMODE', 'postgresql://u@127.0.0.1:5432/x_test?SSLMODE=disable'],
    ['host', 'postgresql://u@127.0.0.1:5432/x_test?%68ost=x'],
  ])(
    'rejects the %s query parameter outside the allowlist',
    (parameter, url) => {
      expect(withUrl(url)).toThrow(
        `TEST_DATABASE_URL must not contain the ${parameter} parameter.`,
      );
    },
  );

  it('rejects a fragment that libpq would still read as query parameters', () => {
    expect(
      withUrl('postgresql://u@127.0.0.1:5432/x_test#?dbname=postgres'),
    ).toThrow('TEST_DATABASE_URL must not contain a fragment.');
  });

  it('rejects a malformed query parameter name with the guard message', () => {
    expect(withUrl('postgresql://u@127.0.0.1:5432/x_test?%zz=1')).toThrow(
      'TEST_DATABASE_URL must contain valid query parameters.',
    );
  });

  it('drops the Prisma schema parameter and keeps sslmode', () => {
    expect(
      withUrl(
        'postgresql://u@127.0.0.1:5432/x_test?schema=public&sslmode=disable',
      )(),
    ).toBe('postgresql://u@127.0.0.1:5432/x_test?sslmode=disable');
  });

  it.each([
    ['an encoded @', 'postgresql://u:p%40ss@127.0.0.1:5432/x_test'],
    ['a raw @', 'postgresql://u:p@ss@127.0.0.1:5432/x_test'],
  ])('keeps a password containing %s', (_caseName, url) => {
    const result = withUrl(url)();
    expect(result).toBe('postgresql://u:p%40ss@127.0.0.1:5432/x_test');
    expect(decodeURIComponent(new URL(result).password)).toBe('p@ss');
  });

  it.each(['HSK_E2E_TEST', 'hsk-e2e', 'hsk_test_1'])(
    'accepts the disposable database name %s',
    (databaseName) => {
      expect(withUrl(`postgresql://u@127.0.0.1:5432/${databaseName}`)()).toBe(
        `postgresql://u@127.0.0.1:5432/${databaseName}`,
      );
    },
  );
});
