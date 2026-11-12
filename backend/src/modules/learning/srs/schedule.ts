import type {
  Sm2Policy,
  SrsCard,
  SrsGrade,
  SrsScheduleResult,
} from './srs.types';
import { SrsScheduleError } from './srs.types';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clampEase(ease: number, policy: Sm2Policy): number {
  const rounded = roundToDecimals(ease, 2);
  if (rounded < policy.minEaseFactor) return policy.minEaseFactor;
  if (rounded > policy.maxEaseFactor) return policy.maxEaseFactor;
  return rounded;
}

function clampInterval(days: number, policy: Sm2Policy): number {
  if (days < 0) return 0;
  if (days > policy.maxIntervalDays) return policy.maxIntervalDays;
  return Math.round(days);
}

function assertValidInput(
  card: SrsCard,
  grade: SrsGrade,
  now: Date,
  policy: Sm2Policy,
): void {
  if (card.state === 'suspended') {
    throw new SrsScheduleError(
      'card_suspended',
      'Cannot schedule a suspended review card',
    );
  }

  if (
    grade !== 'again' &&
    grade !== 'hard' &&
    grade !== 'good' &&
    grade !== 'easy'
  ) {
    throw new SrsScheduleError(
      'invalid_grade',
      `Unsupported SRS review grade: ${String(grade)}`,
    );
  }

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new SrsScheduleError('invalid_now', 'Invalid Date provided for now');
  }

  if (
    !policy ||
    !Array.isArray(policy.learningStepsMinutes) ||
    policy.learningStepsMinutes.length === 0 ||
    !Array.isArray(policy.relearningStepsMinutes) ||
    policy.relearningStepsMinutes.length === 0
  ) {
    throw new SrsScheduleError(
      'invalid_policy',
      'Policy must define non-empty learning/relearning steps',
    );
  }
}

