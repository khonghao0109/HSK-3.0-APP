import {
  createMediaAccessSignature,
  verifyMediaAccessSignature,
} from './media-access-signature';

describe('Media access signature', () => {
  const secret = 'test-media-signing-secret-at-least-32-characters';

  it('accepts the exact unexpired media grant', () => {
    const signature = createMediaAccessSignature({
      mediaId: 42,
      expiresAt: 1_800_000_000,
      checksum: 'a'.repeat(64),
      secret,
    });
    expect(
      verifyMediaAccessSignature(
        {
          mediaId: 42,
          expiresAt: 1_800_000_000,
          checksum: 'a'.repeat(64),
          signature,
          secret,
        },
        1_799_999_999,
      ),
    ).toBe(true);
  });

  it('rejects expired, cross-asset and malformed grants without throwing', () => {
    const signature = createMediaAccessSignature({
      mediaId: 42,
      expiresAt: 1_800_000_000,
      checksum: 'a'.repeat(64),
      secret,
    });
    expect(
      verifyMediaAccessSignature(
        {
          mediaId: 42,
          expiresAt: 1_800_000_000,
          checksum: 'a'.repeat(64),
          signature,
          secret,
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
        },
        1_799_999_999,
      ),
    ).toBe(false);
  });
});
