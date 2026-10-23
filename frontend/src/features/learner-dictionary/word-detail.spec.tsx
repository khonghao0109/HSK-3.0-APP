import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRouter } from 'next/navigation';

import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

import { WordDetail, type WordView } from './word-detail';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

const replace = vi.fn();

const xuexi: WordView = {
  id: 11,
  hanzi: '学习',
  traditional: '學習',
  pinyin: 'xuéxí',
  vietnamese: 'học tập; nghiên cứu',
  level: 'HSK 1',
  example: '我每天都学习中文。',
  source: { name: 'Từ điển Hán Lộ', version: '1.0.0' },
};

const nihao: WordView = {
  id: 14,
  hanzi: '你好',
  traditional: null,
  pinyin: 'nǐ hǎo',
  vietnamese: null,
  level: null,
  example: null,
  source: null,
};

function renderWord(word: WordView = xuexi, saved = false) {
  return render(
    <LearnerToastProvider>
      <WordDetail word={word} initialSaved={saved} />
    </LearnerToastProvider>,
  );
}

function toasts(): string[] {
  return Array.from(document.querySelectorAll('.toast')).map(
    (toast) => toast.textContent ?? '',
  );
}

function saveButton(): HTMLElement {
  return document.querySelector('.word-save') as HTMLElement;
}

/* M2.10b: two ⋮ buttons exist (mobile app bar, web hero card); the specs
   exercise the mobile one. */
/* M2.10b: the menu exists twice (mobile + web copy); the specs exercise the
   mobile one. */
function menuItem(name: string): HTMLElement {
  const menu = document.getElementById('word-menu');
  if (!menu) throw new Error('missing menu');
  return within(menu as HTMLElement).getByRole('button', { name });
}

