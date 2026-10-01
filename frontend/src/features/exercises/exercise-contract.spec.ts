import { describe, expect, it } from 'vitest';

import {
  backendExerciseDetailSchema,
  backendExerciseListSchema,
  exerciseDetailResponseSchema,
  exerciseListResponseSchema,
} from './exercise-contract';

const BACKEND_META = {
  requestId: '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f',
  timestamp: '2026-09-14T05:00:00.000Z',
};

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
  it('resolves the backend envelope to the BFF list and detail shapes', () => {
    const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 };
    const list = backendExerciseListSchema.parse({
      success: true,
      data: [{ ...exercise(), latestRevision: null }],
      meta: { ...BACKEND_META, pagination },
    });
    expect(list.meta).toEqual(pagination);
    expect(exerciseListResponseSchema.parse(list)).toEqual(list);

    const detail = backendExerciseDetailSchema.parse({
      success: true,
      data: { ...exercise(), revisions: [] },
      meta: BACKEND_META,
    });
    expect(detail).toEqual({
      success: true,
      data: expect.objectContaining({ revisions: [] }),
    });
    expect(
      backendExerciseDetailSchema.safeParse({
        success: true,
        data: { ...exercise(), revisions: [] },
      }).success,
    ).toBe(false);
  });

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
