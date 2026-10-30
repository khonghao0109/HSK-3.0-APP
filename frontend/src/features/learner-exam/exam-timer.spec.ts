import { describe, expect, it, vi } from 'vitest';

import {
  EXAM_LOW_NOTICE,
  formatTimer,
  lockMessage,
  remainingAt,
  shouldLockExam,
  timerLabel,
  createExamTimer,
  clockFrom,
} from './exam-timer';

function deps(nowMs: number) {
  let now = nowMs;
  const handlers: Array<() => void> = [];
  return {
    deps: {
      now: () => now,
      setInterval: (handler: () => void) => {
        handlers.push(handler);
        return handlers.length;
      },
      clearInterval: () => undefined,
    },
    advance(ms: number) {
      now += ms;
      for (const handler of handlers) handler();
    },
  };
}

describe('exam timer (TL-137)', () => {
  it('formats MM:SS with minutes above 59 and sets the low state below 300 s', () => {
    expect(formatTimer(0)).toBe('00:00');
    expect(formatTimer(65)).toBe('01:05');
    expect(formatTimer(80 * 60)).toBe('80:00');
    expect(timerLabel(65)).toBe('Thời gian còn lại: 1 phút 5 giây');
    expect(clockFrom(1_000, 299).low).toBe(true);
    expect(clockFrom(1_000, 300).low).toBe(false);
  });

  it('rebases from the server remaining seconds and never goes negative', () => {
    const clock = clockFrom(1_000, 90);
    expect(remainingAt(clock, 1_000)).toBe(90);
    expect(remainingAt(clock, 1_000 + 30_000)).toBe(60);
    const rebased = clockFrom(1_000, 10);
    expect(remainingAt(rebased, 1_000 + 11_000)).toBe(0);
  });

  it('tick reports the low notice exactly once, including on a late rebase', () => {
    const fake = deps(1_000);
    const onTick = vi.fn();
    const onZero = vi.fn();
    const timer = createExamTimer({
      remainingSeconds: 400,
      deps: fake.deps,
      onTick,
      onZero,
    });
    timer.start();
    fake.advance(101_000);
    const notices = onTick.mock.calls.filter(
      (call) => (call[0] as { lowNotice: boolean }).lowNotice,
    );
    expect(notices).toHaveLength(1);
    expect(notices[0]?.[0]).toMatchObject({ lowNotice: true });
    expect(EXAM_LOW_NOTICE).toBe('Còn dưới 5 phút.');

    const late = deps(1_000);
    const lateTick = vi.fn();
    const lateTimer = createExamTimer({
      remainingSeconds: 200,
      deps: late.deps,
      onTick: lateTick,
      onZero: vi.fn(),
    });
    lateTimer.start();
    expect(lateTick.mock.calls[0]?.[0]).toMatchObject({
      low: true,
      lowNotice: true,
    });
    lateTimer.rebase(150);
    expect(lateTick.mock.calls.at(-1)?.[0]).toMatchObject({
      low: true,
      lowNotice: false,
    });
  });

  it('fires onZero once and rebase can restore a positive clock', () => {
    const fake = deps(0);
    const onZero = vi.fn();
    const timer = createExamTimer({
      remainingSeconds: 2,
      deps: fake.deps,
      onTick: vi.fn(),
      onZero,
    });
    timer.start();
    fake.advance(2_000);
    fake.advance(2_000);
    expect(onZero).toHaveBeenCalledTimes(1);

    timer.rebase(60);
    fake.advance(1_000);
    fake.advance(60_000);
    expect(onZero).toHaveBeenCalledTimes(2);
    timer.stop();
  });

  it('locks on local zero, server zero or a closed status, with the Q127 copy', () => {
    expect(
      shouldLockExam({
        status: 'in_progress',
        remainingSeconds: 0,
        localRemainingSeconds: 0,
      }),
    ).toBe(true);
    expect(
      shouldLockExam({
        status: 'in_progress',
        remainingSeconds: 0,
        localRemainingSeconds: 5,
      }),
    ).toBe(true);
    expect(
      shouldLockExam({
        status: 'timed_out',
        remainingSeconds: 10,
        localRemainingSeconds: 10,
      }),
    ).toBe(true);
    expect(
      shouldLockExam({
        status: 'in_progress',
        remainingSeconds: 10,
        localRemainingSeconds: 10,
      }),
    ).toBe(false);
    expect(lockMessage('timed_out')).toBe('Hết giờ. Bài làm đã được lưu.');
    expect(lockMessage('submitted')).toBe('Bài thi đã kết thúc.');
  });

  it('rebase never extends the deadline when a late response arrives', () => {
    const fake = deps(0);
    const onTick = vi.fn();
    const timer = createExamTimer({
      remainingSeconds: 100,
      deps: fake.deps,
      onTick,
      onZero: vi.fn(),
    });
    timer.start();
    fake.advance(10_000);
    timer.rebase(95);
    expect(timer.current().remainingSeconds).toBe(90);
    expect(onTick.mock.calls.at(-1)?.[0]).toMatchObject({
      remainingSeconds: 90,
    });
  });

  it('rebase shortens the deadline when the server is behind', () => {
    const fake = deps(0);
    const timer = createExamTimer({
      remainingSeconds: 100,
      deps: fake.deps,
      onTick: vi.fn(),
      onZero: vi.fn(),
    });
    timer.start();
    fake.advance(10_000);
    timer.rebase(80);
    expect(timer.current().remainingSeconds).toBe(80);
  });
});
