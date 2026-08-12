import { BadRequestException } from '@nestjs/common';

const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{31,127}$/u;
const FORBIDDEN_PATH_OR_ENCODING =
  /(?:[/\\]|\.\.|%2f|%5c|%252f|%255c|^[A-Za-z]:)/iu;

export function normalizeUploadFilename(value: string): string {
  const decoded = decodePathEncoding(value);
  const normalized = decoded.normalize('NFKC').trim();
  if (
    normalized.length === 0 ||
    FORBIDDEN_PATH_OR_ENCODING.test(normalized) ||
    hasControlOrBidiCharacter(normalized)
  ) {
    throw new BadRequestException('Upload filename is not allowed.');
  }
  const characters = Array.from(normalized);
  return characters.slice(Math.max(0, characters.length - 160)).join('');
}

export function validateMediaIdempotencyKey(value: string | undefined): string {
  if (!value || !SAFE_IDEMPOTENCY_KEY.test(value)) {
    throw new BadRequestException('Idempotency-Key is invalid.');
  }
  return value;
}

export function buildMediaObjectKey(
  _mediaType: 'audio' | 'image',
  extension: 'jpg' | 'png' | 'mp3' | 'wav',
  now: Date,
  opaqueId: string,
): string {
  const year = now.getUTCFullYear().toString().padStart(4, '0');
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  return `media/${year}/${month}/${opaqueId}.${extension}`;
}

function decodePathEncoding(value: string): string {
  let decoded = value;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      throw new BadRequestException('Upload filename is not allowed.');
    }
  }
  return decoded;
}

function hasControlOrBidiCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0) ?? 0;
    return (
      point <= 0x1f ||
      point === 0x7f ||
      (point >= 0x200b && point <= 0x200f) ||
      (point >= 0x202a && point <= 0x202e) ||
      (point >= 0x2066 && point <= 0x2069)
    );
  });
}