export function schedule(
  card: SrsCard,
  grade: SrsGrade,
  now: Date,
  policy: Sm2Policy,
): SrsScheduleResult {
  assertValidInput(card, grade, now, policy);

  const nowMs = now.getTime();
  const currentEase = clampEase(card.easeFactor, policy);
  const lapses = card.lapses;

  // 1. NEW CARD
  if (card.state === 'new') {
    if (grade === 'again') {
      const stepMinutes = policy.learningStepsMinutes[0];
      return {
        state: 'learning',
        dueAt: new Date(nowMs + stepMinutes * MINUTE_MS),
        intervalDays: 0,
        easeFactor: currentEase,
        repetitions: 0,
        lapses,
        lastReviewedAt: new Date(nowMs),
        schedulerVersion: policy.version,
      };
    }

    if (grade === 'hard') {
      const stepMinutes =
        policy.learningStepsMinutes[0] * policy.hardStepMultiplier;
      return {
        state: 'learning',
        dueAt: new Date(nowMs + Math.round(stepMinutes * MINUTE_MS)),
        intervalDays: 0,
        easeFactor: currentEase,
        repetitions: 0,
        lapses,
        lastReviewedAt: new Date(nowMs),
        schedulerVersion: policy.version,
      };
    }

    if (grade === 'good') {
      if (policy.learningStepsMinutes.length === 1) {
        // Only 1 step: graduates immediately
        const intervalDays = clampInterval(
          policy.graduatingIntervalDays,
          policy,
        );
        return {
          state: 'review',
          dueAt: new Date(nowMs + intervalDays * DAY_MS),
          intervalDays,
          easeFactor: currentEase,
          repetitions: 1,
          lapses,
          lastReviewedAt: new Date(nowMs),
          schedulerVersion: policy.version,
        };
      }
      // Moves to step 1
      const stepMinutes = policy.learningStepsMinutes[1];
      return {
        state: 'learning',
        dueAt: new Date(nowMs + stepMinutes * MINUTE_MS),
        intervalDays: 0,
        easeFactor: currentEase,
        repetitions: 1,
        lapses,
        lastReviewedAt: new Date(nowMs),
        schedulerVersion: policy.version,
      };
    }

    // grade === 'easy'
    const intervalDays = clampInterval(policy.easyIntervalDays, policy);
    return {
      state: 'review',
      dueAt: new Date(nowMs + intervalDays * DAY_MS),
      intervalDays,
      easeFactor: currentEase,
      repetitions: 1,
      lapses,
      lastReviewedAt: new Date(nowMs),
      schedulerVersion: policy.version,
    };
  }

  // 2. LEARNING CARD
  if (card.state === 'learning') {
    const currentStepIndex = Math.min(
      Math.max(card.repetitions, 0),
      policy.learningStepsMinutes.length - 1,
    );

    if (grade === 'again') {
      const stepMinutes = policy.learningStepsMinutes[0];
      return {
        state: 'learning',
        dueAt: new Date(nowMs + stepMinutes * MINUTE_MS),
        intervalDays: 0,
        easeFactor: currentEase,
        repetitions: 0,
        lapses,
        lastReviewedAt: new Date(nowMs),
        schedulerVersion: policy.version,
      };
    }

    if (grade === 'hard') {
      const stepMinutes =
        policy.learningStepsMinutes[currentStepIndex] *
        policy.hardStepMultiplier;
      return {
        state: 'learning',
        dueAt: new Date(nowMs + Math.round(stepMinutes * MINUTE_MS)),
        intervalDays: 0,
        easeFactor: currentEase,
        repetitions: card.repetitions,
        lapses,
        lastReviewedAt: new Date(nowMs),
        schedulerVersion: policy.version,
      };
    }

    if (grade === 'good') {
      const nextStepIndex = currentStepIndex + 1;
      if (nextStepIndex >= policy.learningStepsMinutes.length) {
        // Graduates to review
        const intervalDays = clampInterval(
          policy.graduatingIntervalDays,
          policy,
        );
        return {
          state: 'review',
          dueAt: new Date(nowMs + intervalDays * DAY_MS),
          intervalDays,
          easeFactor: currentEase,
          repetitions: 1,
          lapses,
          lastReviewedAt: new Date(nowMs),
          schedulerVersion: policy.version,
        };
      }
      const stepMinutes = policy.learningStepsMinutes[nextStepIndex];
      return {
        state: 'learning',
        dueAt: new Date(nowMs + stepMinutes * MINUTE_MS),
        intervalDays: 0,
        easeFactor: currentEase,
        repetitions: nextStepIndex,
        lapses,
        lastReviewedAt: new Date(nowMs),
        schedulerVersion: policy.version,
      };
    }

    // grade === 'easy'
    const intervalDays = clampInterval(policy.easyIntervalDays, policy);
    return {
      state: 'review',
      dueAt: new Date(nowMs + intervalDays * DAY_MS),
      intervalDays,
      easeFactor: currentEase,
      repetitions: 1,
      lapses,
      lastReviewedAt: new Date(nowMs),
      schedulerVersion: policy.version,
    };
  }

  // 3. RELEARNING CARD
  if (card.state === 'relearning') {
    const currentStepIndex = Math.min(
      Math.max(card.repetitions, 0),
      policy.relearningStepsMinutes.length - 1,
    );

    if (grade === 'again') {
      const stepMinutes = policy.relearningStepsMinutes[0];
      return {
        state: 'relearning',
        dueAt: new Date(nowMs + stepMinutes * MINUTE_MS),
        intervalDays: 0,
        easeFactor: currentEase,
        repetitions: 0,
        lapses, // lapses already incremented when dropping from review
        lastReviewedAt: new Date(nowMs),
        schedulerVersion: policy.version,
      };
    }

    if (grade === 'hard') {
      const stepMinutes =
        policy.relearningStepsMinutes[currentStepIndex] *
        policy.hardStepMultiplier;
      return {
        state: 'relearning',
        dueAt: new Date(nowMs + Math.round(stepMinutes * MINUTE_MS)),
        intervalDays: 0,
        easeFactor: currentEase,
        repetitions: card.repetitions,
        lapses,
        lastReviewedAt: new Date(nowMs),
        schedulerVersion: policy.version,
      };
    }

    if (grade === 'good') {
      const nextStepIndex = currentStepIndex + 1;
      if (nextStepIndex >= policy.relearningStepsMinutes.length) {
        // Graduates back to review with interval 1 day
        const intervalDays = clampInterval(
          policy.graduatingIntervalDays,
          policy,
        );
        return {
          state: 'review',
          dueAt: new Date(nowMs + intervalDays * DAY_MS),
          intervalDays,
          easeFactor: currentEase,
          repetitions: 1,
          lapses,
          lastReviewedAt: new Date(nowMs),
          schedulerVersion: policy.version,
        };
      }
      const stepMinutes = policy.relearningStepsMinutes[nextStepIndex];
      return {
        state: 'relearning',
        dueAt: new Date(nowMs + stepMinutes * MINUTE_MS),
        intervalDays: 0,
        easeFactor: currentEase,
        repetitions: nextStepIndex,
        lapses,
        lastReviewedAt: new Date(nowMs),
        schedulerVersion: policy.version,
      };
    }

    // grade === 'easy'
    const intervalDays = clampInterval(policy.easyIntervalDays, policy);
    return {
      state: 'review',
      dueAt: new Date(nowMs + intervalDays * DAY_MS),
      intervalDays,
      easeFactor: currentEase,
      repetitions: 1,
      lapses,
      lastReviewedAt: new Date(nowMs),
      schedulerVersion: policy.version,
    };
  }

  // 4. REVIEW CARD
  // Q249: elapsed = whole days actually passed since the last review, used for
  // both early and late reviews; without lastReviewedAt fall back to intervalDays.
  let elapsedDays = card.intervalDays;
  if (card.lastReviewedAt) {
    const elapsedMs = nowMs - card.lastReviewedAt.getTime();
    elapsedDays = Math.max(0, Math.floor(elapsedMs / DAY_MS));
  }

  const delta = policy.easeDelta[grade] ?? 0;
  const newEase = clampEase(currentEase + delta, policy);

  if (grade === 'again') {
    const stepMinutes = policy.relearningStepsMinutes[0];
    return {
      state: 'relearning',
      dueAt: new Date(nowMs + stepMinutes * MINUTE_MS),
      intervalDays: 0,
      easeFactor: newEase,
      repetitions: 0,
      lapses: lapses + 1,
      lastReviewedAt: new Date(nowMs),
      schedulerVersion: policy.version,
    };
  }

  let nextInterval: number;
  if (card.repetitions <= 1) {
    if (grade === 'hard') {
      nextInterval = Math.max(
        1,
        Math.round(card.intervalDays * policy.hardIntervalMultiplier),
      );
      if (nextInterval >= policy.secondIntervalDays) {
        nextInterval = policy.secondIntervalDays - 1;
      }
    } else if (grade === 'good') {
      nextInterval = policy.secondIntervalDays;
    } else {
      nextInterval = Math.round(policy.secondIntervalDays * policy.easyBonus);
    }
  } else {
    const hardInterval = Math.max(
      1,
      Math.round(elapsedDays * policy.hardIntervalMultiplier),
    );
    // good never shrinks the current interval and stays strictly above hard.
    const goodInterval = Math.max(
      card.intervalDays,
      Math.round(elapsedDays * currentEase),
      hardInterval + 1,
    );
    if (grade === 'hard') {
      nextInterval = hardInterval;
    } else if (grade === 'good') {
      nextInterval = goodInterval;
    } else {
      nextInterval = Math.max(
        goodInterval + 1,
        Math.round(elapsedDays * currentEase * policy.easyBonus),
      );
    }
  }

  const finalInterval = clampInterval(nextInterval, policy);
  return {
    state: 'review',
    dueAt: new Date(nowMs + finalInterval * DAY_MS),
    intervalDays: finalInterval,
    easeFactor: newEase,
    repetitions: card.repetitions + 1,
    lapses,
    lastReviewedAt: new Date(nowMs),
    schedulerVersion: policy.version,
  };
}
