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

describe('VocabularyUnitFlow (N3, N4, N8)', () => {
  it('shows the word card with its step count and no Nghe button without audio', () => {
    renderFlow();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Từ vựng 2 · Gia đình',
    );
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('家');
    expect(screen.getByText('jiā')).toBeDefined();
    expect(screen.getByText('Danh từ')).toBeDefined();
    expect(screen.getByText('nhà; gia đình')).toBeDefined();
    expect(screen.getByLabelText('Bước 1 trên 5').textContent).toBe('1/5');
    expect(
      screen.getByRole('link', { name: 'Thoát về bài học' }),
    ).toHaveAttribute('href', '/learn/lessons/5');
    expect(screen.queryByRole('button', { name: /Nghe/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Trước/ })).toBeNull();
  });

  it('shows the example with one syllable per character, the word marked, and goes back', () => {
    const { container } = renderFlow();
    next();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Câu ví dụ với 家',
    );
    const sentence = container.querySelector('.lu-sent');
    expect(sentence).toHaveAttribute('aria-label', '我家有四口人。');
    expect(
      Array.from(container.querySelectorAll('.lu-tok__py')).map(
        (node) => node.textContent,
      ),
    ).toEqual(['wǒ', 'jiā', 'yǒu', 'sì', 'kǒu', 'rén']);
    expect(
      container.querySelector('.lu-tok.is-target .lu-tok__hz')?.textContent,
    ).toBe('家');
    expect(screen.getByText('Nhà tôi có bốn người.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Trước' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('家');
  });

  it('grades only after Kiểm tra, then shows the answer (N4, Q51)', () => {
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
    const check = screen.getByRole('button', { name: 'Kiểm tra' });
    expect(check).toHaveAttribute('aria-disabled', 'true');

    const wrong = options.find(
      (option) => option.textContent !== 'nhà; gia đình',
    );
    if (!wrong) throw new Error('missing wrong option');
    fireEvent.click(wrong);
    expect(wrong).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('Chưa đúng')).toBeNull();

    fireEvent.click(check);
    expect(
      screen.getByText('Chưa đúng', { selector: '.m02-feedback__title' }),
    ).toBeDefined();
    expect(screen.getByText(/Đáp án đúng:/).textContent).toBe(
      'Đáp án đúng: 家 jiā là nhà, gia đình.',
    );
    expect(wrong).toHaveClass('is-wrong');
    expect(
      options.find((option) => option.textContent === 'nhà; gia đình'),
    ).toHaveClass('is-right');
  });

  it('ends on the result: marks the topic learned, lists each word, no medal (N8)', async () => {
    const { container } = renderFlow();
    next();
    next();
    fireEvent.click(screen.getByRole('radio', { name: 'nhà; gia đình' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(
      screen.getByText('Chính xác', { selector: '.m02-feedback__title' }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    next();
    const wrong = screen
      .getAllByRole('radio')
      .find((option) => option.textContent !== 'có');
    if (!wrong) throw new Error('missing wrong option');
    fireEvent.click(wrong);
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    });

    // The backend completes a topic only in a started lesson: start (the BFF
    // treats an already started lesson as started), then complete.
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/learner/lessons/5/start',
      '/api/learner/topics/7/complete',
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

  it('saves every word of the unit for review from the result (N3)', async () => {
    renderFlow(null);
    next();
    next();
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    next();
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
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
