import {
  buildSessionSummary,
  REVIEW_SESSION_IDLE_TTL_MS,
  sessionExpiresAt,
  isSessionExpired,
} from './review-session-rules';

const START = new Date('2026-01-15T00:00:00.000Z');
const HOUR = 3_600_000;

describe('review session expiry (Q253)', () => {
  it('idles out after 24 hours', () => {
    expect(REVIEW_SESSION_IDLE_TTL_MS).toBe(24 * HOUR);
  });

  it('is still active at 24h - 1ms', () => {
    expect(
      isSessionExpired(START, new Date(START.getTime() + 24 * HOUR - 1)),
    ).toBe(false);
  });

  it('expires at exactly 24h', () => {
    expect(isSessionExpired(START, new Date(START.getTime() + 24 * HOUR))).toBe(
      true,
    );
  });

  it('expires at 24h + 1ms', () => {
    expect(
      isSessionExpired(START, new Date(START.getTime() + 24 * HOUR + 1)),
    ).toBe(true);
  });

  it('reports the expiry instant from the last activity', () => {
    expect(sessionExpiresAt(START)).toEqual(
      new Date('2026-01-16T00:00:00.000Z'),
    );
  });
});

describe('buildSessionSummary', () => {
  it('counts grades, remembered/forgot, retention and total duration', () => {
    expect(
      buildSessionSummary([
        { grade: 'again', durationMs: 1000 },
        { grade: 'good', durationMs: 2000 },
        { grade: 'good', durationMs: null },
        { grade: 'easy', durationMs: 500 },
        { grade: 'hard', durationMs: 0 },
        { grade: 'again', durationMs: 100 },
      ]),
    ).toEqual({
      again: 2,
      hard: 1,
      good: 2,
      easy: 1,
      remembered: 4,
      forgot: 2,
      retentionPercent: 67,
      totalDurationMs: 3600,
    });
  });

  it('has a null retention without reviews', () => {
    expect(buildSessionSummary([])).toEqual({
      again: 0,
      hard: 0,
      good: 0,
      easy: 0,
      remembered: 0,
      forgot: 0,
      retentionPercent: null,
      totalDurationMs: 0,
    });
  });
});
