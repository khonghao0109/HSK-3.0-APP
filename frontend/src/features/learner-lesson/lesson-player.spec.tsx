import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
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

function attempt(isCorrect: boolean, explanation: string | null = null) {
  return ok({ success: true, data: { isCorrect, explanation } });
}

let fetchSpy: MockInstance<typeof fetch>;

function renderPlayer(
  exercises: PlayerExercise[],
  options: { startIndex?: number; needsStart?: boolean } = {},
) {
  return render(
    <div className="app">
      <LessonPlayer
        lessonId={5}
        exercises={exercises}
        startIndex={options.startIndex ?? 0}
        needsStart={options.needsStart ?? false}
      />
    </div>,
  );
}

function checkButton() {
  return screen.getByRole('button', { name: 'Kiểm tra' });
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
    const bar = screen.getByRole('progressbar', { name: 'Tiến độ luyện tập' });
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '4');
    expect(bar.querySelector('span')).toHaveClass('pct-25');
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('checks a correct mcq answer and moves focus to Tiếp tục', async () => {
    fetchSpy.mockResolvedValue(attempt(true));
    renderPlayer([mcq, arrange]);
    const group = screen.getByRole('radiogroup', {
      name: 'Chọn từ có nghĩa là siêu thị.',
    });
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(checkButton()).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    expect(screen.getByRole('radio', { name: '超市' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(checkButton()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(checkButton());

    const next = await screen.findByRole('button', { name: 'Tiếp tục' });
    await waitFor(() => expect(next).toHaveFocus());
    expect(screen.getByText('Chính xác!')).toBeInTheDocument();
    expect(screen.getByText('Câu của bạn hoàn toàn đúng.')).toBeInTheDocument();
    expect(next.closest('[aria-live]')).toBeNull();
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe(
      'Chính xác! Câu của bạn hoàn toàn đúng.',
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
    fireEvent.click(checkButton());
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
    // Locked after checking: another option cannot be chosen.
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    expect(screen.getByRole('radio', { name: '超市' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('hides a null explanation', async () => {
    fetchSpy.mockResolvedValue(attempt(false, null));
    const { container } = renderPlayer([mcq]);
    fireEvent.click(screen.getByRole('radio', { name: '银行' }));
    fireEvent.click(checkButton());
    await screen.findByText('Chưa đúng', { selector: '.m02-feedback__title' });
    expect(
      container.querySelector('.m02-feedback--wrong .m02-feedback__text'),
    ).toBeNull();
  });

  it('moves the mcq choice with arrow keys and roving tabindex', () => {
    renderPlayer([mcq]);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1]);
    radios[0]?.focus();
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowRight' });
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveFocus();
    expect(screen.getAllByRole('radio').map((radio) => radio.tabIndex)).toEqual(
      [-1, 0, -1, -1],
    );
    fireEvent.keyDown(radios[1] as HTMLElement, { key: 'ArrowLeft' });
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(radios[3]).toHaveAttribute('aria-checked', 'true');
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
    fireEvent.click(checkButton());
    expect(
      screen.getByRole('button', { name: 'Đang kiểm tra…' }),
    ).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Đang kiểm tra…' }));
    expect(attemptCalls()).toHaveLength(1);
    await act(async () => resolve(attempt(true)));
    await screen.findByText('Chính xác!');
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
    fireEvent.click(checkButton());
    expect(
      await screen.findByText('Không gửi được câu trả lời. Vui lòng thử lại.', {
        selector: '.ex-error',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('x')).toBeNull();
    fireEvent.click(checkButton());
    await waitFor(() => expect(attemptCalls()).toHaveLength(2));
    await screen.findByText('Không gửi được câu trả lời. Vui lòng thử lại.', {
      selector: '.ex-error',
    });
    fireEvent.click(checkButton());
    await screen.findByText('Chính xác!');
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
    fireEvent.click(checkButton());
    await screen.findByText('Không gửi được câu trả lời. Vui lòng thử lại.', {
      selector: '.ex-error',
    });
    fireEvent.click(screen.getByRole('radio', { name: '超市' }));
    fireEvent.click(checkButton());
    await screen.findByText('Chính xác!');
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
      fireEvent.click(checkButton());
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
    // Every word placed: focus moves on to Kiểm tra.
    expect(checkButton()).toHaveFocus();
    expect(checkButton()).not.toHaveAttribute('aria-disabled');
    fireEvent.click(checkButton());
    await screen.findByText('Chính xác!');

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
    await screen.findByText('Chính xác!');
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
    expect(screen.queryByRole('button', { name: 'Kiểm tra' })).toBeNull();
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
    expect(screen.getByRole('progressbar').querySelector('span')).toHaveClass(
      'pct-100',
    );
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
    fireEvent.click(checkButton());
    expect(attemptCalls()).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Đang kiểm tra…' }),
    ).toHaveAttribute('aria-disabled', 'true');

    await act(async () => resolveStart(ok({ success: true })));
    await screen.findByText('Chính xác!');
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
    fireEvent.click(checkButton());
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
      fireEvent.click(checkButton());
      await screen.findByText('Chính xác!');
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
    await screen.findByRole('button', { name: 'Kiểm tra' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
