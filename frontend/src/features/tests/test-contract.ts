import 'server-only';

import { z } from 'zod';

/**
 * Contract server-side của đề thi (M4.1b, TL-105/TL-107/TL-108).
 * Chỉ import ở BFF/server component; client dùng type thuần từ `test-values.ts`
 * để Zod không lọt vào client graph (`client-bundle-guard.spec.ts`).
 */
import { questionListResponseSchema } from '../questions/question-contract';

import { TEST_SKILL_VALUES, TEST_STATUS_VALUES } from './test-values';

const skillSchema = z.enum(TEST_SKILL_VALUES);
const statusSchema = z.enum(TEST_STATUS_VALUES);

const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export const adminTestSchema = z.object({
  id: z.number().int().positive(),
  levelId: z.number().int().positive(),
  levelCode: z.string(),
  title: z.string(),
  instruction: z.string().nullable(),
  duration: z.number().int().positive(),
  passScore: z.number().int().nonnegative().nullable(),
  maxScore: z.number().int().nonnegative(),
  status: statusSchema,
  version: z.number().int().nonnegative(),
  sectionCount: z.number().int().nonnegative(),
  questionCount: z.number().int().nonnegative(),
  skills: z.array(skillSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
});

const adminTestQuestionSchema = z.object({
  questionId: z.number().int().positive(),
  orderIndex: z.number().int().positive(),
  type: z.string(),
  skill: z.string(),
  levelId: z.number().int().positive(),
  difficulty: z.number().int().nullable(),
  status: z.string(),
  content: z.string(),
});

const adminTestGroupSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().nullable(),
  instruction: z.string().nullable(),
  audioId: z.number().int().positive().nullable(),
  imageId: z.number().int().positive().nullable(),
  orderIndex: z.number().int().positive(),
  questions: z.array(adminTestQuestionSchema),
});

const adminTestSectionSchema = z.object({
  id: z.number().int().positive(),
  skill: skillSchema,
  title: z.string(),
  instruction: z.string().nullable(),
  orderIndex: z.number().int().positive(),
  questionCount: z.number().int().nonnegative(),
  groups: z.array(adminTestGroupSchema),
});

export const adminTestDetailSchema = adminTestSchema.extend({
  sections: z.array(adminTestSectionSchema),
});

export const testListResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(adminTestSchema),
  meta: z.object({
    requestId: z.string(),
    timestamp: z.string(),
    pagination: paginationSchema,
  }),
});

export const testDetailResponseSchema = z.object({
  success: z.literal(true),
  data: adminTestDetailSchema,
});

/** Response của mọi mutation BFF (create/patch/structure/publish/archive/duplicate). */
export const testMutationResponseSchema = testDetailResponseSchema;

/** GET BFF `/api/admin/questions` dùng lại contract ngân hàng câu hỏi M4.1a. */
export const testQuestionBankResponseSchema = questionListResponseSchema;

export type AdminTestPayload = z.infer<typeof adminTestSchema>;
export type AdminTestDetailPayload = z.infer<typeof adminTestDetailSchema>;
export type TestListPayload = z.infer<typeof testListResponseSchema>;
export type TestDetailPayload = z.infer<typeof testDetailResponseSchema>;
