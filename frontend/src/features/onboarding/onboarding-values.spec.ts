import { describe, expect, it } from 'vitest';

import type { LevelItem } from './onboarding-contract';
import {
  availableBands,
  localDateString,
  parseGoalPageSearchParams,
  resolveLevelForBand,
} from './onboarding-values';

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

describe('onboarding-values', () => {
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

    it('takes the first value of repeated goal page search params and rejects empty values', () => {
      expect(
        parseGoalPageSearchParams({
          purpose: ['work', 'hsk_exam'],
          band: ['3', '8'],
          notice: ['content_unavailable', 'x'],
        }),
      ).toEqual({ purpose: 'work', band: 3, notice: 'content_unavailable' });
      expect(
        parseGoalPageSearchParams({ purpose: '', band: '', notice: '' }),
      ).toEqual({ purpose: undefined, band: undefined, notice: undefined });
      expect(
        parseGoalPageSearchParams({ purpose: [], band: [], notice: [] }),
      ).toEqual({ purpose: undefined, band: undefined, notice: undefined });
      expect(parseGoalPageSearchParams({})).toEqual({
        purpose: undefined,
        band: undefined,
        notice: undefined,
      });
    });
  });
});
