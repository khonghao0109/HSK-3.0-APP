import { createHmac, timingSafeEqual } from 'node:crypto';

type MediaAccessPayload = {
  mediaId: number;
  expiresAt: number;
  checksum: string;
  secret: string;
};

export function createMediaAccessSignature(input: MediaAccessPayload): string {
  return createHmac('sha256', input.secret)
    .update(`${input.mediaId}:${input.expiresAt}:${input.checksum}`)
    .digest('hex');
}

export function verifyMediaAccessSignature(
  input: MediaAccessPayload & { signature: string },
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (
    input.expiresAt <= nowEpochSeconds ||
    !/^[a-f0-9]{64}$/u.test(input.signature)
  ) {
    return false;
  }
  const expected = Buffer.from(createMediaAccessSignature(input), 'hex');
  const actual = Buffer.from(input.signature, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
