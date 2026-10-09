import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { LearningHome } from '@/features/learner-home/learning-home-contract';
import { getLearningHome } from '@/features/learner-home/learning-home-service';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import type { UserGoal } from '@/features/onboarding/onboarding-contract';
import { getCurrentGoal } from '@/features/onboarding/onboarding-service';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import LearnerHomePage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-home/learning-home-service', () => ({
  getLearningHome: vi.fn(),
}));
vi.mock('@/features/onboarding/onboarding-service', () => ({
  getCurrentGoal: vi.fn(),
}));

const readyHome: LearningHome = {
  nextStep: 'ready',
  greetingName: 'Minh',
  dailyGoal: { targetMinutes: 20, minutesToday: 15 },
  streakDays: 3,
  continueLesson: null,
};

const lesson = {
  lessonId: 7,
  title: 'Chào hỏi cơ bản',
  slug: 'chao-hoi',
  levelCode: 'HSK7_9',
  position: 2,
  completionPercent: 40,
};

const goal: UserGoal = {
  id: 11,
  targetLevelId: 2,
  targetBand: 7,
  dailyMinutes: 15,
  learningPurpose: 'hsk_exam',
  reminderEnabled: false,
  reminderTime: null,
  startDate: '2026-10-01',
  isActive: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  targetLevel: {
    id: 2,
    code: 'HSK7_9',
    name: 'HSK 7-9',
    minBand: 7,
    maxBand: 9,
  },
};

