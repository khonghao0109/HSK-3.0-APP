import { describe, expect, it } from 'vitest';

import { topicBlocks, topicsForPage } from './topic-content';

describe('topicBlocks (M2.5f, Q175)', () => {
  it('keeps text and the lesson_words vocabulary list, in order', () => {
    expect(
      topicBlocks([
        { type: 'text', value: '  Bài 1 gồm 20 từ.  ' },
        { type: 'vocabulary_list', value: 'lesson_words' },
      ]),
    ).toEqual([
      { kind: 'text', value: 'Bài 1 gồm 20 từ.' },
      { kind: 'vocabulary_list' },
    ]);
  });

  it('skips unknown, empty or malformed blocks', () => {
    expect(
      topicBlocks([
        { type: 'image', url: 'x' },
        { type: 'text', value: '   ' },
        { type: 'text', value: 3 },
        { type: 'vocabulary_list', value: 'other' },
        null,
        'text',
      ]),
    ).toEqual([]);
    expect(topicBlocks({ type: 'text', value: 'x' })).toEqual([]);
    expect(topicBlocks(undefined)).toEqual([]);
  });
});

describe('topicsForPage', () => {
  const topics = [
    { id: 1, type: 'key_text', orderIndex: 3 },
    { id: 2, type: 'grammar', orderIndex: 2 },
    { id: 3, type: 'vocabulary', orderIndex: 1 },
    { id: 4, type: 'quiz', orderIndex: 4 },
  ];

  it('puts vocabulary topics on the vocabulary page', () => {
    expect(topicsForPage(topics, 'vocabulary').map((t) => t.id)).toEqual([3]);
  });

  it('puts grammar then key_text on the grammar page, by orderIndex', () => {
    expect(topicsForPage(topics, 'grammar').map((t) => t.id)).toEqual([2, 1]);
  });
});
