import { z } from 'zod';

import { onboardingNextStepSchema } from '@/features/onboarding/onboarding-contract';
import { backendEnvelope } from '@/lib/api/backend-envelope';

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

/** `HSK1` → `HSK 1`; `HSK7_9` → `HSK 7–9` (Q3). Unknown codes pass through. */
export function levelLabel(code: string): string {
  const range = /^HSK(\d+)_(\d+)$/u.exec(code);
  if (range) return `HSK ${range[1]}–${range[2]}`;
  const single = /^HSK(\d+)$/u.exec(code);
  return single ? `HSK ${single[1]}` : code;
}

/** Whole percent in 0..100; anything non-finite reads as 0. */
export function wholePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Share of today's goal for the gauge, capped at 100 (Q21). */
export function dailyGoalPercent(dailyGoal: LearningHome['dailyGoal']): number {
  if (!dailyGoal || dailyGoal.targetMinutes <= 0) return 0;
  return wholePercent((dailyGoal.minutesToday / dailyGoal.targetMinutes) * 100);
}

/**
 * Static class setting `--value` (`.pct-0` … `.pct-100` in learner.css):
 * inline styles would be blocked by the CSP.
 */
export function percentClass(value: number): string {
  return `pct-${wholePercent(value)}`;
}
