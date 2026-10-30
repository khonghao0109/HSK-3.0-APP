/**
 * TL-137: the exam clock is a deadline in monotonic time, rebased from every
 * server `remainingSeconds`. It never compares `Date.now()` with `expiresAt`.
 */

export const EXAM_LOW_SECONDS = 300;
export const EXAM_TIMER_TICK_MS = 250;

export type ExamClock = {
  /** `performance.now()` based deadline; monotonic within the page. */
  deadlineMs: number;
  /** Whole seconds shown to the learner. */
  remainingSeconds: number;
  low: boolean;
};

export type ExamClockState = ExamClock & {
  /** True exactly once, when the clock first drops below five minutes. */
  lowNotice: boolean;
};

export type ExamClockDeps = {
  now: () => number;
  setInterval: (handler: () => void, timeoutMs: number) => number;
  clearInterval: (handle: number) => void;
};

export function clockFrom(nowMs: number, remainingSeconds: number): ExamClock {
  const safe = Math.max(0, Math.floor(remainingSeconds));
  return {
    deadlineMs: nowMs + safe * 1_000,
    remainingSeconds: safe,
    low: safe > 0 && safe < EXAM_LOW_SECONDS,
  };
}

export function rebaseClock(
  nowMs: number,
  remainingSeconds: number,
): ExamClock {
  return clockFrom(nowMs, remainingSeconds);
}

export function remainingAt(clock: ExamClock, nowMs: number): number {
  const remaining = Math.ceil((clock.deadlineMs - nowMs) / 1_000);
  return remaining > 0 ? remaining : 0;
}

export function formatTimer(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function timerLabel(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `Thời gian còn lại: ${String(minutes)} phút ${String(seconds)} giây`;
}

/** Q127 copy (TL-137). */
export const EXAM_EXPIRED_MESSAGE = 'Hết giờ. Bài làm đã được lưu.';
export const EXAM_CLOSED_MESSAGE = 'Bài thi đã kết thúc.';
export const EXAM_UNSAVED_BEFORE_EXPIRY =
  'Có câu chưa lưu được trước khi hết giờ.';
export const EXAM_LOW_NOTICE = 'Còn dưới 5 phút.';

/** Q127 triggers on the local zero, `remainingSeconds === 0` or a closed status. */
export function shouldLockExam(input: {
  status: string;
  remainingSeconds: number;
  localRemainingSeconds: number;
}): boolean {
  return (
    input.localRemainingSeconds <= 0 ||
    input.remainingSeconds <= 0 ||
    input.status !== 'in_progress'
  );
}

export function lockMessage(status: string): string {
  if (
    status === 'submitted' ||
    status === 'invalidated' ||
    status === 'closed'
  ) {
    return EXAM_CLOSED_MESSAGE;
  }
  return EXAM_EXPIRED_MESSAGE;
}

export type ExamTimer = {
  start: () => void;
  stop: () => void;
  rebase: (remainingSeconds: number) => void;
  current: () => ExamClockState;
};

/**
 * Small ticker around {@link clockFrom}. `onTick` runs for every tick and when
 * a rebase drops the clock below five minutes, so the UI never waits a tick to
 * show the warning.
 */
export function createExamTimer(input: {
  remainingSeconds: number;
  deps: ExamClockDeps;
  onTick: (state: ExamClockState) => void;
  onZero: () => void;
}): ExamTimer {
  let clock = clockFrom(input.deps.now(), input.remainingSeconds);
  // The first tick decides whether the under-five-minutes notice is due;
  // opening the page already below five minutes must still announce it once.
  let lowNoticeShown = false;
  let zeroFired = clock.remainingSeconds === 0;
  let handle: number | null = null;
  let stopped = false;

  const state = (): ExamClockState => ({
    ...clock,
    remainingSeconds: remainingAt(clock, input.deps.now()),
    low:
      remainingAt(clock, input.deps.now()) > 0 &&
      remainingAt(clock, input.deps.now()) < EXAM_LOW_SECONDS,
    lowNotice: clock.low && !lowNoticeShown,
  });

  const tick = (): void => {
    if (stopped) return;
    const remaining = remainingAt(clock, input.deps.now());
    const low = remaining > 0 && remaining < EXAM_LOW_SECONDS;
    const lowNotice = low && !lowNoticeShown;
    if (lowNotice) lowNoticeShown = true;
    clock = { ...clock, remainingSeconds: remaining, low };
    input.onTick({
      deadlineMs: clock.deadlineMs,
      remainingSeconds: remaining,
      low,
      lowNotice,
    });
    if (remaining === 0 && !zeroFired) {
      zeroFired = true;
      input.onZero();
    }
  };

  return {
    start() {
      if (handle !== null) return;
      tick();
      handle = input.deps.setInterval(tick, EXAM_TIMER_TICK_MS);
    },
    stop() {
      stopped = true;
      if (handle !== null) {
        input.deps.clearInterval(handle);
        handle = null;
      }
    },
    rebase(remainingSeconds: number) {
      const nowMs = input.deps.now();
      const fromServer = rebaseClock(nowMs, remainingSeconds);
      // M4.2b: a late or out-of-order response may only shorten the deadline; a
      // server value must never add exam time. An already-expired local clock
      // still accepts the server value (recovery path).
      const deadlineMs =
        remainingAt(clock, nowMs) > 0
          ? Math.min(clock.deadlineMs, fromServer.deadlineMs)
          : fromServer.deadlineMs;
      const remaining = remainingAt({ ...fromServer, deadlineMs }, nowMs);
      clock = {
        deadlineMs,
        remainingSeconds: remaining,
        low: remaining > 0 && remaining < EXAM_LOW_SECONDS,
      };
      const low =
        clock.remainingSeconds > 0 && clock.remainingSeconds < EXAM_LOW_SECONDS;
      const lowNotice = low && !lowNoticeShown;
      if (lowNotice) lowNoticeShown = true;
      if (clock.remainingSeconds > 0) zeroFired = false;
      input.onTick({
        deadlineMs: clock.deadlineMs,
        remainingSeconds: clock.remainingSeconds,
        low,
        lowNotice,
      });
      if (clock.remainingSeconds === 0 && !zeroFired) {
        zeroFired = true;
        input.onZero();
      }
    },
    current: state,
  };
}
