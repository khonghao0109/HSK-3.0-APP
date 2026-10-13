import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import type { DictionaryWordDetail } from '@/features/learner-dictionary/dictionary-contract';
import {
  getSaved,
  getWord,
} from '@/features/learner-dictionary/dictionary-service';
import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';
import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';

import WordNotFound from './not-found';
import WordPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/features/learner-auth/server-learner-session', () => ({
  getServerLearnerSession: vi.fn(),
}));
vi.mock('@/features/learner-dictionary/dictionary-service', () => ({
  getWord: vi.fn(),
  getSaved: vi.fn(),
}));

const learner = {
  state: 'learner' as const,
  user: { id: 1, email: 'a@b.c', role: 'user' as const },
  token: 'learner-token',
};

const word: DictionaryWordDetail = {
  id: 11,
  hanzi: '学习',
  traditional: '學習',
  pinyin: 'xue2 xi2',
  pinyinTone: 'xuéxí',
  example: '我每天都学习中文。',
  meanings: [
    { order: 1, en: 'to learn', vi: 'học tập' },
    { order: 2, en: 'to study', vi: 'nghiên cứu' },
  ],
  levels: [{ code: 'HSK1', name: 'HSK 1' }],
  sources: [{ name: 'Từ điển Hán Lộ', version: '1.0.0' }],
};

function backendError(status: number) {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

async function page(id: string) {
  return WordPage({ params: Promise.resolve({ id }) });
}

describe('Chi tiết từ page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerLearnerSession).mockResolvedValue(learner as never);
    vi.mocked(getWord).mockResolvedValue(word);
    vi.mocked(getSaved).mockResolvedValue(true);
  });

  it.each(['abc', '0', '-1', '012', '2147483648'])(
    'is not found for id %s before any session or backend call',
    async (id) => {
      await expect(page(id)).rejects.toThrow('NEXT_NOT_FOUND');
      expect(getServerLearnerSession).not.toHaveBeenCalled();
      expect(getWord).not.toHaveBeenCalled();
    },
  );

  it('sends a visitor without a learner session to sign-in', async () => {
    vi.mocked(getServerLearnerSession).mockResolvedValue({
      state: 'unauthenticated',
      token: null,
    });
    await expect(page('11')).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });

  it('is not found when the backend answers 404 (missing or draft word)', async () => {
    vi.mocked(getWord).mockRejectedValue(backendError(404));
    vi.mocked(getSaved).mockRejectedValue(backendError(404));
    await expect(page('11')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('redirects to sign-in on 401', async () => {
    vi.mocked(getWord).mockRejectedValue(backendError(401));
    await expect(page('11')).rejects.toThrow('NEXT_REDIRECT:/sign-in');
  });

  it('rethrows other backend failures to the error boundary', async () => {
    vi.mocked(getSaved).mockRejectedValue(backendError(503));
    await expect(page('11')).rejects.toBeInstanceOf(BackendRequestError);
  });

  it('renders the word with every Vietnamese meaning and the saved state', async () => {
    render(<LearnerToastProvider>{await page('11')}</LearnerToastProvider>);
    expect(getWord).toHaveBeenCalledWith('learner-token', 11);
    expect(getSaved).toHaveBeenCalledWith('learner-token', 11);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('学习');
    expect(screen.getByText('xuéxí')).toHaveClass('word__py');
    expect(screen.getByText('học tập; nghiên cứu')).toHaveClass('word__vi');
    expect(screen.getByRole('button', { name: 'Đã lưu' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('group', { name: 'Kiểu chữ' })).toBeInTheDocument();
  });

  it('hides the script switch when the traditional form is the same (Q68)', async () => {
    vi.mocked(getWord).mockResolvedValue({
      ...word,
      hanzi: '你好',
      traditional: '你好',
    });
    render(<LearnerToastProvider>{await page('11')}</LearnerToastProvider>);
    expect(screen.queryByRole('group', { name: 'Kiểu chữ' })).toBeNull();
  });

  it('not-found page links back to Tra từ', () => {
    render(
      <LearnerToastProvider>
        <WordNotFound />
      </LearnerToastProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Không tìm thấy từ',
    );
    expect(
      screen.getByText('Từ này không có trong từ điển hoặc chưa được công bố.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về Tra từ' })).toHaveAttribute(
      'href',
      '/learn/dictionary',
    );
    expect(
      screen.getByRole('link', { name: 'Quay lại Tra từ' }),
    ).toHaveAttribute('href', '/learn/dictionary');
  });
});
