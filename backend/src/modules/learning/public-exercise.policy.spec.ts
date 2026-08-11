import {
  PUBLIC_LESSON_EXERCISE_TYPES,
  PUBLIC_LESSON_EXERCISE_WHERE,
  projectPublicExerciseMedia,
} from './public-exercise.policy';

describe('public LessonExercise policy', () => {
  it('allows only the four Lesson Activity V1 types', () => {
    expect([...PUBLIC_LESSON_EXERCISE_TYPES].sort()).toEqual(
      ['mcq', 'listening_choice', 'fill_blank', 'arrange_sentence'].sort(),
    );
    expect(PUBLIC_LESSON_EXERCISE_TYPES).not.toContain('speaking_repeat');
    expect(PUBLIC_LESSON_EXERCISE_WHERE).toMatchObject({
      AND: expect.arrayContaining([
        { status: 'published', deletedAt: null },
        { type: { in: PUBLIC_LESSON_EXERCISE_TYPES } },
        {
          OR: expect.arrayContaining([
            expect.objectContaining({
              type: 'listening_choice',
              media: {
                is: {
                  type: 'audio',
                  processingStatus: 'ready',
                  deletedAt: null,
                  url: { not: '' },
                },
              },
            }),
          ]),
        },
        {
          OR: [
            { topicId: null },
            { topic: { is: { status: 'published', deletedAt: null } } },
          ],
        },
      ]),
    });
  });

  it('projects only replay-safe audio fields for listening_choice', () => {
    expect(
      projectPublicExerciseMedia('listening_choice', {
        id: 7,
        url: 'https://cdn.example.test/audio/7.mp3',
        type: 'audio',
        mimeType: 'audio/mpeg',
        duration: 12,
        storageProvider: 's3',
        storageKey: 'private/key.mp3',
        checksum: 'internal-checksum',
        metadata: { signedOrigin: 'secret' },
      }),
    ).toEqual({
      id: 7,
      url: 'https://cdn.example.test/audio/7.mp3',
      type: 'audio',
      mimeType: 'audio/mpeg',
      duration: 12,
    });
  });

  it('does not attach media to other exercise types or accept unsafe snapshots', () => {
    const media = {
      id: 7,
      url: 'https://cdn.example.test/audio/7.mp3',
      type: 'audio',
      mimeType: null,
      duration: null,
    };
    expect(projectPublicExerciseMedia('mcq', media)).toBeNull();
    expect(
      projectPublicExerciseMedia('listening_choice', {
        ...media,
        type: 'image',
      }),
    ).toBeNull();
    expect(
      projectPublicExerciseMedia('listening_choice', {
        ...media,
        url: '   ',
      }),
    ).toBeNull();
    expect(
      projectPublicExerciseMedia('listening_choice', {
        ...media,
        url: ` ${media.url}`,
      }),
    ).toBeNull();
    expect(
      projectPublicExerciseMedia('listening_choice', {
        ...media,
        storageKey: 'private/key',
        url: '',
      }),
    ).toBeNull();
  });
});
