import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewSession } from './review-session';
import type { ReviewCall, ReviewTransport } from './review-transport';

const router = { replace: vi.fn(), push: vi.fn(), refresh: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const NOW = Date.parse('2026-11-12T08:00:00.000Z');
const at = (ms: number) => new Date(NOW + ms).toISOString();

function item(
  cardId: number,
  hanzi: string,
  vi: string | null = 'nghĩa ' + hanzi,
) {
  return {
    cardId,
    word: {
      id: cardId + 100,
      hanzi,
      pinyin: 'pin' + String(cardId),
      pinyinTone: null,
      example: cardId === 1 ? '我每天都学习中文。' : null,
      meanings: [{ order: 1, vi, en: 'en ' + hanzi }],
    },
    preview: {
      again: { dueAt: at(60_000) },
      hard: { dueAt: at(6 * 60_000) },
      good: { dueAt: at(24 * 3_600_000) },
      easy: { dueAt: at(4 * 24 * 3_600_000) },
    },
  };
}

const session = (reviewedCount = 0, plannedCount = 3) => ({
  sessionId: 41,
  status: 'in_progress',
  plannedCount,
  reviewedCount,
  startedAt: at(0),
  expiresAt: at(86_400_000),
});

const summary = {
  again: 1,
  hard: 0,
  good: 1,
  easy: 1,
  remembered: 2,
  forgot: 1,
  retentionPercent: 67,
  totalDurationMs: 755_000,
};

type Fake = {
  [K in keyof ReviewTransport]: ReturnType<typeof vi.fn>;
};

function fake(): Fake {
  return {
    current: vi.fn(),
    create: vi.fn(),
    grade: vi.fn(),
    complete: vi.fn(),
    overview: vi.fn(),
    preferences: vi.fn(),
    savePreferences: vi.fn(),
  };
}

const ok = <T,>(data: T): ReviewCall<T> => ({ ok: true, data });
const fail = (status: number, code: string | null = null) => ({
  ok: false as const,
  status,
  code,
});

function renderSession(t: Fake) {
  return render(<ReviewSession transport={t as never} />);
}

function gradeOk(t: Fake, planned = 3) {
  let reviewed = 0;
  t.grade.mockImplementation(() => {
    reviewed += 1;
    return Promise.resolve(
      ok({
        cardId: 1,
        session: { reviewedCount: reviewed, plannedCount: planned },
      }),
    );
  });
}

beforeEach(() => {
  // jsdom has no modal dialog; the settings panel only needs it to open.
  if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
  }
  if (typeof HTMLDialogElement.prototype.close !== 'function') {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
  }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  let n = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  router.replace.mockReset();
});

