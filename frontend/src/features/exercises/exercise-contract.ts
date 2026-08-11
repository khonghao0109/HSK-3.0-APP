import { z } from 'zod';

export const exerciseTypes = [
  'mcq',
  'fill_blank',
  'listening_choice',
  'arrange_sentence',
  'speaking_repeat',
] as const;
export const exerciseStatuses = ['draft', 'published', 'archived'] as const;

const relationSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
});

const mediaSchema = z.object({
  id: z.number().int().positive(),
  url: z.string(),
  type: z.enum(['audio', 'image', 'pdf', 'video']),
  mimeType: z.string().nullable(),
  duration: z.number().nullable(),
  processingStatus: z.enum([
    'pending',
    'processing',
    'ready',
    'failed',
    'quarantined',
  ]),
  deletedAt: z.string().datetime().nullable(),
});

const reviewSchema = z.object({
  id: z.number().int().positive(),
  reviewerId: z.number().int().positive().nullable(),
  decision: z.enum(['approved', 'changes_requested', 'rejected']),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const revisionSchema = z.object({
  id: z.number().int().positive(),
  entityType: z.literal('lesson_exercise'),
  entityId: z.number().int().positive(),
  revision: z.number().int().positive(),
  snapshot: z.unknown(),
  contentHash: z.string().nullable(),
  authorId: z.number().int().positive().nullable(),
  createdAt: z.string().datetime(),
  reviews: z.array(reviewSchema),
});

export const adminExerciseSchema = z.object({
  id: z.number().int().positive(),
  lessonId: z.number().int().positive(),
  topicId: z.number().int().positive().nullable(),
  mediaId: z.number().int().positive().nullable(),
  type: z.enum(exerciseTypes),
  prompt: z.string(),
  content: z.unknown(),
  answer: z.unknown(),
  explanation: z.string().nullable(),
  version: z.number().int().positive(),
  orderIndex: z.number().int().positive(),
  status: z.enum(exerciseStatuses),
  dataSourceId: z.number().int().positive().nullable(),
  sourceKey: z.string().nullable(),
  createdById: z.number().int().positive().nullable(),
  updatedById: z.number().int().positive().nullable(),
  publishedById: z.number().int().positive().nullable(),
  publishedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lesson: relationSchema.extend({ slug: z.string() }),
  topic: relationSchema.nullable(),
  dataSource: z
    .object({
      id: z.number().int().positive(),
      code: z.string(),
      name: z.string(),
      version: z.string(),
    })
    .nullable(),
  media: mediaSchema.nullable(),
  latestRevision: revisionSchema.nullable().optional(),
});

export const adminExerciseDetailSchema = adminExerciseSchema
  .omit({ latestRevision: true })
  .extend({ revisions: z.array(revisionSchema) });

export const exerciseListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(adminExerciseSchema),
  meta: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export const exerciseDetailResponseSchema = z.object({
  success: z.literal(true),
  data: adminExerciseDetailSchema,
});

export type AdminExercise = z.infer<typeof adminExerciseSchema>;
export type AdminExerciseDetail = z.infer<typeof adminExerciseDetailSchema>;
export type ExerciseListResponse = z.infer<typeof exerciseListResponseSchema>;
