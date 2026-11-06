import { createHash } from 'node:crypto';

import { grantTracker } from './media-content-throttle';

describe('grantTracker', () => {
  const now = 1_800_000_000;
  const signature = 'c'.repeat(64);
  const valid = { mediaId: '41', expires: String(now + 300), signature };

  const track = (
    params: Record<string, unknown>,
    query: Record<string, unknown>,
  ) => grantTracker({ ip: '203.0.113.7', params, query });

  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(now * 1000));
  afterEach(() => jest.restoreAllMocks());

  it('keys a well-formed live grant by a hash that never contains the signature', () => {
    const key = track(
      { mediaId: valid.mediaId },
      { expires: valid.expires, signature },
    );

    expect(key).toBe(
      `grant:${createHash('sha256')
        .update(`41:${valid.expires}:${signature}`)
        .digest('hex')}`,
    );
    expect(key).toMatch(/^grant:[a-f0-9]{64}$/u);
    expect(key).not.toContain(signature);
  });

  it('gives different grants of one media separate buckets', () => {
    const other = track(
      { mediaId: '41' },
      { expires: valid.expires, signature: 'd'.repeat(64) },
    );

    expect(other).not.toBe(
      track({ mediaId: '41' }, { expires: valid.expires, signature }),
    );
  });

  it.each([
    ['repeated expires (array)', { expires: [valid.expires, valid.expires] }],
    ['repeated signature (array)', { signature: [signature, signature] }],
    ['missing expires', { expires: undefined }],
    ['missing signature', { signature: undefined }],
    ['uppercase signature', { signature: 'C'.repeat(64) }],
    ['short signature', { signature: 'c'.repeat(63) }],
    ['non-numeric expires', { expires: '18e8' }],
    ['11-digit expires', { expires: '18000003000' }],
    ['expired grant', { expires: String(now - 1) }],
    [
      'expiry beyond any configurable TTL plus skew',
      { expires: String(now + 661) },
    ],
  ])('falls back to the IP bucket for %s', (_label, override) => {
    expect(track({ mediaId: valid.mediaId }, { ...valid, ...override })).toBe(
      'ip:203.0.113.7',
    );
  });

  it.each([
    ['zero', '0'],
    ['leading zero', '041'],
    ['17 digits', '1'.repeat(17)],
    ['beyond safe integer', '9999999999999999'],
    ['array', ['41']],
    ['missing', undefined],
  ])('falls back to the IP bucket for a %s media id', (_label, mediaId) => {
    expect(track({ mediaId }, valid)).toBe('ip:203.0.113.7');
  });

  it.each([
    ['60', 300],
    ['300', 300],
    ['600', 600],
  ])(
    'with admin TTL %s s accepts expiry up to max(TTL) + 60 s',
    (adminTtl, maxTtl) => {
      const previous = process.env.MEDIA_ACCESS_TTL_SECONDS;
      process.env.MEDIA_ACCESS_TTL_SECONDS = adminTtl;
      try {
        expect(
          track(
            { mediaId: '41' },
            { ...valid, expires: String(now + maxTtl + 60) },
          ),
        ).toMatch(/^grant:/u);
        expect(
          track(
            { mediaId: '41' },
            { ...valid, expires: String(now + maxTtl + 61) },
          ),
        ).toBe('ip:203.0.113.7');
        expect(
          track({ mediaId: '41' }, { ...valid, expires: String(now) }),
        ).toMatch(/^grant:/u);
      } finally {
        if (previous === undefined) delete process.env.MEDIA_ACCESS_TTL_SECONDS;
        else process.env.MEDIA_ACCESS_TTL_SECONDS = previous;
      }
    },
  );
});
