import { serializePublicLessonDetail } from './public-lesson.serializer';

describe('public lesson serializer', () => {
  it('does not expose exercise answers or internal publication metadata', () => {
    const serialized = serializePublicLessonDetail({
      id: 1,
      title: 'Safe lesson',
      status: 'published',
      publishedById: 9,
      updatedById: 9,
      level: { id: 1, name: 'HSK1', orderIndex: 1 },
      topics: [],
      lessonWords: [],
      stories: [],
      exercises: [
        {
          id: 10,
          type: 'mcq',
          prompt: 'Choose',
          content: { choices: ['A', 'B'] },
          answer: { correct: 'A' },
          explanation: 'A is correct',
          version: 1,
          orderIndex: 1,
          status: 'published',
          deletedAt: null,
          media: {
            id: 91,
            url: 'https://cdn.example.test/ignored.mp3',
            type: 'audio',
            mimeType: 'audio/mpeg',
            duration: 8,
          },
        },
      ],
    });

    expect(JSON.stringify(serialized)).not.toContain('answer');
    expect(JSON.stringify(serialized)).not.toContain('publishedById');
    expect(JSON.stringify(serialized)).not.toContain('updatedById');
    expect(serialized.exercises).toEqual([
      {
        id: 10,
        type: 'mcq',
        prompt: 'Choose',
        content: { choices: ['A', 'B'] },
        version: 1,
        orderIndex: 1,
        media: null,
      },
    ]);
  });

  it('returns only safe listening media projection', () => {
    const serialized = serializePublicLessonDetail({
      id: 1,
      title: 'Listening lesson',
      level: { id: 1, name: 'HSK1', orderIndex: 1 },
      topics: [],
      lessonWords: [],
      stories: [],
      exercises: [
        {
          id: 11,
          type: 'listening_choice',
          prompt: 'Listen',
          content: { options: [] },
          version: 2,
          orderIndex: 1,
          media: {
            id: 22,
            url: 'https://cdn.example.test/listening.mp3',
            type: 'audio',
            mimeType: 'audio/mpeg',
            duration: 17,
            storageProvider: 's3',
            storageKey: 'private/listening.mp3',
            checksum: 'internal-only',
            metadata: { private: true },
          },
        },
      ],
    });

    expect(serialized.exercises[0]).toMatchObject({
      media: {
        id: 22,
        url: 'https://cdn.example.test/listening.mp3',
        type: 'audio',
        mimeType: 'audio/mpeg',
        duration: 17,
      },
    });
    expect(JSON.stringify(serialized)).not.toContain('storageProvider');
    expect(JSON.stringify(serialized)).not.toContain('storageKey');
    expect(JSON.stringify(serialized)).not.toContain('checksum');
    expect(JSON.stringify(serialized)).not.toContain('private');
  });
});
