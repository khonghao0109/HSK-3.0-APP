import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { LearningHome } from '@/features/learner-home/learning-home-contract';
import { getLearningHome } from '@/features/learner-home/learning-home-service';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import { getOptionalConsents } from '@/features/legal/legal-documents-service';

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
vi.mock('@/features/legal/legal-documents-service', () => ({
  getOptionalConsents: vi.fn(),
}));
// Its own behaviour is proven in privacy-rights-panel.spec.tsx.
vi.mock('@/features/privacy/privacy-rights-panel', () => ({
  PrivacyRightsPanel: ({ variant }: { variant?: string }) => (
    <div data-testid="privacy-rights-panel" data-variant={variant} />
  ),
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
    vi.mocked(getOptionalConsents).mockResolvedValue({
      analytics: false,
      marketing: false,
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
      const { container } = render(
        <LearnerToastProvider>
          {await LearnerProfilePage()}
        </LearnerToastProvider>,
      );
      expect(rowValue('Tên')).toBe('Không tải được tên hiển thị.');
      expect(rowValue('Email')).toBe('learner@example.com');
      expect(
        screen.getByRole('button', { name: 'Đăng xuất' }),
      ).toBeInTheDocument();
      expect(container.querySelector('[style]')).toBeNull();
      expect(container.querySelector('.w-chip')).toBeNull();
    },
  );

  it('still renders email and sign-out on a network or parse error', async () => {
    vi.mocked(getLearningHome).mockRejectedValue(new TypeError('fetch failed'));
    render(
      <LearnerToastProvider>{await LearnerProfilePage()}</LearnerToastProvider>,
    );
    expect(rowValue('Tên')).toBe('Không tải được tên hiển thị.');
    expect(rowValue('Email')).toBe('learner@example.com');
    expect(
      screen.getByRole('button', { name: 'Đăng xuất' }),
    ).toBeInTheDocument();
  });

  it('shows the name, email and sign-out button', async () => {
    vi.mocked(getLearningHome).mockResolvedValue(home);
    render(
      <LearnerToastProvider>{await LearnerProfilePage()}</LearnerToastProvider>,
    );
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
    // Streak chip of the web top bar from the same /learning/home (Q83).
    expect(document.querySelector('.w-top .w-chip')).toHaveTextContent(
      'Chuỗi ngày học: 0 ngày',
    );
  });

  it('shows a placeholder when there is no display name', async () => {
    vi.mocked(getLearningHome).mockResolvedValue({
      ...home,
      greetingName: null,
    });
    render(
      <LearnerToastProvider>{await LearnerProfilePage()}</LearnerToastProvider>,
    );
    expect(rowValue('Tên')).toBe('Chưa có tên hiển thị');
  });

  it('has a "Quyền riêng tư & dữ liệu" section with the saved optional consents and the data rights (M1.7b2 B3)', async () => {
    vi.mocked(getLearningHome).mockResolvedValue(home);
    vi.mocked(getOptionalConsents).mockResolvedValue({
      analytics: true,
      marketing: false,
    });
    render(
      <LearnerToastProvider>{await LearnerProfilePage()}</LearnerToastProvider>,
    );
    const section = screen.getByRole('region', {
      name: 'Quyền riêng tư & dữ liệu',
    });
    expect(getOptionalConsents).toHaveBeenCalledWith('learner-token');
    expect(
      within(section).getByRole('switch', { name: 'Phân tích sản phẩm' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      within(section).getByRole('switch', { name: 'Tin tức và ưu đãi' }),
    ).toHaveAttribute('aria-checked', 'false');
    expect(
      within(section).getByRole('link', { name: /Quyền riêng tư/ }),
    ).toHaveAttribute('href', '/privacy');
    expect(
      within(section).getByRole('link', { name: /Điều khoản sử dụng/ }),
    ).toHaveAttribute('href', '/terms');
    expect(within(section).getByTestId('privacy-rights-panel')).toHaveAttribute(
      'data-variant',
      'profile',
    );
    expect(screen.getAllByRole('button', { name: 'Đăng xuất' })).toHaveLength(
      1,
    );
  });

  it('says the optional consents could not be read instead of guessing them', async () => {
    vi.mocked(getLearningHome).mockResolvedValue(home);
    vi.mocked(getOptionalConsents).mockRejectedValue(
      new BackendRequestError(normalizeApiFailure({ status: 503 })),
    );
    render(
      <LearnerToastProvider>{await LearnerProfilePage()}</LearnerToastProvider>,
    );
    expect(screen.queryByRole('switch')).toBeNull();
    expect(
      screen.getByText(
        'Chưa tải được lựa chọn của bạn. Tải lại trang để thử lại.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('privacy-rights-panel')).toBeInTheDocument();
  });

  it('redirects to /sign-in when reading the consents returns 401', async () => {
    vi.mocked(getLearningHome).mockResolvedValue(home);
    vi.mocked(getOptionalConsents).mockRejectedValue(
      new BackendRequestError(normalizeApiFailure({ status: 401 })),
    );
    await expect(LearnerProfilePage()).rejects.toThrow(
      'NEXT_REDIRECT:/sign-in',
    );
  });
});
