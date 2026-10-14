import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { LearningPath } from '@/features/learner-path/learning-path-contract';
import { getLearningPath } from '@/features/learner-path/learning-path-service';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import { getCurrentGoal } from '@/features/onboarding/onboarding-service';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import LearnerPathPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-path/learning-path-service', () => ({
  getLearningPath: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getCurrentGoal: vi.fn(),
}));

const readyPath: LearningPath = {
  nextStep: 'ready',
  goal: { targetLevelCode: 'HSK3', targetBand: 3, learningPurpose: 'work' },
  levels: [
    {
      id: 3,
      code: 'HSK3',
      name: 'HSK 3',
      orderIndex: 3,
      lessonCount: 8,
      completedCount: 0,
      lessons: [
        {
          id: 31,
          title: 'Gia đình',
          slug: 'gia-dinh',
          position: 1,
          state: 'current',
          completionPercent: 10,
        },
      ],
    },
  ],
  nextLesson: {
    lessonId: 31,
    title: 'Gia đình',
    slug: 'gia-dinh',
    levelCode: 'HSK3',
    position: 1,
  },
};

function backendError(status: number) {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

async function renderPath(path: LearningPath) {
  vi.mocked(getLearningPath).mockResolvedValue(path);
  const element = await LearnerPathPage();
  return render(<LearnerToastProvider>{element}</LearnerToastProvider>);
}

describe('LearnerPathPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      user: { id: 1, email: 'learner@example.com', role: 'user' },
      token: 'learner-token',
    });
  });

  it('sets the page title', () => {
    expect(metadata.title).toBe('Lộ trình học');
  });

  it('redirects to /sign-in without a learner session and skips the path fetch', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'unauthenticated',
      token: null,
    });
    await expect(LearnerPathPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(getLearningPath).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'redirects to /sign-in when the path fetch fails with %i',
    async (status) => {
      vi.mocked(getLearningPath).mockRejectedValue(backendError(status));
      await expect(LearnerPathPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
      expect(redirect).toHaveBeenCalledWith('/sign-in');
    },
  );

  it('rethrows other backend failures', async () => {
    const failure = backendError(503);
    vi.mocked(getLearningPath).mockRejectedValue(failure);
    await expect(LearnerPathPage()).rejects.toBe(failure);
    expect(redirect).not.toHaveBeenCalled();
  });

  it.each([
    ['set_goal', '/onboarding/goal'],
    ['content_unavailable', '/onboarding/goal?notice=content_unavailable'],
  ] as const)('sends %s to %s', async (nextStep, url) => {
    vi.mocked(getLearningPath).mockResolvedValue({
      ...readyPath,
      nextStep,
      goal: null,
    });
    await expect(LearnerPathPage()).rejects.toThrow(`NEXT_REDIRECT:${url}`);
    expect(redirect).toHaveBeenCalledWith(url);
    expect(getCurrentGoal).not.toHaveBeenCalled();
  });

  it('sends generate_plan to the plan step using the path goal', async () => {
    vi.mocked(getLearningPath).mockResolvedValue({
      ...readyPath,
      nextStep: 'generate_plan',
      goal: { learningPurpose: 'work', targetBand: 3, targetLevelCode: 'HSK3' },
    });
    await expect(LearnerPathPage()).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/plan?purpose=work&band=3',
    );
    expect(redirect).toHaveBeenCalledWith(
      '/onboarding/plan?purpose=work&band=3',
    );
    expect(getCurrentGoal).not.toHaveBeenCalled();
  });

  it('sends generate_plan without a purpose back to the goal step', async () => {
    vi.mocked(getLearningPath).mockResolvedValue({
      ...readyPath,
      nextStep: 'generate_plan',
      goal: { learningPurpose: null, targetBand: 3, targetLevelCode: 'HSK3' },
    });
    await expect(LearnerPathPage()).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/goal?band=3',
    );
    expect(getCurrentGoal).not.toHaveBeenCalled();
  });

  it('renders the ready path with the goal level selected', async () => {
    const { container } = await renderPath(readyPath);
    const logo = screen.getByRole('link', { name: 'Hán Lộ' });
    expect(logo).toHaveAttribute('href', '/learn');
    expect(screen.queryByText(/XP/u)).toBeNull();
    expect(screen.getByRole('tab', { name: 'HSK 3' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Lộ trình HSK 3' }),
    ).toBeInTheDocument();
    expect(container.querySelector('[style]')).toBeNull();
    expect(getServerLearnerSession).toHaveBeenCalledTimes(1);
    expect(getLearningPath).toHaveBeenCalledTimes(1);
    expect(getLearningPath).toHaveBeenCalledWith('learner-token');
    expect(getCurrentGoal).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('renders the next lesson card with a start link to the lesson', async () => {
    const { container } = await renderPath(readyPath);
    // M2.10d F4: two copies share the card — the early `.path-mid` (shown at
    // 1024–1279px, where the card sits above the grid) and the late
    // `.path-next` (mobile bar and ≥ 1280px aside); CSS shows exactly one per
    // viewport, so the Tab order matches the visual order everywhere.
    const asides = screen.getAllByRole('complementary', {
      name: 'Bài tiếp theo',
    });
    expect(asides.map((aside) => aside.className)).toEqual([
      'path-mid',
      'path-next',
    ]);
    for (const aside of asides) {
      expect(aside.tagName).toBe('ASIDE');
      const cls = aside.className;
      expect(aside.querySelector(`p.${cls}__title`)?.textContent).toBe(
        'Gia đình',
      );
      const button = aside.querySelector(`a.${cls}__btn`);
      if (!(button instanceof HTMLAnchorElement)) {
        throw new Error('missing start link');
      }
      expect(button.textContent?.startsWith('Bắt đầu')).toBe(true);
      expect(button.querySelector('.sr-only')?.textContent).toBe(
        ' bài Gia đình',
      );
      expect(button).toHaveAttribute(
        'href',
        `/learn/lessons/${readyPath.nextLesson?.lessonId}`,
      );
    }
    // The early copy sits after the tabs, right above the lesson panel where
    // the eye sees it at 1024–1279px; the late copy follows `main`, so the
    // DOM order equals the visual order at every viewport.
    const main = container.querySelector('main.path-body');
    expect(main?.children[1]).toBe(asides[0]);
    expect(main?.querySelector('.path-panel')?.previousElementSibling).toBe(
      asides[0],
    );
    expect(main?.nextElementSibling).toBe(asides[1]);
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('omits the next lesson card when nextLesson is null', async () => {
    const { container } = await renderPath({ ...readyPath, nextLesson: null });
    expect(container.querySelector('aside')).toBeNull();
    expect(
      screen.queryByRole('complementary', { name: 'Bài tiếp theo' }),
    ).toBeNull();
  });
});
