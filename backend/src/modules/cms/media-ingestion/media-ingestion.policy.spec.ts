import {
  buildMediaObjectKey,
  normalizeUploadFilename,
  validateMediaIdempotencyKey,
} from './media-ingestion.policy';

describe('Media ingestion policy', () => {
  it.each([
    '../lesson.png',
    '..\\lesson.png',
    'C:\\lesson.png',
    '/absolute/lesson.png',
    '..%2flesson.png',
    '..%252flesson.png',
    '..／lesson.png',
  ])('rejects path-bearing filename %j without reflecting it', (filename) => {
    expect(() => normalizeUploadFilename(filename)).toThrow(
      'Upload filename is not allowed.',
    );
  });

  it('normalizes safe Unicode metadata with NFKC and a bounded basename', () => {
    expect(normalizeUploadFilename('  ｌｅｓｓｏｎ－０１.png  ')).toBe(
      'lesson-01.png',
    );
    expect(normalizeUploadFilename(`${'a'.repeat(180)}.png`)).toHaveLength(160);
  });

  it.each(['', 'short', 'contains space', 'secret@example.com', '../secret'])(
    'rejects unsafe idempotency key %j with a generic error',
    (key) => {
      expect(() => validateMediaIdempotencyKey(key)).toThrow(
        'Idempotency-Key is invalid.',
      );
    },
  );

  it('creates an opaque provider-independent object key', () => {
    const key = buildMediaObjectKey(
      'image',
      'png',
      new Date('2026-08-12T01:02:03.000Z'),
      '018f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b',
    );
    expect(key).toBe('media/2026/08/018f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b.png');
    expect(key).not.toContain('lesson');
    expect(key).not.toContain('..');
  });

  it('does not mutate the input when building object identity', () => {
    const date = new Date('2026-08-12T01:02:03.000Z');
    buildMediaObjectKey(
      'audio',
      'mp3',
      date,
      '018f43cb-9e6c-7f4e-8d23-8e8a0f8d5a9b',
    );
    expect(date.toISOString()).toBe('2026-08-12T01:02:03.000Z');
  });
});
