import {
  createMediaAccessSignature,
  verifyMediaAccessSignature,
} from './media-access-signature';

describe('Media access signature', () => {
  const secret = 'test-media-signing-secret-at-least-32-characters';
  const canonicalRequest = {
    method: 'GET',
    resource: '/api/v1/media/42/content',
  };

  it('accepts the exact unexpired media grant', () => {
    const signature = createMediaAccessSignature({
      mediaId: 42,
      expiresAt: 1_800_000_000,
      checksum: 'a'.repeat(64),
      secret,
      ...canonicalRequest,
    });
    expect(
      verifyMediaAccessSignature(
        {
          mediaId: 42,
          expiresAt: 1_800_000_000,
          checksum: 'a'.repeat(64),
          signature,
          secret,
          ...canonicalRequest,
        },
        1_799_999_999,
      ),
    ).toBe(true);
  });

  it('binds a grant to GET and the canonical content resource', () => {
    const grant = {
      mediaId: 42,
      expiresAt: 1_800_000_000,
      checksum: 'a'.repeat(64),
      secret,
      ...canonicalRequest,
    };
    const signature = createMediaAccessSignature(grant);

    expect(
      verifyMediaAccessSignature({ ...grant, signature }, 1_799_999_999),
    ).toBe(true);
    expect(
      verifyMediaAccessSignature(
        { ...grant, method: 'HEAD', signature },
        1_799_999_999,
      ),
    ).toBe(false);
    expect(
      verifyMediaAccessSignature(
        {
          ...grant,
          resource: '/api/v1/media/42/content/',
          signature,
        },
        1_799_999_999,
      ),
    ).toBe(false);
    expect(
      verifyMediaAccessSignature(
        {
          ...grant,
          resource: '/API/v1/media/42/content',
          signature,
        },
        1_799_999_999,
      ),
    ).toBe(false);
  });

  it('makes the bounded replay contract explicit', () => {
    const grant = {
      mediaId: 42,
      expiresAt: 1_800_000_000,
      checksum: 'a'.repeat(64),
      secret,
      ...canonicalRequest,
    };
    const signature = createMediaAccessSignature(grant);

    expect(
      verifyMediaAccessSignature({ ...grant, signature }, 1_799_999_998),
    ).toBe(true);
    expect(
      verifyMediaAccessSignature({ ...grant, signature }, 1_799_999_999),
    ).toBe(true);
    expect(
      verifyMediaAccessSignature({ ...grant, signature }, 1_800_000_000),
    ).toBe(false);
  });

  it('rejects expired, cross-asset and malformed grants without throwing', () => {
    const signature = createMediaAccessSignature({
      mediaId: 42,
      expiresAt: 1_800_000_000,
      checksum: 'a'.repeat(64),
      secret,
      ...canonicalRequest,
    });
    expect(
      verifyMediaAccessSignature(
        {
          mediaId: 42,
          expiresAt: 1_800_000_000,
          checksum: 'a'.repeat(64),
          signature,
          secret,
          ...canonicalRequest,
        },
        1_800_000_001,
      ),
    ).toBe(false);
    expect(
      verifyMediaAccessSignature(
        {
          mediaId: 42,
          expiresAt: 1_800_000_000,
          checksum: 'a'.repeat(64),
          signature,
          secret,
          ...canonicalRequest,
        },
        1_800_000_000,
      ),
    ).toBe(false);
    expect(
      verifyMediaAccessSignature(
        {
          mediaId: 43,
          expiresAt: 1_800_000_000,
          checksum: 'a'.repeat(64),
          signature,
          secret,
          ...canonicalRequest,
        },
        1_799_999_999,
      ),
    ).toBe(false);
    expect(
      verifyMediaAccessSignature(
        {
          mediaId: 42,
          expiresAt: 1_800_000_000,
          checksum: 'a'.repeat(64),
          signature: 'not-hex',
          secret,
          ...canonicalRequest,
        },
        1_799_999_999,
      ),
    ).toBe(false);
    expect(
      verifyMediaAccessSignature(
        {
          mediaId: 42,
          expiresAt: 1_800_000_001,
          checksum: 'a'.repeat(64),
          signature,
          secret,
          ...canonicalRequest,
        },
        1_799_999_999,
      ),
    ).toBe(false);
    expect(
      verifyMediaAccessSignature(
        {
          mediaId: 42,
          expiresAt: 1_800_000_000,
          checksum: 'b'.repeat(64),
          signature,
          secret,
          ...canonicalRequest,
        },
        1_799_999_999,
      ),
    ).toBe(false);
  });
});
