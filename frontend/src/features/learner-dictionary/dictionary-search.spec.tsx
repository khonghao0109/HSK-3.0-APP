import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRouter, useSearchParams } from 'next/navigation';

import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

import type { DictionarySearchItem } from './dictionary-contract';
import { DictionarySearch, SEARCH_DEBOUNCE_MS } from './dictionary-search';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}));

const push = vi.fn();
const replace = vi.fn();

function word(
  id: number,
  hanzi: string,
  meanings: DictionarySearchItem['meanings'],
  level: string | null = 'HSK 1',
): DictionarySearchItem {
  return {
    id,
    hanzi,
    pinyin: 'xue2 xi2',
    pinyinTone: 'xuéxí',
    meanings,
    level,
  };
}

const xuexi = word(11, '学习', [
  { en: 'to learn', vi: 'học tập' },
  { en: 'to study', vi: 'nghiên cứu' },
]);
const learner = word(
  12,
  '学习者',
  [{ en: 'learner', vi: 'người học' }],
  'HSK 2',
);
const materials = word(
  13,
  '学习资料',
  [{ en: 'study materials', vi: null }],
  null,
);

function urlQuery(q: string | null) {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(q === null ? [] : [['q', q]]) as never,
  );
}

function renderSearch(
  initialQuery = '',
  initialItems: DictionarySearchItem[] | null = null,
) {
  urlQuery(initialQuery || null);
  return render(
    <LearnerToastProvider>
      <DictionarySearch
        initialQuery={initialQuery}
        initialItems={initialItems}
      />
    </LearnerToastProvider>,
  );
}

function input(): HTMLInputElement {
  return screen.getByRole('searchbox', {
    name: 'Tra từ: chữ Hán, pinyin hoặc nghĩa tiếng Việt',
  });
}

function ok(items: DictionarySearchItem[]): Response {
  return Response.json({ success: true, data: items });
}

/**
 * A fetch whose responses the test resolves by hand, in any order. With
 * `rejectOnAbort: false` an aborted request can still answer late, as when
 * the response was already on its way.
 */
