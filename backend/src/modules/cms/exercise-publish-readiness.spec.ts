import { UnprocessableEntityException } from '@nestjs/common';

import { assertExerciseMediaPublishReady } from './exercise-publish-readiness';

describe('Exercise publish media readiness', () => {
  const safeAudio = {
    id: 11,
    url: 'https://cdn.example.test/listening.mp3',
    type: 'audio' as const,
    mimeType: 'audio/mpeg',
    duration: 12,
    processingStatus: 'ready' as const,
    deletedAt: null,
    storageProvider: 'private-provider',
    storageKey: 'private-key',
    checksum: 'private-checksum',
    metadata: { private: true },
    originalFilename: 'private-name.mp3',
  };

  it('returns only the safe public projection for ready, live audio', () => {
    expect(
      assertExerciseMediaPublishReady('listening_choice', 11, safeAudio),
    ).toEqual({
      id: 11,
      url: 'https://cdn.example.test/listening.mp3',
      type: 'audio',
      mimeType: 'audio/mpeg',
      duration: 12,
    });
  });

  it.each([
    ['missing relation', null, null],
    ['missing row', 11, null],
    ['wrong media id', 12, safeAudio],
    ['empty URL', 11, { ...safeAudio, url: '' }],
    ['blank URL', 11, { ...safeAudio, url: '   ' }],
    ['untrimmed URL', 11, { ...safeAudio, url: ` ${safeAudio.url}` }],
    ['wrong type', 11, { ...safeAudio, type: 'image' as const }],
    ['pending', 11, { ...safeAudio, processingStatus: 'pending' as const }],
    [
      'processing',
      11,
      { ...safeAudio, processingStatus: 'processing' as const },
    ],
    ['failed', 11, { ...safeAudio, processingStatus: 'failed' as const }],
    [
      'quarantined',
      11,
      { ...safeAudio, processingStatus: 'quarantined' as const },
    ],
    ['deleted', 11, { ...safeAudio, deletedAt: new Date() }],
  ])('rejects listening media when %s', (_label, mediaId, media) => {
    expect(() =>
      assertExerciseMediaPublishReady('listening_choice', mediaId, media),
    ).toThrow(UnprocessableEntityException);
  });

  it('does not require or expose media for non-listening types', () => {
    expect(assertExerciseMediaPublishReady('mcq', null, null)).toBeNull();
  });
});
