import { describe, expect, it } from 'vitest';

import { lessonTopicActivitySchema } from './lesson-topic-contract';

const activity = {
  lesson: { id: 26, title: 'Xin chào' },
  level: { id: 1, code: 'HSK1', name: 'HSK 1' },
  state: 'current',
  topics: [
    {
      id: 136,
      title: 'Bài khoá bài 1',
      subtitle: null,
      type: 'key_text',
      content: [],
      orderIndex: 2,
      progress: { status: 'not_started' },
    },
  ],
};

describe('lessonTopicActivitySchema', () => {
  it('reads the Level of a levelled lesson', () => {
    expect(lessonTopicActivitySchema.parse(activity).level).toEqual({
      code: 'HSK1',
    });
  });

  // ADR-009: a textbook course lesson has no Level; its Bài khoá and Ngữ pháp
  // screens must still open.
  it('accepts a course lesson without a Level', () => {
    const parsed = lessonTopicActivitySchema.parse({
      ...activity,
      level: null,
    });
    expect(parsed.level).toBeNull();
    expect(parsed.topics[0]?.type).toBe('key_text');
  });
});
