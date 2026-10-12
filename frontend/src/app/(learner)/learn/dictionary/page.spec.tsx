import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redirect, useSearchParams } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { searchWords } from '@/features/learner-dictionary/dictionary-service';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import DictionaryPage, { metadata } from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-dictionary/dictionary-service', () => ({
  searchWords: vi.fn(),
}));

const learner = {
  state: 'learner' as const,
  user: { id: 1, email: 'a@b.c', role: 'user' as const },
  token: 'learner-token',
};

function backendError(status: number) {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

async function page(q?: string | string[]) {
  return DictionaryPage({
    searchParams: Promise.resolve(q === undefined ? {} : { q }),
  });
}

describe('Tra từ page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue(learner as never);
  });

  it('is titled Từ điển', () => {
    expect(metadata.title).toBe('Từ điển');
  });

  it('sends a visitor without a learner session to sign-in', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'unauthenticated',
      token: null,
    });
    await expect(page()).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(searchWords).not.toHaveBeenCalled();
  });

  it('opens empty without searching', async () => {
    render(<LearnerToastProvider>{await page()}</LearnerToastProvider>);
    expect(searchWords).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Nhập từ cần tra',
    );
  });

  it.each([['   '], ['a'.repeat(65)], [['a', 'b']]])(
    'treats an invalid q (%j) as empty',
    async (q) => {
      await page(q);
      expect(searchWords).not.toHaveBeenCalled();
    },
  );

  it('searches a trimmed ?q= on the server with the learner token', async () => {
    vi.mocked(searchWords).mockResolvedValue([]);
    await page(' 学习 ');
    expect(searchWords).toHaveBeenCalledWith('learner-token', '学习');
  });

  it('redirects to sign-in when the search answers 401', async () => {
    vi.mocked(searchWords).mockRejectedValue(backendError(401));
    await expect(page('学习')).rejects.toThrow('NEXT_REDIRECT:/sign-in');
    expect(redirect).toHaveBeenCalledWith('/sign-in');
  });

  it('renders the retry state when the search fails otherwise', async () => {
    vi.mocked(searchWords).mockRejectedValue(backendError(503));
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams([['q', '学习']]) as never,
    );
    render(<LearnerToastProvider>{await page('学习')}</LearnerToastProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Không tra được lúc này',
    );
  });
});
