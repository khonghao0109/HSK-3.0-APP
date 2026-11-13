import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

import ReviewPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/learn/review',
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));

describe('Ôn tập page (M3.3b, Q270)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
  });

  it('is titled Ôn tập', () => {
    expect(metadata.title).toBe('Ôn tập');
  });

  it('sends a visitor without a learner session to sign-in', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'unauthenticated',
      token: null,
    });
    await expect(ReviewPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });

  it('loads the overview through the BFF for a learner', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      user: { id: 1, email: 'a@b.c', role: 'user' },
      token: 'learner-token',
    } as never);
    render(<LearnerToastProvider>{await ReviewPage()}</LearnerToastProvider>);
    expect(screen.getByText('Đang tải lịch ôn tập…')).toHaveAttribute(
      'role',
      'status',
    );
    expect(fetch).toHaveBeenCalledWith(
      '/api/learner/review/overview',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});
