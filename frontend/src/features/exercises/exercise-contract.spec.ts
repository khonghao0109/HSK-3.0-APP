import { describe, expect, it } from 'vitest';

import {
  exerciseDetailResponseSchema,
  exerciseListResponseSchema,
} from './exercise-contract';

function exercise() {
  return {
    id: 1,
    lessonId: 2,
    topicId: 3,
    mediaId: null,
    type: 'mcq',
    prompt: 'Choose 你好',
    content: { options: [{ id: 'hello', text: 'Hello' }] },
    answer: { optionId: 'hello' },
    explanation: null,
    version: 1,
    orderIndex: 1,
    status: 'draft',
    dataSourceId: null,
    sourceKey: null,
    createdById: 1,
    updatedById: 1,
    publishedById: null,
    publishedAt: null,
    deletedAt: null,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    lesson: { id: 2, title: 'Greetings', slug: 'greetings' },
    topic: { id: 3, title: 'Saying hello' },
    dataSource: null,
    media: null,
  };
}

describe('Exercise read API runtime contract', () => {
  it('accepts the minimal list and detail projections used by the console', () => {
    expect(
      exerciseListResponseSchema.parse({
        success: true,
        data: [{ ...exercise(), latestRevision: null }],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }).data[0]?.lesson.title,
    ).toBe('Greetings');
    expect(
      exerciseDetailResponseSchema.parse({
        success: true,
        data: { ...exercise(), revisions: [] },
      }).data.revisions,
    ).toEqual([]);
  });

  it('rejects an incomplete relation and strips unrecognized media fields', () => {
    const incomplete = { ...exercise(), lesson: { id: 2, title: 'Greetings' } };
    expect(
      exerciseListResponseSchema.safeParse({
        success: true,
        data: [{ ...incomplete, latestRevision: null }],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }).success,
    ).toBe(false);
    const parsed = exerciseDetailResponseSchema.parse({
      success: true,
      data: {
        ...exercise(),
        media: {
          id: 9,
          url: 'https://cdn.example.test/a.mp3',
          type: 'audio',
          mimeType: 'audio/mpeg',
          duration: 2,
          processingStatus: 'ready',
          deletedAt: null,
          storageKey: 'must-not-be-used-by-the-contract',
        },
        revisions: [],
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('storageKey');
  });
});
