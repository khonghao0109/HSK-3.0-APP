import { createHmac, timingSafeEqual } from 'node:crypto';

type MediaAccessPayload = {
  mediaId: number;
  expiresAt: number;
  checksum: string;
  secret: string;
  method: string;
  resource: string;
};

export const MEDIA_CONTENT_ACCESS_METHOD = 'GET';
const MEDIA_ACCESS_SIGNATURE_VERSION = 'hsk-media-access-v1';

export function canonicalMediaContentResource(mediaId: number): string {
  return `/api/v1/media/${mediaId}/content`;
}

export function createMediaAccessSignature(input: MediaAccessPayload): string {
  return createHmac('sha256', input.secret)
    .update(
      [
        MEDIA_ACCESS_SIGNATURE_VERSION,
        input.method,
        input.resource,
        String(input.expiresAt),
        input.checksum,
      ].join('\n'),
    )
    .digest('hex');
}

export function verifyMediaAccessSignature(
  input: MediaAccessPayload & { signature: string },
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (
    input.expiresAt <= nowEpochSeconds ||
    input.method !== MEDIA_CONTENT_ACCESS_METHOD ||
    input.resource !== canonicalMediaContentResource(input.mediaId) ||
    !/^[a-f0-9]{64}$/u.test(input.checksum) ||
    !/^[a-f0-9]{64}$/u.test(input.signature)
  ) {
    return false;
  }
  const expected = Buffer.from(createMediaAccessSignature(input), 'hex');
  const actual = Buffer.from(input.signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
