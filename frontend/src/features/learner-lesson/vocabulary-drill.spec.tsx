import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { MATCHING_WRONG_MS } from './matching-exercise';
import { type DrillStep, unitDrills } from './vocabulary-drills';
import { VocabularyUnitFlow } from './vocabulary-unit-flow';
import type { UnitWord } from './vocabulary-unit';

// Words and examples as in backend/content/hsk1 (bài 01, batch-01).
const word = (
  id: number,
  hanzi: string,
  pinyin: string,
  meaning: string,
  partOfSpeech: string,
  example: UnitWord['example'] = null,
): UnitWord => ({
  id,
  hanzi,
  pinyin,
  meaning,
  firstMeaning: meaning,
  partOfSpeech,
  image: null,
  example,
});
const unit = [
  word(1, '我', 'wǒ', 'tôi, mình', 'đại từ', {
    hanzi: '我是学生。',
    pinyin: 'Wǒ shì xuéshēng.',
    vi: 'Tôi là học sinh.',
  }),
  word(2, '是', 'shì', 'là', 'động từ', {
    hanzi: '他是我的老师。',
    pinyin: 'Tā shì wǒ de lǎoshī.',
    vi: 'Anh ấy là thầy giáo của tôi.',
  }),
  word(3, '他', 'tā', 'anh ấy', 'đại từ', {
    hanzi: '我们都是学生。',
    pinyin: 'Wǒmen dōu shì xuéshēng.',
    vi: 'Chúng tôi đều là học sinh.',
  }),
  word(4, '你', 'nǐ', 'bạn', 'đại từ'),
  word(5, '我们', 'wǒmen', 'chúng tôi', 'đại từ'),
];
const pool = [...unit, word(6, '老师', 'lǎoshī', 'thầy giáo', 'danh từ')];
const drills = unitDrills(unit, pool);
const drill = <K extends DrillStep['kind']>(kind: K) => {
  const found = drills.find(
    (step): step is Extract<DrillStep, { kind: K }> => step.kind === kind,
  );
  if (!found) throw new Error(`no ${kind} drill`);
  return found;
};

function renderDrills(steps: DrillStep[] = drills) {
  return render(
    <VocabularyUnitFlow
      lessonId={5}
      topicId={7}
      title="Từ vựng 1 · Chào hỏi"
      lessonHref="/learn/lessons/5"
      nextHref={null}
      words={unit}
      steps={steps}
    />,
  );
}

type Spoken = { text: string; rate: number };
function stubVoices() {
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
    getVoices: () => [{ lang: 'zh-CN', localService: true }],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    cancel: vi.fn(),
    speak: (utterance: Utterance) =>
      spoken.push({ text: utterance.text, rate: utterance.rate }),
  });
  return spoken;
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const status = () => screen.getAllByRole('status')[0]?.textContent;
const footButtons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('footer button')).map(
    (button) => button.textContent,
  );

