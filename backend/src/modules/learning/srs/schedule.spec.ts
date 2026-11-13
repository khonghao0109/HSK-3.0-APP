import { SM2_V1_POLICY } from './sm2-v1.policy';
import { schedule } from './schedule';
import type { SrsCard, SrsGrade, SrsScheduleResult } from './srs.types';
import { SrsScheduleError } from './srs.types';

const NOW = new Date('2026-01-15T00:00:00.000Z');
const MIN = 60_000;
const DAY = 86_400_000;
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

function card(overrides: Partial<SrsCard>): SrsCard {
  return {
    state: 'review',
    dueAt: NOW,
    intervalDays: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    lastReviewedAt: null,
    ...overrides,
  };
}

const NEW_CARD = card({ state: 'new' });
const LEARNING_STEP_0 = card({
  state: 'learning',
  repetitions: 0,
  lastReviewedAt: at(-MIN),
});
const LEARNING_STEP_1 = card({
  state: 'learning',
  repetitions: 1,
  lastReviewedAt: at(-10 * MIN),
});
const REVIEW = card({
  state: 'review',
  intervalDays: 10,
  repetitions: 3,
  lapses: 1,
  lastReviewedAt: at(-10 * DAY),
});
const REVIEW_FIRST = card({
  state: 'review',
  intervalDays: 1,
  repetitions: 1,
  lastReviewedAt: at(-DAY),
});
const RELEARNING = card({
  state: 'relearning',
  easeFactor: 2.18,
  repetitions: 0,
  lapses: 2,
  lastReviewedAt: at(-10 * MIN),
});

interface Expected {
  state: SrsScheduleResult['state'];
  dueOffsetMs: number;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
}

type Vector = [name: string, input: SrsCard, grade: SrsGrade, want: Expected];

