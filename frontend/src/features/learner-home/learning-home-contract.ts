import { z } from 'zod';

import { onboardingNextStepSchema } from '@/features/onboarding/onboarding-contract';
import { backendEnvelope } from '@/lib/api/backend-envelope';

import { wholePercent } from './percent';

export const learningHomeSchema = z.object({
  nextStep: onboardingNextStepSchema,
  greetingName: z.string().nullable(),
  dailyGoal: z
    .object({
      targetMinutes: z.number().int(),
      minutesToday: z.number().int(),
    })
    .nullable(),
  streakDays: z.number().int(),
  continueLesson: z
    .object({
      lessonId: z.number().int(),
      title: z.string(),
      slug: z.string(),
      levelCode: z.string(),
      position: z.number().int(),
      completionPercent: z.number(),
    })
    .nullable(),
});
export type LearningHome = z.infer<typeof learningHomeSchema>;

export const backendLearningHomeSchema = backendEnvelope(learningHomeSchema);

// Kept out of this Zod module so client components can use it without
// bundling Zod (its JIT probe calls Function(), which the CSP blocks).
export { levelLabel } from './level-label';
export { percentClass, wholePercent } from './percent';

/** Share of today's goal for the gauge, capped at 100 (Q21). */
export function dailyGoalPercent(dailyGoal: LearningHome['dailyGoal']): number {
  if (!dailyGoal || dailyGoal.targetMinutes <= 0) return 0;
  return wholePercent((dailyGoal.minutesToday / dailyGoal.targetMinutes) * 100);
}
