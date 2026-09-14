import { z } from 'zod';

import {
  backendEnvelope,
  backendPage,
  paginationSchema,
} from '@/lib/api/backend-envelope';

export const mediaTypes = ['audio', 'image', 'pdf', 'video'] as const;
export const mediaProcessingStatuses = [
  'pending',
  'processing',
  'ready',
  'failed',
  'quarantined',
] as const;
export const mediaLifecycles = ['active', 'archived'] as const;

const dataSourceSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  version: z.string(),
});

export const adminMediaSchema = z.object({
  id: z.number().int().positive(),
  filename: z.string().min(1).nullable(),
  type: z.enum(mediaTypes),
  mimeType: z.string().nullable(),
  size: z.number().int().nonnegative().nullable(),
  duration: z.number().int().nonnegative().nullable(),
  processingStatus: z.enum(mediaProcessingStatuses),
  lifecycle: z.enum(mediaLifecycles),
  usageCount: z.number().int().nonnegative(),
  dataSourceId: z.number().int().positive().nullable(),
  uploadedById: z.number().int().positive().nullable(),
  updatedById: z.number().int().positive().nullable(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dataSource: dataSourceSchema.nullable(),
});

const mediaUsageSchema = z.object({
  lessonExercises: z.array(
    z.object({
      id: z.number().int().positive(),
      lessonId: z.number().int().positive(),
      topicId: z.number().int().positive().nullable(),
      prompt: z.string(),
      status: z.enum(['draft', 'published', 'archived']),
    }),
  ),
  counts: z.object({
    lessonExercises: z.number().int().nonnegative(),
    otherContent: z.number().int().nonnegative(),
  }),
});

// BFF → browser shapes.
export const mediaListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(adminMediaSchema),
  meta: paginationSchema,
});

export const mediaDetailResponseSchema = z.object({
  success: z.literal(true),
  data: adminMediaSchema.extend({ usage: mediaUsageSchema }),
});

export const mediaMutationResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    idempotent: z.boolean(),
    media: adminMediaSchema,
  }),
});

// Backend → BFF: the global envelope, resolved to the BFF shapes above.
export const backendMediaListSchema = backendPage(adminMediaSchema);
export const backendMediaDetailSchema = backendEnvelope(
  adminMediaSchema.extend({ usage: mediaUsageSchema }),
);
export const backendMediaMutationSchema = backendEnvelope(
  z.object({ idempotent: z.boolean(), media: adminMediaSchema }),
);

export type AdminMedia = z.infer<typeof adminMediaSchema>;
export type AdminMediaDetail = z.infer<
  typeof mediaDetailResponseSchema
>['data'];
export type MediaListResponse = z.infer<typeof mediaListResponseSchema>;