// Every row is one test vector of docs/PLAN.md R3: input card + grade -> new card.
const VECTORS: Vector[] = [
  // ---- new: again repeats the first step, hard differs from good, easy graduates
  [
    'new/again',
    NEW_CARD,
    'again',
    {
      state: 'learning',
      dueOffsetMs: MIN,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      lapses: 0,
    },
  ],
  [
    'new/hard',
    NEW_CARD,
    'hard',
    {
      state: 'learning',
      dueOffsetMs: 90_000,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      lapses: 0,
    },
  ],
  [
    'new/good',
    NEW_CARD,
    'good',
    {
      state: 'learning',
      dueOffsetMs: 10 * MIN,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 1,
      lapses: 0,
    },
  ],
  [
    'new/easy',
    NEW_CARD,
    'easy',
    {
      state: 'review',
      dueOffsetMs: 4 * DAY,
      intervalDays: 4,
      easeFactor: 2.5,
      repetitions: 1,
      lapses: 0,
    },
  ],
  // ---- learning, first step
  [
    'learning(step0)/again',
    LEARNING_STEP_0,
    'again',
    {
      state: 'learning',
      dueOffsetMs: MIN,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      lapses: 0,
    },
  ],
  [
    'learning(step0)/hard',
    LEARNING_STEP_0,
    'hard',
    {
      state: 'learning',
      dueOffsetMs: 90_000,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      lapses: 0,
    },
  ],
  [
    'learning(step0)/good',
    LEARNING_STEP_0,
    'good',
    {
      state: 'learning',
      dueOffsetMs: 10 * MIN,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 1,
      lapses: 0,
    },
  ],
  [
    'learning(step0)/easy',
    LEARNING_STEP_0,
    'easy',
    {
      state: 'review',
      dueOffsetMs: 4 * DAY,
      intervalDays: 4,
      easeFactor: 2.5,
      repetitions: 1,
      lapses: 0,
    },
  ],
  // ---- learning, last step: good graduates
  [
    'learning(step1)/again',
    LEARNING_STEP_1,
    'again',
    {
      state: 'learning',
      dueOffsetMs: MIN,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 0,
      lapses: 0,
    },
  ],
  [
    'learning(step1)/hard',
    LEARNING_STEP_1,
    'hard',
    {
      state: 'learning',
      dueOffsetMs: 15 * MIN,
      intervalDays: 0,
      easeFactor: 2.5,
      repetitions: 1,
      lapses: 0,
    },
  ],
  [
    'learning(step1)/good',
    LEARNING_STEP_1,
    'good',
    {
      state: 'review',
      dueOffsetMs: DAY,
      intervalDays: 1,
      easeFactor: 2.5,
      repetitions: 1,
      lapses: 0,
    },
  ],
  [
    'learning(step1)/easy',
    LEARNING_STEP_1,
    'easy',
    {
      state: 'review',
      dueOffsetMs: 4 * DAY,
      intervalDays: 4,
      easeFactor: 2.5,
      repetitions: 1,
      lapses: 0,
    },
  ],
  // ---- review (interval 10, ease 2.5, lapses 1, reviewed on time)
  [
    'review/again',
    REVIEW,
    'again',
    {
      state: 'relearning',
      dueOffsetMs: 10 * MIN,
      intervalDays: 0,
      easeFactor: 2.18,
      repetitions: 0,
      lapses: 2,
    },
  ],
  [
    'review/hard',
    REVIEW,
    'hard',
    {
      state: 'review',
      dueOffsetMs: 12 * DAY,
      intervalDays: 12,
      easeFactor: 2.36,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'review/good',
    REVIEW,
    'good',
    {
      state: 'review',
      dueOffsetMs: 25 * DAY,
      intervalDays: 25,
      easeFactor: 2.5,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'review/easy',
    REVIEW,
    'easy',
    {
      state: 'review',
      dueOffsetMs: 33 * DAY,
      intervalDays: 33,
      easeFactor: 2.6,
      repetitions: 4,
      lapses: 1,
    },
  ],
  // ---- review right after graduation (repetitions 1): SM-2 second interval is 6 days
  [
    'review(n=1)/again',
    REVIEW_FIRST,
    'again',
    {
      state: 'relearning',
      dueOffsetMs: 10 * MIN,
      intervalDays: 0,
      easeFactor: 2.18,
      repetitions: 0,
      lapses: 1,
    },
  ],
  [
    'review(n=1)/hard',
    REVIEW_FIRST,
    'hard',
    {
      state: 'review',
      dueOffsetMs: DAY,
      intervalDays: 1,
      easeFactor: 2.36,
      repetitions: 2,
      lapses: 0,
    },
  ],
  [
    'review(n=1)/good',
    REVIEW_FIRST,
    'good',
    {
      state: 'review',
      dueOffsetMs: 6 * DAY,
      intervalDays: 6,
      easeFactor: 2.5,
      repetitions: 2,
      lapses: 0,
    },
  ],
  [
    'review(n=1)/easy',
    REVIEW_FIRST,
    'easy',
    {
      state: 'review',
      dueOffsetMs: 8 * DAY,
      intervalDays: 8,
      easeFactor: 2.6,
      repetitions: 2,
      lapses: 0,
    },
  ],
  // ---- relearning (one step of 10 minutes): lapses are not touched here
  [
    'relearning/again',
    RELEARNING,
    'again',
    {
      state: 'relearning',
      dueOffsetMs: 10 * MIN,
      intervalDays: 0,
      easeFactor: 2.18,
      repetitions: 0,
      lapses: 2,
    },
  ],
  [
    'relearning/hard',
    RELEARNING,
    'hard',
    {
      state: 'relearning',
      dueOffsetMs: 15 * MIN,
      intervalDays: 0,
      easeFactor: 2.18,
      repetitions: 0,
      lapses: 2,
    },
  ],
  [
    'relearning/good',
    RELEARNING,
    'good',
    {
      state: 'review',
      dueOffsetMs: DAY,
      intervalDays: 1,
      easeFactor: 2.18,
      repetitions: 1,
      lapses: 2,
    },
  ],
  [
    'relearning/easy',
    RELEARNING,
    'easy',
    {
      state: 'review',
      dueOffsetMs: 4 * DAY,
      intervalDays: 4,
      easeFactor: 2.18,
      repetitions: 1,
      lapses: 2,
    },
  ],
  // ---- easeFactor floor 1.3 and cap 5.0
  [
    'floor: ease 1.3 again',
    { ...REVIEW, easeFactor: 1.3 },
    'again',
    {
      state: 'relearning',
      dueOffsetMs: 10 * MIN,
      intervalDays: 0,
      easeFactor: 1.3,
      repetitions: 0,
      lapses: 2,
    },
  ],
  [
    'floor: ease 1.3 hard',
    { ...REVIEW, easeFactor: 1.3 },
    'hard',
    {
      state: 'review',
      dueOffsetMs: 12 * DAY,
      intervalDays: 12,
      easeFactor: 1.3,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'floor: ease 1.3 good',
    { ...REVIEW, easeFactor: 1.3 },
    'good',
    {
      state: 'review',
      dueOffsetMs: 13 * DAY,
      intervalDays: 13,
      easeFactor: 1.3,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'floor: ease 1.4 hard (1.26 clamps)',
    { ...REVIEW, easeFactor: 1.4 },
    'hard',
    {
      state: 'review',
      dueOffsetMs: 12 * DAY,
      intervalDays: 12,
      easeFactor: 1.3,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'floor: ease 1.4 easy',
    { ...REVIEW, easeFactor: 1.4 },
    'easy',
    {
      state: 'review',
      dueOffsetMs: 18 * DAY,
      intervalDays: 18,
      easeFactor: 1.5,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'cap: ease 4.95 easy (5.05 clamps)',
    { ...REVIEW, easeFactor: 4.95 },
    'easy',
    {
      state: 'review',
      dueOffsetMs: 64 * DAY,
      intervalDays: 64,
      easeFactor: 5,
      repetitions: 4,
      lapses: 1,
    },
  ],
  // ---- late review: lastReviewedAt -> now (40 days) beats the scheduled 10
  [
    'late 40d/hard',
    { ...REVIEW, dueAt: at(-30 * DAY), lastReviewedAt: at(-40 * DAY) },
    'hard',
    {
      state: 'review',
      dueOffsetMs: 48 * DAY,
      intervalDays: 48,
      easeFactor: 2.36,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'late 40d/good',
    { ...REVIEW, dueAt: at(-30 * DAY), lastReviewedAt: at(-40 * DAY) },
    'good',
    {
      state: 'review',
      dueOffsetMs: 100 * DAY,
      intervalDays: 100,
      easeFactor: 2.5,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'late 40d/easy',
    { ...REVIEW, dueAt: at(-30 * DAY), lastReviewedAt: at(-40 * DAY) },
    'easy',
    {
      state: 'review',
      dueOffsetMs: 130 * DAY,
      intervalDays: 130,
      easeFactor: 2.6,
      repetitions: 4,
      lapses: 1,
    },
  ],
  // ---- Q249 early review: elapsed (3d) replaces intervalDays; good keeps intervalDays
  [
    'early 3d/hard (Q249: max(1, round(3 x 1.2)))',
    { ...REVIEW, dueAt: at(7 * DAY), lastReviewedAt: at(-3 * DAY) },
    'hard',
    {
      state: 'review',
      dueOffsetMs: 4 * DAY,
      intervalDays: 4,
      easeFactor: 2.36,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'early 3d/good (Q249: max(intervalDays 10, round(3 x 2.5)))',
    { ...REVIEW, dueAt: at(7 * DAY), lastReviewedAt: at(-3 * DAY) },
    'good',
    {
      state: 'review',
      dueOffsetMs: 10 * DAY,
      intervalDays: 10,
      easeFactor: 2.5,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'early 3d/easy (Q249: max(good + 1, round(3 x 2.5 x 1.3)))',
    { ...REVIEW, dueAt: at(7 * DAY), lastReviewedAt: at(-3 * DAY) },
    'easy',
    {
      state: 'review',
      dueOffsetMs: 11 * DAY,
      intervalDays: 11,
      easeFactor: 2.6,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'early same-day/hard (Q249: elapsed 0 floors at 1)',
    { ...REVIEW, dueAt: at(10 * DAY), lastReviewedAt: at(-MIN) },
    'hard',
    {
      state: 'review',
      dueOffsetMs: DAY,
      intervalDays: 1,
      easeFactor: 2.36,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'early same-day/good (Q249: keeps intervalDays)',
    { ...REVIEW, dueAt: at(10 * DAY), lastReviewedAt: at(-MIN) },
    'good',
    {
      state: 'review',
      dueOffsetMs: 10 * DAY,
      intervalDays: 10,
      easeFactor: 2.5,
      repetitions: 4,
      lapses: 1,
    },
  ],
  // ---- Q249 on-time review: elapsed == intervalDays, result unchanged
  [
    'on-time 10d/hard (unchanged)',
    { ...REVIEW, dueAt: NOW, lastReviewedAt: at(-10 * DAY) },
    'hard',
    {
      state: 'review',
      dueOffsetMs: 12 * DAY,
      intervalDays: 12,
      easeFactor: 2.36,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'on-time 10d/good (unchanged)',
    { ...REVIEW, dueAt: NOW, lastReviewedAt: at(-10 * DAY) },
    'good',
    {
      state: 'review',
      dueOffsetMs: 25 * DAY,
      intervalDays: 25,
      easeFactor: 2.5,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'on-time 10d/easy (unchanged)',
    { ...REVIEW, dueAt: NOW, lastReviewedAt: at(-10 * DAY) },
    'easy',
    {
      state: 'review',
      dueOffsetMs: 33 * DAY,
      intervalDays: 33,
      easeFactor: 2.6,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'relearning/good one minute after the step is due returns to 1 day',
    { ...RELEARNING, dueAt: at(-MIN), lastReviewedAt: at(-11 * MIN) },
    'good',
    {
      state: 'review',
      dueOffsetMs: DAY,
      intervalDays: 1,
      easeFactor: 2.18,
      repetitions: 1,
      lapses: 2,
    },
  ],
  [
    'cap: early 3d easy at ease 4.95 (ease 5.05 clamps to maxEaseFactor 5)',
    {
      ...REVIEW,
      easeFactor: 4.95,
      dueAt: at(7 * DAY),
      lastReviewedAt: at(-3 * DAY),
    },
    'easy',
    {
      state: 'review',
      dueOffsetMs: 19 * DAY,
      intervalDays: 19,
      easeFactor: 5,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'cap: early 100d good of a 3650d card keeps maxIntervalDays 3650',
    {
      ...REVIEW,
      intervalDays: 3650,
      dueAt: at(3550 * DAY),
      lastReviewedAt: at(-100 * DAY),
    },
    'good',
    {
      state: 'review',
      dueOffsetMs: 3650 * DAY,
      intervalDays: 3650,
      easeFactor: 2.5,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'review without lastReviewedAt uses intervalDays',
    { ...REVIEW, lastReviewedAt: null },
    'good',
    {
      state: 'review',
      dueOffsetMs: 25 * DAY,
      intervalDays: 25,
      easeFactor: 2.5,
      repetitions: 4,
      lapses: 1,
    },
  ],
  [
    'maxIntervalDays caps the interval',
    { ...REVIEW, intervalDays: 3000, lastReviewedAt: at(-3000 * DAY) },
    'good',
    {
      state: 'review',
      dueOffsetMs: 3650 * DAY,
      intervalDays: 3650,
      easeFactor: 2.5,
      repetitions: 4,
      lapses: 1,
    },
  ],
];

describe('SRS schedule() — policy sm2-v1', () => {
  it.each(VECTORS)('%s', (_name, input, grade, want) => {
    const got = schedule(input, grade, NOW, SM2_V1_POLICY);

    expect(got.state).toBe(want.state);
    expect(got.dueAt.getTime() - NOW.getTime()).toBe(want.dueOffsetMs);
    expect(got.intervalDays).toBe(want.intervalDays);
    expect(got.easeFactor).toBe(want.easeFactor);
    expect(got.repetitions).toBe(want.repetitions);
    expect(got.lapses).toBe(want.lapses);
    expect(got.lastReviewedAt.getTime()).toBe(NOW.getTime());
    expect(got.schedulerVersion).toBe('sm2-v1');
  });

  describe('policy invariants over the whole state x grade matrix', () => {
    const STATES: Array<[string, SrsCard]> = [
      ['new', NEW_CARD],
      ['learning', LEARNING_STEP_1],
      ['review', REVIEW],
      ['relearning', RELEARNING],
    ];
    const GRADES: SrsGrade[] = ['again', 'hard', 'good', 'easy'];

    it.each(STATES)('%s: every grade yields a legal DB row', (_n, input) => {
      for (const grade of GRADES) {
        const got = schedule(input, grade, NOW, SM2_V1_POLICY);
        expect(got.easeFactor).toBeGreaterThanOrEqual(1.3);
        expect(got.easeFactor).toBeLessThanOrEqual(5);
        expect(got.intervalDays).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(got.intervalDays)).toBe(true);
        expect(got.repetitions).toBeGreaterThanOrEqual(0);
        expect(got.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
        expect(got.lapses).toBeGreaterThanOrEqual(input.lapses);
      }
    });

    it('again in review is the only grade that raises lapses', () => {
      expect(schedule(REVIEW, 'again', NOW, SM2_V1_POLICY).lapses).toBe(2);
      for (const [, input] of STATES) {
        for (const grade of GRADES) {
          const got = schedule(input, grade, NOW, SM2_V1_POLICY);
          const expectedLapses =
            input.state === 'review' && grade === 'again'
              ? input.lapses + 1
              : input.lapses;
          expect(got.lapses).toBe(expectedLapses);
        }
      }
    });

    it('in review hard < good < easy strictly, for any interval', () => {
      for (const intervalDays of [1, 2, 6, 10, 45, 400]) {
        for (const repetitions of [1, 2, 5]) {
          for (const easeFactor of [1.3, 2.5, 4]) {
            const input = card({
              intervalDays,
              repetitions,
              easeFactor,
              lastReviewedAt: at(-intervalDays * DAY),
            });
            const hard = schedule(input, 'hard', NOW, SM2_V1_POLICY);
            const good = schedule(input, 'good', NOW, SM2_V1_POLICY);
            const easy = schedule(input, 'easy', NOW, SM2_V1_POLICY);
            expect(hard.intervalDays).toBeLessThan(good.intervalDays);
            expect(good.intervalDays).toBeLessThan(easy.intervalDays);
          }
        }
      }
    });
  });

  describe('time handling', () => {
    it('uses only UTC instants: due offsets are exact across a US DST change', () => {
      const dstNow = new Date('2026-03-08T06:59:00.000Z');
      const input = card({
        intervalDays: 10,
        repetitions: 3,
        lastReviewedAt: new Date(dstNow.getTime() - 10 * DAY),
      });
      const got = schedule(input, 'good', dstNow, SM2_V1_POLICY);
      expect(got.dueAt.getTime() - dstNow.getTime()).toBe(25 * DAY);
    });

    it('treats the same instant written with another UTC offset identically', () => {
      const utc = new Date('2026-03-08T06:59:00.000Z');
      const offset = new Date('2026-03-08T01:59:00-05:00');
      const lastReviewedAt = new Date('2026-02-26T06:59:00.000Z');
      const input = card({ intervalDays: 10, repetitions: 3, lastReviewedAt });
      expect(schedule(input, 'good', offset, SM2_V1_POLICY)).toEqual(
        schedule(input, 'good', utc, SM2_V1_POLICY),
      );
    });

    it('does not read the clock', () => {
      jest.useFakeTimers().setSystemTime(new Date('2000-01-01T00:00:00.000Z'));
      try {
        const got = schedule(REVIEW, 'good', NOW, SM2_V1_POLICY);
        expect(got.dueAt.getTime()).toBe(NOW.getTime() + 25 * DAY);
        expect(got.lastReviewedAt.getTime()).toBe(NOW.getTime());
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('purity', () => {
    it('never mutates the card or the policy and returns fresh Dates', () => {
      const input = Object.freeze({ ...REVIEW });
      const before = JSON.stringify(input);
      const got = schedule(input, 'again', NOW, SM2_V1_POLICY);
      expect(JSON.stringify(input)).toBe(before);
      expect(got.dueAt).not.toBe(input.dueAt);
      expect(got.lastReviewedAt).not.toBe(NOW);
      expect(Object.isFrozen(SM2_V1_POLICY)).toBe(true);
    });

    it('echoes the policy version and honours custom steps', () => {
      const custom = {
        ...SM2_V1_POLICY,
        version: 'sm2-test',
        learningStepsMinutes: [5],
      };
      const got = schedule(NEW_CARD, 'good', NOW, custom);
      expect(got.schedulerVersion).toBe('sm2-test');
      expect(got.state).toBe('review');
      expect(got.intervalDays).toBe(1);
    });
  });

  describe('errors', () => {
    it.each(['again', 'hard', 'good', 'easy'] as SrsGrade[])(
      'suspended card cannot be scheduled (%s)',
      (grade) => {
        const input = card({ state: 'suspended', intervalDays: 10 });
        expect(() => schedule(input, grade, NOW, SM2_V1_POLICY)).toThrow(
          SrsScheduleError,
        );
        try {
          schedule(input, grade, NOW, SM2_V1_POLICY);
        } catch (error) {
          expect((error as SrsScheduleError).code).toBe('card_suspended');
        }
      },
    );

    it('rejects an unknown grade, an invalid now and an empty-step policy', () => {
      const codeOf = (run: () => unknown): string | null => {
        try {
          run();
          return null;
        } catch (error) {
          return error instanceof SrsScheduleError ? error.code : 'other';
        }
      };
      expect(
        codeOf(() => schedule(REVIEW, 'nope' as SrsGrade, NOW, SM2_V1_POLICY)),
      ).toBe('invalid_grade');
      expect(
        codeOf(() => schedule(REVIEW, 'good', new Date('nope'), SM2_V1_POLICY)),
      ).toBe('invalid_now');
      expect(
        codeOf(() =>
          schedule(REVIEW, 'good', NOW, {
            ...SM2_V1_POLICY,
            learningStepsMinutes: [],
          }),
        ),
      ).toBe('invalid_policy');
    });
  });
});
