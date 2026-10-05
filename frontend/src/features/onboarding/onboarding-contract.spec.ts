import { describe, expect, it } from 'vitest';

import {
  availableBands,
  currentGoalResponseSchema,
  levelItemSchema,
  levelsResponseSchema,
  localDateString,
  onboardingCompleteInputSchema,
  onboardingStatusResponseSchema,
  parseGoalPageSearchParams,
  planPageSearchParamsSchema,
  resolveLevelForBand,
  userGoalSchema,
  type LevelItem,
} from './onboarding-contract';

const sampleLevels: LevelItem[] = [
  { id: 1, name: 'HSK 1', orderIndex: 1, code: 'HSK1', minBand: 1, maxBand: 1 },
  { id: 2, name: 'HSK 2', orderIndex: 2, code: 'HSK2', minBand: 2, maxBand: 2 },
  { id: 3, name: 'HSK 3', orderIndex: 3, code: 'HSK3', minBand: 3, maxBand: 3 },
  {
    id: 7,
    name: 'HSK 7-9',
    orderIndex: 7,
    code: 'HSK7_9',
    minBand: 7,
    maxBand: 9,
  },
];

describe('onboarding-contract', () => {
  describe('resolveLevelForBand', () => {
    it('resolves band 1 to HSK1', () => {
      const level = resolveLevelForBand(sampleLevels, 1);
      expect(level).not.toBeNull();
      expect(level?.code).toBe('HSK1');
    });

    it('resolves bands 7, 8, 9 to HSK7_9', () => {
      for (const b of [7, 8, 9]) {
        const level = resolveLevelForBand(sampleLevels, b);
        expect(level).not.toBeNull();
        expect(level?.code).toBe('HSK7_9');
      }
    });

    it('returns null for missing bands like 4, 5, 6', () => {
      for (const b of [4, 5, 6]) {
        expect(resolveLevelForBand(sampleLevels, b)).toBeNull();
      }
    });
  });

  describe('availableBands', () => {
    it('returns sorted unique list of all available bands', () => {
      expect(availableBands(sampleLevels)).toEqual([1, 2, 3, 7, 8, 9]);
    });
  });

  describe('localDateString', () => {
    it('formats date using local year, month, date without toISOString', () => {
      // Month 9 is October (0-indexed)
      const date = new Date(2026, 9, 5, 0, 30);
      expect(localDateString(date)).toBe('2026-10-05');
    });
  });

  describe('search params parsing', () => {
    it('parses valid goal page search params', () => {
      expect(
        parseGoalPageSearchParams({
          purpose: 'study_abroad',
          band: '2',
          notice: 'content_unavailable',
        }),
      ).toEqual({
        purpose: 'study_abroad',
        band: 2,
        notice: 'content_unavailable',
      });
    });

    it('ignores invalid goal page search params', () => {
      expect(
        parseGoalPageSearchParams({
          purpose: 'invalid_purpose',
          band: '10',
          notice: 'unknown_notice',
        }),
      ).toEqual({
        purpose: undefined,
        band: undefined,
        notice: undefined,
      });
    });

    it('parses valid plan page search params using zod', () => {
      const parsed = planPageSearchParamsSchema.safeParse({
        purpose: 'hsk_exam',
        band: '8',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toEqual({
          purpose: 'hsk_exam',
          band: 8,
        });
      }
    });

    it('fails plan page search params with invalid purpose or band', () => {
      expect(
        planPageSearchParamsSchema.safeParse({ purpose: 'invalid', band: '3' })
          .success,
      ).toBe(false);
      expect(
        planPageSearchParamsSchema.safeParse({ purpose: 'work', band: '0' })
          .success,
      ).toBe(false);
      expect(
        planPageSearchParamsSchema.safeParse({ purpose: 'work', band: '10' })
          .success,
      ).toBe(false);
    });
  });

  describe('schemas validation', () => {
    it('validates level item and levels response schema', () => {
      const valid = {
        id: 1,
        name: 'HSK 1',
        orderIndex: 1,
        code: 'HSK1',
        minBand: 1,
        maxBand: 1,
      };
      expect(levelItemSchema.safeParse(valid).success).toBe(true);
      expect(
        levelsResponseSchema.safeParse({ success: true, data: [valid] })
          .success,
      ).toBe(true);
    });

    it('validates user goal schema with nullable purpose and reminderTime', () => {
      const validGoal = {
        id: 10,
        targetLevelId: 3,
        targetBand: 3,
        dailyMinutes: 15,
        learningPurpose: null,
        reminderEnabled: false,
        reminderTime: null,
        startDate: '2026-10-05',
        isActive: true,
        createdAt: '2026-10-05T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
        targetLevel: {
          id: 3,
          code: 'HSK3',
          name: 'HSK 3',
          minBand: 3,
          maxBand: 3,
        },
      };
      expect(userGoalSchema.safeParse(validGoal).success).toBe(true);
      expect(
        currentGoalResponseSchema.safeParse({ success: true, data: validGoal })
          .success,
      ).toBe(true);
      expect(
        currentGoalResponseSchema.safeParse({ success: true, data: null })
          .success,
      ).toBe(true);
    });

    it('validates onboarding status response schema', () => {
      const validStatus = {
        hasActiveGoal: true,
        hasActiveLearningPlan: false,
        hasUsableLearningPlan: false,
        hasCompletedPlacement: false,
        nextStep: 'generate_plan',
      };
      expect(
        onboardingStatusResponseSchema.safeParse({
          success: true,
          data: validStatus,
        }).success,
      ).toBe(true);
    });

    it('validates onboarding complete input schema with strict constraints', () => {
      const validOn = {
        learningPurpose: 'communication',
        targetBand: 3,
        dailyMinutes: 15,
        reminderEnabled: true,
        reminderTime: '19:00',
        startDate: '2026-10-05',
      };
      expect(onboardingCompleteInputSchema.safeParse(validOn).success).toBe(
        true,
      );

      const validOff = {
        learningPurpose: 'work',
        targetBand: 1,
        dailyMinutes: 10,
        reminderEnabled: false,
        reminderTime: null,
        startDate: '2026-10-05',
      };
      expect(onboardingCompleteInputSchema.safeParse(validOff).success).toBe(
        true,
      );

      // Extra property rejected by strict
      expect(
        onboardingCompleteInputSchema.safeParse({ ...validOn, extra: true })
          .success,
      ).toBe(false);

      // reminderEnabled true but null reminderTime
      expect(
        onboardingCompleteInputSchema.safeParse({
          ...validOn,
          reminderTime: null,
        }).success,
      ).toBe(false);

      // reminderEnabled false but non-null reminderTime
      expect(
        onboardingCompleteInputSchema.safeParse({
          ...validOff,
          reminderTime: '19:00',
        }).success,
      ).toBe(false);

      // invalid calendar date (Feb 30th)
      expect(
        onboardingCompleteInputSchema.safeParse({
          ...validOn,
          startDate: '2026-02-30',
        }).success,
      ).toBe(false);

      // invalid dailyMinutes (20)
      expect(
        onboardingCompleteInputSchema.safeParse({
          ...validOn,
          dailyMinutes: 20,
        }).success,
      ).toBe(false);
    });
  });
});
