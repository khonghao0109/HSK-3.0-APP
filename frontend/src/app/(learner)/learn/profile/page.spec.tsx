import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { LearningHome } from '@/features/learner-home/learning-home-contract';
import { getLearningHome } from '@/features/learner-home/learning-home-service';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import LearnerProfilePage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-home/learning-home-service', () => ({
  getLearningHome: vi.fn(),
}));

const home: LearningHome = {
  nextStep: 'ready',
  greetingName: 'Minh',
  dailyGoal: null,
  streakDays: 0,
  continueLesson: null,
};

function rowValue(term: string): string | null {
  return screen.getByText(term).nextElementSibling?.textContent ?? null;
}

describe('LearnerProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      user: { id: 1, email: 'learner@example.com', role: 'user' },
      token: 'learner-token',
    });
  });

  it('sets the page title', () => {
    expect(metadata.title).toBe('Hồ sơ');
  });

  it('redirects to /sign-in without a learner session', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'unauthenticated',
      token: null,
    });
    await expect(LearnerProfilePage()).rejects.toThrow(
      'NEXT_REDIRECT:/sign-in',
    );
    expect(getLearningHome).not.toHaveBeenCalled();
  });

  it('redirects to /sign-in when the home fetch returns 401', async () => {
    vi.mocked(getLearningHome).mockRejectedValue(
      new BackendRequestError(normalizeApiFailure({ status: 401 })),
    );
    await expect(LearnerProfilePage()).rejects.toThrow(
      'NEXT_REDIRECT:/sign-in',
    );
  });

  it.each([401, 403])(
    'redirects to /sign-in when the home fetch returns %i',
    async (status) => {
      vi.mocked(getLearningHome).mockRejectedValue(
        new BackendRequestError(normalizeApiFailure({ status })),
      );
      await expect(LearnerProfilePage()).rejects.toThrow(
        'NEXT_REDIRECT:/sign-in',
      );
    },
  );

  it.each([503, 429])(
    'still renders email and sign-out when the home fetch returns %i',
    async (status) => {
      vi.mocked(getLearningHome).mockRejectedValue(
        new BackendRequestError(normalizeApiFailure({ status })),
      );
      const { container } = render(await LearnerProfilePage());
      expect(rowValue('Tên')).toBe('Không tải được tên hiển thị.');
      expect(rowValue('Email')).toBe('learner@example.com');
      expect(
        screen.getByRole('button', { name: 'Đăng xuất' }),
      ).toBeInTheDocument();
      expect(container.querySelector('[style]')).toBeNull();
    },
  );

  it('still renders email and sign-out on a network or parse error', async () => {
    vi.mocked(getLearningHome).mockRejectedValue(new TypeError('fetch failed'));
    render(await LearnerProfilePage());
    expect(rowValue('Tên')).toBe('Không tải được tên hiển thị.');
    expect(rowValue('Email')).toBe('learner@example.com');
    expect(
      screen.getByRole('button', { name: 'Đăng xuất' }),
    ).toBeInTheDocument();
  });

  it('shows the name, email and sign-out button', async () => {
    vi.mocked(getLearningHome).mockResolvedValue(home);
    render(await LearnerProfilePage());
    expect(
      screen.getByRole('heading', { level: 1, name: 'Hồ sơ' }),
    ).toBeInTheDocument();
    expect(rowValue('Tên')).toBe('Minh');
    expect(document.querySelector('[style]')).toBeNull();
    expect(rowValue('Email')).toBe('learner@example.com');
    expect(
      screen.getByRole('button', { name: 'Đăng xuất' }),
    ).toBeInTheDocument();
    expect(getLearningHome).toHaveBeenCalledWith('learner-token');
  });

  it('shows a placeholder when there is no display name', async () => {
    vi.mocked(getLearningHome).mockResolvedValue({
      ...home,
      greetingName: null,
    });
    render(await LearnerProfilePage());
    expect(rowValue('Tên')).toBe('Chưa có tên hiển thị');
  });
});
