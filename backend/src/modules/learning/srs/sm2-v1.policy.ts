import type { Sm2Policy } from './srs.types';

/**
 * M3.1 R3 policy `sm2-v1` (Q244: SM-2 only). Numbers come from SM-2 itself
 * (ease formula, 1 → 6 → I·EF, floor 1.3) plus our own learning steps; none is
 * copied from a competitor. Changing any value needs a new `version`.
 */
export const SM2_V1_POLICY: Sm2Policy = Object.freeze({
  version: 'sm2-v1',
  learningStepsMinutes: Object.freeze([1, 10]),
  relearningStepsMinutes: Object.freeze([10]),
  graduatingIntervalDays: 1,
  easyIntervalDays: 4,
  secondIntervalDays: 6,
  hardIntervalMultiplier: 1.2,
  easyBonus: 1.3,
  hardStepMultiplier: 1.5,
  minEaseFactor: 1.3,
  maxEaseFactor: 5,
  maxIntervalDays: 3650,
  // q = 2, 3, 4, 5 in EF' = EF + (0.1 - (5-q)(0.08 + (5-q)0.02)).
  easeDelta: Object.freeze({ again: -0.32, hard: -0.14, good: 0, easy: 0.1 }),
});
