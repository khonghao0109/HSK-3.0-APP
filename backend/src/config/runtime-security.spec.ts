import { createHash } from 'node:crypto';

import {
  API_SECURITY_HEADERS,
  applyApiSecurityHeaders,
  assertMediaProviders,
  assertProductionSecrets,
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

  describe('media providers', () => {
    const providers = (
      NODE_ENV: string | undefined,
      MEDIA_STORAGE_PROVIDER: string | undefined,
      MEDIA_SCANNER_PROVIDER: string | undefined,
    ) => ({ NODE_ENV, MEDIA_STORAGE_PROVIDER, MEDIA_SCANNER_PROVIDER });

    it.each(['production', 'development', 'test', undefined])(
      'accepts S3 with ClamAV under NODE_ENV=%s',
      (nodeEnv) => {
        expect(() =>
          assertMediaProviders(providers(nodeEnv, 's3', 'clamav')),
        ).not.toThrow();
      },
    );

    it.each([
      ['memory', 'test'],
      ['memory', 'clamav'],
      ['s3', 'test'],
    ])(
      'accepts storage %s with scanner %s only under NODE_ENV=test',
      (storage, scanner) => {
        expect(() =>
          assertMediaProviders(providers('test', storage, scanner)),
        ).not.toThrow();
        for (const nodeEnv of ['production', 'development', undefined]) {
          expect(() =>
            assertMediaProviders(providers(nodeEnv, storage, scanner)),
          ).toThrow('Media provider configuration is invalid.');
        }
      },
    );

    it.each([
      [undefined, 'clamav'],
      ['s3', undefined],
      ['minio', 'clamav'],
      ['S3', 'clamav'],
      ['s3', 'noop'],
      ['memory', ''],
    ])(
      'fails closed on missing or unknown providers %j / %j, even under test',
      (storage, scanner) => {
        expect(() =>
          assertMediaProviders(providers('test', storage, scanner)),
        ).toThrow(/^Media provider configuration is invalid\.$/u);
      },
    );
  });

  describe('production secret material', () => {
    const material = (purpose: string) =>
      createHash('sha256').update(`runtime-security:${purpose}`).digest();
    const baseEnvironment = () => ({
      JWT_SECRETS: JSON.stringify({
        v1: material('jwt-v1').toString('base64'),
        v2: material('jwt-v2').toString('hex'),
      }),
      JWT_ACTIVE_KID: 'v2',
      AUTH_PASSWORD_PEPPER: material('password-pepper').toString('base64'),
      MEDIA_SIGNING_SECRET: material('media-signing').toString('hex'),
      MEDIA_METRICS_BEARER_TOKEN:
        material('metrics-current').toString('base64'),
      MEDIA_METRICS_BEARER_TOKEN_PREVIOUS:
        material('metrics-previous').toString('base64'),
    });

    it.each([
      ['raw', 'N7!qP2@vR9#xK4$mT8%zC6&wH3*yL5?uD1'],
      ['base64', material('positive-base64').toString('base64')],
      [
        'base64-unpadded',
        material('positive-base64-unpadded')
          .toString('base64')
          .replace(/=+$/u, ''),
      ],
      ['hex', material('positive-hex').toString('hex')],
    ])('accepts distinct %s CSPRNG-shaped material', (_, candidate) => {
      expect(() =>
        assertProductionSecrets({
          ...baseEnvironment(),
          MEDIA_SIGNING_SECRET: candidate,
        }),
      ).not.toThrow();
    });

    it.each(
      ['change-me', 'password', 'example', 'test-fixture'].flatMap(
        (placeholder) => {
          const decoded = `${placeholder}-must-never-be-used-as-production-secret-material`;
          return [
            ['raw', placeholder, decoded],
            ['base64', placeholder, Buffer.from(decoded).toString('base64')],
            [
              'base64-unpadded',
              placeholder,
              Buffer.from(decoded).toString('base64').replace(/=+$/u, ''),
            ],
            ['hex', placeholder, Buffer.from(decoded).toString('hex')],
          ];
        },
      ),
    )(
      'rejects %s-encoded %s material after decoding without reflection',
      (_encoding, _placeholder, candidate) => {
        let thrown: unknown;
        try {
          assertProductionSecrets({
            ...baseEnvironment(),
            MEDIA_SIGNING_SECRET: candidate,
          });
        } catch (error: unknown) {
          thrown = error;
        }
        expect(thrown).toEqual(
          expect.objectContaining({
            message: 'Production secret configuration is invalid.',
          }),
        );
        expect(String(thrown)).not.toContain(candidate);
      },
    );

    it('rejects an unlabelled raw placeholder that is also syntactically base64', () => {
      expect(() =>
        assertProductionSecrets({
          ...baseEnvironment(),
          MEDIA_SIGNING_SECRET: 'password'.repeat(4),
        }),
      ).toThrow('Production secret configuration is invalid.');
    });

    it.each([
      [
        'base64url',
        Buffer.concat([
          Buffer.from('change-me-placeholder-material-that-is-long-enough-'),
          Buffer.from([0xfb, 0xff, 0xfe, 0xfa]),
        ]).toString('base64url'),
      ],
      [
        'base64 with spaces',
        Buffer.from('change-me-placeholder-material-that-is-long-enough-spaces')
          .toString('base64')
          .replace(/.{12}/gu, (chunk) => `${chunk} `),
      ],
      [
        'base64 with newline',
        (() => {
          const encoded = Buffer.from(
            'change-me-placeholder-material-that-is-long-enough-newline',
          ).toString('base64');
          return `${encoded.slice(0, 20)}\n${encoded.slice(20)}`;
        })(),
      ],
      [
        'base64 prefix',
        `base64:${Buffer.from(
          'change-me-placeholder-material-that-is-long-enough-prefix',
        ).toString('base64')}`,
      ],
      [
        '0x hex prefix',
        `0x${Buffer.from(
          'change-me-placeholder-material-that-is-long-enough-hex',
        ).toString('hex')}`,
      ],
    ])(
      'rejects noncanonical or alternate %s placeholder material',
      (_, candidate) => {
        expect(() =>
          assertProductionSecrets({
            ...baseEnvironment(),
            MEDIA_SIGNING_SECRET: candidate,
          }),
        ).toThrow('Production secret configuration is invalid.');
      },
    );

    it('accepts canonical unpadded base64url CSPRNG-shaped material', () => {
      const candidate = Buffer.concat([
        material('positive-base64url'),
        Buffer.from([0xfb, 0xff]),
      ]).toString('base64url');
      expect(candidate).toMatch(/[-_]/u);
      expect(() =>
        assertProductionSecrets({
          ...baseEnvironment(),
          MEDIA_SIGNING_SECRET: candidate,
        }),
      ).not.toThrow();
    });

    it.each([
      `base64:${material('noncanonical-prefix').toString('base64')}`,
      `0x${material('noncanonical-hex-prefix').toString('hex')}`,
      `${material('noncanonical-space').toString('base64')} `,
      `${material('noncanonical-newline').toString('base64')}\n`,
    ])(
      'rejects noncanonical encoding grammar even for strong material',
      (candidate) => {
        expect(() =>
          assertProductionSecrets({
            ...baseEnvironment(),
            MEDIA_SIGNING_SECRET: candidate,
          }),
        ).toThrow('Production secret configuration is invalid.');
      },
    );

    it.each([
      ['raw periodic', 'Ab1!'.repeat(8)],
      ['base64 periodic', Buffer.from('01234567'.repeat(4)).toString('base64')],
      [
        'hex grouped',
        Buffer.concat([
          Buffer.alloc(16, 0x41),
          Buffer.alloc(16, 0x42),
        ]).toString('hex'),
      ],
    ])('rejects low-diversity or deterministic %s material', (_, candidate) => {
      expect(() =>
        assertProductionSecrets({
          ...baseEnvironment(),
          MEDIA_SIGNING_SECRET: candidate,
        }),
      ).toThrow('Production secret configuration is invalid.');
    });

    it('rejects cross-purpose reuse even when the same bytes use different encodings', () => {
      const reused = material('reused-cross-purpose');
      expect(() =>
        assertProductionSecrets({
          ...baseEnvironment(),
          JWT_SECRETS: JSON.stringify({ v1: reused.toString('base64') }),
          JWT_ACTIVE_KID: 'v1',
          AUTH_PASSWORD_PEPPER: reused.toString('hex'),
        }),
      ).toThrow('Production secret configuration is invalid.');
    });

    it('rejects malformed JWT secret maps with the same sanitized error', () => {
      for (const JWT_SECRETS of ['null', '[]', '{', '{"v1":42}']) {
        expect(() =>
          assertProductionSecrets({
            ...baseEnvironment(),
            JWT_SECRETS,
          }),
        ).toThrow('Production secret configuration is invalid.');
      }
    });
  });
});
