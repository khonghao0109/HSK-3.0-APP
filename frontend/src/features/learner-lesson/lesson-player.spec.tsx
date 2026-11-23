import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { LessonPlayer } from './lesson-player';
import type { PlayerExercise } from './lesson-player-model';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
}));

const mcq: PlayerExercise = {
  id: 11,
  topicId: null,
  prompt: 'Chọn từ có nghĩa là siêu thị.',
  answered: false,
  kind: 'mcq',
  options: [
    { id: 'shop', text: '商店' },
    { id: 'market', text: '超市' },
    { id: 'bank', text: '银行' },
    { id: 'food', text: '餐馆' },
  ],
};
const arrange: PlayerExercise = {
  id: 12,
  topicId: null,
  prompt: 'Sắp xếp các từ sau thành câu hoàn chỉnh.',
  answered: false,
  kind: 'arrange_sentence',
  tokens: [
    { id: 'wo', text: '我' },
    { id: 'xiang', text: '想' },
    { id: 'mai', text: '买' },
  ],
};
const matching: PlayerExercise = {
  id: 15,
  topicId: null,
  prompt: 'Chọn cặp tương ứng',
  answered: false,
  kind: 'matching',
  pairs: [
    { id: 'p1', left: '家', leftReading: 'jiā', right: 'nhà' },
    { id: 'p2', left: '爸爸', leftReading: 'bàba', right: 'bố' },
    { id: 'p3', left: '妈妈', leftReading: 'māma', right: 'mẹ' },
  ],
  rightOrder: ['p3', 'p1', 'p2'],
};
const fill: PlayerExercise = {
  id: 13,
  topicId: null,
  prompt: '你___',
  answered: false,
  kind: 'fill_blank',
};
const listening: PlayerExercise = {
  id: 14,
  topicId: null,
  prompt: 'Nghe và chọn.',
  answered: false,
  kind: 'unsupported',
};

