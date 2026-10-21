import { describe, expect, it } from 'vitest';

import {
  canonicalMediaFile,
  checkMediaFile,
  formatMediaBytes,
  MEDIA_IDEMPOTENCY_KEY_PATTERN,
  MEDIA_UPLOAD_MAX_BYTES,
  MEDIA_UPLOAD_TEXT,
} from './media-upload-values';

describe('checkMediaFile (TL-39)', () => {
  it.each([
    ['bai1.wav', 'audio/wav'],
    ['BAI1.WAV', 'audio/wav'],
    ['anh.JPG', 'image/jpeg'],
    ['anh.png', 'image/png'],
    ['nghe.mp3', 'audio/mpeg'],
  ])('accepts %s with canonical MIME %s', (name, mimeType) => {
    expect(checkMediaFile({ name, size: 10 })).toMatchObject({
      ok: true,
      mimeType,
    });
  });

  it.each(['bai.1.wav', '.wav', 'bai', 'bai.gif', 'bai.wav.png', 'bai.mp4'])(
    'rejects filename %s',
    (name) => {
      expect(checkMediaFile({ name, size: 10 })).toEqual({
        ok: false,
        message: MEDIA_UPLOAD_TEXT.name,
      });
    },
  );

  it('rejects .jpeg with a rename hint', () => {
    expect(checkMediaFile({ name: 'anh.jpeg', size: 10 })).toEqual({
      ok: false,
      message: MEDIA_UPLOAD_TEXT.jpeg,
    });
  });

  it('rejects empty and oversized files at the backend multer limit', () => {
    expect(checkMediaFile({ name: 'a.wav', size: 0 })).toEqual({
      ok: false,
      message: MEDIA_UPLOAD_TEXT.empty,
    });
    expect(MEDIA_UPLOAD_MAX_BYTES).toBe(10_485_760);
    expect(
      checkMediaFile({ name: 'a.wav', size: MEDIA_UPLOAD_MAX_BYTES }).ok,
    ).toBe(true);
    expect(
      checkMediaFile({ name: 'a.wav', size: MEDIA_UPLOAD_MAX_BYTES + 1 }),
    ).toEqual({ ok: false, message: MEDIA_UPLOAD_TEXT.tooLarge });
  });
});

describe('canonicalMediaFile (TL-39)', () => {
  it.each(['audio/x-wav', 'audio/wave', ''])(
    'rebuilds a WAV declared as %j with audio/wav and the same bytes/name',
    async (declared) => {
      const original = new File([new Uint8Array([1, 2, 3])], 'bai1.wav', {
        type: declared,
      });
      const check = checkMediaFile(original);
      if (!check.ok) throw new Error('expected a valid file');

      const rebuilt = canonicalMediaFile(original, check.mimeType);

      expect(rebuilt.type).toBe('audio/wav');
      expect(rebuilt.name).toBe('bai1.wav');
      expect([...new Uint8Array(await rebuilt.arrayBuffer())]).toEqual([
        1, 2, 3,
      ]);
    },
  );
});

describe('MEDIA_IDEMPOTENCY_KEY_PATTERN (TL-38)', () => {
  it('accepts a UUID and rejects short or unsafe keys', () => {
    expect(MEDIA_IDEMPOTENCY_KEY_PATTERN.test(crypto.randomUUID())).toBe(true);
    expect(MEDIA_IDEMPOTENCY_KEY_PATTERN.test('a'.repeat(31))).toBe(false);
    expect(MEDIA_IDEMPOTENCY_KEY_PATTERN.test('a'.repeat(129))).toBe(false);
    expect(MEDIA_IDEMPOTENCY_KEY_PATTERN.test(`-${'a'.repeat(40)}`)).toBe(
      false,
    );
  });
});

describe('formatMediaBytes (nit)', () => {
  it.each([
    [1600, '1,6 KB'],
    [1024 * 1024 - 1, '1.024,0 KB'],
    [1024 * 1024, '1,0 MB'],
    [10 * 1024 * 1024, '10,0 MB'],
    [10_485_700, '10,0 MB'],
  ])('%i bytes → %s', (bytes, text) => {
    expect(formatMediaBytes(bytes)).toBe(text);
  });
});
