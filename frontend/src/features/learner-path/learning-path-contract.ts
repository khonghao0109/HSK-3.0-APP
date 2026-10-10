import { z } from 'zod';

import {
  learningPurposeSchema,
  onboardingNextStepSchema,
} from '@/features/onboarding/onboarding-contract';
import { backendEnvelope } from '@/lib/api/backend-envelope';

export const lessonStateSchema = z.enum([
  'done',
  'current',
  'available',
  'locked',
]);
export type LessonState = z.infer<typeof lessonStateSchema>;

export const pathLessonSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  slug: z.string(),
  position: z.number().int(),
  state: lessonStateSchema,
  completionPercent: z.number(),
});
export type PathLesson = z.infer<typeof pathLessonSchema>;

export const pathLevelSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
  orderIndex: z.number().int(),
  lessonCount: z.number().int(),
  completedCount: z.number().int(),
  lessons: z.array(pathLessonSchema),
});
export type PathLevel = z.infer<typeof pathLevelSchema>;

export const learningPathSchema = z.object({
  nextStep: onboardingNextStepSchema,
  goal: z
    .object({
      targetLevelCode: z.string(),
      targetBand: z.number().int().nullable(),
      learningPurpose: learningPurposeSchema.nullable(),
    })
    .nullable(),
  levels: z.array(pathLevelSchema),
  nextLesson: z
    .object({
      lessonId: z.number().int(),
      title: z.string(),
      slug: z.string(),
      levelCode: z.string(),
      position: z.number().int(),
    })
    .nullable(),
});
export type LearningPath = z.infer<typeof learningPathSchema>;

export const backendLearningPathSchema = backendEnvelope(learningPathSchema);

export { PATH_LEVEL_CODES } from './path-level-codes';
