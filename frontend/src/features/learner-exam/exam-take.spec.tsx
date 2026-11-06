import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

import { FORBIDDEN_KEYS } from './exam-forbidden-keys';

import { ExamTake } from './exam-take';
import type { ExamAttemptView } from './exam-take-model';

const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
};
vi.mock('next/navigation', () => ({ useRouter: () => router }));

// The toast hook returns a fresh function on every render: the queue effect
// must not depend on callback identity. The wrapper still delegates to the real
// provider so toast rendering keeps working.
vi.mock(
  import('@/features/learner-shell/learner-toast'),
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      useLearnerToast: () => {
        const show = actual.useLearnerToast();
        return (message: string, tone?: 'status' | 'alert') => {
          show(message, tone);
        };
      },
    };
  },
);

function question(overrides: Record<string, unknown>) {
  return {
    key: 'q1',
    orderIndex: 1,
    type: 'mcq',
    skill: 'reading',
    content: 'Câu hỏi',
    answers: {
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
    },
    audio: null,
    image: null,
    ...overrides,
  };
}

function attempt(overrides: Record<string, unknown> = {}): ExamAttemptView {
  const value: ExamAttemptView = {
    id: 41,
    testId: 7,
    status: 'in_progress',
    startedAt: '2026-10-27T09:00:00.000Z',
    expiresAt: '2026-10-27T10:30:00.000Z',
    serverNow: '2026-10-27T09:00:00.000Z',
    remainingSeconds: 5_400,
    maxScore: 200,
    questionCount: 2,
    test: {
      title: 'Đề thi',
      instruction: null,
      levelCode: 'HSK4',
      durationMinutes: 90,
      passScore: 120,
    },
    sections: [
      {
        key: 's1',
        orderIndex: 1,
        title: 'Đọc hiểu',
        instruction: null,
        skill: 'reading',
        groups: [
          {
            key: 's1-g1',
            orderIndex: 1,
            title: null,
            instruction: 'Chọn đáp án đúng.',
            content: null,
            audio: null,
            image: null,
            questions: [question({}), question({ key: 'q2', orderIndex: 2 })],
          },
        ],
      },
    ],
    answers: [],
    ...overrides,
  } as ExamAttemptView;
  return value;
}

function media(kind: 'audio' | 'image', mediaId: number) {
  return {
    mediaId,
    kind,
    mimeType: kind === 'audio' ? 'audio/mpeg' : 'image/png',
    durationMs: null,
  };
}

function singleQuestionAttempt(
  overrides: Record<string, unknown>,
): ExamAttemptView {
  return attempt({
    sections: [
      {
        key: 's1',
        orderIndex: 1,
        title: 'Đọc hiểu',
        instruction: null,
        skill: 'reading',
        groups: [
          {
            key: 's1-g1',
            orderIndex: 1,
            title: null,
            instruction: null,
            content: null,
            audio: null,
            image: null,
            questions: [question(overrides)],
          },
        ],
      },
    ],
  });
}

function renderTake(props: ExamAttemptView) {
  return render(
    <LearnerToastProvider>
      <ExamTake attempt={props} />
    </LearnerToastProvider>,
  );
}

async function settleFetch(): Promise<void> {
  for (let index = 0; index < 40; index += 1) {
    await new Promise<void>((resolve) => resolve());
  }
}

function savedView(questionKey: string, version: number, answer: unknown) {
  return {
    questionKey,
    answer,
    isFlagged: false,
    version,
    answeredAt: '2026-10-27T09:00:00.000Z',
    lastSavedAt: '2026-10-27T09:00:00.000Z',
    serverNow: '2026-10-27T09:00:00.000Z',
    remainingSeconds: 5_400,
  };
}

let putBodies: Array<Record<string, unknown>> = [];
let putInits: RequestInit[] = [];
let putHandler: (url: string, body: Record<string, unknown>) => Response;
let submitBodies: Array<Record<string, unknown>> = [];
let fetchOrder: string[] = [];
let submitHandler: (
  url: string,
  body: Record<string, unknown>,
) => Response | Promise<Response>;

function submitView(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 41,
    status: 'submitted',
    submittedAt: '2026-10-27T09:05:00.000Z',
    serverNow: '2026-10-27T09:05:00.000Z',
    answeredCount: 0,
    unansweredCount: 2,
    flaggedCount: 0,
    replayed: false,
    ...overrides,
  };
}

function mockFetch() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/media-grants')) {
      return Response.json({
        success: true,
        data: { grants: [], unavailable: [] },
      });
    }
    if (url.endsWith('/submit') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      submitBodies.push(body);
      fetchOrder.push('post');
      return submitHandler(url, body);
    }
    if (url.includes('/answers') && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      putBodies.push(body);
      fetchOrder.push('put');
      if (init !== undefined) putInits.push(init);
      return putHandler(url, body);
    }
    return Response.json({ success: true, data: attempt() });
  });
}

