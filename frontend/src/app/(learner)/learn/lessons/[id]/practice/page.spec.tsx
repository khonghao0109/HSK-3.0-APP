import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { getLessonPlayerActivity } from '@/features/learner-lesson/lesson-activity-service';
import type { LessonPlayerActivity } from '@/features/learner-lesson/lesson-player-contract';
import { getOnboardingStatus } from '@/features/onboarding/onboarding-service';
import type { OnboardingStatus } from '@/features/onboarding/onboarding-contract';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import LessonPracticePage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-lesson/lesson-activity-service', () => ({
  getLessonActivity: vi.fn(),
  getLessonPlayerActivity: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getOnboardingStatus: vi.fn(),
  getCurrentGoal: vi.fn(),
}));

function exercise(
  id: number,
  orderIndex: number,
  latestAttempt: { attemptId: number } | null = null,
) {
  return {
    id,
    type: 'mcq',
    prompt: `Câu ${id}`,
    content: {
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
    },
    orderIndex,
    latestAttempt,
  };
}

const activity: LessonPlayerActivity = {
  lesson: { id: 5, title: 'Chào hỏi' },
  state: 'current',
  progress: { status: 'learning' },
  topics: [
    {
      id: 1,
      orderIndex: 1,
      progress: { status: 'learning' },
      exercises: [exercise(11, 1, { attemptId: 1 }), exercise(12, 2)],
    },
  ],
  standaloneExercises: [exercise(13, 1)],
};

function status(): OnboardingStatus {
  return {
    hasActiveGoal: true,
    hasActiveLearningPlan: true,
    hasUsableLearningPlan: true,
    hasCompletedPlacement: false,
    nextStep: 'ready',
  };
}

function page(id: string) {
  return LessonPracticePage({ params: Promise.resolve({ id }) });
}

describe('LessonPracticePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      user: { id: 1, email: 'learner@example.com', role: 'user' },
      token: 'learner-token',
    });
    vi.mocked(getOnboardingStatus).mockResolvedValue(status());
  });

  it('sets the page title', () => {
    expect(metadata.title).toBe('Luyện tập');
  });

  it('opens at the first exercise without an attempt', async () => {
    vi.mocked(getLessonPlayerActivity).mockResolvedValue(activity);
    const { container } = render(await page('5'));
    expect(getLessonPlayerActivity).toHaveBeenCalledWith('learner-token', 5);
    expect(container.querySelector('.m02-bar__count')?.textContent).toBe('2/3');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Câu 12' }),
    ).toBeInTheDocument();
  });

  it('sends a locked lesson back to the lesson page (Q44)', async () => {
    vi.mocked(getLessonPlayerActivity).mockResolvedValue({
      ...activity,
      state: 'locked',
    });
    await expect(page('5')).rejects.toThrow('NEXT_REDIRECT:/learn/lessons/5');
  });

  it.each(['abc', '0', '99999999999'])(
    'calls notFound for id %s before reading the session',
    async (id) => {
      await expect(page(id)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(getServerLearnerSession).not.toHaveBeenCalled();
    },
  );

  it('calls notFound when the backend has no ready lesson (Q41)', async () => {
    vi.mocked(getLessonPlayerActivity).mockRejectedValue(
      new BackendRequestError(normalizeApiFailure({ status: 404 })),
    );
    await expect(page('5')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('redirects to /sign-in without a learner session', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'unauthenticated',
      token: null,
    });
    await expect(page('5')).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(getLessonPlayerActivity).not.toHaveBeenCalled();
  });
});
