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
      },
    ]);
  });
});
