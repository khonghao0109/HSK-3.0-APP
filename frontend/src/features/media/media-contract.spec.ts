import { describe, expect, it } from 'vitest';

import {
  backendMediaListSchema,
  backendMediaMutationSchema,
  mediaDetailResponseSchema,
  mediaListResponseSchema,
  mediaMutationResponseSchema,
} from './media-contract';

const BACKEND_META = {
  requestId: '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f',
  timestamp: '2026-09-14T05:00:00.000Z',
};

function asset() {
  return {
    id: 41,
    filename: 'lesson.mp3',
    type: 'audio',
    mimeType: 'audio/mpeg',
    size: 2048,
    duration: 8,
    processingStatus: 'ready',
    lifecycle: 'active',
    usageCount: 1,
    dataSourceId: 7,
    uploadedById: 1,
    updatedById: 2,
    deletedAt: null,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T01:00:00.000Z',
    dataSource: {
      id: 7,
      code: 'HSK_AUDIO',
      name: 'Licensed audio',
      version: '2026.08',
    },
  };
}

describe('Media admin runtime contract', () => {
  it('resolves backend envelopes to BFF shapes without storage fields', () => {
    const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 };
    const list = backendMediaListSchema.parse({
      success: true,
      data: [{ ...asset(), storageKey: 'must-not-survive' }],
      meta: { ...BACKEND_META, pagination },
    });
    expect(list.meta).toEqual(pagination);
    expect(JSON.stringify(list)).not.toContain('must-not-survive');
    expect(JSON.stringify(list)).not.toContain(BACKEND_META.requestId);

    const mutation = backendMediaMutationSchema.parse({
      success: true,
      data: { idempotent: true, media: asset() },
      meta: BACKEND_META,
    });
    expect(mediaMutationResponseSchema.parse(mutation)).toEqual(mutation);
  });

  it('accepts list/detail metadata and strips storage-only fields', () => {
    const list = mediaListResponseSchema.parse({
      success: true,
      data: [
        {
          ...asset(),
          url: 'must-not-survive',
          storageKey: 'must-not-survive',
          checksum: 'must-not-survive',
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(JSON.stringify(list)).not.toContain('must-not-survive');

    const detail = mediaDetailResponseSchema.parse({
      success: true,
      data: {
        ...asset(),
        usage: {
          lessonExercises: [
            {
              id: 5,
              lessonId: 2,
              topicId: 3,
              prompt: 'Listen and choose',
              status: 'published',
            },
          ],
          counts: { lessonExercises: 1, otherContent: 0 },
        },
      },
    });
    expect(detail.data.usage.lessonExercises[0]?.prompt).toBe(
      'Listen and choose',
    );
  });

  it('rejects unknown lifecycle and processing states', () => {
    expect(
      mediaListResponseSchema.safeParse({
        success: true,
        data: [{ ...asset(), processingStatus: 'published' }],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }).success,
    ).toBe(false);
    expect(
      mediaListResponseSchema.safeParse({
        success: true,
        data: [{ ...asset(), lifecycle: 'deleted' }],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }).success,
    ).toBe(false);
  });

  it('strips storage-only fields from lifecycle mutation responses', () => {
    const result = mediaMutationResponseSchema.parse({
      success: true,
      data: {
        idempotent: false,
        media: {
          ...asset(),
          url: 'must-not-survive',
          storageKey: 'must-not-survive',
          metadata: { signedUrl: 'must-not-survive' },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-survive');
  });
});