beforeEach(() => {
  // jsdom has no modal dialog implementation; the island only needs it to open.
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
  putBodies = [];
  putInits = [];
  submitBodies = [];
  fetchOrder = [];
  submitHandler = () => Response.json({ success: true, data: submitView() });
  putHandler = (_url, body) => {
    const key = String(body.questionKey ?? 'q1');
    return Response.json({
      success: true,
      data: savedView(key, 2, body.answer ?? null),
    });
  };
  mockFetch();
  vi.clearAllMocks();
});

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ExamTake island logic (D)', () => {
  it('D1 sends the seeded expectedVersion when editing an answered question', async () => {
    const props = attempt({
      answers: [
        {
          questionKey: 'q1',
          answer: { choice: 'a' },
          isFlagged: false,
          version: 3,
          answeredAt: '2026-10-27T09:00:00.000Z',
          lastSavedAt: '2026-10-27T09:00:00.000Z',
        },
      ],
    });
    renderTake(props);
    // The first unanswered question is q2, so jump back to q1 to edit it.
    fireEvent.click(screen.getByRole('button', { name: /^Câu 1,/u }));
    fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement);
    await waitFor(() => expect(putBodies.length).toBeGreaterThan(0));
    expect(putBodies[0]).toMatchObject({
      answer: { choice: 'b' },
      expectedVersion: 3,
    });
  });

  it('D2 locks the answers and shows the Q127 copy when remainingSeconds is 0', () => {
    renderTake(attempt({ remainingSeconds: 0 }));
    expect(screen.getByText('Hết giờ. Bài làm đã được lưu.')).toBeDefined();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('D4 shows the offline banner and flushes from "Thử lại"', async () => {
    let putCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        putCount += 1;
        if (putCount === 1) throw new TypeError('Failed to fetch');
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({
          success: true,
          data: savedView(
            String(body.questionKey ?? 'q1'),
            2,
            body.answer ?? null,
          ),
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    renderTake(attempt());
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((status) =>
            (status.textContent ?? '').includes('Không kết nối được máy chủ'),
          ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(putCount).toBeGreaterThan(1));
  });

  it('D5 keeps an arrange draft without PUT until every token is placed', async () => {
    const props = attempt({
      answers: [],
      sections: [
        {
          key: 's1',
          orderIndex: 1,
          title: 'Đọc hiểu',
          instruction: null,
          skill: 'reading',
          groups: [
            {
              key: 's1-g1',
              orderIndex: 1,
              title: null,
              instruction: null,
              content: null,
              audio: null,
              image: null,
              questions: [
                question({
                  key: 'q1',
                  type: 'arrange_sentence',
                  content: 'Sắp xếp',
                  answers: {
                    tokens: [
                      { id: 't1', text: '一' },
                      { id: 't2', text: '二' },
                      { id: 't3', text: '三' },
                    ],
                  },
                }),
              ],
            },
          ],
        },
      ],
    });
    renderTake(props);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 一' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 二' }));
    expect(putBodies).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 三' }));
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({
      answer: { order: ['t1', 't2', 't3'] },
    });
  });

  it('D9 opens one submit dialog from the footer and the panel with the current counts', () => {
    renderTake(
      attempt({
        answers: [
          {
            questionKey: 'q1',
            answer: { choice: 'a' },
            isFlagged: true,
            version: 1,
            answeredAt: '2026-10-27T09:00:00.000Z',
            lastSavedAt: '2026-10-27T09:00:00.000Z',
          },
        ],
      }),
    );
    const footer = screen.getByRole('contentinfo');
    fireEvent.click(within(footer).getByRole('button', { name: 'Nộp bài' }));
    let dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Nộp bài?' }),
    ).toBeDefined();
    expect(dialog.textContent).toContain('Bạn còn 1 câu chưa làm.');
    expect(dialog.textContent).toContain('1 câu đã đánh dấu.');
    expect(dialog.textContent).toContain('Sau khi nộp, bạn không thể sửa bài.');
    expect(screen.queryByText('Tính năng sắp ra mắt.')).toBeNull();
    expect(submitBodies).toHaveLength(0);

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Tiếp tục làm' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    const panel = screen.getByRole('complementary', {
      name: 'Danh sách câu',
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Nộp bài' }));
    dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Nộp bài?' }),
    ).toBeDefined();
  });

  it('D10 hides "Câu sau" on the last question', () => {
    renderTake(attempt());
    fireEvent.click(screen.getByRole('button', { name: 'Câu sau' }));
    expect(screen.queryByRole('button', { name: 'Câu sau' })).toBeNull();
  });

  it('V4: the last-question submit opens the same dialog instead of toasting', () => {
    renderTake(attempt());
    fireEvent.click(screen.getByRole('button', { name: 'Câu sau' }));
    const nav = screen.getByRole('navigation', {
      name: 'Điều hướng câu hỏi',
    });
    fireEvent.click(within(nav).getByRole('button', { name: 'Nộp bài' }));
    expect(
      within(screen.getByRole('dialog')).getByRole('heading', {
        name: 'Nộp bài?',
      }),
    ).toBeDefined();
    expect(screen.queryByText('Tính năng sắp ra mắt.')).toBeNull();
    expect(submitBodies).toHaveLength(0);
  });

  it('D11 never renders a forbidden R11 key', () => {
    const { container } = renderTake(attempt());
    const serialized = `${container.innerHTML}${JSON.stringify(attempt())}`;
    // R1 (2c-c): dùng chung danh sách với route handler/e2e thay vì chép tay
    // (bản chép tay trước đây thiếu `optionId`).
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('D12 flushes a debounced fill on hidden and on pagehide', async () => {
    vi.useFakeTimers();
    const props = attempt({
      sections: [
        {
          key: 's1',
          orderIndex: 1,
          title: 'Đọc hiểu',
          instruction: null,
          skill: 'reading',
          groups: [
            {
              key: 's1-g1',
              orderIndex: 1,
              title: null,
              instruction: null,
              content: null,
              audio: null,
              image: null,
              questions: [
                question({
                  key: 'q1',
                  type: 'fill_blank',
                  content: 'Điền',
                  answers: {},
                }),
              ],
            },
          ],
        },
      ],
    });
    renderTake(props);
    const input = screen.getByLabelText('Câu trả lời của bạn');
    fireEvent.change(input, { target: { value: 'a b' } });
    await Promise.resolve();
    expect(putBodies).toHaveLength(0);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    // Assert before the 600 ms debounce could fire on its own.
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(putBodies).toHaveLength(1);
    expect(putBodies[0]).toMatchObject({ answer: { text: 'a b' } });

    fireEvent.change(input, { target: { value: 'c d' } });
    await Promise.resolve();
    window.dispatchEvent(new Event('pagehide'));
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(putBodies).toHaveLength(2);
    expect(putBodies[1]).toMatchObject({ answer: { text: 'c d' } });
    vi.useRealTimers();
  });

  it('D12b flushes a debounced fill on pagehide while the tab is still visible', async () => {
    vi.useFakeTimers();
    const props = attempt({
      sections: [
        {
          key: 's1',
          orderIndex: 1,
          title: 'Đọc hiểu',
          instruction: null,
          skill: 'reading',
          groups: [
            {
              key: 's1-g1',
              orderIndex: 1,
              title: null,
              instruction: null,
              content: null,
              audio: null,
              image: null,
              questions: [
                question({
                  key: 'q1',
                  type: 'fill_blank',
                  content: 'Điền',
                  answers: {},
                }),
              ],
            },
          ],
        },
      ],
    });
    renderTake(props);
    const input = screen.getByLabelText('Câu trả lời của bạn');
    fireEvent.change(input, { target: { value: 'p q' } });
    await Promise.resolve();
    // Fake timers never advance, so the 600 ms debounce cannot have fired.
    expect(putBodies).toHaveLength(0);
    // D12 above restored the jsdom default; only `pagehide` may flush here.
    expect(document.visibilityState).toBe('visible');
    window.dispatchEvent(new Event('pagehide'));
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(putBodies).toHaveLength(1);
    expect(putBodies[0]).toMatchObject({ answer: { text: 'p q' } });
    vi.useRealTimers();
  });

  it('task5 keeps versions and pending state when the island re-renders', async () => {
    putHandler = (_url, body) =>
      Response.json({
        success: true,
        data: savedView(
          String(body.questionKey ?? 'q1'),
          1,
          body.answer ?? null,
        ),
      });
    const view = renderTake(attempt());
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({ expectedVersion: null });

    // The route page re-renders the island with a new `attempt` object that
    // keeps the same id; the queue must not be recreated and lose version 1.
    view.rerender(
      <LearnerToastProvider>
        <ExamTake attempt={attempt()} />
      </LearnerToastProvider>,
    );
    fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement);
    await waitFor(() => expect(putBodies).toHaveLength(2));
    expect(putBodies[1]).toMatchObject({
      answer: { choice: 'b' },
      expectedVersion: 1,
    });
  });

  it('task1: quitting force-flushes a question that is waiting for backoff', async () => {
    const order: string[] = [];
    let putCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        putBodies.push(body);
        putCount += 1;
        order.push(`put${String(putCount)}`);
        if (putCount === 1) {
          return Response.json(
            { success: false, error: { code: 'EXAM_UNAVAILABLE' } },
            { status: 503 },
          );
        }
        return Response.json({
          success: true,
          data: savedView(
            String(body.questionKey ?? 'q1'),
            2,
            body.answer ?? null,
          ),
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    router.push.mockImplementation(() => {
      order.push('push');
    });
    renderTake(attempt());
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    // The first PUT fails as unavailable, so q1 waits for its backoff timer.
    await waitFor(() => expect(putBodies).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Thoát bài thi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thoát' }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(putBodies).toHaveLength(2);
    expect(putBodies[1]?.idempotencyKey).toBe(putBodies[0]?.idempotencyKey);
    expect(order.indexOf('put2')).toBeLessThan(order.indexOf('push'));
  });

  it('task5 fill: a conflict drops the draft and shows the server text', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        return Response.json(
          { success: false, error: { code: 'EXAM_ANSWER_VERSION_CONFLICT' } },
          { status: 409 },
        );
      }
      return Response.json({
        success: true,
        data: {
          answers: [
            {
              questionKey: 'q1',
              answer: { text: 'server text' },
              isFlagged: false,
              version: 7,
            },
          ],
          status: 'in_progress',
        },
      });
    });
    renderTake(
      singleQuestionAttempt({
        key: 'q1',
        type: 'fill_blank',
        content: 'Điền',
        answers: {},
      }),
    );
    const input = screen.getByLabelText('Câu trả lời của bạn');
    fireEvent.change(input, { target: { value: 'local text' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Câu trả lời của bạn') as HTMLInputElement)
          .value,
      ).toBe('server text'),
    );
  });

  it('task5 arrange: a conflict drops the draft and shows the server order', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        return Response.json(
          { success: false, error: { code: 'EXAM_ANSWER_VERSION_CONFLICT' } },
          { status: 409 },
        );
      }
      return Response.json({
        success: true,
        data: {
          answers: [
            {
              questionKey: 'q1',
              answer: { order: ['t2', 't1'] },
              isFlagged: false,
              version: 7,
            },
          ],
          status: 'in_progress',
        },
      });
    });
    renderTake(
      singleQuestionAttempt({
        key: 'q1',
        type: 'arrange_sentence',
        content: 'Sắp xếp',
        answers: {
          tokens: [
            { id: 't1', text: '一' },
            { id: 't2', text: '二' },
          ],
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 一' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thêm 二' }));
    await waitFor(() => {
      const row = screen.getByRole('group', {
        name: 'Câu trả lời của bạn',
      });
      expect(
        within(row)
          .getAllByRole('button')
          .map((button) => button.textContent?.trim()),
      ).toEqual(['二', '一']);
    });
  });

  it('task5 mcq: a stale refresh does not overwrite the newer choice', async () => {
    let resolvePut: ((value: Response) => void) | undefined;
    let putCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        putCount += 1;
        if (putCount === 1) {
          return new Promise<Response>((resolve) => {
            resolvePut = resolve;
          });
        }
        // The resend of the newer edit stays in flight, so the assertion below
        // sees exactly what the stale refresh did to the screen.
        return new Promise<Response>(() => undefined);
      }
      return Response.json({
        success: true,
        data: {
          answers: [
            {
              questionKey: 'q1',
              answer: { choice: 'b' },
              isFlagged: false,
              version: 7,
            },
          ],
          status: 'in_progress',
        },
      });
    });
    renderTake(attempt());
    fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement);
    await settleFetch();
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await settleFetch();
    resolvePut?.(
      Response.json(
        { success: false, error: { code: 'EXAM_ANSWER_VERSION_CONFLICT' } },
        { status: 409 },
      ),
    );
    await settleFetch();
    await waitFor(() => expect(putCount).toBe(2));
    // Let React flush the async queue callbacks before reading the screen.
    await act(async () => undefined);
    expect(screen.getAllByRole('radio')[0]?.getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getAllByRole('radio')[1]?.getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('task6: a 409 CLOSED grants response locks with the closed message', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json(
          {
            success: false,
            error: { code: 'EXAM_ATTEMPT_CLOSED' },
          },
          { status: 409 },
        );
      }
      return Response.json({ success: true, data: attempt() });
    });
    renderTake(singleQuestionAttempt({ audio: media('audio', 9) }));
    expect(await screen.findByText('Bài thi đã kết thúc.')).toBeDefined();
  });

  it('task6: a 401 grants response sends the learner to sign-in', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json(
          { success: false, error: { code: 'EXAM_UNAUTHORIZED' } },
          { status: 401 },
        );
      }
      return Response.json({ success: true, data: attempt() });
    });
    renderTake(singleQuestionAttempt({ audio: media('audio', 9) }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/sign-in'),
    );
  });

  it('G1: bài đã khoá lúc mount thì không gọi media-grants (2c)', async () => {
    const locked = {
      ...singleQuestionAttempt({ audio: media('audio', 9) }),
      remainingSeconds: 0,
    };
    renderTake(locked);
    await settleFetch();
    const urls = vi
      .mocked(globalThis.fetch)
      .mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.endsWith('/media-grants'))).toHaveLength(0);
    // R12 (TL-148): mount trong trạng thái khoá thì preloader không được tạo
    // request content nào.
    expect(
      urls.filter(
        (url) => /\/media\/\d+/u.test(url) && !url.endsWith('/media-grants'),
      ),
    ).toHaveLength(0);
  });

  it('G1: khoá giữa phiên thì ngừng gọi lại media-grants khi media lỗi (2c)', async () => {
    let grantsFetches = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        return Response.json({
          success: true,
          data: {
            grants: [
              {
                mediaId: 9,
                src: '/media/9',
                expiresAt: new Date(Date.now() + 280_000).toISOString(),
              },
            ],
            unavailable: [],
          },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        return Response.json(
          { success: false, error: { code: 'EXAM_ATTEMPT_CLOSED' } },
          { status: 409 },
        );
      }
      return Response.json({ success: true, data: attempt() });
    });
    const { container } = renderTake(
      singleQuestionAttempt({ audio: media('audio', 9) }),
    );
    await waitFor(() => expect(grantsFetches).toBe(1));
    // Khoá giữa phiên: save trả 409 EXAM_ATTEMPT_CLOSED.
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await waitFor(() =>
      expect(screen.getByText('Bài thi đã kết thúc.')).toBeDefined(),
    );
    expect(grantsFetches).toBe(1);
    const audioEl = container.querySelector('audio');
    expect(audioEl).not.toBeNull();
    fireEvent.error(audioEl as HTMLAudioElement);
    await settleFetch();
    expect(grantsFetches).toBe(1);
  });

  it('task6: switching to a media whose grant expires soon refetches grants', async () => {
    let grantsFetches = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        const expiresAt =
          grantsFetches === 1
            ? new Date(Date.now() + 10_000).toISOString()
            : new Date(Date.now() + 280_000).toISOString();
        return Response.json({
          success: true,
          data: {
            grants: [{ mediaId: 9, src: '/media/9', expiresAt }],
            unavailable: [],
          },
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    renderTake(
      attempt({
        sections: [
          {
            key: 's1',
            orderIndex: 1,
            title: 'Đọc hiểu',
            instruction: null,
            skill: 'reading',
            groups: [
              {
                key: 's1-g1',
                orderIndex: 1,
                title: null,
                instruction: null,
                content: null,
                audio: null,
                image: null,
                questions: [
                  question({}),
                  question({
                    key: 'q2',
                    orderIndex: 2,
                    image: media('image', 9),
                  }),
                ],
              },
            ],
          },
        ],
      }),
    );
    await waitFor(() => expect(grantsFetches).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Câu sau' }));
    await waitFor(() => expect(grantsFetches).toBe(2));
    // The refreshed grant is fresh, so moving back and forth must not refetch.
    fireEvent.click(screen.getByRole('button', { name: 'Câu trước' }));
    fireEvent.click(screen.getByRole('button', { name: 'Câu sau' }));
    await settleFetch();
    expect(grantsFetches).toBe(2);
  });

  it('task6: an image error refetches grants exactly once', async () => {
    let grantsFetches = 0;
    const farExpiry = new Date(Date.now() + 280_000).toISOString();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        return Response.json({
          success: true,
          data: {
            grants: [{ mediaId: 9, src: '/media/9', expiresAt: farExpiry }],
            unavailable: [],
          },
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    renderTake(singleQuestionAttempt({ image: media('image', 9) }));
    const image = await screen.findByRole('img', { name: /Hình minh hoạ/ });
    await waitFor(() => expect(grantsFetches).toBe(1));
    fireEvent.error(image);
    await waitFor(() => expect(grantsFetches).toBe(2));
    fireEvent.error(screen.getByRole('img', { name: /Hình minh hoạ/ }));
    await settleFetch();
    expect(grantsFetches).toBe(2);
  });

  it('task6: re-rendering with the same attempt id does not refetch grants', async () => {
    let grantsFetches = 0;
    const farExpiry = new Date(Date.now() + 280_000).toISOString();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        return Response.json({
          success: true,
          data: {
            grants: [{ mediaId: 9, src: '/media/9', expiresAt: farExpiry }],
            unavailable: [],
          },
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    const view = renderTake(
      singleQuestionAttempt({ image: media('image', 9) }),
    );
    await waitFor(() => expect(grantsFetches).toBe(1));
    view.rerender(
      <LearnerToastProvider>
        <ExamTake
          attempt={singleQuestionAttempt({ image: media('image', 9) })}
        />
      </LearnerToastProvider>,
    );
    await settleFetch();
    expect(grantsFetches).toBe(1);
  });

  it('task1: an audio load error before play only refreshes the grant', async () => {
    let grantsFetches = 0;
    const farExpiry = new Date(Date.now() + 280_000).toISOString();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        return Response.json({
          success: true,
          data: {
            grants: [
              {
                mediaId: 9,
                src: `/media/9?v=${String(grantsFetches)}`,
                expiresAt: farExpiry,
              },
            ],
            unavailable: [],
          },
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const view = renderTake(
      singleQuestionAttempt({ audio: media('audio', 9) }),
    );
    await waitFor(() => expect(grantsFetches).toBe(1));
    expect(screen.getByRole('button', { name: 'Phát' })).toBeDefined();
    const audio = view.container.querySelector('audio');
    expect(audio).not.toBeNull();
    fireEvent.error(audio as HTMLAudioElement);
    await waitFor(() => expect(grantsFetches).toBe(2));
    await settleFetch();
    expect(play).not.toHaveBeenCalled();
    expect(screen.queryByText('Không tải được âm thanh.')).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Phát' })
        .getAttribute('aria-disabled'),
    ).toBeNull();
    const speedGroup = screen.getByRole('group', {
      name: 'Tốc độ phát phần nghe',
    });
    for (const button of within(speedGroup).getAllByRole('button')) {
      expect(button.getAttribute('aria-disabled')).toBeNull();
    }
  });

  it('task1: replaying after an audio error keeps the single listen', async () => {
    let grantsFetches = 0;
    const farExpiry = new Date(Date.now() + 280_000).toISOString();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        return Response.json({
          success: true,
          data: {
            grants: [
              {
                mediaId: 9,
                src: `/media/9?v=${String(grantsFetches)}`,
                expiresAt: farExpiry,
              },
            ],
            unavailable: [],
          },
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const view = renderTake(
      singleQuestionAttempt({ audio: media('audio', 9) }),
    );
    await waitFor(() => expect(grantsFetches).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Phát' }));
    await settleFetch();
    expect(play).toHaveBeenCalledTimes(1);
    const audio = view.container.querySelector('audio');
    fireEvent.error(audio as HTMLAudioElement);
    await waitFor(() => expect(grantsFetches).toBe(2));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    fireEvent.ended(audio as HTMLAudioElement);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Đã nghe' })).toBeDefined(),
    );
    expect(screen.getAllByText('Đã nghe')).toHaveLength(1);
  });

  it('task1: an error does not replay after the learner moves to another question', async () => {
    let grantsFetches = 0;
    let resolveGrants: ((value: Response) => void) | undefined;
    const farExpiry = new Date(Date.now() + 280_000).toISOString();
    const grantsPayload = () => ({
      success: true,
      data: {
        grants: [
          { mediaId: 9, src: '/media/9', expiresAt: farExpiry },
          { mediaId: 10, src: '/media/10', expiresAt: farExpiry },
        ],
        unavailable: [],
      },
    });
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        if (grantsFetches === 1) return Response.json(grantsPayload());
        return new Promise<Response>((resolve) => {
          resolveGrants = resolve;
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const twoAudio = attempt({
      sections: [
        {
          key: 's1',
          orderIndex: 1,
          title: 'Nghe hiểu',
          instruction: null,
          skill: 'listening',
          groups: [
            {
              key: 's1-g1',
              orderIndex: 1,
              title: null,
              instruction: null,
              content: null,
              audio: null,
              image: null,
              questions: [
                question({ key: 'q1', audio: media('audio', 9) }),
                question({
                  key: 'q2',
                  orderIndex: 2,
                  audio: media('audio', 10),
                }),
              ],
            },
          ],
        },
      ],
    });
    const view = renderTake(twoAudio);
    await waitFor(() => expect(grantsFetches).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Phát' }));
    await settleFetch();
    expect(play).toHaveBeenCalledTimes(1);
    const audio = view.container.querySelector('audio');
    fireEvent.error(audio as HTMLAudioElement);
    await waitFor(() => expect(grantsFetches).toBe(2));
    // The learner moves to the next question while the grants are loading.
    fireEvent.click(screen.getByRole('button', { name: 'Câu sau' }));
    await settleFetch();
    resolveGrants?.(Response.json(grantsPayload()));
    await settleFetch();
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Câu trước' }));
    await settleFetch();
    expect(screen.getByRole('button', { name: 'Phát' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Đã nghe' })).toBeNull();
  });

  it('task2: unmount force-flushes a debounced fill with keepalive', async () => {
    const view = renderTake(
      singleQuestionAttempt({
        key: 'q1',
        type: 'fill_blank',
        content: 'Điền',
        answers: {},
      }),
    );
    fireEvent.change(screen.getByLabelText('Câu trả lời của bạn'), {
      target: { value: 'abc' },
    });
    await settleFetch();
    expect(putBodies).toHaveLength(0);
    view.unmount();
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({ answer: { text: 'abc' } });
    expect(putInits[0]?.keepalive).toBe(true);
  });

  it('task2: unmount force-flushes a question that is waiting for backoff', async () => {
    let putCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        putBodies.push(body);
        if (init !== undefined) putInits.push(init);
        putCount += 1;
        if (putCount === 1) {
          return Response.json(
            { success: false, error: { code: 'EXAM_UNAVAILABLE' } },
            { status: 503 },
          );
        }
        return Response.json({
          success: true,
          data: savedView(
            String(body.questionKey ?? 'q1'),
            2,
            body.answer ?? null,
          ),
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    const view = renderTake(attempt());
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await waitFor(() => expect(putBodies).toHaveLength(1));
    view.unmount();
    await waitFor(() => expect(putBodies).toHaveLength(2));
    expect(putBodies[1]?.idempotencyKey).toBe(putBodies[0]?.idempotencyKey);
    expect(putInits[1]?.keepalive).toBe(true);
  });

  it('task4: online keeps the offline banner until a save succeeds', async () => {
    let putCount = 0;
    let resolveRetry: ((value: Response) => void) | undefined;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        putBodies.push(body);
        if (init !== undefined) putInits.push(init);
        putCount += 1;
        if (putCount === 1) throw new TypeError('Failed to fetch');
        if (putCount === 2) {
          return new Promise<Response>((resolve) => {
            resolveRetry = resolve;
          });
        }
        return Response.json({
          success: true,
          data: savedView(
            String(body.questionKey ?? 'q1'),
            2,
            body.answer ?? null,
          ),
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    renderTake(attempt());
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Thử lại' })).toBeDefined(),
    );
    window.dispatchEvent(new Event('online'));
    await settleFetch();
    // Flush React's pending update from the `online` handler deterministically.
    await act(async () => undefined);
    expect(putBodies).toHaveLength(2);
    // The retry is still in flight: the banner must stay until a save works.
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeDefined();
    resolveRetry?.(
      Response.json(
        { success: false, error: { code: 'EXAM_UNAVAILABLE' } },
        { status: 503 },
      ),
    );
    await settleFetch();
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull(),
    );
  });

  it('F28: one main landmark; header, main and footer are siblings', () => {
    const view = renderTake(attempt());
    expect(screen.getAllByRole('main')).toHaveLength(1);
    const main = screen.getByRole('main');
    const header = screen.getByRole('banner');
    const footer = screen.getByRole('contentinfo');
    expect(main.parentElement).toBe(header.parentElement);
    expect(footer.parentElement).toBe(header.parentElement);
    const dialog = view.container.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(main.contains(dialog)).toBe(false);
  });

  it('F22: fill_blank renders its content once and keeps ids unique', () => {
    const view = renderTake(
      singleQuestionAttempt({
        type: 'fill_blank',
        content: 'Điền từ',
        answers: {},
      }),
    );
    const occurrences = (view.container.textContent ?? '').split(
      'Điền từ',
    ).length;
    expect(occurrences - 1).toBe(1);
    const ids = [...view.container.querySelectorAll('[id]')].map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === 'ex-q')).toHaveLength(1);
  });

  it('F22: arrange_sentence renders its content once and keeps ids unique', () => {
    const view = renderTake(
      singleQuestionAttempt({
        type: 'arrange_sentence',
        content: 'Ghép câu này',
        answers: {
          tokens: [
            { id: 't1', text: '一' },
            { id: 't2', text: '二' },
          ],
        },
      }),
    );
    const occurrences = (view.container.textContent ?? '').split(
      'Ghép câu này',
    ).length;
    expect(occurrences - 1).toBe(1);
    const ids = [...view.container.querySelectorAll('[id]')].map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id === 'ex-q')).toHaveLength(1);
  });

  it('F21: navigation is a labelled landmark and the last question has no next', () => {
    renderTake(attempt());
    const nav = screen.getByRole('navigation', {
      name: 'Điều hướng câu hỏi',
    });
    expect(
      within(nav)
        .getByRole('button', { name: 'Câu trước' })
        .querySelector('use')
        ?.getAttribute('href'),
    ).toBe('#i-chevron-left');
    expect(
      within(nav)
        .getByRole('button', { name: 'Câu sau' })
        .querySelector('use')
        ?.getAttribute('href'),
    ).toBe('#i-chevron-right');
    fireEvent.click(within(nav).getByRole('button', { name: 'Câu sau' }));
    expect(screen.queryByRole('button', { name: 'Câu sau' })).toBeNull();
    expect(
      screen.getByRole('navigation', { name: 'Điều hướng câu hỏi' }),
    ).toBeDefined();
  });

  it('F26/F27: the check icon only shows with Đã lưu and the count is announced', async () => {
    let resolveSave: ((value: Response) => void) | undefined;
    let putCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        putBodies.push(body);
        putCount += 1;
        if (putCount === 1) {
          return new Promise<Response>((resolve) => {
            resolveSave = resolve;
          });
        }
        return Response.json({
          success: true,
          data: savedView('q1', 4, body.answer ?? null),
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    renderTake(attempt());
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((status) => (status.textContent ?? '').includes('Đang lưu…')),
      ).toBe(true),
    );
    expect(screen.queryByTestId('exam-saved-check')).toBeNull();
    resolveSave?.(
      Response.json({
        success: true,
        data: savedView('q1', 2, { choice: 'a' }),
      }),
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((status) => (status.textContent ?? '').includes('Đã lưu')),
      ).toBe(true),
    );
    expect(screen.getByTestId('exam-saved-check')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Câu sau' }));
    await settleFetch();
    expect(screen.getByTestId('exam-count-live').textContent).toBe(
      'Câu 2 trên 2',
    );
  });

  it('F26: a locked exam has no saved check', () => {
    renderTake(attempt({ remainingSeconds: 0 }));
    expect(screen.queryByTestId('exam-saved-check')).toBeNull();
  });

  it('F24/F25/D7: speed before play sets playbackRate, ended locks, wave fills by progress', async () => {
    const farExpiry = new Date(Date.now() + 280_000).toISOString();
    let grantsFetches = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        return Response.json({
          success: true,
          data: {
            grants: [{ mediaId: 9, src: '/media/9', expiresAt: farExpiry }],
            unavailable: [],
          },
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const view = renderTake(
      attempt({
        sections: [
          {
            key: 's1',
            orderIndex: 1,
            title: 'Nghe hiểu',
            instruction: null,
            skill: 'listening',
            groups: [
              {
                key: 's1-g1',
                orderIndex: 1,
                title: null,
                instruction: null,
                content: null,
                audio: null,
                image: null,
                questions: [
                  question({ key: 'q1', audio: media('audio', 9) }),
                  question({ key: 'q2', orderIndex: 2 }),
                ],
              },
            ],
          },
        ],
      }),
    );
    await waitFor(() => expect(grantsFetches).toBe(1));
    await settleFetch();
    const speedGroup = screen.getByRole('group', {
      name: 'Tốc độ phát phần nghe',
    });
    const playButton = screen.getByRole('button', { name: 'Phát' });
    expect(
      speedGroup.compareDocumentPosition(playButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(within(speedGroup).getByRole('button', { name: '0,75×' }));
    expect(
      within(speedGroup)
        .getByRole('button', { name: '0,75×' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(playButton);
    await settleFetch();
    const audio = view.container.querySelector('audio') as HTMLAudioElement;
    expect(audio.playbackRate).toBe(0.75);
    expect(play).toHaveBeenCalledTimes(1);

    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: 10,
    });
    Object.defineProperty(audio, 'currentTime', {
      configurable: true,
      value: 5,
    });
    fireEvent.timeUpdate(audio);
    const bars = [...view.container.querySelectorAll('[data-played]')];
    const playedBars = bars.filter(
      (bar) => bar.getAttribute('data-played') === 'true',
    );
    expect(playedBars.length).toBeGreaterThan(0);
    expect(playedBars.length).toBeLessThan(bars.length);
    expect(bars[0]?.getAttribute('data-played')).toBe('true');
    expect(bars.at(-1)?.getAttribute('data-played')).toBe('false');

    fireEvent.ended(audio);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Đã nghe' })).toBeDefined(),
    );
    expect(
      screen
        .getByRole('button', { name: 'Đã nghe' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Câu sau' }));
    fireEvent.click(screen.getByRole('button', { name: 'Câu trước' }));
    expect(screen.getByRole('button', { name: 'Đã nghe' })).toBeDefined();
  });

  it('Q124: a locked attempt disables every submit entry', () => {
    renderTake(attempt({ remainingSeconds: 0 }));
    const submitButtons = screen
      .getAllByRole('button')
      .filter((button) => /Nộp bài/u.test(button.textContent ?? ''));
    expect(submitButtons.length).toBeGreaterThan(0);
    for (const button of submitButtons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('D3: expiring with one unsaved question shows the unsaved line', async () => {
    let resolveExpired: ((value: Response) => void) | undefined;
    let putCount = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        putCount += 1;
        if (putCount === 1) {
          return new Promise<Response>((resolve) => {
            resolveExpired = resolve;
          });
        }
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Response.json({
          success: true,
          data: savedView('q2', 2, body.answer ?? null),
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    renderTake(attempt());
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await settleFetch();
    fireEvent.click(screen.getByRole('button', { name: 'Câu sau' }));
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await settleFetch();
    resolveExpired?.(
      Response.json(
        { success: false, error: { code: 'EXAM_ATTEMPT_EXPIRED' } },
        { status: 409 },
      ),
    );
    expect(
      await screen.findByText('Hết giờ. Bài làm đã được lưu.'),
    ).toBeDefined();
    expect(
      screen.getByText('Có câu chưa lưu được trước khi hết giờ.'),
    ).toBeDefined();
  });

  it('D6: fill sends the trimmed text on blur', async () => {
    renderTake(
      singleQuestionAttempt({
        type: 'fill_blank',
        content: 'Điền',
        answers: {},
      }),
    );
    const input = screen.getByLabelText('Câu trả lời của bạn');
    fireEvent.change(input, { target: { value: 'a b' } });
    fireEvent.blur(input);
    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toMatchObject({ answer: { text: 'a b' } });
  });

  it('D6: clearing a question without a version sends nothing', async () => {
    renderTake(
      singleQuestionAttempt({
        type: 'fill_blank',
        content: 'Điền',
        answers: {},
      }),
    );
    const input = screen.getByLabelText('Câu trả lời của bạn');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: '' } });
    await settleFetch();
    expect(putBodies).toHaveLength(0);
  });

  it('D6: clearing a saved question sends answer null', async () => {
    const props = singleQuestionAttempt({
      type: 'fill_blank',
      content: 'Điền',
      answers: {},
    });
    props.answers = [
      {
        questionKey: 'q1',
        answer: { text: 'cũ' },
        isFlagged: false,
        version: 3,
        answeredAt: '2026-10-27T09:00:00.000Z',
        lastSavedAt: '2026-10-27T09:00:00.000Z',
      },
    ];
    renderTake(props);
    const input = screen.getByLabelText('Câu trả lời của bạn');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() => expect(putBodies.length).toBeGreaterThan(0));
    expect(putBodies.some((body) => body.answer === null)).toBe(true);
  });

  it('D8: the quit dialog explains Q125, restores focus, closes on Esc and exits', async () => {
    renderTake(attempt());
    const trigger = screen.getByRole('button', { name: 'Thoát bài thi' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Thoát bài thi?' }),
    ).toBeDefined();
    expect(dialog.textContent).toContain('Đồng hồ vẫn chạy');
    expect(dialog.textContent).toContain('Bài làm đã được lưu');
    expect(dialog.textContent).toContain('quay lại làm tiếp');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Tiếp tục làm' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const reopened = screen.getByRole('dialog');
    // In a browser Esc fires `cancel` on the modal dialog.
    fireEvent(reopened, new Event('cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();

    let resolveSave: ((value: Response) => void) | undefined;
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        putBodies.push(body);
        return new Promise<Response>((resolve) => {
          resolveSave = resolve;
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await settleFetch();
    expect(putBodies).toHaveLength(1);
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Thoát',
      }),
    );
    await settleFetch();
    expect(router.push).not.toHaveBeenCalled();
    resolveSave?.(
      Response.json({
        success: true,
        data: savedView('q1', 2, { choice: 'a' }),
      }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/learn/exam/7'),
    );
  });
});

/**
 * R12 (TL-145…TL-147): audio tải trước thành blob và `src` bị ghim trong lượt
 * nghe. jsdom không có URL.createObjectURL nên mỗi test tự định nghĩa.
 */
describe('ExamTake R12 audio preload (TL-145..TL-147)', () => {
  const FAR = () => new Date(Date.now() + 280_000).toISOString();
  const SOON = () => new Date(Date.now() + 10_000).toISOString();

  function listingAttempt(
    questions: Array<Record<string, unknown>>,
  ): ExamAttemptView {
    return attempt({
      sections: [
        {
          key: 's1',
          orderIndex: 1,
          title: 'Nghe hiểu',
          instruction: null,
          skill: 'listening',
          groups: [
            {
              key: 's1-g1',
              orderIndex: 1,
              title: null,
              instruction: null,
              content: null,
              audio: null,
              image: null,
              questions,
            },
          ],
        },
      ],
    });
  }

  function stubObjectUrls() {
    let counter = 0;
    const created: string[] = [];
    const create = vi.fn(() => {
      counter += 1;
      const url = `blob:r12-${String(counter)}`;
      created.push(url);
      return url;
    });
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: create,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revoke,
    });
    return { create, revoke, created };
  }

  function clearObjectUrls(): void {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  }

  function audioBytes(): Response {
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    });
  }

  afterEach(() => {
    clearObjectUrls();
  });

  it('mount: mỗi audio duy nhất chỉ fetch content đúng một lần', async () => {
    stubObjectUrls();
    const contentFetches: string[] = [];
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: {
            grants: [{ mediaId: 9, src: '/media/9', expiresAt: FAR() }],
            unavailable: [],
          },
        });
      }
      if (/^\/media\/9/u.test(url)) {
        contentFetches.push(url);
        return audioBytes();
      }
      return Response.json({ success: true, data: attempt() });
    });
    const view = renderTake(
      listingAttempt([
        question({ key: 'q1', audio: media('audio', 9) }),
        question({ key: 'q2', orderIndex: 2, audio: media('audio', 9) }),
      ]),
    );
    const audioEl = view.container.querySelector('audio') as HTMLAudioElement;
    await waitFor(() => expect(audioEl.getAttribute('src')).toMatch(/^blob:/u));
    await settleFetch();
    expect(contentFetches).toHaveLength(1);
  });

  it('onReady cùng act với click Phát: play 1 lần, không có mutation src thêm', async () => {
    stubObjectUrls();
    const grantsPayload = () =>
      Response.json({
        success: true,
        data: {
          grants: [{ mediaId: 9, src: '/media/9', expiresAt: FAR() }],
          unavailable: [],
        },
      });
    let releaseContent: ((value: Response) => void) | undefined;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) return grantsPayload();
      if (/^\/media\/9/u.test(url)) {
        return new Promise<Response>((resolve) => {
          releaseContent = resolve;
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const view = renderTake(
      listingAttempt([question({ key: 'q1', audio: media('audio', 9) })]),
    );
    const audioEl = view.container.querySelector('audio') as HTMLAudioElement;
    await waitFor(() => expect(audioEl.getAttribute('src')).toBe('/media/9'));
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records);
    });
    observer.observe(audioEl, { attributes: true, attributeFilter: ['src'] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Phát' }));
      // Blob onReady về ngay sau click, trong cùng act.
      releaseContent?.(audioBytes());
      await settleFetch();
    });
    observer.disconnect();
    expect(play).toHaveBeenCalledTimes(1);
    await settleFetch();
    // `src` đã được đồng bộ trước lượt nghe, nên click không phải ghi lại;
    // blob commit trong cùng act cũng KHÔNG được ghi (thiếu ghim thì effect
    // ghi blob thành một mutation và test này đỏ).
    expect(
      mutations.filter((record) => record.attributeName === 'src'),
    ).toHaveLength(0);
    expect(audioEl.getAttribute('src')).toBe('/media/9');
  });

  it('blob về giữa lượt nghe: 0 mutation src', async () => {
    stubObjectUrls();
    let releaseContent: ((value: Response) => void) | undefined;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: {
            grants: [{ mediaId: 9, src: '/media/9', expiresAt: FAR() }],
            unavailable: [],
          },
        });
      }
      if (/^\/media\/9/u.test(url)) {
        return new Promise<Response>((resolve) => {
          releaseContent = resolve;
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const view = renderTake(
      listingAttempt([question({ key: 'q1', audio: media('audio', 9) })]),
    );
    const audioEl = view.container.querySelector('audio') as HTMLAudioElement;
    await waitFor(() => expect(audioEl.getAttribute('src')).toBe('/media/9'));
    fireEvent.click(screen.getByRole('button', { name: 'Phát' }));
    await settleFetch();
    expect(play).toHaveBeenCalledTimes(1);
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records);
    });
    observer.observe(audioEl, { attributes: true, attributeFilter: ['src'] });
    await act(async () => {
      releaseContent?.(audioBytes());
      await settleFetch();
    });
    observer.disconnect();
    expect(
      mutations.filter((record) => record.attributeName === 'src'),
    ).toHaveLength(0);
    expect(audioEl.getAttribute('src')).toBe('/media/9');
  });

  it('media-grants trả src mới khi đang phát: chỉ 1 lần ghi src trong click', async () => {
    stubObjectUrls();
    let grantsFetches = 0;
    let releaseRefresh: ((value: Response) => void) | undefined;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        if (grantsFetches === 1) {
          return Response.json({
            success: true,
            data: {
              grants: [{ mediaId: 9, src: '/media/9?v=1', expiresAt: SOON() }],
              unavailable: [],
            },
          });
        }
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve;
        });
      }
      if (/^\/media\/9/u.test(url)) return audioBytes();
      return Response.json({ success: true, data: attempt() });
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const view = renderTake(
      listingAttempt([question({ key: 'q1', audio: media('audio', 9) })]),
    );
    const audioEl = view.container.querySelector('audio') as HTMLAudioElement;
    await waitFor(() => expect(grantsFetches).toBe(1));
    // Preloader bắt đầu refresh grant vì URL còn < 15 s.
    await waitFor(() => expect(grantsFetches).toBe(2));
    await waitFor(() =>
      expect(audioEl.getAttribute('src')).toBe('/media/9?v=1'),
    );
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => {
      mutations.push(...records);
    });
    observer.observe(audioEl, { attributes: true, attributeFilter: ['src'] });
    mutations.length = 0;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Phát' }));
      await settleFetch();
      // Grant mới về đúng lúc đang phát; `play(fresh)` ghi src một lần, commit
      // state sau đó không được ghi lần hai.
      releaseRefresh?.(
        Response.json({
          success: true,
          data: {
            grants: [{ mediaId: 9, src: '/media/9?v=2', expiresAt: FAR() }],
            unavailable: [],
          },
        }),
      );
      await settleFetch();
    });
    observer.disconnect();
    expect(play).toHaveBeenCalledTimes(1);
    expect(grantsFetches).toBe(2);
    expect(
      mutations.filter((record) => record.attributeName === 'src'),
    ).toHaveLength(1);
    expect(audioEl.getAttribute('src')).toBe('/media/9?v=2');
  });

  it('unmount revoke mọi object URL và StrictMode vẫn tới trạng thái có blob', async () => {
    const { create, revoke } = stubObjectUrls();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: {
            grants: [{ mediaId: 9, src: '/media/9', expiresAt: FAR() }],
            unavailable: [],
          },
        });
      }
      if (/^\/media\/9/u.test(url)) return audioBytes();
      return Response.json({ success: true, data: attempt() });
    });
    const view = render(
      <StrictMode>
        <LearnerToastProvider>
          <ExamTake
            attempt={listingAttempt([
              question({ key: 'q1', audio: media('audio', 9) }),
            ])}
          />
        </LearnerToastProvider>
      </StrictMode>,
    );
    const audioEl = view.container.querySelector('audio') as HTMLAudioElement;
    await waitFor(() => expect(audioEl.getAttribute('src')).toMatch(/^blob:/u));
    view.unmount();
    expect(revoke.mock.calls).toHaveLength(create.mock.calls.length);
  });

  it('lỗi trên blob: bỏ blob, không play lần 2, vẫn còn lượt retry grant', async () => {
    stubObjectUrls();
    let grantsFetches = 0;
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        return Response.json({
          success: true,
          data: {
            grants: [{ mediaId: 9, src: '/media/9', expiresAt: FAR() }],
            unavailable: [],
          },
        });
      }
      if (/^\/media\/9/u.test(url)) return audioBytes();
      return Response.json({ success: true, data: attempt() });
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const view = renderTake(
      listingAttempt([question({ key: 'q1', audio: media('audio', 9) })]),
    );
    const audioEl = view.container.querySelector('audio') as HTMLAudioElement;
    await waitFor(() => expect(audioEl.getAttribute('src')).toMatch(/^blob:/u));
    fireEvent.error(audioEl);
    await settleFetch();
    expect(play).not.toHaveBeenCalled();
    expect(screen.getAllByText('Không tải được âm thanh.').length).toBe(1);
    expect(grantsFetches).toBe(1);
    expect(view.container.querySelector('audio')?.getAttribute('src')).toBe(
      '/media/9',
    );
    fireEvent.error(view.container.querySelector('audio') as HTMLAudioElement);
    await waitFor(() => expect(grantsFetches).toBe(2));
  });

  it('40 câu, grant sắp hết hạn: click Phát khi preloader đang refresh chỉ dùng chung 1 lần gọi loader', async () => {
    stubObjectUrls();
    let grantsFetches = 0;
    let releaseRefresh: ((value: Response) => void) | undefined;
    const ids = Array.from({ length: 40 }, (_, index) => 100 + index);
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        grantsFetches += 1;
        if (grantsFetches === 1) {
          return Response.json({
            success: true,
            data: {
              grants: ids.map((mediaId) => ({
                mediaId,
                src: `/media/${String(mediaId)}`,
                expiresAt: SOON(),
              })),
              unavailable: [],
            },
          });
        }
        return new Promise<Response>((resolve) => {
          releaseRefresh = resolve;
        });
      }
      if (/^\/media\/\d+/u.test(url)) return audioBytes();
      return Response.json({ success: true, data: attempt() });
    });
    const view = renderTake(
      listingAttempt(
        ids.map((mediaId, index) =>
          question({
            key: `q${String(index + 1)}`,
            orderIndex: index + 1,
            audio: media('audio', mediaId),
          }),
        ),
      ),
    );
    await waitFor(() => expect(grantsFetches).toBe(1));
    // Preloader gọi getSrc cho item đầu và bắt đầu refresh grant; click Phát
    // trong lúc đó phải dùng chung promise đó thay vì phát sinh request thứ ba
    // (bỏ single-flight: grantsFetches = 3 → test đỏ).
    await waitFor(() => expect(grantsFetches).toBe(2));
    fireEvent.click(screen.getByRole('button', { name: 'Phát' }));
    await settleFetch();
    expect(grantsFetches).toBe(2);
    view.unmount();
    releaseRefresh?.(
      Response.json({
        success: true,
        data: {
          grants: ids.map((mediaId) => ({
            mediaId,
            src: `/media/${String(mediaId)}?fresh=1`,
            expiresAt: FAR(),
          })),
          unavailable: [],
        },
      }),
    );
    await settleFetch();
  });
});