describe('ReviewSession (M3.3a)', () => {
  it('resumes the current session and shows the front face first', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(1), items: [item(2, '记得'), item(3, '工作')] }),
    );
    renderSession(t);
    const card = await screen.findByRole('button', { name: /Lật thẻ/ });
    expect(card).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('记得', { selector: '.fc-hz' })).toBeVisible();
    expect(screen.queryByText('nghĩa 记得')).not.toBeVisible();
    expect(screen.getByText('Chạm vào thẻ để lật mặt sau')).toBeInTheDocument();
    expect(screen.getAllByText('2 / 3').length).toBeGreaterThan(0);
    expect(t.create).not.toHaveBeenCalled();
  });

  it('creates a session with a fresh key when there is none (Q259)', async () => {
    const t = fake();
    t.current
      .mockResolvedValueOnce(fail(404))
      .mockResolvedValueOnce(
        ok({ session: session(), items: [item(1, '学习')] }),
      );
    t.create.mockResolvedValue(ok({ created: true, session: session() }));
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    expect(t.create).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('shows the empty state on REVIEW_NOTHING_DUE', async () => {
    const t = fake();
    t.current.mockResolvedValue(fail(404));
    t.create.mockResolvedValue(fail(409, 'REVIEW_NOTHING_DUE'));
    renderSession(t);
    expect(await screen.findByText('Không có thẻ đến hạn')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lộ trình học' })).toHaveAttribute(
      'href',
      '/learn/path',
    );
    expect(screen.getByRole('link', { name: 'Tra từ' })).toHaveAttribute(
      'href',
      '/learn/dictionary',
    );
  });

  it('flips with a click and shows the back face (Q260)', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习')] }),
    );
    renderSession(t);
    const card = await screen.findByRole('button', { name: /Lật thẻ/ });
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('nghĩa 学习')).toBeVisible();
    expect(screen.getByText('我每天都学习中文。')).toBeVisible();
  });

  it('labels each grade with its preview interval (Q261)', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习')] }),
    );
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    expect(
      screen.getByRole('button', { name: 'Chưa nhớ, gặp lại sau 1 phút' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Khó, gặp lại sau 6 phút' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Tốt, gặp lại sau 1 ngày' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Dễ, gặp lại sau 4 ngày' }),
    ).toBeInTheDocument();
  });

  it('does not grade before the card is flipped (Q266)', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习'), item(2, '记得')] }),
    );
    gradeOk(t, 2);
    renderSession(t);
    const card = await screen.findByRole('button', { name: /Lật thẻ/ });
    for (const name of [/^Chưa nhớ/, /^Khó/, /^Tốt/, /^Dễ/]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole('button', { name: /^Tốt/ }));
    fireEvent.keyDown(window, { key: '3' });
    expect(t.grade).not.toHaveBeenCalled();
    fireEvent.click(card);
    expect(screen.getByRole('button', { name: /^Tốt/ })).toBeEnabled();
    fireEvent.keyDown(window, { key: '3' });
    await waitFor(() => expect(t.grade).toHaveBeenCalledTimes(1));
  });

  it('grades with one key per card, the elapsed time, then advances', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习'), item(2, '记得')] }),
    );
    gradeOk(t, 2);
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    vi.setSystemTime(NOW + 4_200);
    fireEvent.click(screen.getByRole('button', { name: /^Tốt/ }));
    await screen.findByText('记得', { selector: '.fc-hz' });
    expect(t.grade).toHaveBeenCalledWith(
      41,
      { cardId: 1, grade: 'good', durationMs: 4_200 },
      '00000000-0000-4000-8000-000000000001',
    );
    expect(screen.getAllByText('2 / 2').length).toBeGreaterThan(0);
  });

  it('grades with keys 1–4 but not while typing in a field', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习'), item(2, '记得')] }),
    );
    gradeOk(t, 2);
    const { container } = renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    const input = document.createElement('input');
    container.appendChild(input);
    fireEvent.keyDown(input, { key: '1' });
    expect(t.grade).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: '4' });
    await waitFor(() => expect(t.grade).toHaveBeenCalledTimes(1));
    expect(t.grade.mock.calls[0]?.[1]).toMatchObject({ grade: 'easy' });
  });

  it('locks the four buttons while a grade is in flight', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习'), item(2, '记得')] }),
    );
    let resolve: (value: unknown) => void = () => undefined;
    t.grade.mockReturnValue(new Promise((r) => (resolve = r)));
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Khó/ }));
    for (const name of [/^Chưa nhớ/, /^Khó/, /^Tốt/, /^Dễ/]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole('button', { name: /^Dễ/ }));
    fireEvent.keyDown(window, { key: '3' });
    expect(t.grade).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(
        ok({ cardId: 1, session: { reviewedCount: 1, plannedCount: 2 } }),
      );
    });
  });

  it('sends one grade for two keypresses in the same tick', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({
        session: session(),
        items: [item(1, '学习'), item(2, '记得'), item(3, '工作')],
      }),
    );
    gradeOk(t);
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    });
    expect(
      await screen.findByText('记得', { selector: '.fc-hz' }),
    ).toBeInTheDocument();
    expect(t.grade).toHaveBeenCalledTimes(1);
  });

  it('offers Thử lại with the same key after the retries run out', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习'), item(2, '记得')] }),
    );
    t.grade
      .mockResolvedValueOnce(fail(0))
      .mockResolvedValueOnce(
        ok({ cardId: 1, session: { reviewedCount: 1, plannedCount: 2 } }),
      );
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Tốt/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Thử lại' }));
    await screen.findByText('记得', { selector: '.fc-hz' });
    expect(t.grade.mock.calls[1]?.[2]).toBe(t.grade.mock.calls[0]?.[2]);
    expect(t.grade.mock.calls[1]?.[1]).toMatchObject({ grade: 'good' });
  });

  it('uses a new key when a different grade follows a failure', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习'), item(2, '记得')] }),
    );
    t.grade
      .mockResolvedValueOnce(fail(503))
      .mockResolvedValueOnce(
        ok({ cardId: 1, session: { reviewedCount: 1, plannedCount: 2 } }),
      );
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Tốt/ }));
    await screen.findByRole('button', { name: 'Thử lại' });
    fireEvent.click(screen.getByRole('button', { name: /^Dễ/ }));
    await screen.findByText('记得', { selector: '.fc-hz' });
    expect(t.grade.mock.calls[1]?.[2]).not.toBe(t.grade.mock.calls[0]?.[2]);
  });

  it('skips a card the server reports as already reviewed', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习'), item(2, '记得')] }),
    );
    t.grade.mockResolvedValue(fail(409, 'REVIEW_CARD_ALREADY_REVIEWED'));
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Tốt/ }));
    expect(
      await screen.findByText('记得', { selector: '.fc-hz' }),
    ).toBeInTheDocument();
  });

  it('shows the expired state and starts a new session with a new key', async () => {
    const t = fake();
    t.current
      .mockResolvedValueOnce(
        ok({ session: session(), items: [item(1, '学习')] }),
      )
      .mockResolvedValueOnce(fail(404))
      .mockResolvedValueOnce(
        ok({ session: session(), items: [item(5, '早餐')] }),
      );
    t.grade.mockResolvedValue(fail(409, 'REVIEW_SESSION_EXPIRED'));
    t.create.mockResolvedValue(ok({ created: true, session: session() }));
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Dễ/ }));
    expect(await screen.findByText('Phiên ôn đã hết hạn')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu phiên mới' }));
    expect(
      await screen.findByText('早餐', { selector: '.fc-hz' }),
    ).toBeInTheDocument();
    const usedKeys = t.grade.mock.calls.map((call) => call[2]);
    expect(usedKeys).not.toContain(t.create.mock.calls[0]?.[0]);
  });

  it('completes after the last card and shows the summary (Q263)', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(2), items: [item(3, '工作')] }),
    );
    gradeOk(t);
    t.complete.mockResolvedValue(
      ok({ session: { ...session(3), status: 'completed' }, summary }),
    );
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Chưa nhớ/ }));
    expect(
      await screen.findByRole('heading', { name: 'Ôn tập hôm nay' }),
    ).toBeInTheDocument();
    expect(t.complete).toHaveBeenCalledWith(41);
    const stat = (title: string) =>
      screen
        .getByRole('heading', { name: title })
        .closest('section') as HTMLElement;
    expect(within(stat('Thẻ đã ôn')).getByText('3')).toBeInTheDocument();
    expect(within(stat('Nhớ')).getByText('2')).toBeInTheDocument();
    expect(within(stat('Chưa nhớ')).getByText('1')).toBeInTheDocument();
    expect(screen.getByText(/Tỷ lệ ghi nhớ 67%/)).toBeInTheDocument();
    expect(screen.getByText(/Thời gian 12 phút 35 giây/)).toBeInTheDocument();
    expect(
      screen.getByText(/Phiên ôn không cộng XP hay huy hiệu/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về Ôn tập' })).toHaveAttribute(
      'href',
      '/learn/review',
    );
    // Q278: summary.again = 1, so the retry of the forgotten cards is offered.
    expect(
      screen.getByRole('button', { name: 'Ôn lại thẻ chưa nhớ' }),
    ).toBeInTheDocument();
  });

  it('hides Ôn lại thẻ chưa nhớ when no card was graded again (Q278)', async () => {
    const t = fake();
    t.current.mockResolvedValue(ok({ session: session(0, 1), items: [] }));
    t.complete.mockResolvedValue(
      ok({
        session: session(1, 1),
        summary: { ...summary, again: 0, forgot: 0, remembered: 1 },
      }),
    );
    renderSession(t);
    expect(
      await screen.findByRole('heading', { name: 'Ôn tập hôm nay' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Ôn lại thẻ chưa nhớ' }),
    ).not.toBeInTheDocument();
  });

  it('starts a retry of the finished session on the server, with a new key (Q278)', async () => {
    const t = fake();
    t.current
      .mockResolvedValueOnce(ok({ session: session(0, 1), items: [] }))
      .mockResolvedValueOnce(
        ok({
          session: { ...session(0, 1), sessionId: 42 },
          items: [item(2, '工作')],
        }),
      );
    t.complete.mockResolvedValue(ok({ session: session(1, 1), summary }));
    t.create.mockResolvedValue(
      ok({ created: true, session: { ...session(0, 1), sessionId: 42 } }),
    );
    renderSession(t);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Ôn lại thẻ chưa nhớ' }),
    );
    expect(
      await screen.findByRole('button', { name: /Lật thẻ/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('工作').length).toBeGreaterThan(0);
    expect(t.current).toHaveBeenCalledTimes(2);
    expect(t.create).toHaveBeenCalledTimes(1);
    expect(t.create).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      { retrySessionId: 41 },
    );
  });

  it('says the daily limit is reached and offers the settings (Q282)', async () => {
    const t = fake();
    t.current.mockResolvedValue(fail(404));
    t.create.mockResolvedValue(fail(409, 'REVIEW_DAILY_LIMIT_REACHED'));
    renderSession(t);
    expect(
      await screen.findByRole('heading', {
        name: 'Bạn đã ôn đủ số thẻ hôm nay',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về Ôn tập' })).toHaveAttribute(
      'href',
      '/learn/review',
    );
  });

  it('opens the settings panel from the header (Q279)', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习')] }),
    );
    t.preferences.mockResolvedValue(
      ok({
        dailyCardLimit: 20,
        levelCodes: [],
        levels: [{ code: 'HSK3', name: 'HSK 3' }],
      }),
    );
    renderSession(t);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Cài đặt ôn tập' }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Cài đặt ôn tập' }),
    ).toBeInTheDocument();
  });

  it('shows — when retention is null', async () => {
    const t = fake();
    t.current.mockResolvedValue(ok({ session: session(0, 1), items: [] }));
    t.complete.mockResolvedValue(
      ok({
        session: session(0, 1),
        summary: {
          ...summary,
          remembered: 0,
          forgot: 0,
          retentionPercent: null,
          totalDurationMs: 0,
        },
      }),
    );
    renderSession(t);
    expect(await screen.findByText(/Tỷ lệ ghi nhớ —/)).toBeInTheDocument();
  });

  it('ends the session early only after confirmation', async () => {
    const t = fake();
    t.current.mockResolvedValue(
      ok({ session: session(), items: [item(1, '学习')] }),
    );
    t.complete.mockResolvedValue(ok({ session: session(), summary }));
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderSession(t);
    fireEvent.click(await screen.findByRole('button', { name: /Lật thẻ/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Kết thúc phiên' }));
    expect(t.complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Kết thúc phiên' }));
    expect(
      await screen.findByRole('heading', { name: 'Ôn tập hôm nay' }),
    ).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('sends an unauthorised learner to sign-in', async () => {
    const t = fake();
    t.current.mockResolvedValue(fail(401));
    renderSession(t);
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/sign-in'),
    );
  });
});
