import 'server-only';

import { z } from 'zod';

/**
 * Contract server-side của ngân hàng câu hỏi (M4.1a, TL-82/TL-93).
 * Chỉ import ở server component/service/BFF; client dùng type/value thuần từ
 * `question-values.ts` để Zod không lọt vào client graph
 * (`client-bundle-guard.spec.ts`).
 */
import {
  QUESTION_SKILL_VALUES,
  QUESTION_STATUS_VALUES,
  QUESTION_TYPE_VALUES,
  REVIEW_DECISION_VALUES,
} from './question-values';

const questionTypes = QUESTION_TYPE_VALUES;
const questionSkills = QUESTION_SKILL_VALUES;
const questionStatuses = QUESTION_STATUS_VALUES;
const reviewDecisions = REVIEW_DECISION_VALUES;

const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

const questionTagSchema = z.object({ slug: z.string(), name: z.string() });
const questionLevelSchema = z.object({
  id: z.number().int(),
  code: z.string(),
});
const revisionUserSchema = z
  .object({ id: z.number().int(), name: z.string().nullable() })
  .nullable();

const revisionReviewSchema = z.object({
  decision: z.enum(reviewDecisions),
  note: z.string().nullable(),
  reviewer: revisionUserSchema,
  createdAt: z.string().datetime(),
});

export const questionRevisionSchema = z.object({
  id: z.number().int(),
  revision: z.number().int().nonnegative(),
  contentHash: z.string().nullable(),
  createdAt: z.string().datetime(),
  author: revisionUserSchema,
  changedFields: z.array(z.string()),
  reviews: z.array(revisionReviewSchema),
});

export const adminQuestionSchema = z.object({
  id: z.number().int().positive(),
  content: z.string(),
  type: z.enum(questionTypes),
  skill: z.enum(questionSkills),
  audioId: z.number().int().positive().nullable(),
  imageId: z.number().int().positive().nullable(),
  answers: z.record(z.string(), z.unknown()),
  correctAnswer: z.record(z.string(), z.unknown()),
  explanation: z.string().nullable(),
  objective: z.string().nullable(),
  levelId: z.number().int().positive(),
  difficulty: z.number().int().min(1).max(3).nullable(),
  version: z.number().int().nonnegative(),
  contentHash: z.string().nullable(),
  status: z.enum(questionStatuses),
  dataSourceId: z.number().int().positive().nullable(),
  createdById: z.number().int().positive().nullable(),
  updatedById: z.number().int().positive().nullable(),
  publishedById: z.number().int().positive().nullable(),
  publishedAt: z.string().datetime().nullable(),
  deletedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  level: questionLevelSchema,
  tags: z.array(questionTagSchema),
});

const latestRevisionSchema = z
  .object({
    id: z.number().int(),
    revision: z.number().int().nonnegative(),
    decision: z.enum(reviewDecisions).nullable(),
  })
  .nullable();

export const questionListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(
    adminQuestionSchema.extend({ latestRevision: latestRevisionSchema }),
  ),
  meta: z.object({
    requestId: z.string(),
    timestamp: z.string(),
    pagination: paginationSchema,
  }),
});

export const questionDetailResponseSchema = z.object({
  success: z.literal(true),
  data: adminQuestionSchema.extend({
    revisions: z.array(questionRevisionSchema),
  }),
});

export const questionCountsResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    total: z.number().int().nonnegative(),
    bySkill: z.object({
      listening: z.number().int().nonnegative(),
      reading: z.number().int().nonnegative(),
      writing: z.number().int().nonnegative(),
      speaking: z.number().int().nonnegative(),
    }),
    vocabularyGrammar: z.number().int().nonnegative(),
  }),
});

export const questionTagListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      questionCount: z.number().int().nonnegative(),
    }),
  ),
});

/**
 * Response của BFF cho mọi mutation câu hỏi. Backend trả `question` (create/
 * revision/publish/archive) hoặc `review` (review); BFF giữ nguyên envelope và
 * client chỉ đọc các field cần.
 */
export const backendQuestionMutationSchema = z.object({
  success: z.literal(true),
  data: z
    .object({
      idempotent: z.boolean(),
      question: z
        .object({
          id: z.number().int().positive(),
          status: z.enum(questionStatuses),
          version: z.number().int().nonnegative(),
        })
        .loose()
        .optional(),
      revision: z
        .object({ id: z.number().int(), revision: z.number().int() })
        .loose()
        .optional(),
      review: z.object({ id: z.number().int() }).loose().optional(),
    })
    .loose(),
});

export type AdminQuestion = z.infer<typeof adminQuestionSchema>;
export type AdminQuestionListItem = z.infer<
  typeof questionListResponseSchema
>['data'][number];
export type QuestionRevision = z.infer<typeof questionRevisionSchema>;
export type QuestionDetail = z.infer<
  typeof questionDetailResponseSchema
>['data'];
export type QuestionListResponse = z.infer<typeof questionListResponseSchema>;
export type QuestionCounts = z.infer<
  typeof questionCountsResponseSchema
>['data'];
export type QuestionTagOption = z.infer<
  typeof questionTagListResponseSchema
>['data'][number];
