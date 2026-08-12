import { envValidationSchema } from './env.validation';

describe('media environment validation', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:password@localhost:5432/hsk_test',
    JWT_SECRETS: JSON.stringify({ v1: 'a'.repeat(32) }),
    JWT_ACTIVE_KID: 'v1',
  };

  it.each([
    'MEDIA_STORAGE_BUCKET',
    'MEDIA_STORAGE_REGION',
    'MEDIA_SIGNING_SECRET',
    'MEDIA_SCANNER_HOST',
  ])('requires production boundary %s', (missing) => {
    const environment: Record<string, string> = {
      ...base,
      NODE_ENV: 'production',
      MEDIA_STORAGE_BUCKET: 'hsk-private-media',
      MEDIA_STORAGE_REGION: 'ap-southeast-1',
      MEDIA_SIGNING_SECRET: 's'.repeat(32),
      MEDIA_SCANNER_HOST: 'clamav.internal',
    };
    delete environment[missing];
    const result = envValidationSchema.validate(environment, {
      abortEarly: false,
    });
    expect(result.error?.message).toContain(missing);
  });

  it('accepts a complete production media boundary and bounded TTL', () => {
    const result = envValidationSchema.validate({
      ...base,
      NODE_ENV: 'production',
      MEDIA_STORAGE_BUCKET: 'hsk-private-media',
      MEDIA_STORAGE_REGION: 'ap-southeast-1',
      MEDIA_STORAGE_ENDPOINT: 'https://objects.example.test',
      MEDIA_SIGNING_SECRET: 's'.repeat(32),
      MEDIA_ACCESS_TTL_SECONDS: 300,
      MEDIA_SCANNER_HOST: 'clamav.internal',
      MEDIA_SCANNER_PORT: 3310,
    });
    expect(result.error).toBeUndefined();
  });

  it('rejects insecure storage endpoints and out-of-contract access TTL', () => {
    const insecure = envValidationSchema.validate({
      ...base,
      NODE_ENV: 'production',
      MEDIA_STORAGE_BUCKET: 'hsk-private-media',
      MEDIA_STORAGE_REGION: 'ap-southeast-1',
      MEDIA_STORAGE_ENDPOINT: 'http://objects.example.test',
      MEDIA_SIGNING_SECRET: 's'.repeat(32),
      MEDIA_ACCESS_TTL_SECONDS: 601,
      MEDIA_SCANNER_HOST: 'clamav.internal',
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
  });
});
