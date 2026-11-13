import {
  isUsableMediaContent,
  type MediaContentRecord,
} from './media-access.service';

/**
 * F5: one usable-media rule for every learner-facing signed grant. The rule
 * must be as strict as `readSignedObject`: a row missing any field the content
 * route later needs is not usable, even when it is `ready`.
 */
function media(
  overrides: Partial<MediaContentRecord> = {},
): MediaContentRecord {
  return {
    checksum: 'a'.repeat(64),
    mimeType: 'image/png',
    storageProvider: 'memory',
    storageKey: 'media/f5/image.png',
    type: 'image',
    processingStatus: 'ready',
    deletedAt: null,
    size: 12,
    ...overrides,
  };
}

describe('isUsableMediaContent', () => {
  it('accepts a complete, ready row from the active storage provider', () => {
    expect(isUsableMediaContent(media(), 'memory')).toBe(true);
  });

  it('rejects a missing row', () => {
    expect(isUsableMediaContent(null, 'memory')).toBe(false);
    expect(isUsableMediaContent(undefined, 'memory')).toBe(false);
  });

  it.each([
    ['checksum null', { checksum: null }],
    ['checksum empty', { checksum: '' }],
    ['storageKey null', { storageKey: null }],
    ['storageKey empty', { storageKey: '' }],
    ['storageProvider null', { storageProvider: null }],
    ['storageProvider empty', { storageProvider: '' }],
    ['mimeType null', { mimeType: null }],
    ['mimeType empty', { mimeType: '' }],
    ['size null', { size: null }],
    ['size zero', { size: 0 }],
  ] as const)('rejects a row with %s (F5)', (_label, overrides) => {
    expect(isUsableMediaContent(media(overrides), 'memory')).toBe(false);
  });

  it('rejects a row the content route would refuse', () => {
    expect(
      isUsableMediaContent(media({ storageProvider: 's3' }), 'memory'),
    ).toBe(false);
    expect(
      isUsableMediaContent(media({ processingStatus: 'processing' }), 'memory'),
    ).toBe(false);
    expect(
      isUsableMediaContent(media({ deletedAt: new Date() }), 'memory'),
    ).toBe(false);
    expect(
      isUsableMediaContent(
        media({ type: 'pdf', mimeType: 'application/pdf' }),
        'memory',
      ),
    ).toBe(false);
  });
});