function moreButton(): HTMLElement {
  const bar = document.querySelector('.appbar');
  if (!bar) throw new Error('missing app bar');
  const button = Array.from(bar.querySelectorAll('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === 'Tuỳ chọn khác',
  );
  if (!button) throw new Error('missing ⋮ button');
  return button as HTMLElement;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe('WordDetail', () => {
  beforeEach(() => {
    vi.mocked(useRouter).mockReturnValue({
      replace,
      back: vi.fn(),
      push: vi.fn(),
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the word as in the demo, with every Vietnamese meaning (Q70)', () => {
    const { container } = renderWord();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('学习');
    expect(h1).toHaveAttribute('lang', 'zh-Hans');
    expect(container.querySelector('.word__py')).toHaveTextContent('xuéxí');
    expect(container.querySelector('.word__vi')).toHaveTextContent(
      'học tập; nghiên cứu',
    );
    expect(container.querySelector('.badge--lv')).toHaveTextContent('HSK 1');
    expect(container.querySelector('.word-ex__cn')).toHaveTextContent(
      '我每天都学习中文。',
    );
    // Q68: no example pinyin or translation lines.
    expect(container.querySelector('.word-ex__py, .word-ex__vi')).toBeNull();
    expect(
      Array.from(container.querySelectorAll('.word-ex footer span')).map(
        (span) => span.textContent,
      ),
    ).toEqual(['Nguồn: Từ điển Hán Lộ', 'Phiên bản: 1.0.0']);
    // Q63, Q66: no aria-pressed on the heart, no speaker.
    const fav = screen.getByRole('button', { name: 'Thêm vào yêu thích' });
    expect(fav).not.toHaveAttribute('aria-pressed');
    expect(
      container.querySelector('.word__say, .m03-say, [data-play]'),
    ).toBeNull();
    expect(saveButton()).toHaveAttribute('aria-pressed', 'false');
    expect(saveButton()).toHaveTextContent('Lưu để ôn');
    expect(saveButton().querySelector('use')).toHaveAttribute(
      'href',
      '#i-heart',
    );
  });

  it('hides the script switch, example and badge when the word has none (Q65, Q68)', () => {
    const { container } = renderWord(nihao);
    expect(container.querySelector('.seg')).toBeNull();
    expect(container.querySelector('.word-ex')).toBeNull();
    expect(container.querySelector('.badge--lv')).toBeNull();
    const vi = container.querySelector('.word__vi');
    expect(vi).toHaveClass('word__vi--none');
    expect(vi).toHaveTextContent('Chưa có nghĩa tiếng Việt');
  });

  it('Phồn thể switches only the headword and its lang (Q68)', () => {
    const { container } = renderWord();
    const simplified = screen.getByRole('button', { name: 'Giản thể' });
    const traditional = screen.getByRole('button', { name: 'Phồn thể' });
    expect(simplified).toHaveAttribute('aria-pressed', 'true');
    expect(traditional).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(traditional);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('學習');
    expect(h1).toHaveAttribute('lang', 'zh-Hant');
    expect(simplified).toHaveAttribute('aria-pressed', 'false');
    expect(traditional).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.word-ex__cn')).toHaveTextContent(
      '我每天都学习中文。',
    );

    fireEvent.click(simplified);
    expect(h1).toHaveTextContent('学习');
    expect(h1).toHaveAttribute('lang', 'zh-Hans');
  });

  it('the ⋮ menu opens, closes on an item, outside click and Esc (focus back)', () => {
    renderWord();
    const more = moreButton();
    const menu = document.getElementById('word-menu')!;
    expect(more).toHaveAttribute('aria-controls', 'word-menu');
    expect(menu).toHaveAttribute('hidden');

    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(menu).not.toHaveAttribute('hidden');
    expect(
      Array.from(menu.querySelectorAll('button')).map((b) => b.textContent),
    ).toEqual(['Xem cách viết Hán tự', 'Sao chép từ', 'Báo lỗi nội dung']);
    fireEvent.click(menuItem('Xem cách viết Hán tự'));
    expect(menu).toHaveAttribute('hidden');
    // The focused item vanished with the menu: focus goes back to ⋮.
    expect(more).toHaveFocus();
    expect(toasts()).toEqual(['Tính năng sắp ra mắt.']);

    fireEvent.click(more);
    fireEvent.click(document.body);
    expect(menu).toHaveAttribute('hidden');
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu).toHaveAttribute('hidden');
    expect(more).toHaveFocus();
  });

  /* M2.10d (F7): the same behaviours for the web hero card's ⋮ copy
     ('.word-web__more' + '#word-menu-web'); both copies render in jsdom, so
     the specs pick them by their web-only selectors. */
  describe('web ⋮ menu (F7)', () => {
    function moreWebButton(): HTMLElement {
      const button = document.querySelector('.word-web__more');
      if (!button) throw new Error('missing web ⋮ button');
      return button as HTMLElement;
    }

    function webMenu(): HTMLElement {
      const menu = document.getElementById('word-menu-web');
      if (!menu) throw new Error('missing web menu');
      return menu as HTMLElement;
    }

    function webMenuItem(name: string): HTMLElement {
      return within(webMenu()).getByRole('button', { name });
    }

    it('opens from the web ⋮ with aria-expanded and aria-controls', () => {
      renderWord();
      const more = moreWebButton();
      const menu = webMenu();
      expect(more).toHaveAttribute('aria-controls', 'word-menu-web');
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(menu).toHaveAttribute('hidden');

      fireEvent.click(more);
      expect(menu).not.toHaveAttribute('hidden');
      expect(more).toHaveAttribute('aria-expanded', 'true');
      // The mobile copy follows the shared state but stays out of scope here.
      expect(document.getElementById('word-menu')).not.toHaveAttribute(
        'hidden',
      );
    });

    it('Escape closes the web menu and returns focus to the web ⋮', () => {
      renderWord();
      const more = moreWebButton();
      fireEvent.click(more);
      expect(webMenu()).not.toHaveAttribute('hidden');

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(webMenu()).toHaveAttribute('hidden');
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(document.activeElement).toBe(more);
    });

    it('Sao chép từ in the web menu copies and closes the menu', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      renderWord();
      fireEvent.click(moreWebButton());
      fireEvent.click(webMenuItem('Sao chép từ'));
      await flush();
      expect(webMenu()).toHaveAttribute('hidden');
      expect(writeText).toHaveBeenCalledWith('学习 (xuéxí)');
      expect(toasts()).toEqual(['Đã sao chép 学习 (xuéxí)']);
    });

    it('a click outside closes the web menu', () => {
      renderWord();
      const more = moreWebButton();
      fireEvent.click(more);
      expect(webMenu()).not.toHaveAttribute('hidden');

      fireEvent.click(document.body);
      expect(webMenu()).toHaveAttribute('hidden');
      expect(more).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('Sao chép từ copies "hanzi (pinyin)" and toasts it (Q67)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderWord();
    fireEvent.click(moreButton());
    fireEvent.click(menuItem('Sao chép từ'));
    await flush();
    expect(writeText).toHaveBeenCalledWith('学习 (xuéxí)');
    expect(toasts()).toEqual(['Đã sao chép 学习 (xuéxí)']);
  });

  it('a failed copy toasts "Không sao chép được."', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    renderWord();
    fireEvent.click(moreButton());
    fireEvent.click(menuItem('Sao chép từ'));
    await flush();
    expect(toasts()).toEqual(['Không sao chép được.']);
  });

  it('saves with POST, then unsaves with DELETE (Q62)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ success: true, data: { saved: true } }),
      )
      .mockResolvedValueOnce(
        Response.json({ success: true, data: { saved: false } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderWord();

    fireEvent.click(saveButton());
    await flush();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/learner/dictionary/words/11/save',
      { method: 'POST' },
    );
    expect(saveButton()).toHaveAttribute('aria-pressed', 'true');
    expect(saveButton()).toHaveTextContent('Đã lưu');
    expect(saveButton().querySelector('use')).toHaveAttribute(
      'href',
      '#i-check',
    );
    expect(toasts()).toEqual(['Đã lưu 学习 vào danh sách ôn tập']);

    fireEvent.click(saveButton());
    await flush();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/learner/dictionary/words/11/save',
      { method: 'DELETE' },
    );
    expect(saveButton()).toHaveAttribute('aria-pressed', 'false');
    expect(saveButton()).toHaveTextContent('Lưu để ôn');
    expect(toasts()).toContain('Đã bỏ 学习 khỏi danh sách ôn tập');
  });

  it('starts saved and ignores a second click while the first is in flight', async () => {
    let answer: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWord(xuexi, true);
    expect(saveButton()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(saveButton());
    fireEvent.click(saveButton());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(saveButton()).not.toBeDisabled();
    answer(Response.json({ success: true, data: { saved: false } }));
    await flush();
    expect(saveButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the state and toasts on a failed save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    renderWord();
    fireEvent.click(saveButton());
    await flush();
    expect(saveButton()).toHaveAttribute('aria-pressed', 'false');
    expect(toasts()).toEqual(['Chưa lưu được. Vui lòng thử lại.']);
  });

  it('goes to sign-in when the save answers 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    renderWord();
    fireEvent.click(saveButton());
    await flush();
    expect(replace).toHaveBeenCalledWith('/sign-in');
    expect(toasts()).toEqual([]);
  });
});
