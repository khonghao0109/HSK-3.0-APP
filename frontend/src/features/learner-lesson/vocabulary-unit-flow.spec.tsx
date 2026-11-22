import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./lesson-image', () => ({
  LessonImage: ({ altText }: { altText: string | null }) => (
    <span role="img" aria-label={altText ?? ''} />
  ),
}));

import { VocabularyUnitFlow } from './vocabulary-unit-flow';
import { type UnitWord, unitSteps } from './vocabulary-unit';

const jia: UnitWord = {
  id: 1,
  hanzi: '家',
  pinyin: 'jiā',
  meaning: 'nhà; gia đình',
  firstMeaning: 'nhà',
  partOfSpeech: 'danh từ',
  image: null,
  example: {
    hanzi: '我家有四口人。',
    pinyin: 'wǒ jiā yǒu sì kǒu rén.',
    vi: 'Nhà tôi có bốn người.',
  },
};
const you: UnitWord = {
  id: 2,
  hanzi: '有',
  pinyin: 'yǒu',
  meaning: 'có',
  firstMeaning: 'có',
  partOfSpeech: null,
  image: null,
  example: null,
};
const kou: UnitWord = {
  ...you,
  id: 3,
  hanzi: '口',
  pinyin: 'kǒu',
  meaning: 'miệng; nhân khẩu',
  firstMeaning: 'miệng',
};

const words = [jia, you];
const steps = unitSteps(words, [jia, you, kou]);

function renderFlow(nextHref: string | null = '/learn/lessons/5/grammar') {
  return render(
    <VocabularyUnitFlow
      lessonId={5}
      topicId={7}
      title="Từ vựng 2 · Gia đình"
      lessonHref="/learn/lessons/5"
      nextHref={nextHref}
      words={words}
      steps={steps}
    />,
  );
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ data: { saved: true } }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const next = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));

// Pha G2a: Nghe cần giọng zh của máy; jsdom không có speechSynthesis.
type Spoken = { text: string; rate: number; lang: string };
function stubVoices(voices: Array<{ lang: string; localService: boolean }>) {
  const spoken: Spoken[] = [];
  class Utterance {
    text: string;
    rate = 1;
    lang = '';
    voice: unknown = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => voices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    cancel: vi.fn(),
    speak: (utterance: Utterance) =>
      spoken.push({
        text: utterance.text,
        rate: utterance.rate,
        lang: utterance.lang,
      }),
  });
  return spoken;
}