describe('Unit review drills (Pha G2c)', () => {
  it('leaves out "nghe rồi sắp xếp" on a device without a zh voice', () => {
    renderDrills();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Ôn tập 1/3 · Ghép từ với nghĩa',
    );
  });

  it('matching: a wrong pair shows ✕ and clears, the last pair ends with Tiếp tục only', () => {
    vi.useFakeTimers();
    const { container } = renderDrills([drill('match')]);
    const cell = (side: 'Từ' | 'Nghĩa', text: string) =>
      within(screen.getByRole('list', { name: side })).getByRole('button', {
        name: new RegExp(side === 'Từ' ? `${text}$` : text),
      });
    fireEvent.click(cell('Từ', '我'));
    fireEvent.click(cell('Nghĩa', '^là$'));
    expect(cell('Từ', '我')).toHaveClass('is-wrong');
    act(() => vi.advanceTimersByTime(MATCHING_WRONG_MS));
    expect(cell('Từ', '我')).not.toHaveClass('is-wrong');
    expect(container.querySelector('footer')).toBeNull();

    for (const pair of drill('match').pairs) {
      fireEvent.click(cell('Từ', pair.left));
      fireEvent.click(cell('Nghĩa', `^${pair.right}$`));
    }
    expect(screen.getByText('Hoàn thành · Sai 1 lần')).toBeInTheDocument();
    expect(footButtons(container)).toEqual(['Tiếp tục']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('matching with no mistake says Chính xác', () => {
    renderDrills([drill('match')]);
    for (const pair of drill('match').pairs) {
      fireEvent.click(
        within(screen.getByRole('list', { name: 'Từ' })).getByRole('button', {
          name: new RegExp(`${pair.left}$`),
        }),
      );
      fireEvent.click(
        within(screen.getByRole('list', { name: 'Nghĩa' })).getByRole(
          'button',
          { name: new RegExp(`^${pair.right}$`) },
        ),
      );
    }
    expect(screen.getByText('Chính xác')).toBeInTheDocument();
    expect(screen.getByText('Bạn đã ghép đúng cả 5 cặp.')).toBeInTheDocument();
  });

  it('fill: options show pinyin; a wrong choice is graded at once with the right sentence', () => {
    const fill = drill('fill');
    const { container } = renderDrills([fill]);
    expect(screen.getByText('Ôn tập 1/1 · Điền chỗ trống')).toBeInTheDocument();
    expect(screen.getByLabelText('chỗ trống')).toBeInTheDocument();
    const options = screen.getAllByRole('radio');
    expect(options[0]?.querySelector('.g-chip__py')?.textContent).toBe(
      fill.options[0]?.pinyin,
    );
    expect(
      screen.queryByRole('button', { name: /Kiểm tra|Xác nhận/ }),
    ).toBeNull();

    const wrong = fill.answer === 0 ? 1 : 0;
    fireEvent.click(options[wrong] as HTMLElement);
    expect(options[wrong]).toHaveClass('is-wrong');
    expect(options[fill.answer]).toHaveClass('is-right');
    expect(options[fill.answer]).toHaveAttribute('aria-disabled', 'true');
    expect(container.querySelector('.g-fb__text')?.textContent).toBe(
      `Câu đúng: ${fill.sentence}`,
    );
    expect(footButtons(container)).toEqual(['Tiếp tục']);
    expect(document.activeElement?.textContent).toBe('Tiếp tục');
    expect(status()).toBe(`Chưa đúng. Câu đúng: ${fill.sentence}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fill: arrows move focus without grading; the right choice says Chính xác', () => {
    const fill = drill('fill');
    renderDrills([fill]);
    const options = screen.getAllByRole('radio');
    (options[0] as HTMLElement).focus();
    fireEvent.keyDown(options[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(options[1]);
    expect(screen.queryByText('Chính xác')).toBeNull();
    fireEvent.click(options[fill.answer] as HTMLElement);
    expect(screen.getByText('Chính xác')).toBeInTheDocument();
  });

  it('arrange: Xác nhận waits for every chip; a wrong order shows the right sentence', () => {
    const arrange = drill('arrange');
    const { container } = renderDrills([arrange]);
    expect(screen.getByText(arrange.vi)).toHaveClass('g-prompt');
    const confirm = screen.getByRole('button', { name: 'Xác nhận' });
    expect(confirm).toBeDisabled();
    expect(container.querySelector('.g-note')?.textContent).toBe(
      `Còn ${arrange.chips.length} mảnh. Xếp đủ rồi bấm Xác nhận.`,
    );
    const bank = within(
      screen.getByRole('group', { name: 'Các mảnh để chọn' }),
    );
    expect(
      bank.getAllByRole('button')[0]?.querySelector('.g-chip__py'),
    ).not.toBeNull();

    // The bank order is never the sentence order, so tapping it is wrong.
    for (const chip of arrange.bank) {
      fireEvent.click(
        bank.getByRole('button', {
          name: `Thêm ${arrange.chips[chip]?.hanzi}`,
        }),
      );
    }
    const answer = screen.getByRole('group', { name: 'Câu bạn ghép' });
    const first = arrange.chips[arrange.bank[0] ?? 0]?.hanzi;
    fireEvent.click(
      within(answer).getByRole('button', { name: `Bỏ ${first}` }),
    );
    expect(confirm).toBeDisabled();
    fireEvent.click(bank.getByRole('button', { name: `Thêm ${first}` }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(answer).toHaveClass('is-bad');
    expect(screen.getByText('Chưa đúng')).toBeInTheDocument();
    expect(container.querySelector('.g-fb__text')?.textContent).toBe(
      `Câu đúng: ${arrange.sentence}`,
    );
    expect(footButtons(container)).toEqual(['Tiếp tục']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('arrange in the sentence order says Chính xác', () => {
    const arrange = drill('arrange');
    renderDrills([arrange]);
    const bank = within(
      screen.getByRole('group', { name: 'Các mảnh để chọn' }),
    );
    for (const chip of arrange.chips) {
      fireEvent.click(bank.getByRole('button', { name: `Thêm ${chip.hanzi}` }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(screen.getByText('Chính xác')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Câu bạn ghép' })).toHaveClass(
      'is-ok',
    );
  });

  it('listen: Nghe câu and Nghe chậm speak the sentence; the answer reveals pinyin and meaning', () => {
    const spoken = stubVoices();
    const listen = drill('listen');
    renderDrills([listen]);
    expect(
      screen.getByText('Ôn tập 1/1 · Nghe và sắp xếp'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nghe câu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nghe chậm' }));
    expect(spoken).toEqual([
      { text: listen.sentence, rate: 0.9 },
      { text: listen.sentence, rate: 0.6 },
    ]);
    const bank = within(
      screen.getByRole('group', { name: 'Các mảnh để chọn' }),
    );
    for (const chip of listen.chips) {
      fireEvent.click(bank.getByRole('button', { name: `Thêm ${chip.hanzi}` }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(screen.getByText('Chính xác')).toBeInTheDocument();
    expect(document.querySelector('.g-reveal')?.textContent).toBe(
      `${listen.pinyin} ${listen.vi}`,
    );
  });

  it('counts the listen drill when the device has a zh voice', () => {
    stubVoices();
    renderDrills();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Ôn tập 1/4 · Ghép từ với nghĩa',
    );
  });
});
