import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';

import ReviewSessionPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));

describe('Ôn tập session page (M3.3a, Q258)', () => {
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
    await expect(ReviewSessionPage()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });

  it('renders the review island in its loading state for a learner', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'learner',
      user: { id: 1, email: 'a@b.c', role: 'user' },
      token: 'learner-token',
    } as never);
    render(await ReviewSessionPage());
    expect(
      screen.getByRole('heading', { level: 1, name: 'Ôn tập' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải phiên ôn…');
    expect(fetch).toHaveBeenCalledWith(
      '/api/learner/review/sessions/current',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
});
