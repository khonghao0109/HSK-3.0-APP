import { z } from 'zod';

export const levelItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  orderIndex: z.number().int(),
  code: z.string(),
  minBand: z.number().int(),
  maxBand: z.number().int(),
});
export type LevelItem = z.infer<typeof levelItemSchema>;

export const levelsResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(levelItemSchema),
});
export type LevelsResponse = z.infer<typeof levelsResponseSchema>;

export const learningPurposeSchema = z.enum([
  'communication',
  'study_abroad',
  'hsk_exam',
  'work',
]);
export type LearningPurpose = z.infer<typeof learningPurposeSchema>;

export const userGoalSchema = z.object({
  id: z.number().int(),
  targetLevelId: z.number().int(),
  targetBand: z.number().int(),
  dailyMinutes: z.number().int(),
  learningPurpose: learningPurposeSchema.nullable(),
  reminderEnabled: z.boolean(),
  reminderTime: z.string().nullable(),
  startDate: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  targetLevel: z.object({
    id: z.number().int(),
    code: z.string(),
    name: z.string(),
    minBand: z.number().int(),
    maxBand: z.number().int(),
  }),
});
export type UserGoal = z.infer<typeof userGoalSchema>;

export const currentGoalResponseSchema = z.object({
  success: z.literal(true),
  data: userGoalSchema.nullable(),
});
export type CurrentGoalResponse = z.infer<typeof currentGoalResponseSchema>;

export const onboardingNextStepSchema = z.enum([
  'set_goal',
  'content_unavailable',
  'generate_plan',
  'ready',
]);
export type OnboardingNextStep = z.infer<typeof onboardingNextStepSchema>;

export const onboardingStatusSchema = z.object({
  hasActiveGoal: z.boolean(),
  hasActiveLearningPlan: z.boolean(),
  hasUsableLearningPlan: z.boolean(),
  hasCompletedPlacement: z.boolean(),
  nextStep: onboardingNextStepSchema,
});
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;

export const onboardingStatusResponseSchema = z.object({
  success: z.literal(true),
  data: onboardingStatusSchema,
});
export type OnboardingStatusResponse = z.infer<
  typeof onboardingStatusResponseSchema
>;

export function isValidCalendarDate(val: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const [yearStr, monthStr, dayStr] = val.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12) return false;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export const onboardingCompleteInputSchema = z
  .object({
    learningPurpose: learningPurposeSchema,
    targetBand: z.number().int().min(1).max(9),
    dailyMinutes: z.union([z.literal(10), z.literal(15), z.literal(30)]),
    reminderEnabled: z.boolean(),
    reminderTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    startDate: z.string().refine(isValidCalendarDate, {
      message: 'startDate must be a valid calendar date in YYYY-MM-DD format',
    }),
  })
  .strict()
  .refine((data) => data.reminderEnabled === (data.reminderTime !== null), {
    message:
      'reminderTime must be non-null if and only if reminderEnabled is true',
  });
export type OnboardingCompleteInput = z.infer<
  typeof onboardingCompleteInputSchema
>;

export const planPageSearchParamsSchema = z.object({
  purpose: learningPurposeSchema,
  band: z.coerce.number().int().min(1).max(9),
});
export type PlanPageSearchParams = z.infer<typeof planPageSearchParamsSchema>;

export function parseGoalPageSearchParams(
  params: Record<string, string | string[] | undefined>,
): {
  purpose?: LearningPurpose;
  band?: number;
  notice?: 'content_unavailable';
} {
  const rawPurpose = Array.isArray(params.purpose)
    ? params.purpose[0]
    : params.purpose;
  const rawBand = Array.isArray(params.band) ? params.band[0] : params.band;
  const rawNotice = Array.isArray(params.notice)
    ? params.notice[0]
    : params.notice;

  const purposeResult = learningPurposeSchema.safeParse(rawPurpose);
  const bandNum = rawBand !== undefined ? Number(rawBand) : NaN;
  const isBandValid = Number.isInteger(bandNum) && bandNum >= 1 && bandNum <= 9;

  return {
    purpose: purposeResult.success ? purposeResult.data : undefined,
    band: isBandValid ? bandNum : undefined,
    notice:
      rawNotice === 'content_unavailable' ? 'content_unavailable' : undefined,
  };
}

export function resolveLevelForBand(
  levels: LevelItem[],
  band: number,
): LevelItem | null {
  return levels.find((l) => l.minBand <= band && band <= l.maxBand) ?? null;
}

export function availableBands(
  levels: Array<{ minBand: number; maxBand: number }>,
): number[] {
  const bands = new Set<number>();
  for (const level of levels) {
    for (let b = level.minBand; b <= level.maxBand; b++) {
      if (b >= 1 && b <= 9) {
        bands.add(b);
      }
    }
  }
  return Array.from(bands).sort((a, b) => a - b);
}

export function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
