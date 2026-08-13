import {
  API_SECURITY_HEADERS,
  applyApiSecurityHeaders,
  buildCorsOriginValidator,
  configureApiEdgeSecurity,
  normalizeAllowedOrigins,
} from './runtime-security';

describe('runtime edge security', () => {
  it('normalizes exact HTTPS production origins', () => {
    expect(
      normalizeAllowedOrigins(
        'https://admin.example.com/, https://app.example.com',
        'production',
      ),
    ).toEqual(['https://admin.example.com', 'https://app.example.com']);
  });

  it.each([
    '',
    '*',
    'https://*.example.com',
    'https://admin.example.com,',
    'http://admin.example.com',
    'https://user:secret@admin.example.com',
    'https://admin.example.com/path',
    'https://admin.example.com?next=secret',
    'https://admin.example.com#fragment',
    'admin.example.com',
  ])('rejects unsafe production origin %j', (value) => {
    expect(() => normalizeAllowedOrigins(value, 'production')).toThrow(
      'ALLOWED_ORIGINS',
    );
  });

  it('allows only explicit loopback HTTP origins outside production', () => {
    expect(
      normalizeAllowedOrigins(
        'http://localhost:3001,http://127.0.0.1:3001',
        'test',
      ),
    ).toEqual(['http://localhost:3001', 'http://127.0.0.1:3001']);
    expect(() =>
      normalizeAllowedOrigins('http://example.com', 'development'),
    ).toThrow('ALLOWED_ORIGINS');
  });

  it('compares request origins exactly and rejects malicious suffixes', () => {
    const validate = buildCorsOriginValidator(['https://admin.example.com']);
    expect(validate(undefined)).toBe(true);
    expect(validate('https://admin.example.com')).toBe(true);
    expect(validate('https://admin.example.com.evil.test')).toBe(false);
    expect(validate('https://evil-admin.example.com')).toBe(false);
  });

  it('ships API-safe headers without application-layer HSTS', () => {
    expect(API_SECURITY_HEADERS).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': expect.stringContaining('camera=()'),
      'Content-Security-Policy': expect.stringContaining("media-src 'self'"),
    });
    expect(API_SECURITY_HEADERS).not.toHaveProperty(
      'Strict-Transport-Security',
    );
  });

  it('wires exact credentialed CORS and security middleware into Nest', () => {
    const app = { enableCors: jest.fn(), use: jest.fn() };
    const config = {
      getOrThrow: jest.fn().mockReturnValue(['https://admin.example.com']),
    };
    configureApiEdgeSecurity(app as never, config as never);

    expect(app.enableCors).toHaveBeenCalledTimes(1);
    const cors = app.enableCors.mock.calls[0]?.[0] as {
      credentials: boolean;
      origin: (
        origin: string | undefined,
        callback: (error: Error | null, allow?: boolean) => void,
      ) => void;
    };
    expect(cors.credentials).toBe(true);
    const allowed = jest.fn();
    cors.origin('https://admin.example.com', allowed);
    expect(allowed).toHaveBeenCalledWith(null, true);
    const rejected = jest.fn();
    cors.origin('https://admin.example.com.evil.test', rejected);
    expect(rejected).toHaveBeenCalledWith(null, false);
    expect(app.use).toHaveBeenCalledWith(applyApiSecurityHeaders);
  });

  it('sets every application-layer header without reflecting request data', () => {
    const response = { setHeader: jest.fn() };
    const next = jest.fn();
    applyApiSecurityHeaders(
      { url: '/api/v1/media/1/content?signature=secret' } as never,
      response as never,
      next,
    );
    expect(response.setHeader).toHaveBeenCalledTimes(
      Object.keys(API_SECURITY_HEADERS).length,
    );
    expect(JSON.stringify(response.setHeader.mock.calls)).not.toContain(
      'secret',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