function ok(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function attempt(
  isCorrect: boolean,
  explanation: string | null = null,
  correctAnswer?: unknown,
) {
  return ok({
    success: true,
    data: {
      isCorrect,
      explanation,
      ...(correctAnswer === undefined ? {} : { correctAnswer }),
    },
  });
}

let fetchSpy: MockInstance<typeof fetch>;

function renderPlayer(
  exercises: PlayerExercise[],
  options: {
    startIndex?: number;
    needsStart?: boolean;
    lessonDone?: boolean;
  } = {},
) {
  return render(
    <div className="app">
      <LessonPlayer
        lessonId={5}
        exercises={exercises}
        startIndex={options.startIndex ?? 0}
        needsStart={options.needsStart ?? false}
        lessonDone={options.lessonDone ?? false}
      />
    </div>,
  );
}

// Pha G2a (PO 20/11/2026): arrange_sentence and fill_blank send with
// Xác nhận; a choice sends itself, and a failed send offers Thử lại.
function checkButton() {
  return screen.getByRole('button', { name: 'Xác nhận' });
}

function retryButton() {
  return screen.getByRole('button', { name: 'Thử lại' });
}

function attemptCalls() {
  return fetchSpy.mock.calls.filter(([url]) =>
    String(url).includes('/attempts'),
  );
}

describe('LessonPlayer', () => {
  beforeEach(() => {
    replace.mockReset();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('renders the bar with X back to the lesson, x/y and progress', () => {
    const { container } = renderPlayer([mcq, arrange, fill, listening], {
      startIndex: 1,
    });
    expect(
      screen.getByRole('link', { name: 'Thoát bài luyện tập' }),
    ).toHaveAttribute('href', '/learn/lessons/5');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Luyện tập' }),
    ).toBeInTheDocument();
    const count = container.querySelector('.m02-bar__count');
    expect(count?.textContent).toBe('2/4');
    expect(count).toHaveAttribute('aria-label', 'Câu 2 trên 4');
    // M2.10b: the bar shows it on the web frame, the body below 1024px.
    const bars = screen.getAllByRole('progressbar', {
      name: 'Tiến độ luyện tập',
    });
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar).toHaveAttribute('aria-valuenow', '1');
      expect(bar).toHaveAttribute('aria-valuemax', '4');
      expect(bar.querySelector('span')).toHaveClass('pct-25');
    }
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('sends a choice the moment it is made and moves focus to Tiếp tục (PO 20/11, thay Q51)', async () => {
    fetchSpy.mockResolvedValue(attempt(true));
    renderPlayer([mcq, arrange]);
    const group = screen.getByRole('radiogroup', {
      name: 'Chọn từ có nghĩa là siêu thị.',
    });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    expect(screen.getByRole('radio', { name: '超市' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(attemptCalls()).toHaveLength(1);

    const next = await screen.findByRole('button', { name: 'Tiếp tục' });
    await waitFor(() => expect(next).toHaveFocus());
    expect(screen.getByText('Chính xác')).toBeInTheDocument();
    expect(screen.getByText('Câu của bạn hoàn toàn đúng.')).toBeInTheDocument();
    expect(next.closest('[aria-live]')).toBeNull();
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'Chính xác. Câu của bạn hoàn toàn đúng.',
    );
    expect(screen.getByRole('radio', { name: '超市' })).toHaveClass('is-right');

    const [url, init] = attemptCalls()[0] ?? [];
    expect(url).toBe('/api/learner/exercises/11/attempts');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('idempotency-key')).toMatch(/^attempt-/u);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      answer: { optionId: 'market' },
    });

    fireEvent.click(next);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Sắp xếp các từ sau thành câu hoàn chỉnh.',
        }),
      ).toHaveFocus(),
    );
  });

  it('shows a wrong answer with the explanation and no retry (Q50)', async () => {
    fetchSpy.mockResolvedValue(attempt(false, 'Siêu thị là 超市.'));
    const { container } = renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '银行' }));
    await screen.findByText('Chưa đúng', { selector: '.m02-feedback__title' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Tiếp tục' })).toHaveFocus(),
    );
    const bar = container.querySelector('.m02-feedback--wrong');
    expect(bar).not.toBeNull();
    expect(screen.getByText('Siêu thị là 超市.')).toBeInTheDocument();
    expect(screen.queryByText(/Đáp án/u)).toBeNull();
    expect(screen.queryByRole('button', { name: /Làm lại/u })).toBeNull();
    expect(screen.getByRole('radio', { name: '银行' })).toHaveClass('is-wrong');
    expect(screen.getByRole('radio', { name: '超市' })).not.toHaveClass(
      'is-right',
    );
    // Only Tiếp tục: no retry, no second send (Q50).
    expect(
      Array.from(container.querySelectorAll('.ex-foot button')).map(
        (button) => button.textContent,
      ),
    ).toEqual(['Tiếp tục']);
    // Locked after checking: another option cannot be chosen.
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    expect(screen.getByRole('radio', { name: '超市' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(attemptCalls()).toHaveLength(1);
  });

  it('hides a null explanation', async () => {
    fetchSpy.mockResolvedValue(attempt(false, null));
    const { container } = renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '银行' }));
    await screen.findByText('Chưa đúng', { selector: '.m02-feedback__title' });
    expect(
      container.querySelector('.m02-feedback--wrong .m02-feedback__text'),
    ).toBeNull();
  });

  it('reveals the correct option and names it after a wrong mcq (Q-G9)', async () => {
    fetchSpy.mockResolvedValue(attempt(false, null, { optionId: 'market' }));
    const { container } = renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '银行' }));
    await screen.findByText('Chưa đúng', { selector: '.m02-feedback__title' });
    expect(
      container.querySelector('.m02-feedback--wrong')?.textContent,
    ).toContain('Đáp án đúng: 超市');
    expect(screen.getByRole('radio', { name: '银行' })).toHaveClass('is-wrong');
    expect(screen.getByRole('radio', { name: '超市' })).toHaveClass('is-right');
    expect(
      document.querySelector('[aria-live="polite"]')?.textContent,
    ).toContain('Đáp án đúng: 超市');
  });

  it('speaks a single period when the explanation already ends with one (G3c)', async () => {
    fetchSpy.mockResolvedValue(
      attempt(false, '你好 is a greeting.', { optionId: 'market' }),
    );
    renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '银行' }));
    await screen.findByText('Chưa đúng', { selector: '.m02-feedback__title' });
    const live =
      document.querySelector('[aria-live="polite"]')?.textContent ?? '';
    expect(live).toBe('Chưa đúng. 你好 is a greeting. Đáp án đúng: 超市');
    expect(live).not.toMatch(/\.\./u);
  });

  it('adds a period between parts with no end punctuation (G3c)', async () => {
    fetchSpy.mockResolvedValue(
      attempt(false, 'Sai rồi', { optionId: 'market' }),
    );
    renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '银行' }));
    await screen.findByText('Chưa đúng', { selector: '.m02-feedback__title' });
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'Chưa đúng. Sai rồi. Đáp án đúng: 超市',
    );
  });

  it('keeps a Chinese full stop without adding a Latin period (G3c)', async () => {
    fetchSpy.mockResolvedValue(
      attempt(false, '这是错的。', { optionId: 'market' }),
    );
    renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '银行' }));
    await screen.findByText('Chưa đúng', { selector: '.m02-feedback__title' });
    const live =
      document.querySelector('[aria-live="polite"]')?.textContent ?? '';
    expect(live).toBe('Chưa đúng. 这是错的。 Đáp án đúng: 超市');
    expect(live).not.toMatch(/。\./u);
  });

  it('reveals nothing when the correct option id is absent from the content (Q-G9)', async () => {
    fetchSpy.mockResolvedValue(attempt(false, null, { optionId: 'ghost' }));
    const { container } = renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '银行' }));
    await screen.findByText('Chưa đúng', { selector: '.m02-feedback__title' });
    expect(screen.queryByText(/Đáp án đúng/u)).toBeNull();
    expect(screen.getByRole('radio', { name: '超市' })).not.toHaveClass(
      'is-right',
    );
    expect(
      container.querySelector('.m02-feedback--wrong')?.textContent,
    ).not.toContain('Đáp án đúng');
  });

  it('reveals the accepted text after a wrong fill_blank (Q-G9)', async () => {
    fetchSpy.mockResolvedValue(
      attempt(false, null, { acceptedTexts: ['好', 'hǎo'] }),
    );
    const { container } = renderPlayer([fill]);
    const input = screen.getByLabelText('Câu trả lời của bạn');
    fireEvent.change(input, { target: { value: 'sai' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Chưa đúng', { selector: '.m02-feedback__title' });
    expect(
      container.querySelector('.m02-feedback--wrong')?.textContent,
    ).toContain('Đáp án đúng: 好');
  });

  it('reveals the correct sentence after a wrong arrange_sentence (Q-G9)', async () => {
    fetchSpy.mockResolvedValue(
      attempt(false, null, { tokenIds: ['wo', 'xiang', 'mai'] }),
    );
    const { container } = renderPlayer([arrange]);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 买' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 我' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 想' }));
    fireEvent.click(checkButton());
    await screen.findByText('Chưa đúng', { selector: '.m02-feedback__title' });
    expect(
      container.querySelector('.m02-feedback--wrong')?.textContent,
    ).toContain('Câu đúng: 我想买');
  });

  it('moves focus with arrow keys and roving tabindex without sending (Q51)', () => {
    renderPlayer([mcq]);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1]);
    radios[0]?.focus();
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowRight' });
    expect(radios[1]).toHaveAttribute('aria-checked', 'false');
    expect(radios[1]).toHaveFocus();
    expect(screen.getAllByRole('radio').map((radio) => radio.tabIndex)).toEqual(
      [-1, 0, -1, -1],
    );
    fireEvent.keyDown(radios[1] as HTMLElement, { key: 'ArrowLeft' });
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(radios[3]).toHaveFocus();
    expect(
      radios.every((radio) => radio.getAttribute('aria-checked') === 'false'),
    ).toBe(true);
    expect(attemptCalls()).toHaveLength(0);
  });

  it('sends one attempt for a double submit', async () => {
    let resolve: (response: Response) => void = () => {};
    fetchSpy.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    // Locked while the answer is in flight; a second tap sends nothing.
    expect(screen.getByRole('radio', { name: '超市' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'Đang chấm…',
    );
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    fireEvent.click(screen.getByRole('radio', { name: '银行' }));
    expect(attemptCalls()).toHaveLength(1);
    await act(async () => resolve(attempt(true)));
    await screen.findByText('Chính xác');
    expect(attemptCalls()).toHaveLength(1);
  });

  it('shows a friendly error and retries with the same key', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        ok(
          { success: false, error: { kind: 'unavailable', message: 'x' } },
          503,
        ),
      )
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(attempt(true));
    renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    expect(
      await screen.findByText('Không gửi được câu trả lời. Vui lòng thử lại.', {
        selector: '.ex-error',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('x')).toBeNull();
    fireEvent.click(retryButton());
    await waitFor(() => expect(attemptCalls()).toHaveLength(2));
    await screen.findByText('Không gửi được câu trả lời. Vui lòng thử lại.', {
      selector: '.ex-error',
    });
    // Choosing the same option again resends it too.
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    await screen.findByText('Chính xác');
    const keys = attemptCalls().map(([, init]) =>
      new Headers(init?.headers).get('idempotency-key'),
    );
    expect(new Set(keys).size).toBe(1);
    const bodies = attemptCalls().map(([, init]) => String(init?.body));
    expect(new Set(bodies).size).toBe(1);
  });

  it('uses a new key when the answer changes after an error', async () => {
    fetchSpy
      .mockResolvedValueOnce(ok({ success: false }, 503))
      .mockResolvedValueOnce(attempt(true));
    renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '银行' }));
    await screen.findByText('Không gửi được câu trả lời. Vui lòng thử lại.', {
      selector: '.ex-error',
    });
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    await screen.findByText('Chính xác');
    const keys = attemptCalls().map(([, init]) =>
      new Headers(init?.headers).get('idempotency-key'),
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it.each([401, 403])(
    'goes to /sign-in when the attempt answers %i',
    async (status) => {
      fetchSpy.mockResolvedValue(ok({ success: false }, status));
      renderPlayer([mcq]);
      fireEvent.click(screen.getByRole('radio', { name: '超市' }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in'));
    },
  );

  it('arranges tokens by tapping and sends { tokenIds } in order', async () => {
    fetchSpy.mockResolvedValue(attempt(true));
    const { container } = renderPlayer([arrange]);
    expect(
      screen.getByText('Chạm vào các từ ở trên để ghép câu'),
    ).toBeVisible();
    const bank = screen.getByRole('group', { name: 'Các từ để chọn' });
    expect(bank).toHaveAttribute('aria-describedby', 'pr-hint');

    fireEvent.click(screen.getByRole('button', { name: 'Thêm 想' }));
    expect(screen.getByRole('button', { name: '想, đã dùng' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Focus stays on a word still in the bank.
    expect(screen.getByRole('button', { name: 'Thêm 我' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 我' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ 想 khỏi câu' }));
    expect(
      screen.getByRole('button', { name: 'Bỏ 我 khỏi câu' }),
    ).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 想' }));
    expect(checkButton()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 买' }));
    // Every word placed: focus moves on to Xác nhận.
    expect(checkButton()).toHaveFocus();
    expect(checkButton()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(checkButton());
    await screen.findByText('Chính xác');

    const [, init] = attemptCalls()[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      answer: { tokenIds: ['wo', 'xiang', 'mai'] },
    });
    const placed = container.querySelectorAll('.pr-answer__row .pr-chip');
    expect(Array.from(placed).map((chip) => chip.textContent)).toEqual([
      '我',
      '想',
      '买',
    ]);
    for (const chip of placed) expect(chip).toHaveClass('is-right');
    expect(container.querySelector('.pr-answer__ok')).not.toHaveClass(
      'is-hidden',
    );
    // Locked after checking.
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ 我 khỏi câu' }));
    expect(container.querySelectorAll('.pr-answer__row .pr-chip')).toHaveLength(
      3,
    );
  });

  it('fills a blank with trimmed text and Enter checks (Q47)', async () => {
    fetchSpy.mockResolvedValue(attempt(true));
    const { container } = renderPlayer([fill]);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('你 (chỗ trống)');
    const input = screen.getByLabelText('Câu trả lời của bạn');
    expect(input).toHaveAttribute('maxLength', '4096');
    fireEvent.change(input, { target: { value: '  好 ' } });
    expect(container.querySelector('.fb-blank')?.textContent).toBe('好');
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Chính xác');
    const [, init] = attemptCalls()[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      answer: { text: '好' },
    });
    expect(input).toHaveAttribute('readOnly');
  });

  it('does not check on Enter while an IME composes', () => {
    renderPlayer([fill]);
    const input = screen.getByLabelText('Câu trả lời của bạn');
    fireEvent.change(input, { target: { value: 'hao' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(attemptCalls()).toHaveLength(0);
  });

  it('shows a coming-soon card for unsupported types and sends nothing (Q48)', () => {
    const { container } = renderPlayer([listening, mcq]);
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Dạng bài này sắp ra mắt.',
      }),
    ).toBeInTheDocument();
    expect(container.querySelector('.m02-bar__count')?.textContent).toBe('1/2');
    expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(container.querySelector('.m02-bar__count')?.textContent).toBe('2/2');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the done state with a link back to the lesson', () => {
    const { container } = renderPlayer([mcq], { startIndex: 1 });
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Bạn đã làm xong phần luyện tập',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về bài học' })).toHaveAttribute(
      'href',
      '/learn/lessons/5',
    );
    expect(container.querySelector('.m02-bar__count')?.textContent).toBe('1/1');
    for (const bar of screen.getAllByRole('progressbar')) {
      expect(bar.querySelector('span')).toHaveClass('pct-100');
    }
    expect(container.querySelector('footer')).toBeNull();
  });

  it('starts a not-started lesson once; a check made meanwhile waits for it', async () => {
    let resolveStart: (response: Response) => void = () => {};
    fetchSpy
      .mockReturnValueOnce(
        new Promise<Response>((done) => {
          resolveStart = done;
        }),
      )
      .mockResolvedValueOnce(attempt(true));
    renderPlayer([mcq], { needsStart: true });
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    expect(attemptCalls()).toHaveLength(0);
    expect(screen.getByRole('radio', { name: '超市' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await act(async () => resolveStart(ok({ success: true })));
    await screen.findByText('Chính xác');
    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      '/api/learner/lessons/5/start',
      '/api/learner/exercises/11/attempts',
    ]);
    expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it('sends no attempt when the start a check waits for fails', async () => {
    fetchSpy.mockResolvedValueOnce(ok({ success: false }, 503));
    renderPlayer([mcq], { needsStart: true });
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    await screen.findByText('Chưa mở được bài luyện tập. Vui lòng thử lại.', {
      selector: '.ex-error',
    });
    expect(attemptCalls()).toHaveLength(0);
  });

  it('does not start a lesson that is already learning', () => {
    renderPlayer([mcq], { needsStart: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('goes back to the lesson page when start answers lesson_locked', async () => {
    fetchSpy.mockResolvedValue(
      ok({ success: false, error: { kind: 'lesson_locked' } }, 409),
    );
    renderPlayer([mcq], { needsStart: true });
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/learn/lessons/5'),
    );
  });

  it('goes to /sign-in when start answers 403', async () => {
    fetchSpy.mockResolvedValue(ok({ success: false }, 403));
    renderPlayer([mcq], { needsStart: true });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in'));
  });

  it('keeps focus on a bank word after removing the last placed word', () => {
    renderPlayer([arrange]);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 想' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ 想 khỏi câu' }));
    expect(screen.getByRole('button', { name: 'Thêm 我' })).toHaveFocus();
  });

  describe('completing the lesson (Q58)', () => {
    const inTopic = (id: number, topicId: number): PlayerExercise => ({
      ...mcq,
      id,
      topicId,
    });

    function urls() {
      return fetchSpy.mock.calls.map(([url]) => String(url));
    }

    async function answerRight() {
      fireEvent.click(screen.getByRole('radio', { name: '超市' }));
      await screen.findByText('Chính xác');
    }

    function continueButton() {
      return screen.getByRole('button', { name: 'Tiếp tục' });
    }

    it('closes a topic after its last exercise, then completes the lesson and opens /complete', async () => {
      fetchSpy.mockImplementation(async (url) =>
        String(url).includes('/attempts')
          ? attempt(true)
          : ok({ success: true, data: {} }),
      );
      renderPlayer([inTopic(21, 7), inTopic(22, 7), { ...mcq, id: 23 }]);

      await answerRight();
      fireEvent.click(continueButton());
      expect(urls().filter((url) => url.includes('/topics/'))).toEqual([]);

      await answerRight();
      fireEvent.click(continueButton());
      expect(urls().filter((url) => url.includes('/topics/'))).toEqual([
        '/api/learner/topics/7/complete',
      ]);
      const close = fetchSpy.mock.calls.find(([url]) =>
        String(url).includes('/topics/'),
      );
      expect(close?.[1]?.method).toBe('POST');
      expect(close?.[1]?.body).toBe(JSON.stringify({ lessonId: 5 }));
      expect(
        urls().some(
          (url) => url.includes('/complete') && url.includes('/lessons/'),
        ),
      ).toBe(false);

      await answerRight();
      fireEvent.click(continueButton());
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith('/learn/lessons/5/complete'),
      );
      expect(urls().filter((url) => !url.includes('/attempts'))).toEqual([
        '/api/learner/topics/7/complete',
        '/api/learner/lessons/5/complete',
      ]);
    });

    it('waits for a topic close in flight before completing the lesson', async () => {
      let finishClose: (response: Response) => void = () => {};
      fetchSpy.mockImplementation((url) => {
        if (String(url).includes('/attempts'))
          return Promise.resolve(attempt(true));
        if (String(url).includes('/topics/')) {
          return new Promise<Response>((done) => {
            finishClose = done;
          });
        }
        return Promise.resolve(ok({ success: true, data: { lessonId: 5 } }));
      });
      renderPlayer([inTopic(21, 7), { ...mcq, id: 23 }]);
      await answerRight();
      fireEvent.click(continueButton());
      await answerRight();
      fireEvent.click(continueButton());
      await act(async () => {});
      expect(urls().some((url) => url.endsWith('/lessons/5/complete'))).toBe(
        false,
      );
      await act(async () => finishClose(ok({ success: true })));
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith('/learn/lessons/5/complete'),
      );
    });

    it('completes at once when opened with every exercise answered', async () => {
      fetchSpy.mockResolvedValue(ok({ success: true, data: { lessonId: 5 } }));
      renderPlayer(
        [
          { ...inTopic(21, 7), answered: true },
          { ...mcq, id: 23, answered: true },
        ],
        { startIndex: 2 },
      );
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith('/learn/lessons/5/complete'),
      );
      expect(urls()).toEqual(['/api/learner/lessons/5/complete']);
      expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe('POST');
      expect(screen.queryByRole('link', { name: 'Về bài học' })).toBeNull();
    });

    it('shows an alert with a retry when completing fails, and stays on the page', async () => {
      fetchSpy
        .mockResolvedValueOnce(ok({ success: false }, 503))
        .mockResolvedValueOnce(ok({ success: true, data: { lessonId: 5 } }));
      renderPlayer([{ ...mcq, answered: true }], { startIndex: 1 });
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        'Chưa lưu được kết quả bài học. Vui lòng thử lại.',
      );
      expect(replace).not.toHaveBeenCalled();

      const retry = screen.getByRole('button', { name: 'Thử lại' });
      fireEvent.click(retry);
      await waitFor(() =>
        expect(replace).toHaveBeenCalledWith('/learn/lessons/5/complete'),
      );
      expect(urls()).toEqual([
        '/api/learner/lessons/5/complete',
        '/api/learner/lessons/5/complete',
      ]);
      await waitFor(() =>
        expect(
          screen.getByRole('heading', {
            level: 2,
            name: 'Bạn đã làm xong phần luyện tập',
          }),
        ).toHaveFocus(),
      );
    });

    it('goes to /sign-in when completing answers 401', async () => {
      fetchSpy.mockResolvedValue(ok({ success: false }, 401));
      renderPlayer([{ ...mcq, answered: true }], { startIndex: 1 });
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/sign-in'));
    });

    it('does not complete while an exercise has no attempt (Q48)', () => {
      renderPlayer([listening, { ...mcq, answered: true }], { startIndex: 2 });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(
        screen.getByRole('link', { name: 'Về bài học' }),
      ).toBeInTheDocument();
    });

    describe('a lesson without exercises', () => {
      const EMPTY = 'Bài học này chưa có bài tập.';
      const FINISH = 'Hoàn thành bài học';
      const completeUrl = '/api/learner/lessons/5/complete';
      const completeCalls = () =>
        urls().filter((url) => url === completeUrl).length;

      it('shows the empty card and never completes on open', async () => {
        fetchSpy.mockResolvedValue(ok({ success: true, data: {} }));
        renderPlayer([], { needsStart: true });
        await waitFor(() =>
          expect(urls()).toEqual(['/api/learner/lessons/5/start']),
        );
        await act(async () => {
          await Promise.resolve();
        });

        expect(completeCalls()).toBe(0);
        expect(replace).not.toHaveBeenCalled();
        expect(screen.getByRole('region', { name: EMPTY })).toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
        expect(
          screen.getByRole('button', { name: FINISH }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole('link', { name: 'Về bài học' }),
        ).toHaveAttribute('href', '/learn/lessons/5');
      });

      it('completes once on click, locked while sending', async () => {
        let answer: (response: Response) => void = () => undefined;
        fetchSpy.mockImplementation(
          () =>
            new Promise<Response>((resolve) => {
              answer = resolve;
            }),
        );
        renderPlayer([]);
        expect(fetchSpy).not.toHaveBeenCalled();

        const finish = screen.getByRole('button', { name: FINISH });
        fireEvent.click(finish);
        await waitFor(() => expect(completeCalls()).toBe(1));
        expect(finish).toHaveAttribute('aria-disabled', 'true');
        fireEvent.click(finish);
        fireEvent.click(finish);

        await act(async () => {
          answer(ok({ success: true, data: { lessonId: 5 } }));
          await Promise.resolve();
        });
        await waitFor(() =>
          expect(replace).toHaveBeenCalledWith('/learn/lessons/5/complete'),
        );
        expect(completeCalls()).toBe(1);
      });

      it('offers a retry on the same button when completing fails', async () => {
        fetchSpy
          .mockResolvedValueOnce(ok({ success: false }, 503))
          .mockResolvedValueOnce(ok({ success: true, data: { lessonId: 5 } }));
        renderPlayer([]);
        const button = screen.getByRole('button', { name: FINISH });
        button.focus();
        fireEvent.click(button);

        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Chưa lưu được kết quả bài học. Vui lòng thử lại.',
        );
        expect(replace).not.toHaveBeenCalled();
        const retry = screen.getByRole('button', { name: 'Thử lại' });
        expect(retry).toBe(button);
        expect(retry).toHaveFocus();

        fireEvent.click(retry);
        await waitFor(() =>
          expect(replace).toHaveBeenCalledWith('/learn/lessons/5/complete'),
        );
        expect(completeCalls()).toBe(2);
      });

      it('only links back when the lesson is already done', async () => {
        renderPlayer([], { lessonDone: true });
        await act(async () => {
          await Promise.resolve();
        });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(replace).not.toHaveBeenCalled();
        expect(screen.getByRole('region', { name: EMPTY })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: FINISH })).toBeNull();
        expect(
          screen.getByRole('link', { name: 'Về bài học' }),
        ).toBeInTheDocument();
      });
    });
  });

  // M2.10d (F6): the footer hint "Chọn một đáp án…" only fits kinds where the
  // learner picks an option; arrange/fill have their own guidance.
  describe('footer hint per exercise kind (F6)', () => {
    // Pha G2a: a choice sends itself, so the hint no longer names a button.
    const HINT = 'Chọn một đáp án.';
    const listeningChoice: PlayerExercise = {
      id: 15,
      topicId: null,
      prompt: 'Nghe và chọn đáp án đúng.',
      answered: false,
      kind: 'listening',
      options: [
        { id: 'shop', text: '商店' },
        { id: 'market', text: '超市' },
      ],
      media: { id: 7, duration: 3 },
    };

    it.each([
      ['mcq', mcq],
      ['listening', listeningChoice],
    ])('shows the hint before answering a %s', (_kind, exercise) => {
      // The listening kind fetches its media access grant on mount.
      fetchSpy.mockResolvedValue(ok({ success: true, data: {} }));
      renderPlayer([exercise]);
      expect(screen.getByText(HINT)).toBeInTheDocument();
    });

    it.each([
      ['arrange_sentence', arrange],
      ['fill_blank', fill],
    ])('shows no hint before answering a %s', (_kind, exercise) => {
      renderPlayer([exercise]);
      expect(screen.queryByText(HINT)).toBeNull();
    });
  });

  describe('matching (Pha E)', () => {
    const live = () => document.querySelector('.mt-live')?.textContent ?? '';
    const cell = (column: 'Từ' | 'Nghĩa', name: RegExp) =>
      within(screen.getByRole('list', { name: column })).getByRole('button', {
        name,
      });

    it('moves a matched meaning onto its word row, keeping the cell node (PO 20/11)', async () => {
      renderPlayer([matching, mcq]);
      const meanings = () =>
        within(screen.getByRole('list', { name: 'Nghĩa' }))
          .getAllByRole('button')
          .map((button) => button.textContent);
      expect(meanings()).toEqual(['mẹ', 'nhà', 'bố']);

      // A wrong move moves nothing.
      fireEvent.click(cell('Từ', /家/u));
      fireEvent.click(cell('Nghĩa', /^bố$/u));
      expect(meanings()).toEqual(['mẹ', 'nhà', 'bố']);

      await waitFor(() =>
        expect(cell('Từ', /家/u)).not.toHaveClass('is-wrong'),
      );
      const me = cell('Nghĩa', /^mẹ$/u);
      fireEvent.click(cell('Từ', /妈妈/u));
      fireEvent.click(me);
      // 妈妈 is row 3: mẹ moves there; nhà, bố keep their order.
      expect(meanings()).toEqual(['nhà', 'bố', 'mẹ']);
      expect(cell('Nghĩa', /^mẹ, đã ghép$/u)).toBe(me);
      // Focus goes to the next open word (wraps to the top).
      expect(cell('Từ', /家/u)).toHaveFocus();
    });

    it('locks right pairs, flags a wrong pair, then sends the move log once', async () => {
      fetchSpy.mockResolvedValue(attempt(false));
      renderPlayer([matching, mcq]);
      expect(
        screen.getByRole('heading', { level: 2, name: 'Chọn cặp tương ứng' }),
      ).toBeInTheDocument();
      // No Xác nhận: the last pair sends the attempt.
      expect(screen.queryByRole('button', { name: 'Xác nhận' })).toBeNull();
      expect(
        within(screen.getByRole('list', { name: 'Nghĩa' }))
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['mẹ', 'nhà', 'bố']);

      fireEvent.click(cell('Từ', /爸爸/u));
      expect(cell('Từ', /爸爸/u)).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(cell('Nghĩa', /^mẹ$/u));
      expect(cell('Từ', /爸爸/u)).toHaveClass('is-wrong');
      expect(cell('Nghĩa', /^mẹ$/u)).toHaveClass('is-wrong');
      expect(
        cell('Nghĩa', /^mẹ$/u).querySelector('.mt-cell__mark'),
      ).not.toBeNull();
      expect(live()).toBe('Chưa đúng: 爸爸 bàba không phải mẹ. Chọn lại.');
      await waitFor(() =>
        expect(cell('Từ', /爸爸/u)).not.toHaveClass('is-wrong'),
      );
      expect(cell('Từ', /爸爸/u)).toHaveAttribute('aria-pressed', 'false');

      // Meaning first works too.
      fireEvent.click(cell('Nghĩa', /^nhà$/u));
      fireEvent.click(cell('Từ', /家/u));
      expect(cell('Từ', /家/u)).toHaveClass('is-done');
      expect(cell('Từ', /家/u)).toHaveAttribute('aria-disabled', 'true');
      expect(live()).toBe('Đúng: 家 jiā là nhà. Còn 2 cặp.');
      // Focus moves to the next open word.
      expect(cell('Từ', /爸爸/u)).toHaveFocus();
      fireEvent.click(cell('Từ', /家/u));
      expect(cell('Từ', /家/u)).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(cell('Từ', /爸爸/u));
      fireEvent.click(cell('Nghĩa', /^bố$/u));
      expect(attemptCalls()).toHaveLength(0);
      fireEvent.click(cell('Từ', /妈妈/u));
      fireEvent.click(cell('Nghĩa', /^mẹ$/u));

      const next = await screen.findByRole('button', { name: 'Tiếp tục' });
      await waitFor(() => expect(next).toHaveFocus());
      expect(attemptCalls()).toHaveLength(1);
      const [url, init] = attemptCalls()[0] ?? [];
      expect(url).toBe('/api/learner/exercises/15/attempts');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        answer: {
          moves: [
            { leftId: 'p2', rightId: 'p3' },
            { leftId: 'p1', rightId: 'p1' },
            { leftId: 'p2', rightId: 'p2' },
            { leftId: 'p3', rightId: 'p3' },
          ],
        },
      });
      expect(
        screen.getByText('Hoàn thành · Sai 1 lần', {
          selector: '.m02-feedback__title',
        }),
      ).toBeInTheDocument();
      expect(next.closest('.m02-feedback')).toHaveClass(
        'm02-feedback--neutral',
      );
      expect(screen.queryByText('Chưa đúng')).toBeNull();
    });

    it('shows Chính xác with the pair count when no move was wrong', async () => {
      fetchSpy.mockResolvedValue(attempt(true));
      renderPlayer([matching]);
      for (const [left, right] of [
        [/家/u, /^nhà$/u],
        [/爸爸/u, /^bố$/u],
        [/妈妈/u, /^mẹ$/u],
      ] as const) {
        fireEvent.click(cell('Từ', left));
        fireEvent.click(cell('Nghĩa', right));
      }
      const next = await screen.findByRole('button', { name: 'Tiếp tục' });
      expect(screen.getByText('Chính xác')).toBeInTheDocument();
      expect(
        screen.getByText('Bạn đã ghép đúng cả 3 cặp.'),
      ).toBeInTheDocument();
      expect(next.closest('.m02-feedback')).not.toHaveClass(
        'm02-feedback--neutral',
      );
      expect(live()).toBe('Đúng: 妈妈 māma là mẹ. Đã ghép xong cả 3 cặp.');
    });

    it('offers Thử lại to resend the same log when the attempt fails', async () => {
      fetchSpy.mockResolvedValueOnce(ok({}, 500));
      fetchSpy.mockResolvedValueOnce(attempt(true));
      renderPlayer([matching]);
      for (const [left, right] of [
        [/家/u, /^nhà$/u],
        [/爸爸/u, /^bố$/u],
        [/妈妈/u, /^mẹ$/u],
      ] as const) {
        fireEvent.click(cell('Từ', left));
        fireEvent.click(cell('Nghĩa', right));
      }
      await screen.findByRole('alert');
      fireEvent.click(retryButton());
      await screen.findByRole('button', { name: 'Tiếp tục' });
      const [first, second] = attemptCalls();
      expect(new Headers(second?.[1]?.headers).get('idempotency-key')).toBe(
        new Headers(first?.[1]?.headers).get('idempotency-key'),
      );
    });
  });

  it('offers a retry when start fails', async () => {
    fetchSpy
      .mockResolvedValueOnce(ok({ success: false }, 503))
      .mockResolvedValueOnce(ok({ success: true }));
    renderPlayer([mcq], { needsStart: true });
    expect(
      await screen.findByText('Chưa mở được bài luyện tập. Vui lòng thử lại.', {
        selector: '.ex-error',
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull(),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // M2.5e (Q171, TL-201): the speed choice lives in LessonPlayer, so the
  // per-question `key` on ListeningExercise cannot reset it.
  it('U7: keeps 0,75× for the next listening question of the turn (Q171)', async () => {
    const first: PlayerExercise = {
      id: 21,
      topicId: null,
      prompt: 'Nghe và chọn đáp án đúng.',
      answered: false,
      kind: 'listening',
      options: [
        { id: 'shop', text: '商店' },
        { id: 'market', text: '超市' },
      ],
      media: { id: 7, duration: 3 },
    };
    const second: PlayerExercise = {
      ...first,
      id: 22,
      prompt: 'Nghe câu thứ hai và chọn đáp án.',
    };
    const grantSrc = `/api/learner/media/7/content?expires=1791000000&signature=${'ab'.repeat(32)}`;
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/access')) {
        return Promise.resolve(
          ok({
            success: true,
            data: {
              src: grantSrc,
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
            },
          }),
        );
      }
      if (url.includes('/attempts')) return Promise.resolve(attempt(true));
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      });

    const { container } = renderPlayer([first, second]);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      first.prompt,
    );
    const firstAudio = container.querySelector<HTMLAudioElement>('.ex audio');
    fireEvent.click(screen.getByRole('button', { name: '0,75×' }));
    expect(
      screen
        .getByRole('button', { name: '0,75×' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    await screen.findByRole('button', { name: 'Tiếp tục' });
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));

    // The second question of the same turn: new prompt, new audio element.
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      second.prompt,
    );
    const secondAudio = container.querySelector<HTMLAudioElement>('.ex audio');
    expect(secondAudio).not.toBe(firstAudio);
    expect(
      screen
        .getByRole('button', { name: '0,75×' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByText('Tốc độ 0,75×')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Phát' }));
    // The second question fetches its grant after mount: wait for the click
    // handler's playFrom to assign src and both rates.
    await waitFor(() => expect(secondAudio?.playbackRate).toBe(0.75));
    expect(secondAudio?.getAttribute('src')).toBe(grantSrc);
    expect(secondAudio?.defaultPlaybackRate).toBe(0.75);
    expect(play).toHaveBeenCalledTimes(1);
    play.mockRestore();
  });

  // M2.5e (Q171): the choice belongs to one lesson-player turn; a new mount
  // starts from 1× again.
  it('U9: a newly mounted player starts again at 1× (Q171)', async () => {
    const listeningChoice: PlayerExercise = {
      id: 31,
      topicId: null,
      prompt: 'Nghe và chọn đáp án đúng.',
      answered: false,
      kind: 'listening',
      options: [
        { id: 'shop', text: '商店' },
        { id: 'market', text: '超市' },
      ],
      media: { id: 7, duration: 3 },
    };
    fetchSpy.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/access')) {
        return Promise.resolve(
          ok({
            success: true,
            data: {
              src: `/api/learner/media/7/content?expires=1791000000&signature=${'ab'.repeat(32)}`,
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
            },
          }),
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });

    const firstMount = renderPlayer([listeningChoice]);
    fireEvent.click(screen.getByRole('button', { name: '0,75×' }));
    expect(
      screen
        .getByRole('button', { name: '0,75×' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    firstMount.unmount();

    renderPlayer([listeningChoice]);
    expect(
      screen.getByRole('button', { name: '1×' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: '0,75×' })
        .getAttribute('aria-pressed'),
    ).toBe('false');
    expect(screen.getByText('Tốc độ 1×')).toBeInTheDocument();
  });
});
