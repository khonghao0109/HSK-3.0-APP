import {
  mediaLifecycleDecision,
  projectAdminMedia,
  safeMediaFilename,
} from './media-admin.policy';

const media = {
  id: 41,
  url: 'https://private.example.test/assets/secret.mp3',
  type: 'audio' as const,
  mimeType: 'audio/mpeg',
  size: 2048,
  duration: 8,
  storageProvider: 'private-provider',
  storageKey: 'tenant/private/secret.mp3',
  originalFilename: '../unsafe/lesson\u0000.mp3',
  checksum: 'internal-checksum',
  processingStatus: 'ready' as const,
  metadata: { signedUrl: 'must-not-leak' },
  dataSourceId: 7,
  uploadedById: 1,
  updatedById: 2,
  deletedAt: null,
  createdAt: new Date('2026-08-12T00:00:00.000Z'),
  updatedAt: new Date('2026-08-12T01:00:00.000Z'),
};

describe('Media admin policy', () => {
  it('projects operational metadata without delivery or storage secrets', () => {
    const projected = projectAdminMedia(media, {
      usageCount: 3,
      dataSource: {
        id: 7,
        code: 'HSK_AUDIO',
        name: 'Licensed audio',
        version: '2026.08',
      },
    });

    expect(projected).toMatchObject({
      id: 41,
      filename: 'lesson.mp3',
      type: 'audio',
      mimeType: 'audio/mpeg',
      usageCount: 3,
      lifecycle: 'active',
    });
    const serialized = JSON.stringify(projected);
    for (const secret of [
      'private.example.test',
      'private-provider',
      'tenant/private',
      'internal-checksum',
      'signedUrl',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it.each([
    ['../nested/recording.mp3', 'recording.mp3'],
    ['..\\nested\\recording.mp3', 'recording.mp3'],
    ['..／nested／recording.mp3', 'recording.mp3'],
    ['safe\u202Egnp.exe', 'safegnp.exe'],
    ['\u0000\u0007', null],
    ['  spaced name.mp3  ', 'spaced name.mp3'],
  ])('normalizes a safe basename for %j', (input, expected) => {
    expect(safeMediaFilename(input)).toBe(expected);
  });

  it('keeps archive and quarantine transitions idempotent and fail-closed', () => {
    expect(mediaLifecycleDecision('quarantine', media)).toBe('apply');
    expect(
      mediaLifecycleDecision('quarantine', {
        ...media,
        processingStatus: 'quarantined',
      }),
    ).toBe('idempotent');
    expect(
      mediaLifecycleDecision('archive', { ...media, deletedAt: new Date() }),
    ).toBe('idempotent');
    expect(() =>
      mediaLifecycleDecision('quarantine', {
        ...media,
        deletedAt: new Date(),
      }),
    ).toThrow('Archived media cannot be quarantined.');
  });
});