function deferredFetch({ rejectOnAbort = true } = {}) {
  const calls: Array<{
    url: string;
    signal: AbortSignal;
    resolve: (response: Response) => void;
  }> = [];
  const fetchMock = vi.fn(
    (url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init.signal as AbortSignal;
        if (rejectOnAbort) {
          signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }
        calls.push({ url, signal, resolve });
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function type(value: string) {
  fireEvent.change(input(), { target: { value } });
}

async function settle(ms = SEARCH_DEBOUNCE_MS) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
}

function rows() {
  return Array.from(document.querySelectorAll('.dict-item'));
}

describe('DictionarySearch', () => {
  let replaceState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(useRouter).mockReturnValue({ push, replace } as never);
    replaceState = vi.spyOn(window.history, 'replaceState');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    replaceState.mockRestore();
  });

  it('opens empty: count, hint, no clear button, no speaker (Q66)', () => {
    const { container } = renderSearch();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Từ điển',
    );
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Nhập từ cần tra',
    );
    expect(
      screen.getByText('Gõ chữ Hán, pinyin hoặc nghĩa tiếng Việt để tra từ.'),
    ).toBeInTheDocument();
    expect(input()).toHaveValue('');
    expect(input()).toHaveAttribute(
      'placeholder',
      'Nhập chữ Hán, pinyin, nghĩa',
    );
    expect(container.querySelector('.dict-search__clear')).toHaveAttribute(
      'hidden',
    );
    expect(container.querySelector('.m03-say, [data-play]')).toBeNull();
  });

  it('renders the server result of ?q= with Q65/Q70 meanings and badges', () => {
    const { container } = renderSearch('学习', [xuexi, learner, materials]);
    expect(input()).toHaveValue('学习');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Kết quả (3)',
    );
    const [top, second, third] = rows();
    expect(top).toHaveClass('dict-item', 'dict-item--top');
    expect(top!.querySelector('.dict-item__vi')).toHaveTextContent('học tập');
    expect(top!.querySelector('.dict-item__body .badge')).toHaveTextContent(
      'HSK 1',
    );
    expect(second!.querySelector('.dict-item__body .badge')).toBeNull();
    expect(second!.querySelector(':scope > .badge')).toHaveTextContent('HSK 2');
    const none = third!.querySelector('.dict-item__vi');
    expect(none).toHaveClass('dict-item__vi--none');
    expect(none).toHaveTextContent('Chưa có nghĩa tiếng Việt');
    expect(third!.querySelector('.badge')).toBeNull();
    // English meanings never show (Q65).
    const list = container.querySelector('.dict-results')!.textContent!;
    for (const en of ['to learn', 'to study', 'learner', 'study materials']) {
      expect(list).not.toContain(en);
    }
    expect(
      within(top as HTMLElement).getByRole('link', {
        name: '学习 xuéxí: học tập, HSK 1',
      }),
    ).toHaveAttribute('href', '/learn/dictionary/11');
    expect(
      within(third as HTMLElement).getByRole('link', {
        name: '学习资料 xuéxí: Chưa có nghĩa tiếng Việt',
      }),
    ).toHaveAttribute('href', '/learn/dictionary/13');
  });

  it('shows "Không tìm thấy kết quả" for an empty server result', () => {
    renderSearch('zzzq', []);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Kết quả (0)',
    );
    expect(screen.getByText('Không tìm thấy kết quả')).toBeInTheDocument();
  });

  it('debounces typing 300 ms and searches once through the BFF', async () => {
    const { calls } = deferredFetch();
    renderSearch();

    await type('x');
    await type('xu');
    await type('xue');
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(calls).toHaveLength(0);
    await settle(1);
    expect(calls.map((call) => call.url)).toEqual([
      '/api/learner/dictionary?q=xue',
    ]);
    calls[0]!.resolve(ok([xuexi]));
    await flush();
    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Kết quả (1)',
    );
  });

  it('aborts the older request without showing an error for it', async () => {
    const { calls } = deferredFetch();
    renderSearch();

    await type('xue');
    await settle();
    await type('学习者');
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
    // The abort rejected call 0; that must not read as a failed search.
    expect(screen.queryByRole('alert')).toBeNull();

    calls[1]!.resolve(ok([learner]));
    await flush();
    expect(
      rows().map((row) => row.querySelector('.dict-item__hz')!.textContent),
    ).toEqual(['学习者']);
  });

  it('drops a late answer of an aborted request', async () => {
    const { calls } = deferredFetch({ rejectOnAbort: false });
    renderSearch();

    await type('xue');
    await settle();
    await type('学习者');
    await settle();
    calls[1]!.resolve(ok([learner]));
    await flush();
    calls[0]!.resolve(ok([xuexi, learner, materials]));
    await flush();
    expect(
      rows().map((row) => row.querySelector('.dict-item__hz')!.textContent),
    ).toEqual(['学习者']);
  });

  it("Enter does not open the previous query's result while a search is pending", async () => {
    const { calls } = deferredFetch();
    renderSearch('学习', [xuexi]);

    await type('学习者');
    fireEvent.submit(screen.getByRole('search'));
    expect(push).not.toHaveBeenCalled();
    await settle();
    fireEvent.submit(screen.getByRole('search'));
    expect(push).not.toHaveBeenCalled();

    calls[0]!.resolve(ok([learner]));
    await flush();
    fireEvent.submit(screen.getByRole('search'));
    expect(push).toHaveBeenCalledWith('/learn/dictionary/12');
  });

  it('keeps the URL in sync with replaceState', async () => {
    deferredFetch();
    renderSearch();
    await type(' 学习 ');
    expect(replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      `/learn/dictionary?q=${encodeURIComponent('学习')}`,
    );
    await type('  ');
    expect(replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      '/learn/dictionary',
    );
  });

  it('clear empties the box, returns to the empty state and focuses it', async () => {
    const { calls } = deferredFetch();
    const { container } = renderSearch('学习', [xuexi]);
    const clear = screen.getByRole('button', { name: 'Xoá nội dung tìm kiếm' });
    expect(clear).not.toHaveAttribute('hidden');

    await type('学习者');
    fireEvent.click(clear);
    await settle();
    expect(calls).toHaveLength(0);
    expect(input()).toHaveValue('');
    expect(input()).toHaveFocus();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Nhập từ cần tra',
    );
    expect(container.querySelector('.dict-search__clear')).toHaveAttribute(
      'hidden',
    );
    expect(replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      '/learn/dictionary',
    );
  });

  it('Enter opens the first result and never submits the form', () => {
    renderSearch('学习', [xuexi, learner]);
    const form = screen.getByRole('search');
    const submitted = fireEvent.submit(form);
    expect(submitted).toBe(false);
    expect(push).toHaveBeenCalledWith('/learn/dictionary/11');
  });

  it('Enter with no result does nothing', () => {
    renderSearch('zzzq', []);
    fireEvent.submit(screen.getByRole('search'));
    expect(push).not.toHaveBeenCalled();
  });

  it('shows the retry alert on a BFF error and retries the same query', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(ok([xuexi]));
    vi.stubGlobal('fetch', fetchMock);
    renderSearch();

    await type('学习');
    await settle();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Không tra được lúc này');
    expect(alert).toHaveTextContent('Vui lòng thử lại.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Thử lại' }));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe(
      `/api/learner/dictionary?q=${encodeURIComponent('学习')}`,
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('shows the retry alert when the server search failed', () => {
    renderSearch('学习', null);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Không tra được lúc này',
    );
  });

  it('goes to sign-in on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    renderSearch();
    await type('学习');
    await settle();
    expect(replace).toHaveBeenCalledWith('/sign-in');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('searches again on mount when the URL query differs from the server render', async () => {
    const { calls } = deferredFetch();
    urlQuery('学习');
    render(
      <LearnerToastProvider>
        <DictionarySearch initialQuery="" initialItems={null} />
      </LearnerToastProvider>,
    );
    await flush();
    expect(input()).toHaveValue('学习');
    expect(calls.map((call) => call.url)).toEqual([
      `/api/learner/dictionary?q=${encodeURIComponent('学习')}`,
    ]);
    calls[0]!.resolve(ok([xuexi]));
    await flush();
    expect(rows()).toHaveLength(1);
  });

  it('the tools, history and "Xem thêm" only toast (Q67)', () => {
    renderSearch();
    for (const name of [
      'Tra bằng chữ viết tay',
      'Tra bằng ảnh chụp',
      'Tra bằng giọng nói',
      'Lịch sử tra cứu',
    ]) {
      fireEvent.click(screen.getByRole('button', { name }));
    }
    fireEvent.click(
      screen.getByRole('button', { name: 'Xem thêm trong Từ điển Hán Lộ' }),
    );
    expect(screen.getAllByText('Tính năng sắp ra mắt.')).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'Quay lại' })).toHaveAttribute(
      'href',
      '/learn',
    );
  });
});