/**
 * TL-157/TL-158: the submit flow. The dialog is the only confirmation step;
 * the server result owns the locked banner copy, and a submit in flight must
 * never be closed or overwritten by the local clock.
 */
describe('ExamTake submit (TL-157/TL-158)', () => {
  function openSubmit(): HTMLElement {
    const footer = screen.getByRole('contentinfo');
    fireEvent.click(within(footer).getByRole('button', { name: 'Nộp bài' }));
    return screen.getByRole('dialog');
  }

  async function confirm(): Promise<void> {
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Nộp bài' }));
  }

  it('restores focus to the trigger and sends nothing on cancel', () => {
    renderTake(attempt());
    const footer = screen.getByRole('contentinfo');
    const trigger = within(footer).getByRole('button', { name: 'Nộp bài' });
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Tiếp tục làm',
      }),
    );
    expect(document.activeElement).toBe(trigger);
    expect(fetchOrder).toEqual([]);
  });

  it('flushes pending saves before one POST that carries only the key', async () => {
    // A debounced fill is still pending when the learner confirms: the forced
    // flush must settle before the POST, so the PUT is observable first.
    renderTake(singleQuestionAttempt({ type: 'fill_blank', answers: {} }));
    fireEvent.change(screen.getByLabelText('Câu trả lời của bạn'), {
      target: { value: '你好' },
    });
    openSubmit();
    await confirm();
    await waitFor(() => expect(submitBodies).toHaveLength(1));
    expect(putBodies.length).toBeGreaterThan(0);
    expect(fetchOrder.indexOf('put')).toBeLessThan(fetchOrder.indexOf('post'));
    expect(Object.keys(submitBodies[0] ?? {})).toEqual(['idempotencyKey']);
    expect(String(submitBodies[0]?.idempotencyKey)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('alert')).getByText('Bài đã được nộp.'),
      ).toBeDefined(),
    );
  });

  it('sends exactly one POST when the confirm button is double-clicked', async () => {
    let resolveSubmit: ((value: Response) => void) | undefined;
    submitHandler = () =>
      new Promise<Response>((resolve) => {
        resolveSubmit = resolve;
      });
    renderTake(attempt());
    openSubmit();
    const dialog = screen.getByRole('dialog');
    const confirmButton = within(dialog).getByRole('button', {
      name: 'Nộp bài',
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    await waitFor(() => expect(submitBodies).toHaveLength(1));
    resolveSubmit?.(Response.json({ success: true, data: submitView() }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('alert')).getByText('Bài đã được nộp.'),
      ).toBeDefined(),
    );
    expect(submitBodies).toHaveLength(1);
  });

  it('posts within 3 s even when the queue flush hangs', async () => {
    vi.useFakeTimers();
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        return new Promise<Response>(() => undefined);
      }
      if (url.endsWith('/submit') && init?.method === 'POST') {
        submitBodies.push(
          JSON.parse(String(init.body)) as Record<string, unknown>,
        );
        return Response.json({ success: true, data: submitView() });
      }
      return Response.json({ success: true, data: attempt() });
    });
    renderTake(attempt());
    fireEvent.click(screen.getAllByRole('radio')[0] as HTMLElement);
    await vi.advanceTimersByTimeAsync(700);
    openSubmit();
    await confirm();
    await vi.advanceTimersByTimeAsync(3_000);
    await settleFetch();
    expect(submitBodies).toHaveLength(1);
  });

  it('does not POST while offline and keeps the key for the retry', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderTake(attempt());
    openSubmit();
    await confirm();
    await waitFor(() =>
      expect(
        screen.getByText('Không có kết nối. Kiểm tra mạng rồi thử lại.'),
      ).toBeDefined(),
    );
    expect(submitBodies).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });

  it('retries a network failure with the same idempotency key', async () => {
    submitHandler = () => {
      throw new TypeError('Failed to fetch');
    };
    renderTake(attempt());
    openSubmit();
    await confirm();
    await waitFor(() =>
      expect(screen.getByText('Không nộp được. Thử lại.')).toBeDefined(),
    );
    const firstKey = submitBodies[0]?.idempotencyKey;
    expect(submitBodies).toHaveLength(1);

    submitHandler = () => Response.json({ success: true, data: submitView() });
    await confirm();
    await waitFor(() => expect(submitBodies).toHaveLength(2));
    expect(submitBodies[1]?.idempotencyKey).toBe(firstKey);
    await waitFor(() =>
      expect(
        within(screen.getByRole('alert')).getByText('Bài đã được nộp.'),
      ).toBeDefined(),
    );
  });

  it.each([
    ['EXAM_ATTEMPT_ALREADY_SUBMITTED', 'Bài đã được nộp.'],
    ['EXAM_ATTEMPT_EXPIRED', 'Hết giờ. Bài làm đã được lưu.'],
    ['EXAM_ATTEMPT_CLOSED', 'Bài thi đã kết thúc.'],
  ])('maps 409 %s to its locked copy', async (code, copy) => {
    submitHandler = () =>
      Response.json(
        { success: false, error: { kind: 'conflict', message: 'x', code } },
        { status: 409 },
      );
    renderTake(attempt());
    openSubmit();
    await confirm();
    await waitFor(() =>
      expect(within(screen.getByRole('alert')).getByText(copy)).toBeDefined(),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(submitBodies).toHaveLength(1);
  });

  it('retries a reused key once with a fresh key, then submits', async () => {
    let call = 0;
    submitHandler = () => {
      call += 1;
      if (call === 1) {
        return Response.json(
          {
            success: false,
            error: {
              kind: 'conflict',
              message: 'x',
              code: 'EXAM_IDEMPOTENCY_KEY_REUSED',
            },
          },
          { status: 409 },
        );
      }
      return Response.json({ success: true, data: submitView() });
    };
    renderTake(attempt());
    openSubmit();
    await confirm();
    await waitFor(() => expect(submitBodies).toHaveLength(2));
    expect(submitBodies[0]?.idempotencyKey).not.toBe(
      submitBodies[1]?.idempotencyKey,
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('alert')).getByText('Bài đã được nộp.'),
      ).toBeDefined(),
    );
  });

  it('keeps the dialog open when the clock hits zero during the POST, then the server wins', async () => {
    let resolveSubmit: ((value: Response) => void) | undefined;
    submitHandler = () =>
      new Promise<Response>((resolve) => {
        resolveSubmit = resolve;
      });
    renderTake(attempt({ remainingSeconds: 1 }));
    openSubmit();
    await confirm();
    await waitFor(() => expect(submitBodies).toHaveLength(1));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1_400));
    // Prove the local clock really reached zero before the server answered.
    expect(screen.getByRole('timer').textContent).toContain('00:00');
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(screen.queryByText('Hết giờ. Bài làm đã được lưu.')).toBeNull();
    resolveSubmit?.(Response.json({ success: true, data: submitView() }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('alert')).getByText('Bài đã được nộp.'),
      ).toBeDefined(),
    );
  });

  it('F2 (M4.2c): a zero mid-POST followed by a failed POST locks with the Q127 copy', async () => {
    vi.useFakeTimers();
    let resolveSubmit: ((value: Response) => void) | undefined;
    submitHandler = () =>
      new Promise<Response>((resolve) => {
        resolveSubmit = resolve;
      });
    renderTake(attempt({ remainingSeconds: 1 }));
    openSubmit();
    await confirm();
    // The 3 s flush guard elapses; the POST is hanging and the clock hits zero.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(submitBodies).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(screen.queryByText('Hết giờ. Bài làm đã được lưu.')).toBeNull();
    // The server answer is a plain failure: the lock must come from `finally`,
    // and the submit error must not replace the Q127 copy.
    await act(async () => {
      resolveSubmit?.(
        Response.json(
          { success: false, error: { kind: 'server', message: 'x' } },
          { status: 503 },
        ),
      );
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Hết giờ. Bài làm đã được lưu.')).toBeDefined();
    expect(screen.queryByText('Không nộp được. Thử lại.')).toBeNull();
  });

  it('after a submit there are no more PUTs, no expiry copy and no low-time notice', async () => {
    renderTake(attempt({ remainingSeconds: 200 }));
    openSubmit();
    await confirm();
    await waitFor(() =>
      expect(
        within(screen.getByRole('alert')).getByText('Bài đã được nộp.'),
      ).toBeDefined(),
    );
    const putsAfterSubmit = putBodies.length;
    const footerText = screen.getByRole('contentinfo').textContent;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1_300));
    expect(putBodies.length).toBe(putsAfterSubmit);
    // The clock is stopped: the footer countdown must not move after a submit.
    expect(screen.getByRole('contentinfo').textContent).toBe(footerText);
    expect(
      screen.queryByText('Có câu chưa lưu được trước khi hết giờ.'),
    ).toBeNull();
    expect(screen.queryByText('Còn dưới 5 phút.')).toBeNull();
  });

  it('blocks Esc while the submit is in flight', async () => {
    let resolveSubmit: ((value: Response) => void) | undefined;
    submitHandler = () =>
      new Promise<Response>((resolve) => {
        resolveSubmit = resolve;
      });
    renderTake(attempt());
    openSubmit();
    await confirm();
    await waitFor(() => expect(submitBodies).toHaveLength(1));
    fireEvent(screen.getByRole('dialog'), new Event('cancel'));
    expect(screen.queryByRole('dialog')).not.toBeNull();
    resolveSubmit?.(Response.json({ success: true, data: submitView() }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('alert')).getByText('Bài đã được nộp.'),
      ).toBeDefined(),
    );
  });

  it('mounts a submitted attempt locked with its own copy and a link back', async () => {
    renderTake(attempt({ status: 'submitted', remainingSeconds: 0 }));
    expect(
      within(screen.getByRole('alert')).getByText('Bài đã được nộp.'),
    ).toBeDefined();
    const back = screen.getByRole('link', { name: 'Về màn giới thiệu đề' });
    expect(back.getAttribute('href')).toBe('/learn/exam/7');
    // Q164: the primary action of a terminal attempt is the result page.
    const resultLink = within(screen.getByRole('alert')).getByRole('link', {
      name: 'Xem kết quả',
    });
    expect(resultLink.getAttribute('href')).toBe(
      '/learn/exam/attempts/41/result',
    );
    const footerSubmit = within(screen.getByRole('contentinfo')).getByRole(
      'button',
      { name: 'Nộp bài' },
    );
    expect((footerSubmit as HTMLButtonElement).disabled).toBe(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 600));
    expect(screen.queryByText('Còn dưới 5 phút.')).toBeNull();
  });

  it('Q164: a timed-out attempt offers "Xem kết quả" as primary and the intro as secondary', () => {
    renderTake(attempt({ status: 'timed_out', remainingSeconds: 0 }));
    expect(screen.getByText('Hết giờ. Bài làm đã được lưu.')).toBeDefined();
    const alert = screen.getByRole('alert');
    const resultLink = within(alert).getByRole('link', { name: 'Xem kết quả' });
    expect(resultLink.getAttribute('href')).toBe(
      '/learn/exam/attempts/41/result',
    );
    expect(resultLink.className).toContain('btn--primary');
    const back = within(alert).getByRole('link', {
      name: 'Về màn giới thiệu đề',
    });
    expect(back.getAttribute('href')).toBe('/learn/exam/7');
    expect(back.className).toContain('btn--outline');
  });

  it('Q164: an invalidated attempt has no result link', () => {
    renderTake(attempt({ status: 'invalidated', remainingSeconds: 0 }));
    expect(screen.queryByRole('link', { name: 'Xem kết quả' })).toBeNull();
  });

  it('F1 (M4.2c): after a submit the clock pill is gone and the footer carries the copy', async () => {
    renderTake(attempt({ remainingSeconds: 200 }));
    openSubmit();
    await confirm();
    await waitFor(() =>
      expect(
        within(screen.getByRole('alert')).getByText('Bài đã được nộp.'),
      ).toBeDefined(),
    );
    expect(screen.queryByRole('timer')).toBeNull();
    expect(document.querySelector('.ext-timer')).toBeNull();
    expect(
      screen.getByRole('contentinfo').querySelector('.uxb-fine')?.textContent,
    ).toBe('Bài đã được nộp.');
  });

  it('F1 (M4.2c): mounting a submitted attempt hides the clock and has no is-low', () => {
    renderTake(attempt({ status: 'submitted', remainingSeconds: 200 }));
    expect(screen.queryByRole('timer')).toBeNull();
    expect(document.querySelector('.ext-timer')).toBeNull();
    expect(document.querySelector('.is-low')).toBeNull();
    expect(
      screen.getByRole('contentinfo').querySelector('.uxb-fine')?.textContent,
    ).toBe('Bài đã được nộp.');
  });

  it('F1 (M4.2c): a live attempt under five minutes still gets is-low', () => {
    renderTake(attempt({ remainingSeconds: 200 }));
    const timer = screen.getByRole('timer');
    expect(timer.className).toContain('is-low');
  });

  it('F1 (M4.2c): a timed-out attempt keeps the 00:00 readout without is-low', () => {
    renderTake(attempt({ remainingSeconds: 0 }));
    const timer = screen.getByRole('timer');
    expect(timer.textContent).toContain('00:00');
    expect(timer.className).not.toContain('is-low');
    expect(
      screen.getByRole('contentinfo').querySelector('.uxb-fine')?.textContent,
    ).toContain('Còn 00:00 phút');
  });

  it('F1 (M4.2c): a remounted timed_out attempt keeps 00:00 and the Q127 copy', () => {
    renderTake(attempt({ status: 'timed_out', remainingSeconds: 0 }));
    expect(screen.getByText('Hết giờ. Bài làm đã được lưu.')).toBeDefined();
    const timer = screen.getByRole('timer');
    expect(timer.textContent).toContain('00:00');
    expect(timer.className).not.toContain('is-low');
  });
});

