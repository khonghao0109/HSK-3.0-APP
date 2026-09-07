/**
 * Giá trị mặc định để `npm run test:e2e` chạy được từ một checkout mới bằng một
 * lệnh (H.3b). Mặc định khớp service `postgres` trong `docker-compose.yml` ở gốc
 * repo và chỉ được áp dụng khi biến chưa được set, nên CI hay máy local vẫn ghi đè
 * bình thường.
 *
 * Đây là credential local dùng một lần cho database disposable, không phải secret.
 * Mọi lệnh ghi vào DB vẫn đi qua `assertDisposableTestDatabase()`.
 */
const DEFAULT_DATABASE_URL =
  'postgresql://hsk:test-local-postgres@127.0.0.1:5432/hsk_e2e_test';
const DEFAULT_JWT_SECRETS =
  '{"e2e":"test-e2e-jwt-secret-at-least-32-characters"}';
const DEFAULT_JWT_ACTIVE_KID = 'e2e';

export type E2eEnvironment = {
  databaseUrl: string;
  testDatabaseUrl: string;
};

/**
 * `TEST_DATABASE_URL` được truyền thẳng cho psql nên không được mang query
 * parameter riêng của Prisma (ví dụ `?schema=public`).
 */
function stripQueryParameters(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function applyE2eEnvironmentDefaults(
  environment: NodeJS.ProcessEnv = process.env,
): E2eEnvironment {
  if (environment.NODE_ENV !== undefined && environment.NODE_ENV !== 'test') {
    throw new Error(
      `E2E requires NODE_ENV=test (got "${environment.NODE_ENV}")`,
    );
  }
  environment.NODE_ENV = 'test';

  const configuredDatabaseUrl = environment.DATABASE_URL;
  const configuredTestDatabaseUrl = environment.TEST_DATABASE_URL;

  if (!configuredDatabaseUrl && !configuredTestDatabaseUrl) {
    environment.DATABASE_URL = DEFAULT_DATABASE_URL;
    environment.TEST_DATABASE_URL = DEFAULT_DATABASE_URL;
  } else if (configuredDatabaseUrl && !configuredTestDatabaseUrl) {
    environment.TEST_DATABASE_URL = stripQueryParameters(configuredDatabaseUrl);
  } else if (!configuredDatabaseUrl && configuredTestDatabaseUrl) {
    environment.DATABASE_URL = configuredTestDatabaseUrl;
  }

  if (!environment.JWT_SECRETS) {
    environment.JWT_SECRETS = DEFAULT_JWT_SECRETS;
    environment.JWT_ACTIVE_KID = DEFAULT_JWT_ACTIVE_KID;
  }

  const databaseUrl = environment.DATABASE_URL;
  const testDatabaseUrl = environment.TEST_DATABASE_URL;

  if (!databaseUrl || !testDatabaseUrl) {
    throw new Error('E2E requires DATABASE_URL and TEST_DATABASE_URL');
  }

  return { databaseUrl, testDatabaseUrl };
}
