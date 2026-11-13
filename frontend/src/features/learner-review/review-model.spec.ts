import { describe, expect, it } from 'vitest';

import {
  clampDurationMs,
  formatDuration,
  gradeFailureAction,
  intervalLabel,
  progressCounter,
  retentionText,
  reviewCardView,
} from './review-model';

const NOW = Date.parse('2026-11-12T08:00:00.000Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('intervalLabel (Q261)', () => {
  it.each([
    [0, '1 phút'],
    [-5 * MIN, '1 phút'],
    [20_000, '1 phút'],
    [10 * MIN, '10 phút'],
    [59 * MIN, '59 phút'],
    [HOUR, '1 giờ'],
    [6 * HOUR, '6 giờ'],
    [23 * HOUR, '23 giờ'],
    [DAY, '1 ngày'],
    [4 * DAY, '4 ngày'],
    [29 * DAY, '29 ngày'],
    [30 * DAY, '1 tháng'],
    [75 * DAY, '2 tháng'],
    [90 * DAY, '3 tháng'],
  ])('%i ms → %s', (delta, label) => {
    expect(intervalLabel(at(delta), NOW)).toBe(label);
  });

  it('never rounds a unit up to the next boundary', () => {
    expect(intervalLabel(at(HOUR - 1), NOW)).toBe('59 phút');
    expect(intervalLabel(at(DAY - 1), NOW)).toBe('23 giờ');
    expect(intervalLabel(at(30 * DAY - 1), NOW)).toBe('29 ngày');
  });
});

describe('formatDuration (Q263)', () => {
  it.each([
    [0, '0 phút 0 giây'],
    [6000, '0 phút 6 giây'],
    [755_000, '12 phút 35 giây'],
    [3_601_400, '60 phút 1 giây'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('clampDurationMs (Q262)', () => {
  it('keeps 0–600000 and rounds to an integer', () => {
    expect(clampDurationMs(-3)).toBe(0);
    expect(clampDurationMs(1234.6)).toBe(1235);
    expect(clampDurationMs(600_001)).toBe(600_000);
    expect(clampDurationMs(Number.NaN)).toBe(0);
  });
});

describe('gradeFailureAction (Q262)', () => {
  it.each([
    [409, 'REVIEW_CARD_ALREADY_REVIEWED', 'skip'],
    [409, 'REVIEW_CARD_UNAVAILABLE', 'skip'],
    [409, 'REVIEW_SESSION_EXPIRED', 'expired'],
    [409, 'REVIEW_SESSION_NOT_ACTIVE', 'expired'],
    [404, null, 'expired'],
    [0, null, 'retry'],
    [500, null, 'retry'],
    [503, null, 'retry'],
    [401, null, 'unauthorized'],
    [403, null, 'unauthorized'],
    [409, 'CONFLICT', 'error'],
    [429, null, 'error'],
    [400, null, 'error'],
  ] as const)('%i %s → %s', (status, code, action) => {
    expect(gradeFailureAction(status, code)).toBe(action);
  });
});

describe('reviewCardView (Q260)', () => {
  const word = {
    id: 12,
    hanzi: '学习',
    pinyin: 'xue2 xi2',
    pinyinTone: 'xuéxí',
    example: '我每天都学习中文。',
    meanings: [
      { order: 2, vi: 'ôn luyện', en: 'to practise' },
      { order: 1, vi: 'học tập', en: 'to study' },
    ],
  };

  it('joins Vietnamese meanings in order and prefers tone pinyin', () => {
    expect(reviewCardView(word)).toEqual({
      hanzi: '学习',
      pinyin: 'xuéxí',
      meaning: 'học tập; ôn luyện',
      example: '我每天都学习中文。',
    });
  });

  it('falls back to English when no Vietnamese meaning exists', () => {
    const view = reviewCardView({
      ...word,
      pinyinTone: null,
      example: null,
      meanings: [{ order: 1, vi: null, en: 'to study' }],
    });
    expect(view).toEqual({
      hanzi: '学习',
      pinyin: 'xue2 xi2',
      meaning: 'to study',
      example: null,
    });
  });
});

describe('progressCounter and retentionText (Q260/Q263)', () => {
  it('shows reviewed + 1 over planned, capped at planned', () => {
    expect(progressCounter(0, 3)).toBe('1 / 3');
    expect(progressCounter(2, 3)).toBe('3 / 3');
    expect(progressCounter(3, 3)).toBe('3 / 3');
  });

  it('shows — when retention is null', () => {
    expect(retentionText(null)).toBe('—');
    expect(retentionText(67)).toBe('67%');
  });
});
