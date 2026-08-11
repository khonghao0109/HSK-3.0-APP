import {
  buildLessonReadyWhere,
  isLessonReady,
} from './lesson-readiness.policy';

describe('lesson readiness policy', () => {
  const ready = {
    status: 'published',
    deletedAt: null,
    levelStatus: 'published',
    levelDeletedAt: null,
    publishedTopicCount: 1,
    publishedStoryCount: 0,
  } as const;

  it('requires a public lesson, public parent level and an instructional block', () => {
    expect(isLessonReady(ready)).toBe(true);
    expect(isLessonReady({ ...ready, status: 'draft' })).toBe(false);
    expect(isLessonReady({ ...ready, deletedAt: new Date() })).toBe(false);
    expect(isLessonReady({ ...ready, levelStatus: 'draft' })).toBe(false);
    expect(isLessonReady({ ...ready, levelDeletedAt: new Date() })).toBe(false);
    expect(
      isLessonReady({
        ...ready,
        publishedTopicCount: 0,
        publishedStoryCount: 0,
      }),
    ).toBe(false);
    expect(
      isLessonReady({
        ...ready,
        publishedTopicCount: 0,
        publishedStoryCount: 1,
      }),
    ).toBe(true);
  });

  it('builds the shared Prisma predicate used by public APIs and onboarding', () => {
    expect(buildLessonReadyWhere({ levelId: 7 })).toEqual({
      levelId: 7,
      status: 'published',
      deletedAt: null,
      level: { is: { status: 'published', deletedAt: null } },
      OR: [
        { topics: { some: { status: 'published', deletedAt: null } } },
        { stories: { some: { status: 'published', deletedAt: null } } },
      ],
    });
  });
});
