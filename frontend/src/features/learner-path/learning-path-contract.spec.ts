import { describe, expect, it } from 'vitest';

import {
  backendLearningPathSchema,
  learningPathSchema,
  PATH_LEVEL_CODES,
  type LearningPath,
} from './learning-path-contract';

const lesson = {
  id: 1,
  title: 'Chào hỏi',
  slug: 'chao-hoi',
  position: 1,
  state: 'current',
  completionPercent: 40,
};

const path = {
  nextStep: 'ready',
  goal: { targetLevelCode: 'HSK1', targetBand: 1, learningPurpose: 'work' },
  levels: [
    {
      id: 1,
      code: 'HSK1',
      name: 'HSK 1',
      orderIndex: 1,
      lessonCount: 1,
      completedCount: 0,
      lessons: [lesson],
    },
  ],
  nextLesson: {
    lessonId: 1,
    title: 'Chào hỏi',
    slug: 'chao-hoi',
    levelCode: 'HSK1',
    position: 1,
  },
};

function withState(state: string) {
  return {
    ...path,
    levels: [{ ...path.levels[0], lessons: [{ ...lesson, state }] }],
  };
}

describe('learning path contract', () => {
  it('parses the backend envelope and strips meta', () => {
    const parsed = backendLearningPathSchema.parse({
      success: true,
      data: path,
      meta: { requestId: 'req-1', timestamp: '2026-10-09T00:00:00.000Z' },
    });
    expect(parsed).toEqual({ success: true, data: path });
    expect(parsed).not.toHaveProperty('meta');
  });

  it('rejects an envelope without meta', () => {
    expect(
      backendLearningPathSchema.safeParse({ success: true, data: path })
        .success,
    ).toBe(false);
  });

  it('accepts a null goal and a null nextLesson', () => {
    const parsed: LearningPath = learningPathSchema.parse({
      ...path,
      goal: null,
      nextLesson: null,
    });
    expect(parsed.goal).toBeNull();
    expect(parsed.nextLesson).toBeNull();
  });

  it.each(['done', 'current', 'available', 'locked'])(
    'accepts lesson state %s',
    (state) => {
      const parsed = learningPathSchema.parse(withState(state));
      expect(parsed.levels[0]?.lessons[0]?.state).toBe(state);
    },
  );

  it('rejects an unknown lesson state', () => {
    expect(learningPathSchema.safeParse(withState('skipped')).success).toBe(
      false,
    );
  });

  it('rejects an unknown nextStep', () => {
    expect(
      learningPathSchema.safeParse({ ...path, nextStep: 'start_lesson' })
        .success,
    ).toBe(false);
  });

  it('lists the seven level codes in tab order', () => {
    expect(PATH_LEVEL_CODES).toEqual([
      'HSK1',
      'HSK2',
      'HSK3',
      'HSK4',
      'HSK5',
      'HSK6',
      'HSK7_9',
    ]);
  });
});
