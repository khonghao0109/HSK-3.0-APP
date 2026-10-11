import { describe, expect, it } from 'vitest';

import {
  backendLessonActivitySchema,
  lessonActivitySchema,
} from './lesson-activity-contract';

const activity = {
  lesson: { id: 5, title: 'Chào hỏi', description: null, slug: 'chao-hoi' },
  progress: { completionPercent: 67, status: 'learning' },
  level: { id: 1, code: 'HSK1', name: 'HSK 1' },
  position: 1,
  state: 'current',
  sections: {
    vocabulary: { wordCount: 6, topicCount: 1, topicsDone: 1 },
    grammar: { topicCount: 2, topicsDone: 1 },
    practice: { exerciseCount: 3, attempted: 2 },
  },
  topics: [],
  nextAction: 'submit_exercise',
};

describe('lessonActivitySchema', () => {
  it('keeps only the fields the lesson page reads', () => {
    const parsed = lessonActivitySchema.parse(activity);
    expect(parsed).toEqual({
      lesson: { id: 5, title: 'Chào hỏi', description: null },
      progress: { completionPercent: 67 },
      level: { id: 1, code: 'HSK1', name: 'HSK 1' },
      position: 1,
      state: 'current',
      sections: activity.sections,
    });
  });

  it('unwraps the backend envelope', () => {
    const parsed = backendLessonActivitySchema.parse({
      success: true,
      data: activity,
      meta: { requestId: 'r', timestamp: 't' },
    });
    expect(parsed.data.state).toBe('current');
  });

  it.each(['state', 'position', 'sections', 'level'])(
    'rejects a payload without %s',
    (field) => {
      const rest: Record<string, unknown> = { ...activity };
      delete rest[field];
      expect(lessonActivitySchema.safeParse(rest).success).toBe(false);
    },
  );

  it('rejects a state outside the Q18 enum', () => {
    expect(
      lessonActivitySchema.safeParse({ ...activity, state: 'open' }).success,
    ).toBe(false);
  });

  it('rejects a negative section count', () => {
    expect(
      lessonActivitySchema.safeParse({
        ...activity,
        sections: {
          ...activity.sections,
          practice: { exerciseCount: 3, attempted: -1 },
        },
      }).success,
    ).toBe(false);
  });
});
