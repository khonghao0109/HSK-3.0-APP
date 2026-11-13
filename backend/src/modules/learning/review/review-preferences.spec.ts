import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateReviewPreferencesDto } from './dto/review-preferences.dto';
import {
  activeLevelCodes,
  dailyRemaining,
  dayStartOf,
  levelCardWhere,
  unknownLevelCodes,
} from './review-preferences';

const errorsOf = (body: unknown) =>
  validateSync(plainToInstance(UpdateReviewPreferencesDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('review preferences (M3.3c, Q279–Q282)', () => {
  describe('UpdateReviewPreferencesDto', () => {
    it.each([10, 20, 30])('accepts dailyCardLimit %d', (value) => {
      expect(
        errorsOf({ dailyCardLimit: value, levelCodes: ['HSK1'] }),
      ).toHaveLength(0);
    });

    it.each([0, 15, 25, 31, 50, '20', 20.5, null])(
      'rejects dailyCardLimit %p',
      (value) => {
        expect(
          errorsOf({ dailyCardLimit: value, levelCodes: [] }).length,
        ).toBeGreaterThan(0);
      },
    );

    it('rejects duplicated, empty or non-string level codes', () => {
      for (const levelCodes of [['HSK1', 'HSK1'], [''], [1], 'HSK1', null]) {
        expect(
          errorsOf({ dailyCardLimit: 20, levelCodes }).length,
        ).toBeGreaterThan(0);
      }
    });

    it('accepts at most one level code (Q285)', () => {
      expect(errorsOf({ dailyCardLimit: 20, levelCodes: [] })).toHaveLength(0);
      expect(
        errorsOf({ dailyCardLimit: 20, levelCodes: ['HSK1'] }),
      ).toHaveLength(0);
      expect(
        errorsOf({ dailyCardLimit: 20, levelCodes: ['HSK1', 'HSK2'] }).length,
      ).toBeGreaterThan(0);
    });

    it('requires both fields and rejects extra ones', () => {
      expect(errorsOf({ dailyCardLimit: 20 }).length).toBeGreaterThan(0);
      expect(errorsOf({ levelCodes: [] }).length).toBeGreaterThan(0);
      expect(
        errorsOf({ dailyCardLimit: 20, levelCodes: [], extra: 1 }).length,
      ).toBeGreaterThan(0);
    });
  });

  describe('unknownLevelCodes', () => {
    it('lists the codes that are not public levels, in request order', () => {
      expect(
        unknownLevelCodes(['HSK2', 'X', 'HSK1', 'Y'], ['HSK1', 'HSK2']),
      ).toEqual(['X', 'Y']);
      expect(unknownLevelCodes([], ['HSK1'])).toEqual([]);
    });
  });

  describe('activeLevelCodes (Q281)', () => {
    it('keeps only saved codes that are still public, so an unpublished level falls back to every level', () => {
      expect(activeLevelCodes(['HSK3', 'HSK4'], ['HSK1', 'HSK3'])).toEqual([
        'HSK3',
      ]);
      expect(activeLevelCodes(['HSK4'], ['HSK1', 'HSK3'])).toEqual([]);
      expect(activeLevelCodes([], ['HSK1'])).toEqual([]);
    });
  });

  describe('dailyRemaining (Q282)', () => {
    it('is the limit minus the distinct cards graded today, never below 0', () => {
      expect(dailyRemaining(20, 0)).toBe(20);
      expect(dailyRemaining(20, 7)).toBe(13);
      expect(dailyRemaining(10, 10)).toBe(0);
      expect(dailyRemaining(10, 14)).toBe(0);
    });
  });

  describe('dayStartOf (Q282)', () => {
    const NY = 'America/New_York';

    it('starts the day at local midnight of the learner timezone', () => {
      // 2026-11-12 04:59 UTC is still 11/11 23:59 in New York (UTC-5).
      expect(
        dayStartOf(new Date('2026-11-12T04:59:00.000Z'), NY).toISOString(),
      ).toBe('2026-11-11T05:00:00.000Z');
      // One minute later the local day has turned.
      expect(
        dayStartOf(new Date('2026-11-12T05:00:00.000Z'), NY).toISOString(),
      ).toBe('2026-11-12T05:00:00.000Z');
    });

    it('differs from the default timezone across the same instant', () => {
      const at = new Date('2026-11-12T16:30:00.000Z');
      expect(dayStartOf(at, 'Asia/Ho_Chi_Minh').toISOString()).toBe(
        '2026-11-11T17:00:00.000Z',
      );
      expect(dayStartOf(at, NY).toISOString()).toBe('2026-11-12T05:00:00.000Z');
    });
  });

  describe('levelCardWhere (Q281)', () => {
    it('adds no filter for an empty list (every level)', () => {
      expect(levelCardWhere([])).toEqual({});
    });

    it('keeps cards of a word in a public level of the list', () => {
      expect(levelCardWhere(['HSK1', 'HSK2'])).toEqual({
        word: {
          wordLevels: {
            some: {
              level: {
                code: { in: ['HSK1', 'HSK2'] },
                status: 'published',
                deletedAt: null,
              },
            },
          },
        },
      });
    });
  });
});
