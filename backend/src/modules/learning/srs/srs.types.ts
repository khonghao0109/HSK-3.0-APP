/**
 * M3.1: types of the pure SRS scheduler. They are plain string unions on
 * purpose, so this module never imports Prisma: the Prisma enums
 * `ReviewCardState` / `ReviewGrade` are structurally assignable to these.
 */

export type SrsCardState =
  | 'new'
  | 'learning'
  | 'review'
  | 'relearning'
  | 'suspended';

export type SrsGrade = 'again' | 'hard' | 'good' | 'easy';

/** The scheduling-relevant slice of a `ReviewCard` row. */
export interface SrsCard {
  state: SrsCardState;
  dueAt: Date;
  intervalDays: number;
  easeFactor: number;
  /**
   * In `review` it is the count of consecutive successful reviews (SM-2 `n`).
   * In `learning` / `relearning` it is the index of the step the card is on
   * (= steps already passed), because `ReviewCard` has no separate step column.
   */
  repetitions: number;
  lapses: number;
  lastReviewedAt: Date | null;
}

export interface Sm2Policy {
  /** Stored in `ReviewCard.schedulerVersion`; bump when any number changes. */
  readonly version: string;
  readonly learningStepsMinutes: readonly number[];
  readonly relearningStepsMinutes: readonly number[];
  readonly graduatingIntervalDays: number;
  readonly easyIntervalDays: number;
  /** SM-2: interval of the second successful review (n = 2). */
  readonly secondIntervalDays: number;
  readonly hardIntervalMultiplier: number;
  readonly easyBonus: number;
  /** "Hard" in a (re)learning step repeats the step, waiting this much longer. */
  readonly hardStepMultiplier: number;
  readonly minEaseFactor: number;
  readonly maxEaseFactor: number;
  readonly maxIntervalDays: number;
  /** SM-2 ease change per grade, from EF' = EF + (0.1 - (5-q)(0.08 + (5-q)0.02)). */
  readonly easeDelta: Readonly<Record<SrsGrade, number>>;
}

/** The new state of a card after one grade. It never mutates its input. */
export interface SrsScheduleResult {
  state: Exclude<SrsCardState, 'new' | 'suspended'>;
  dueAt: Date;
  intervalDays: number;
  easeFactor: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt: Date;
  schedulerVersion: string;
}

export type SrsScheduleErrorCode =
  | 'card_suspended'
  | 'invalid_grade'
  | 'invalid_now'
  | 'invalid_policy';

export class SrsScheduleError extends Error {
  constructor(
    readonly code: SrsScheduleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SrsScheduleError';
  }
}
