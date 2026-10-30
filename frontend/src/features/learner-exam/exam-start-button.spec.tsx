import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LearnerToastProvider } from '@/features/learner-shell/learner-toast';

import { ExamStartButton } from './exam-start-button';

const router = {
  replace: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
};

vi.mock('next/navigation', () => ({
  useRouter: () => router,
}));

const START_URL = '/api/learner/exam/tests/12/attempts';
const GENERIC = 'Chưa bắt đầu được bài thi. Vui lòng thử lại.';

let keySeq = 0;

function renderButton() {
  return render(
    <LearnerToastProvider>
      <ExamStartButton testId={12} />
    </LearnerToastProvider>,
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function okResponse() {
  return jsonResponse(200, {
    success: true,
    data: {
      id: 77,
      status: 'in_progress',
      expiresAt: '2026-10-27T03:20:00.000Z',
    },
  });
}

function conflict(code: string) {
  return jsonResponse(409, {
    success: false,
    error: { kind: 'conflict', message: 'conflict', code },
  });
}

describe('ExamStartButton', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    keySeq = 0;
    vi.stubGlobal('crypto', {
      randomUUID: () => `key-${String(++keySeq)}`,
    });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    router.replace.mockClear();
    router.refresh.mockClear();
    router.push.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the exam start with the generated key', async () => {
    fetchMock.mockResolvedValue(okResponse());
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu thi' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(START_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotencyKey: 'key-1' }),
    });
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/learn/exam/attempts/77'),
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('falls back to a refresh when the start response has no attempt id', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: { status: 'in_progress', expiresAt: '2026-10-27T03:20:00.000Z' },
      }),
    );
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu thi' }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sends one request for a double click and disables the button', async () => {
    let resolve: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    renderButton();
    const button = screen.getByRole('button', { name: 'Bắt đầu thi' });

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button).toBeDisabled());
    resolve?.(okResponse());
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith('/learn/exam/attempts/77'),
    );
  });

  it('reuses the key after a network error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderButton();
    const button = screen.getByRole('button', { name: 'Bắt đầu thi' });

    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(GENERIC),
    );

    fetchMock.mockResolvedValueOnce(okResponse());
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      START_URL,
      expect.objectContaining({
        body: JSON.stringify({ idempotencyKey: 'key-1' }),
      }),
    );
  });

  it.each([
    ['200', () => okResponse()],
    ['409', () => conflict('EXAM_TEST_UNAVAILABLE')],
  ])('generates a new key after a %s response', async (_label, response) => {
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(okResponse());
    renderButton();
    const button = screen.getByRole('button', { name: 'Bắt đầu thi' });

    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(button);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      START_URL,
      expect.objectContaining({
        body: JSON.stringify({ idempotencyKey: 'key-1' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      START_URL,
      expect.objectContaining({
        body: JSON.stringify({ idempotencyKey: 'key-2' }),
      }),
    );
  });

  it.each([
    ['401', () => jsonResponse(401, { success: false })],
    ['404', () => jsonResponse(404, { success: false })],
    ['429', () => jsonResponse(429, { success: false })],
    ['500', () => jsonResponse(500, { success: false })],
  ])(
    'starts a new key window after a definitive %s answer',
    async (_label, response) => {
      fetchMock
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(okResponse());
      renderButton();
      const button = screen.getByRole('button', { name: 'Bắt đầu thi' });

      fireEvent.click(button);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      fireEvent.click(button);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        START_URL,
        expect.objectContaining({
          body: JSON.stringify({ idempotencyKey: 'key-1' }),
        }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        START_URL,
        expect.objectContaining({
          body: JSON.stringify({ idempotencyKey: 'key-2' }),
        }),
      );
    },
  );

  it('sends the learner to sign-in on 401', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { success: false }));
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu thi' }));

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/sign-in'),
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('refreshes the page on 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { success: false }));
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu thi' }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('explains an unavailable test on 409', async () => {
    fetchMock.mockResolvedValue(conflict('EXAM_TEST_UNAVAILABLE'));
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu thi' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Đề thi tạm thời không làm được. Vui lòng thử lại sau.',
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Bắt đầu thi' })).toBeEnabled(),
    );
  });

  it('explains a rate limit on 429', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { success: false }));
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu thi' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.',
      ),
    );
  });

  it.each([
    ['500', jsonResponse(500, { success: false })],
    ['an unknown 409 code', conflict('EXAM_IDEMPOTENCY_KEY_REUSED')],
  ])('falls back to the generic message on %s', async (_label, response) => {
    fetchMock.mockResolvedValue(response);
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu thi' }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(GENERIC),
    );
  });
});