describe('VocabularyUnitFlow (N3, N8, Pha G2a)', () => {
  it('shows the word card (mẫu vu-card-noimg) with only Tiếp when the device has no zh voice', () => {
    const { container } = renderFlow();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Từ vựng 2 · Gia đình',
    );
    const card = container.querySelector('section.g-card');
    expect(card).toHaveClass('g-card--noimg');
    expect(
      Array.from(card?.children ?? []).map((node) => [
        node.className,
        node.textContent,
      ]),
    ).toEqual([
      ['g-py', 'jiā'],
      ['g-hz', '家'],
      ['g-pos', 'danh từ'],
      ['g-vi', 'nhà; gia đình'],
    ]);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('家');
    expect(screen.getByLabelText('Bước 1 trên 5').textContent).toBe('1/5');
    expect(
      screen.getByRole('link', { name: 'Thoát về bài học' }),
    ).toHaveAttribute('href', '/learn/lessons/5');
    const bar = screen.getByRole('group', { name: 'Luyện từ này' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Tiếp']);
    expect(
      screen.queryByRole('button', { name: /Nghe|Nói|Viết|Trước/ }),
    ).toBeNull();
  });

  it('shows the word image above the pinyin (mẫu vu-card)', () => {
    const withImage: UnitWord = {
      ...jia,
      image: { id: 9, altText: 'Ngôi nhà' },
    };
    const { container } = render(
      <VocabularyUnitFlow
        lessonId={5}
        topicId={7}
        title="Từ vựng 2 · Gia đình"
        lessonHref="/learn/lessons/5"
        nextHref={null}
        words={[withImage]}
        steps={unitSteps([withImage], [withImage, you])}
      />,
    );
    const card = container.querySelector('section.g-card');
    expect(card).not.toHaveClass('g-card--noimg');
    expect(card?.firstElementChild).toHaveClass('g-media');
    expect(
      within(card as HTMLElement).getByRole('img', { name: 'Ngôi nhà' }),
    ).toBeDefined();
  });

  it('reads the word with a zh voice at 0,9 only on Nghe', () => {
    const spoken = stubVoices([
      { lang: 'en-US', localService: true },
      { lang: 'zh-CN', localService: true },
    ]);
    renderFlow();
    expect(spoken).toEqual([]);
    const bar = screen.getByRole('group', { name: 'Luyện từ này' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Nghe', 'Tiếp']);
    fireEvent.click(screen.getByRole('button', { name: 'Nghe' }));
    expect(spoken).toEqual([{ text: '家', rate: 0.9, lang: 'zh-CN' }]);
  });

  it('shows the example (mẫu vu-example) with the word marked and Nghe câu / Nghe chậm', () => {
    const spoken = stubVoices([{ lang: 'zh-CN', localService: false }]);
    const { container } = renderFlow();
    next();
    expect(
      screen.getByText('Câu ví dụ', { selector: '.g-kicker' }),
    ).toBeDefined();
    const section = screen.getByRole('region', { name: 'Câu ví dụ với 家' });
    expect(section.querySelector('.g-ex__cn')?.innerHTML).toBe(
      '我<mark>家</mark>有四口人。',
    );
    expect(section.querySelector('.g-ex__py')?.textContent).toBe(
      'wǒ jiā yǒu sì kǒu rén.',
    );
    expect(section.querySelector('.g-ex__vi')?.textContent).toBe(
      'Nhà tôi có bốn người.',
    );
    expect(container.querySelector('.lu-tok')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Trước' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Nghe câu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nghe chậm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nghe' }));
    expect(spoken).toEqual([
      { text: '我家有四口人。', rate: 0.9, lang: 'zh-CN' },
      { text: '我家有四口人。', rate: 0.6, lang: 'zh-CN' },
      { text: '我家有四口人。', rate: 0.9, lang: 'zh-CN' },
    ]);
  });

  it('hides Nghe câu and Nghe chậm without a zh voice', () => {
    renderFlow();
    next();
    expect(screen.queryByRole('button', { name: /Nghe/ })).toBeNull();
  });

  it('grades a meaning the moment it is chosen and shows the answer (PO 20/11, thay Q51/N4)', () => {
    renderFlow();
    next();
    next();
    const group = screen.getByRole('radiogroup', {
      name: 'Chọn nghĩa đúng của 家',
    });
    const options = within(group).getAllByRole('radio');
    const quiz = steps[2];
    expect(quiz?.kind).toBe('quiz');
    expect(options.map((option) => option.textContent)).toEqual(
      quiz?.kind === 'quiz' ? quiz.options : [],
    );
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();

    const wrong = options.find(
      (option) => option.textContent !== 'nhà; gia đình',
    );
    if (!wrong) throw new Error('missing wrong option');
    fireEvent.click(wrong);
    expect(wrong).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByText('Chưa đúng', { selector: '.g-fb__title' }),
    ).toBeDefined();
    expect(
      screen.getByText(/Đáp án đúng:/, { selector: '.g-fb__text' }).textContent,
    ).toBe('Đáp án đúng: 家 jiā là nhà, gia đình.');
    expect(wrong).toHaveClass('is-wrong');
    expect(
      options.find((option) => option.textContent === 'nhà; gia đình'),
    ).toHaveClass('is-right');
    for (const option of options) {
      expect(option).toHaveAttribute('aria-disabled', 'true');
    }
    expect(
      screen
        .getAllByRole('button')
        .filter((button) => !options.includes(button))
        .map((button) => button.textContent),
    ).toEqual(['Tiếp tục']);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Tiếp tục' }),
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Chưa đúng. Đáp án đúng: 家 jiā là nhà, gia đình.',
    );
  });

  it('moves focus with the arrow keys without grading (Q51)', () => {
    renderFlow();
    next();
    next();
    const options = screen.getAllByRole('radio');
    const [first, second] = options;
    if (!first || !second) throw new Error('missing options');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(second);
    expect(second).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('tabindex', '-1');
    expect(second).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByText(/Chính xác|Chưa đúng/)).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('ends on the result: marks the topic learned, lists each word, no medal (N8)', async () => {
    const { container } = renderFlow();
    next();
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'nhà; gia đình' }));
    expect(
      screen.getByText('Chính xác', { selector: '.g-fb__title' }),
    ).toBeDefined();
    expect(
      screen.getByText(/nghĩa là/, { selector: '.g-fb__text' }).textContent,
    ).toBe('家 jiā nghĩa là nhà, gia đình.');
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    next();
    const wrong = screen
      .getAllByRole('radio')
      .find((option) => option.textContent !== 'có');
    if (!wrong) throw new Error('missing wrong option');
    fireEvent.click(wrong);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    });

    // The backend completes a topic only in a started lesson: start (the BFF
    // treats an already started lesson as started), then complete.
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.filter((url) => !url.includes('/strokes?'))).toEqual([
      '/api/learner/lessons/5/start',
      '/api/learner/topics/7/complete',
    ]);
    // Viết (G2d): one read-only stroke lookup per word card, nothing written.
    expect(
      fetchMock.mock.calls
        .filter((call) => String(call[0]).includes('/strokes?'))
        .every((call) => call.length === 1),
    ).toBe(true);
    expect(urls.filter((url) => url.includes('/strokes?'))).toEqual([
      `/api/learner/dictionary/strokes?hanzi=${encodeURIComponent('家')}`,
      `/api/learner/dictionary/strokes?hanzi=${encodeURIComponent('有')}`,
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/learner/topics/7/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lessonId: 5 }),
    });
    expect(screen.getByText('Bạn đã hoàn thành đơn vị học')).toBeDefined();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1 }),
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Từ vựng 2 · Gia đình',
    );
    expect(screen.getByLabelText('Trả lời đúng 50%')).toBeDefined();
    const list = container.querySelector('.lu-words');
    expect(
      Array.from(list?.querySelectorAll('li') ?? []).map(
        (row) => row.textContent,
      ),
    ).toEqual(['家jiānhàĐúng', '有yǒucóSai 1 lần']);
    expect(container.querySelector('.done-medal, img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Về bài' })).toHaveAttribute(
      'href',
      '/learn/lessons/5',
    );
    expect(screen.getByRole('link', { name: 'Đơn vị tiếp' })).toHaveAttribute(
      'href',
      '/learn/lessons/5/grammar',
    );
  });

  // Pha C debt 3a: leaving before the topic is saved showed the unit as
  // not done on the units screen.
  it('keeps Về bài and Đơn vị tiếp closed while the progress is saving', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    renderFlow();
    next();
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'nhà; gia đình' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'có' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    });
    for (const name of ['Về bài', 'Đơn vị tiếp']) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('aria-disabled', 'true');
      expect(fireEvent.click(link)).toBe(false);
    }
  });

  it('saves every word of the unit for review from the result (N3)', async () => {
    renderFlow(null);
    next();
    next();
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    next();
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    });
    expect(screen.queryByRole('link', { name: 'Đơn vị tiếp' })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu để ôn' }));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/learner/dictionary/words/1/save',
      { method: 'POST' },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/learner/dictionary/words/2/save',
      { method: 'POST' },
    );
    expect(
      screen.getByRole('button', { name: 'Đã lưu để ôn' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });
});
