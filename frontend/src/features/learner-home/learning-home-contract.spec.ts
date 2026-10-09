import { describe, expect, it } from 'vitest';

import {
  backendLearningHomeSchema,
  dailyGoalPercent,
  learningHomeSchema,
  levelLabel,
  percentClass,
  type LearningHome,
} from './learning-home-contract';

const home: LearningHome = {
  nextStep: 'ready',
  greetingName: 'Minh',
  dailyGoal: { targetMinutes: 20, minutesToday: 15 },
  streakDays: 3,
  continueLesson: {
    lessonId: 7,
    title: 'Chào hỏi',
    slug: 'chao-hoi',
    levelCode: 'HSK7_9',
    position: 2,
    completionPercent: 40,
  },
};

const meta = { requestId: 'req-1', timestamp: '2026-10-09T00:00:00.000Z' };

describe('learning home contract', () => {
  it('parses a full backend envelope and drops meta', () => {
    const parsed = backendLearningHomeSchema.parse({
      success: true,
      data: home,
      meta,
    });
    expect(parsed).toEqual({ success: true, data: home });
    expect(Object.keys(parsed)).toEqual(['success', 'data']);
  });

  it('accepts null greetingName, dailyGoal and continueLesson', () => {
    const nulls = {
      ...home,
      greetingName: null,
      dailyGoal: null,
      continueLesson: null,
    };
    expect(learningHomeSchema.parse(nulls)).toEqual(nulls);
  });

  it('rejects an unknown nextStep', () => {
    expect(
      learningHomeSchema.safeParse({ ...home, nextStep: 'dashboard' }).success,
    ).toBe(false);
  });

  it('accepts any string levelCode', () => {
    const parsed = learningHomeSchema.parse(home);
    expect(parsed.continueLesson?.levelCode).toBe('HSK7_9');
  });

  it('formats level labels with an en dash for ranges', () => {
    expect(levelLabel('HSK1')).toBe('HSK 1');
    expect(levelLabel('HSK6')).toBe('HSK 6');
    expect(levelLabel('HSK7_9')).toBe('HSK 7–9');
  });

  it('computes the daily goal percent and its class', () => {
    const zero = dailyGoalPercent({ targetMinutes: 20, minutesToday: 0 });
    expect(zero).toBe(0);
    expect(percentClass(zero)).toBe('pct-0');

    const partial = dailyGoalPercent({ targetMinutes: 20, minutesToday: 15 });
    expect(partial).toBe(75);
    expect(percentClass(partial)).toBe('pct-75');

    const over = dailyGoalPercent({ targetMinutes: 20, minutesToday: 25 });
    expect(over).toBe(100);
    expect(percentClass(over)).toBe('pct-100');
  });

  it('returns 0 for a missing goal or a zero target', () => {
    expect(dailyGoalPercent(null)).toBe(0);
    expect(dailyGoalPercent({ targetMinutes: 0, minutesToday: 10 })).toBe(0);
  });
});
