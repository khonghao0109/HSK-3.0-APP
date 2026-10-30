import { z } from 'zod';

import {
  backendEnvelope,
  backendPage,
  paginationSchema,
} from '@/lib/api/backend-envelope';

/**
 * Contract CMS lesson/topic (M5.1a) — khớp select trong
 * backend/src/modules/cms/cms.service.ts. Module này kéo Zod nên CHỈ được
 * import từ server code (service, route handler); client component đọc các
 * type export qua `import type` hoặc qua content-values.ts.
 */

export const contentStatuses = ['draft', 'published', 'archived'] as const;
export const topicTypes = [
  'vocabulary',
  'grammar',
  'key_text',
  'quiz',
  'ai_speaking',
] as const;
export const reviewDecisions = [
  'approved',
  'changes_requested',
  'rejected',
] as const;

const actorIdSchema = z.number().int().positive().nullable();
const dateTimeSchema = z.string().datetime();

const reviewSchema = z.object({
  id: z.number().int().positive(),
  reviewerId: actorIdSchema,
  decision: z.enum(reviewDecisions),
  note: z.string().nullable(),
  createdAt: dateTimeSchema,
});

/** Revision đầy đủ (REVISION_SELECT) — dùng trong trang chi tiết. */
export const contentRevisionSchema = z.object({
  id: z.number().int().positive(),
  entityType: z.enum(['lesson', 'topic']),
  entityId: z.number().int().positive(),
  revision: z.number().int().positive(),
  snapshot: z.unknown(),
  contentHash: z.string().nullable(),
  authorId: actorIdSchema,
  createdAt: dateTimeSchema,
  reviews: z.array(reviewSchema),
});

/** Revision tóm tắt (B1) — không snapshot/contentHash, tối đa 1 review. */
export const revisionSummarySchema = z.object({
  id: z.number().int().positive(),
  revision: z.number().int().positive(),
  authorId: actorIdSchema,
  createdAt: dateTimeSchema,
  reviews: z
    .array(
      z.object({
        decision: z.enum(reviewDecisions),
        reviewerId: actorIdSchema,
        createdAt: dateTimeSchema,
      }),
    )
    .max(1),
});

const adminLessonSchema = z.object({
  id: z.number().int().positive(),
  levelId: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  orderIndex: z.number().int().positive(),
  slug: z.string(),
  status: z.enum(contentStatuses),
  createdById: actorIdSchema,
  updatedById: actorIdSchema,
  publishedById: actorIdSchema,
  publishedAt: dateTimeSchema.nullable(),
  deletedAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export const adminLessonListItemSchema = adminLessonSchema.extend({
  latestRevision: contentRevisionSchema.nullable(),
});

/** Topic trong danh sách của trang chi tiết lesson (B1): không `content`. */
export const topicListItemSchema = z.object({
  id: z.number().int().positive(),
  lessonId: z.number().int().positive(),
  title: z.string(),
  subtitle: z.string().nullable(),
  type: z.enum(topicTypes),
  orderIndex: z.number().int().positive(),
  isPremium: z.boolean(),
  isLocked: z.boolean(),
  status: z.enum(contentStatuses),
  createdById: actorIdSchema,
  updatedById: actorIdSchema,
  publishedById: actorIdSchema,
  publishedAt: dateTimeSchema.nullable(),
  deletedAt: dateTimeSchema.nullable(),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  latestRevision: revisionSummarySchema.nullable(),
});

export const adminTopicSchema = topicListItemSchema
  .omit({ latestRevision: true })
  .extend({ content: z.unknown() });

export const lessonDetailSchema = z.object({
  lesson: adminLessonSchema,
  revisions: z.array(contentRevisionSchema),
  topics: z.array(topicListItemSchema),
});

export const topicDetailSchema = z.object({
  topic: adminTopicSchema,
  revisions: z.array(contentRevisionSchema),
});

/** Level published từ GET /api/v1/levels (TL-12), cho bộ lọc và form tạo. */
export const levelItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  orderIndex: z.number().int().positive(),
  code: z.string(),
  minBand: z.number().int().positive(),
  maxBand: z.number().int().positive(),
});

// BFF → browser shapes.
export const lessonListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(adminLessonListItemSchema),
  meta: paginationSchema,
});

export const lessonDetailResponseSchema = z.object({
  success: z.literal(true),
  data: lessonDetailSchema,
});

export const topicDetailResponseSchema = z.object({
  success: z.literal(true),
  data: topicDetailSchema,
});

// Backend → BFF: envelope toàn cục, resolve về shapes trên.
export const backendLessonListSchema = backendPage(adminLessonListItemSchema);
export const backendLessonDetailSchema = backendEnvelope(lessonDetailSchema);
export const backendTopicDetailSchema = backendEnvelope(topicDetailSchema);
export const backendLevelListSchema = backendEnvelope(z.array(levelItemSchema));

/**
 * Mutation (create/revision/review/publish/archive): BFF proxy giữ nguyên
 * `data` của backend; chỉ chốt envelope để phát hiện drift tối thiểu.
 */
export const backendContentMutationSchema = z.object({
  success: z.literal(true),
  data: z.object({ idempotent: z.boolean() }).loose(),
});

export type AdminLessonListItem = z.infer<typeof adminLessonListItemSchema>;
export type TopicListItem = z.infer<typeof topicListItemSchema>;
export type AdminTopic = z.infer<typeof adminTopicSchema>;
export type ContentRevision = z.infer<typeof contentRevisionSchema>;
export type RevisionSummary = z.infer<typeof revisionSummarySchema>;
export type LessonDetail = z.infer<typeof lessonDetailSchema>;
export type TopicDetail = z.infer<typeof topicDetailSchema>;
export type LevelItem = z.infer<typeof levelItemSchema>;
export type LessonListResponse = z.infer<typeof lessonListResponseSchema>;