function backendError(status: number) {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

async function renderHome(home: LearningHome) {
  vi.mocked(getLearningHome).mockResolvedValue(home);
  const element = await LearnerHomePage();
  return render(<LearnerToastProvider>{element}</LearnerToastProvider>);
}

describe('LearnerHomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      user: { id: 1, email: 'learner@example.com', role: 'user' },
      token: 'learner-token',
    });
  });

  it('sets the page title', () => {
    expect(metadata.title).toBe('Trang chủ');
  });

  it('redirects to /sign-in without a learner session and skips the home fetch', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'unauthenticated',
      token: null,
    });
    await expect(LearnerHomePage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(getLearningHome).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'redirects to /sign-in when the home fetch fails with %i',
    async (status) => {
      vi.mocked(getLearningHome).mockRejectedValue(backendError(status));
      await expect(LearnerHomePage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
      expect(redirect).toHaveBeenCalledWith('/sign-in');
    },
  );

  it('rethrows other backend failures', async () => {
    const failure = backendError(503);
    vi.mocked(getLearningHome).mockRejectedValue(failure);
    await expect(LearnerHomePage()).rejects.toBe(failure);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sends set_goal to /onboarding/goal without fetching the goal', async () => {
    vi.mocked(getLearningHome).mockResolvedValue({
      ...readyHome,
      nextStep: 'set_goal',
    });
    await expect(LearnerHomePage()).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/goal',
    );
    expect(redirect).toHaveBeenCalledWith('/onboarding/goal');
    expect(getCurrentGoal).not.toHaveBeenCalled();
  });

  it('sends content_unavailable to the goal notice without fetching the goal', async () => {
    vi.mocked(getLearningHome).mockResolvedValue({
      ...readyHome,
      nextStep: 'content_unavailable',
    });
    await expect(LearnerHomePage()).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/goal?notice=content_unavailable',
    );
    expect(getCurrentGoal).not.toHaveBeenCalled();
  });

  it('sends generate_plan to the plan step using the current goal', async () => {
    vi.mocked(getLearningHome).mockResolvedValue({
      ...readyHome,
      nextStep: 'generate_plan',
    });
    vi.mocked(getCurrentGoal).mockResolvedValue(goal);
    await expect(LearnerHomePage()).rejects.toThrow(
      'NEXT_REDIRECT:/onboarding/plan?purpose=hsk_exam&band=7',
    );
    expect(getCurrentGoal).toHaveBeenCalledTimes(1);
    expect(getCurrentGoal).toHaveBeenCalledWith('learner-token');
  });

  it('renders the greeting, gauge and streak when ready', async () => {
    const { container } = await renderHome(readyHome);
    expect(getServerLearnerSession).toHaveBeenCalledTimes(1);
    expect(getLearningHome).toHaveBeenCalledTimes(1);
    expect(getLearningHome).toHaveBeenCalledWith('learner-token');
    expect(redirect).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Chào, Minh' }),
    ).toBeInTheDocument();

    const goalStat = screen.getByRole('region', { name: 'Mục tiêu hôm nay' });
    expect(goalStat.querySelector('.sr-only')?.textContent).toBe(
      '15 trên 20 phút',
    );
    const gauge = goalStat.querySelector('.home-gauge');
    expect(gauge).toHaveClass('pct-75');
    expect(gauge).toHaveAttribute('aria-hidden', 'true');
    expect(gauge?.querySelector('b')?.textContent).toBe('15/20');
    const streakStat = screen.getByRole('region', { name: 'Chuỗi ngày học' });
    expect(streakStat.querySelector('.sr-only')?.textContent).toBe('3 ngày');
    expect(streakStat.querySelector('.home-streak b')?.textContent).toBe('3');
    expect(streakStat.querySelector('.home-streak')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    expect(screen.queryByText('Tiếp tục học')).not.toBeInTheDocument();
    expect(container.querySelector('.home-lesson')).toBeNull();
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('falls back to a generic greeting and an empty gauge', async () => {
    const { container } = await renderHome({
      ...readyHome,
      greetingName: null,
      dailyGoal: null,
    });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Chào bạn' }),
    ).toBeInTheDocument();
    const gauge = container.querySelector('.home-gauge');
    expect(gauge).toHaveClass('pct-0');
    expect(gauge?.querySelector('b')?.textContent).toBe('—');
    expect(
      screen
        .getByRole('region', { name: 'Mục tiêu hôm nay' })
        .querySelector('.sr-only')?.textContent,
    ).toBe('Chưa có mục tiêu');
  });

  it('shows the real minutes past the goal while capping the gauge at 100%', async () => {
    const { container } = await renderHome({
      ...readyHome,
      dailyGoal: { targetMinutes: 20, minutesToday: 25 },
    });
    const gauge = container.querySelector('.home-gauge');
    expect(gauge).toHaveClass('pct-100');
    expect(gauge?.querySelector('b')?.textContent).toBe('25/20');
    expect(screen.getByText('25 trên 20 phút')).toHaveClass('sr-only');
  });

  it('shows the streak unit "ngày" and only the two stat cards, no XP', async () => {
    const { container } = await renderHome(readyHome);
    expect(container.querySelector('.home-streak span')?.textContent).toBe(
      'ngày',
    );
    expect(container.querySelectorAll('.home-stat')).toHaveLength(2);
    expect(container.textContent).not.toContain('XP');
  });

  it('renders the continue lesson card and toasts on click', async () => {
    const { container } = await renderHome({
      ...readyHome,
      continueLesson: lesson,
    });
    expect(
      screen.getByRole('heading', { level: 2, name: 'Tiếp tục học' }),
    ).toBeInTheDocument();
    const card = container.querySelector('.home-lesson');
    if (!(card instanceof HTMLElement)) throw new Error('missing lesson card');
    expect(card.querySelector('.home-lesson__title')?.textContent).toBe(
      'Chào hỏi cơ bản',
    );
    expect(card.querySelector('.home-lesson__meta')?.textContent).toBe(
      'HSK 7–9 • Bài 2',
    );
    expect(within(card).queryAllByRole('heading')).toHaveLength(0);
    expect(card.querySelector('h1, h2, h3, h4, h5, h6, p, div')).toBeNull();
    expect(card).toHaveTextContent('40%');
    expect(card.querySelector('.progress > span')).toHaveClass('pct-40');
    expect(container.querySelector('[style]')).toBeNull();

    fireEvent.click(card);
    expect(screen.getByText('Tính năng sắp ra mắt.')).toHaveClass('toast');
  });

  it('lists the eight explore shortcuts in order', async () => {
    await renderHome(readyHome);
    const list = screen.getByRole('list', { name: 'Khám phá' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      'Thi thử',
      'Phát âm',
      'Đọc hiểu',
      'Tài liệu',
      'Trợ lý AI',
      'Hội thoại',
      'Nhận diện chữ',
      'Hỗ trợ',
    ]);

    fireEvent.click(within(list).getByRole('button', { name: 'Đọc hiểu' }));
    expect(screen.getByText('Tính năng sắp ra mắt.')).toHaveClass('toast');
  });

  it('toasts from the bell and links the avatar to the profile', async () => {
    await renderHome(readyHome);
    fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }));
    expect(
      screen.getByText('Thông báo sẽ có khi tính năng ra mắt.'),
    ).toHaveClass('toast');
    expect(screen.getByRole('link', { name: 'Hồ sơ' })).toHaveAttribute(
      'href',
      '/learn/profile',
    );
  });
});