describe('ExamTake pre-submit review (M4.5 B2c / Q225)', () => {
  function reviewAttempt(
    overrides: Record<string, unknown> = {},
  ): ExamAttemptView {
    const seed = (key: string, orderIndex: number) =>
      question({ key, orderIndex });
    return attempt({
      questionCount: 4,
      sections: [
        {
          key: 's1',
          orderIndex: 1,
          title: 'Đọc hiểu',
          instruction: null,
          skill: 'reading',
          groups: [
            {
              key: 's1-g1',
              orderIndex: 1,
              title: null,
              instruction: 'Chọn đáp án đúng.',
              content: null,
              audio: null,
              image: null,
              questions: [seed('q1', 1), seed('q2', 2)],
            },
          ],
        },
        {
          key: 's2',
          orderIndex: 2,
          title: 'Viết câu',
          instruction: null,
          skill: 'writing',
          groups: [
            {
              key: 's2-g1',
              orderIndex: 1,
              title: null,
              instruction: null,
              content: null,
              audio: null,
              image: null,
              questions: [seed('q3', 1), seed('q4', 2)],
            },
          ],
        },
      ],
      answers: [
        {
          questionKey: 'q1',
          answer: { choice: 'a' },
          isFlagged: true,
          version: 1,
          answeredAt: '2026-10-27T09:00:00.000Z',
          lastSavedAt: '2026-10-27T09:00:00.000Z',
        },
        {
          questionKey: 'q2',
          answer: { choice: 'b' },
          isFlagged: false,
          version: 1,
          answeredAt: '2026-10-27T09:00:00.000Z',
          lastSavedAt: '2026-10-27T09:00:00.000Z',
        },
        {
          questionKey: 'q3',
          answer: null,
          isFlagged: true,
          version: 1,
          answeredAt: null,
          lastSavedAt: '2026-10-27T09:00:00.000Z',
        },
      ],
      ...overrides,
    });
  }

  function openReview(): void {
    const panel = screen.getByRole('complementary', { name: 'Danh sách câu' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Xem lại' }));
  }

  function reviewRegion(): HTMLElement {
    return screen.getByRole('region', { name: 'Chọn câu hỏi để xem lại' });
  }

  function summaryCount(label: string): string | null | undefined {
    const list = screen.getByRole('list', { name: 'Tổng quan bài làm' });
    const item = within(list).getByText(label).closest('li');
    return item?.querySelector('b')?.textContent;
  }

  it('Q225: opens the review with counts, part groups, legend and the tip', () => {
    renderTake(reviewAttempt());
    expect(
      screen.queryByRole('heading', { name: 'Chọn câu hỏi để xem lại' }),
    ).toBeNull();

    openReview();

    expect(
      screen.getByRole('heading', { name: 'Xem lại bài thi' }),
    ).toBeDefined();
    expect(
      screen.getByRole('heading', { name: 'Chọn câu hỏi để xem lại' }),
    ).toBeDefined();
    // Đếm đúng 4 câu: 2 trả lời, 2 chưa trả lời, 2 đánh dấu.
    expect(summaryCount('Đã trả lời')).toBe('2');
    expect(summaryCount('Chưa trả lời')).toBe('2');
    expect(summaryCount('Đánh dấu')).toBe('2');
    // Nhóm theo phần, giữ thứ tự phần.
    expect(screen.getByRole('heading', { name: 'Phần 1 · Đọc' })).toBeDefined();
    expect(
      screen.getByRole('heading', { name: 'Phần 2 · Viết' }),
    ).toBeDefined();
    // Legend có icon + chữ, không chỉ màu.
    const legend = screen.getByRole('list', {
      name: 'Chú thích trạng thái câu',
    });
    expect(legend.textContent).toContain('Đã trả lời');
    expect(legend.textContent).toContain('Chưa trả lời');
    expect(legend.textContent).toContain('Đánh dấu');
    expect(
      screen.getByText('Nhấn số câu để quay lại câu đó.', { exact: false }),
    ).toBeDefined();
    // Q225 aria-label từng ô.
    expect(
      screen.getByRole('button', { name: 'Câu 3, chưa trả lời, đã đánh dấu' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Câu 1, đã trả lời, đã đánh dấu' }),
    ).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Câu 2, đã trả lời' }),
    ).toBeDefined();
    // Đồng hồ vẫn chạy và lối ra là nút quay lại của mockup.
    expect(screen.getByRole('timer')).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Quay lại bài thi' }),
    ).toBeDefined();
    // SKILL §7: class mới của lưới/ô phải có trên phần tử thật.
    const doneCell = screen.getByRole('button', {
      name: 'Câu 1, đã trả lời, đã đánh dấu',
    });
    expect(doneCell.className).toContain('extr-cell');
    expect(doneCell.className).toContain('is-done');
    expect(doneCell.className).toContain('is-flag');
    expect(reviewRegion().querySelector('.extr-grid')).not.toBeNull();
    expect(reviewRegion().querySelector('.extr-sum')).not.toBeNull();
    expect(reviewRegion().querySelector('.extr-tip')).not.toBeNull();
  });

  it('Q225: Escape leaves the review and returns to the current question', async () => {
    renderTake(reviewAttempt());
    openReview();
    expect(reviewRegion()).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Chọn câu hỏi để xem lại' }),
      ).toBeNull(),
    );
    await waitFor(() => expect(document.activeElement?.id).toBe('q-part'));
  });

  it('Q225: pressing a number goes back to that question and focuses it', async () => {
    renderTake(reviewAttempt());
    // Câu hiện tại là câu đầu tiên chưa trả lời (q3); về q1 bằng lưới.
    openReview();
    fireEvent.click(
      screen.getByRole('button', { name: 'Câu 1, đã trả lời, đã đánh dấu' }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('exam-count-live').textContent).toBe(
        'Câu 1 trên 4',
      ),
    );
    await waitFor(() => expect(document.activeElement?.id).toBe('q-part'));
    expect(
      screen.queryByRole('heading', { name: 'Chọn câu hỏi để xem lại' }),
    ).toBeNull();
  });

  it('Q225: the review never shows answers, right/wrong state or explanations', () => {
    const { container } = renderTake(reviewAttempt());
    openReview();

    const text = container.textContent ?? '';
    expect(text).not.toContain('Đáp án đúng');
    expect(text).not.toContain('Giải thích');
    // Không render lại khối trả lời của màn làm bài.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(container.querySelectorAll('[data-correct]')).toHaveLength(0);
    expect(container.innerHTML.toLowerCase()).not.toContain('correct');
  });

  it('Q225: "Nộp bài" on the review reuses the existing dialog and "Tiếp tục làm" stays', async () => {
    renderTake(reviewAttempt());
    openReview();

    fireEvent.click(
      within(reviewRegion()).getByRole('button', { name: 'Nộp bài' }),
    );
    expect(screen.getByRole('heading', { name: 'Nộp bài?' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục làm' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Nộp bài?' })).toBeNull(),
    );
    // Huỷ dialog thì vẫn ở màn xem lại.
    expect(reviewRegion()).toBeDefined();
  });

  it('Q225: submitting from the review lands on the locked screen with "Xem kết quả"', async () => {
    renderTake(reviewAttempt());
    openReview();

    fireEvent.click(
      within(reviewRegion()).getByRole('button', { name: 'Nộp bài' }),
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Nộp bài',
      }),
    );

    await waitFor(() =>
      expect(
        within(screen.getByRole('alert')).getByText('Bài đã được nộp.'),
      ).toBeDefined(),
    );
    expect(
      screen.queryByRole('heading', { name: 'Chọn câu hỏi để xem lại' }),
    ).toBeNull();
    expect(screen.getByRole('link', { name: 'Xem kết quả' })).toBeDefined();
  });

  it('Q225/TL-137: the clock reaching zero inside the review keeps the Q127 lock', async () => {
    vi.useFakeTimers();
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    renderTake(reviewAttempt({ remainingSeconds: 2 }));
    openReview();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    now += 5_000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByText('Hết giờ. Bài làm đã được lưu.')).toBeDefined();
    expect(
      (
        within(reviewRegion()).getByRole('button', {
          name: 'Nộp bài',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('Q225: entering the review during a listening turn stops it and the audio stays usable', async () => {
    const grant = {
      mediaId: 9,
      src: '/media/9',
      expiresAt: new Date(Date.now() + 280_000).toISOString(),
    };
    vi.mocked(globalThis.fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [grant], unavailable: [] },
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined);
    const { container } = renderTake(
      singleQuestionAttempt({ audio: media('audio', 9) }),
    );
    await waitFor(() =>
      expect(container.querySelector('audio')?.getAttribute('src')).toBe(
        '/media/9',
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Phát' }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Đang phát' })).toBeDefined();

    openReview();
    // Rời câu giữa lượt nghe không được để lại trạng thái "đang phát" ma.
    expect(screen.queryByRole('button', { name: 'Đang phát' })).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    // <audio> được mount lại phải có src và lượt nghe đã kết thúc (F13).
    await waitFor(() =>
      expect(container.querySelector('audio')?.getAttribute('src')).toBe(
        '/media/9',
      ),
    );
    expect(screen.getByRole('button', { name: 'Đã nghe' })).toBeDefined();
  });

  it('Q225: entering the review does not interrupt an autosave already in flight', async () => {
    const pending: { release: (() => void) | null } = {
      release: null,
    };
    vi.mocked(globalThis.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/media-grants')) {
        return Response.json({
          success: true,
          data: { grants: [], unavailable: [] },
        });
      }
      if (url.includes('/answers') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Promise<Response>((resolve) => {
          pending.release = () =>
            resolve(
              Response.json({
                success: true,
                data: savedView(
                  String(body.questionKey ?? 'q3'),
                  2,
                  body.answer,
                ),
              }),
            );
        });
      }
      return Response.json({ success: true, data: attempt() });
    });
    renderTake(reviewAttempt());
    fireEvent.click(screen.getAllByRole('radio')[1] as HTMLElement);
    await waitFor(() => expect(pending.release).not.toBeNull());

    openReview();
    expect(
      screen
        .getAllByRole('status')
        .some((status) => (status.textContent ?? '').includes('Đang lưu')),
    ).toBe(true);

    const release = pending.release;
    if (release === null) throw new Error('save request did not start');
    release();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole('status')
          .some((status) => (status.textContent ?? '').includes('Đã lưu')),
      ).toBe(true),
    );
    // Autosave chạy tiếp trong mode xem lại; mode không bị đóng.
    expect(reviewRegion()).toBeDefined();
  });
});
