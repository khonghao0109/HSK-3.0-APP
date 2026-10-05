import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type {
  LevelItem,
  UserGoal,
} from '@/features/onboarding/onboarding-contract';
import { OnboardingGoalForm } from '@/features/onboarding/onboarding-goal-form';
import {
  getCurrentGoal,
  getPublicLevels,
} from '@/features/onboarding/onboarding-service';

import OnboardingGoalPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getCurrentGoal: vi.fn(),
  getPublicLevels: vi.fn(),
}));

const levels: LevelItem[] = [
  { id: 2, name: 'HSK 2', orderIndex: 2, code: 'HSK2', minBand: 2, maxBand: 2 },
];

const existingGoal: UserGoal = {
  id: 11,
  targetLevelId: 2,
  targetBand: 2,
  dailyMinutes: 15,
  learningPurpose: 'hsk_exam',
  reminderEnabled: false,
  reminderTime: null,
  startDate: '2026-10-01',
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  targetLevel: { id: 2, code: 'HSK2', name: 'HSK 2', minBand: 2, maxBand: 2 },
};

async function renderPage(params: Record<string, string>) {
  const element = await OnboardingGoalPage({
    searchParams: Promise.resolve(params),
  });
  if (!isValidElement<Parameters<typeof OnboardingGoalForm>[0]>(element)) {
    throw new Error('page did not return an element');
  }
  expect(element.type).toBe(OnboardingGoalForm);
  return element.props;
}

describe('OnboardingGoalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      user: { id: 1, email: 'learner@example.com', role: 'user' },
      token: 'learner-token',
    });
    vi.mocked(getPublicLevels).mockResolvedValue(levels);
  });

  it('fetches the current goal even when the URL has purpose and band, and lets the URL win for prefill', async () => {
    vi.mocked(getCurrentGoal).mockResolvedValue(existingGoal);

    const props = await renderPage({ purpose: 'work', band: '7' });

    expect(getCurrentGoal).toHaveBeenCalledOnce();
    expect(getCurrentGoal).toHaveBeenCalledWith('learner-token');
    expect(getPublicLevels).toHaveBeenCalledOnce();
    expect(getPublicLevels).toHaveBeenCalledWith('learner-token');
    expect(props.initialPurpose).toBe('work');
    expect(props.initialBand).toBe(7);
    expect(props.hasGoal).toBe(true);
    expect(props.levels).toEqual(levels);
  });

  it('reports hasGoal false when the learner has no current goal, even with URL params', async () => {
    vi.mocked(getCurrentGoal).mockResolvedValue(null);

    const props = await renderPage({ purpose: 'work', band: '7' });

    expect(getCurrentGoal).toHaveBeenCalledOnce();
    expect(props.initialPurpose).toBe('work');
    expect(props.initialBand).toBe(7);
    expect(props.hasGoal).toBe(false);
  });

  it('prefills from the current goal when the URL has no purpose or band', async () => {
    vi.mocked(getCurrentGoal).mockResolvedValue(existingGoal);

    const props = await renderPage({});

    expect(props.initialPurpose).toBe('hsk_exam');
    expect(props.initialBand).toBe(2);
    expect(props.hasGoal).toBe(true);
  });
});
