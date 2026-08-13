import { createHash } from 'node:crypto';

import { envValidationSchema } from './env.validation';

describe('media environment validation', () => {
  const secret = (purpose: string) =>
    createHash('sha256').update(`hsk-production-${purpose}`).digest('base64');
  const jwtSecret = secret('jwt');
  const passwordPepper = secret('password-pepper');
  const signingSecret = secret('media-signing');
  const metricsToken = secret('metrics');
  const base = {
    DATABASE_URL: 'postgresql://user:password@localhost:5432/hsk_test',
    JWT_SECRETS: JSON.stringify({ v1: jwtSecret }),
    JWT_ACTIVE_KID: 'v1',
  };

  const production = {
    ...base,
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://admin.example.com,https://app.example.com',
    AUTH_PASSWORD_PEPPER: passwordPepper,
    MEDIA_STORAGE_BUCKET: 'hsk-private-media',
    MEDIA_STORAGE_REGION: 'ap-southeast-1',
    MEDIA_SIGNING_SECRET: signingSecret,
    MEDIA_SCANNER_HOST: 'clamav.internal',
    MEDIA_METRICS_BEARER_TOKEN: metricsToken,
    MEDIA_METRICS_HOST: '0.0.0.0',
    MEDIA_METRICS_PORT: 9464,
  };

  it.each([
    'MEDIA_STORAGE_BUCKET',
    'MEDIA_STORAGE_REGION',
    'MEDIA_SIGNING_SECRET',
    'MEDIA_SCANNER_HOST',
    'MEDIA_METRICS_BEARER_TOKEN',
    'MEDIA_METRICS_HOST',
    'MEDIA_METRICS_PORT',
    'AUTH_PASSWORD_PEPPER',
    'ALLOWED_ORIGINS',
  ])('requires production boundary %s', (missing) => {
    const environment: Record<string, string> = {
      ...production,
    };
    delete environment[missing];
    const result = envValidationSchema.validate(environment, {
      abortEarly: false,
    });
    expect(result.error?.message).toContain(missing);
  });

  it('accepts a complete production media boundary and bounded TTL', () => {
    const result = envValidationSchema.validate({
      ...production,
      MEDIA_STORAGE_ENDPOINT: 'https://objects.example.test',
      MEDIA_ACCESS_TTL_SECONDS: 300,
      MEDIA_INGESTION_ENABLED: false,
      MEDIA_SCANNER_PORT: 3310,
    });
    expect(result.error).toBeUndefined();
  });

  it('rejects a metrics listener that collides with the public API listener', () => {
    expect(
      envValidationSchema.validate({
        ...production,
        PORT: 9464,
        MEDIA_METRICS_PORT: 9464,
      }).error,
    ).toBeDefined();
  });

  it('requires a fresh cache window strictly smaller than the stale fallback window', () => {
    expect(
      envValidationSchema.validate({
        ...production,
        MEDIA_METRICS_CACHE_TTL_MS: 60_000,
        MEDIA_METRICS_STALE_TTL_MS: 1_000,
      }).error,
    ).toBeDefined();
    expect(
      envValidationSchema.validate({
        ...production,
        MEDIA_METRICS_CACHE_TTL_MS: 5_000,
        MEDIA_METRICS_STALE_TTL_MS: 60_000,
      }).error,
    ).toBeUndefined();
  });

  it('rejects insecure storage endpoints and out-of-contract access TTL', () => {
    const insecure = envValidationSchema.validate({
      ...production,
      MEDIA_STORAGE_ENDPOINT: 'http://objects.example.test',
      MEDIA_ACCESS_TTL_SECONDS: 601,
    });
    expect(insecure.error).toBeDefined();
  });

  it('allows test-only adapters without production infrastructure values', () => {
    const result = envValidationSchema.validate({
      ...base,
      NODE_ENV: 'test',
    });
    expect(result.error).toBeUndefined();
    expect(result.value.MEDIA_SIGNING_SECRET).toHaveLength(48);
    expect(result.value.MEDIA_INGESTION_ENABLED).toBe(true);
    expect(result.value.ALLOWED_ORIGINS).toBe(
      'http://localhost:3001,http://127.0.0.1:3001',
    );
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['wildcard', '*'],
    ['HTTP', 'http://admin.example.com'],
    ['path', 'https://admin.example.com/path'],
    ['query', 'https://admin.example.com?next=secret'],
    ['userinfo', 'https://user:secret@admin.example.com'],
  ])('rejects production ALLOWED_ORIGINS when %s', (_, value) => {
    const environment: Record<string, unknown> = { ...production };
    if (value === undefined) delete environment.ALLOWED_ORIGINS;
    else environment.ALLOWED_ORIGINS = value;
    expect(
      envValidationSchema.validate(environment, { abortEarly: false }).error,
    ).toBeDefined();
  });

  it.each([
    [
      'JWT placeholder',
      {
        JWT_SECRETS: JSON.stringify({ v1: 'change-me-at-least-32-characters' }),
      },
    ],
    [
      'JWT test default',
      {
        JWT_SECRETS: JSON.stringify({
          v1: 'test-media-signing-secret-at-least-32-characters',
        }),
      },
    ],
    [
      'password placeholder',
      { AUTH_PASSWORD_PEPPER: 'change-me-at-least-32-characters' },
    ],
    [
      'signing placeholder',
      { MEDIA_SIGNING_SECRET: 'change-me-at-least-32-characters' },
    ],
    [
      'metrics placeholder',
      { MEDIA_METRICS_BEARER_TOKEN: 'change-me-at-least-32-characters' },
    ],
  ])('rejects production %s without reflecting the secret', (_, override) => {
    const result = envValidationSchema.validate(
      { ...production, ...override },
      { abortEarly: false },
    );
    expect(result.error).toBeDefined();
    expect(result.error?.message).not.toContain(Object.values(override)[0]);
  });

  it('rejects active JWT key mismatch and cross-purpose secret reuse', () => {
    const missingActive = envValidationSchema.validate({
      ...production,
      JWT_ACTIVE_KID: 'missing',
    });
    expect(missingActive.error).toBeDefined();

    const reused = envValidationSchema.validate({
      ...production,
      MEDIA_SIGNING_SECRET: passwordPepper,
    });
    expect(reused.error).toBeDefined();
  });

  it('rejects encoded low-diversity values and duplicate rotation tokens', () => {
    const repeatedBytes = Buffer.alloc(32, 0x41).toString('base64');
    expect(
      envValidationSchema.validate({
        ...production,
        MEDIA_SIGNING_SECRET: repeatedBytes,
      }).error,
    ).toBeDefined();
    expect(
      envValidationSchema.validate({
        ...production,
        MEDIA_METRICS_BEARER_TOKEN_PREVIOUS: metricsToken,
      }).error,
    ).toBeDefined();
  });

  it('preserves an explicitly configured HTTPS origin without inferring parents', () => {
    const result = envValidationSchema.validate({
      ...production,
      ALLOWED_ORIGINS: 'https://admin.example.com.evil.test',
    });
    expect(result.error).toBeUndefined();
    expect(result.value.ALLOWED_ORIGINS).toBe(
      'https://admin.example.com.evil.test',
    );
  });
});
