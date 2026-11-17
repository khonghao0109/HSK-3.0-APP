import { render, screen, within } from '@testing-library/react';
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
import WordPage, { generateMetadata } from './page';

// React's cache() only memoizes inside a server-component request; outside
// one it is a passthrough. This stand-in keeps one memo per cached function,
// cleared before each test as a new request would be.
const memos = vi.hoisted(() => [] as Map<string, unknown>[]);
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const memo = new Map<string, unknown>();
      memos.push(memo);
      return (...args: A): R => {
        const key = JSON.stringify(args);
        if (!memo.has(key)) memo.set(key, fn(...args));
        return memo.get(key) as R;
      };
    },
  };
});

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
  audio: null,
  examples: [],
  related: [],
};

const examples: DictionaryWordDetail['examples'] = [
  {
    hanzi: '我在学习中文。',
    pinyin: 'Wǒ zài xuéxí Zhōngwén.',
    vi: 'Tôi đang học tiếng Trung.',
    en: 'I am learning Chinese.',
    source: { name: 'Kho câu A', version: '2.0.0' },
  },
  {
    hanzi: '他在大学学习历史。',
    pinyin: null,
    vi: null,
    en: null,
    source: { name: 'Kho câu A', version: '2.0.0' },
  },
];

const related: DictionaryWordDetail['related'] = [
  {
    id: 31,
    hanzi: '学生',
    pinyin: 'xue2 sheng5',
    pinyinTone: 'xuésheng',
    meanings: [
      { en: 'student', vi: null },
      { en: 'pupil', vi: 'học sinh' },
    ],
    level: 'HSK 1',
  },
  {
    id: 32,
    hanzi: '学期',
    pinyin: 'xue2 qi1',
    pinyinTone: null,
    meanings: [{ en: 'term', vi: null }],
    level: null,
  },
];

function exampleTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.word-ex__cn')).map(
    (el) => el.textContent ?? '',
  );
}

function backendError(status: number) {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

async function page(id: string) {
  return WordPage({ params: Promise.resolve({ id }) });
}

describe('Chi tiết từ page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const memo of memos) memo.clear();
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

  it('shows every API example sentence instead of Word.example, without pinyin or English (M3.4c)', async () => {
    vi.mocked(getWord).mockResolvedValue({ ...word, examples });
    const { container } = render(
      <LearnerToastProvider>{await page('11')}</LearnerToastProvider>,
    );
    expect(exampleTexts(container)).toEqual([
      '我在学习中文。',
      '他在大学学习历史。',
    ]);
    expect(screen.queryByText('Wǒ zài xuéxí Zhōngwén.')).toBeNull();
    expect(screen.queryByText('I am learning Chinese.')).toBeNull();
    expect(
      Array.from(container.querySelectorAll('.word-ex footer span')).map(
        (span) => span.textContent,
      ),
    ).toEqual(['Nguồn: Kho câu A · Phiên bản 2.0.0']);
  });

  it('shows the Vietnamese translation under an example when the API has one (Q315)', async () => {
    vi.mocked(getWord).mockResolvedValue({ ...word, examples });
    const { container } = render(
      <LearnerToastProvider>{await page('11')}</LearnerToastProvider>,
    );
    const items = Array.from(container.querySelectorAll('.word-ex__item'));
    expect(
      items.map(
        (item) => item.querySelector('.word-ex__vi')?.textContent ?? null,
      ),
    ).toEqual(['Tôi đang học tiếng Trung.', null]);
  });

  it('falls back to Word.example when examples is empty (Q311)', async () => {
    const { container } = render(
      <LearnerToastProvider>{await page('11')}</LearnerToastProvider>,
    );
    expect(exampleTexts(container)).toEqual(['我每天都学习中文。']);
    expect(
      Array.from(container.querySelectorAll('.word-ex footer span')).map(
        (span) => span.textContent,
      ),
    ).toEqual(['Nguồn: Từ điển Hán Lộ · Phiên bản 1.0.0']);
  });

  it('hides the example block when there is neither examples nor Word.example', async () => {
    vi.mocked(getWord).mockResolvedValue({ ...word, example: null });
    const { container } = render(
      <LearnerToastProvider>{await page('11')}</LearnerToastProvider>,
    );
    expect(container.querySelector('.word-ex')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Ví dụ' })).toBeNull();
  });

  it('lists related words as links to their own page (Q307)', async () => {
    vi.mocked(getWord).mockResolvedValue({ ...word, related });
    const { container } = render(
      <LearnerToastProvider>{await page('11')}</LearnerToastProvider>,
    );
    const block = container.querySelector('.word-rel') as HTMLElement;
    expect(block).not.toBeNull();
    expect(
      within(block).getByRole('heading', { name: 'Từ liên quan' }),
    ).toBeInTheDocument();
    const hrefs = Array.from(block.querySelectorAll('.word-rel__list a')).map(
      (a) => a.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/learn/dictionary/31', '/learn/dictionary/32']);
    const rows = Array.from(block.querySelectorAll('.word-rel__list a')).map(
      (a) => a.textContent,
    );
    // Pinyin with tone marks when present; first Vietnamese meaning (Q70) or
    // the no-Vietnamese line (Q65).
    expect(rows).toEqual([
      '学生xuésheng · học sinh',
      '学期xué qī · Chưa có nghĩa tiếng Việt',
    ]);
  });

  it('lists the API Vietnamese meanings under "Nghĩa", skipping empty ones (Q324)', async () => {
    vi.mocked(getWord).mockResolvedValue({
      ...word,
      meanings: [
        { order: 1, en: 'to learn', vi: 'học tập' },
        { order: 2, en: 'to imitate', vi: null },
        { order: 3, en: 'to study', vi: ' nghiên cứu ' },
      ],
    });
    render(<LearnerToastProvider>{await page('11')}</LearnerToastProvider>);
    const block = screen.getByRole('region', { name: 'Nghĩa' });
    expect(
      within(block)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['học tập', 'nghiên cứu']);
  });

  it('titles the page with the hanzi (C9, Q331)', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ id: '11' }),
    });
    expect(metadata.title).toBe('学习 · Chi tiết từ vựng');
  });

  it('keeps the plain title when the word cannot be read (C9)', async () => {
    vi.mocked(getWord).mockRejectedValue(backendError(404));
    expect(
      (await generateMetadata({ params: Promise.resolve({ id: '11' }) })).title,
    ).toBe('Chi tiết từ vựng');
    expect(
      (await generateMetadata({ params: Promise.resolve({ id: 'abc' }) }))
        .title,
    ).toBe('Chi tiết từ vựng');
  });

  it('reads the word and the session once per request for the title and the page (Q331)', async () => {
    await generateMetadata({ params: Promise.resolve({ id: '11' }) });
    render(<LearnerToastProvider>{await page('11')}</LearnerToastProvider>);
    expect(getWord).toHaveBeenCalledTimes(1);
    expect(getServerLearnerSession).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('学习');
  });

  it('hides the related block when related is empty', async () => {
    const { container } = render(
      <LearnerToastProvider>{await page('11')}</LearnerToastProvider>,
    );
    expect(container.querySelector('.word-rel')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Từ liên quan' })).toBeNull();
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
