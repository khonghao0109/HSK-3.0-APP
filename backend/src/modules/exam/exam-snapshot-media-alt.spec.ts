import {
  mediaAltText,
  projectExamSnapshotMedia,
} from './exam-snapshot.builder';

describe('exam snapshot media alt text (Q350)', () => {
  const base = {
    id: 5,
    url: 'urn:x',
    type: 'image' as const,
    mimeType: 'image/png',
    duration: null,
    processingStatus: 'ready' as const,
    deletedAt: null,
  };

  it('copies metadata.altText into the snapshot only when present', () => {
    expect(
      projectExamSnapshotMedia({ ...base, metadata: { altText: 'A: Trà' } }),
    ).toEqual({
      mediaId: 5,
      kind: 'image',
      mimeType: 'image/png',
      durationMs: null,
      altText: 'A: Trà',
    });
    expect(projectExamSnapshotMedia(base)).not.toHaveProperty('altText');
  });

  it('ignores blank, non-string or non-object metadata', () => {
    expect(mediaAltText({ altText: '  ' })).toBeNull();
    expect(mediaAltText({ altText: 3 })).toBeNull();
    expect(mediaAltText(['x'])).toBeNull();
    expect(mediaAltText(null)).toBeNull();
  });
});
