import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UnitResult } from './unit-result';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  replace.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const ok = () => new Response('{}', { status: 200 });

function show() {
  return render(
    <UnitResult
      lessonId={5}
      topicId={9}
      title="Ngữ pháp · Gia đình"
      lessonHref="/learn/lessons/5"
      nextHref="/learn/lessons/5/grammar?unit=10"
    />,
  );
}

describe('UnitResult', () => {
  it('starts the lesson, then completes the topic', async () => {
    fetchMock.mockResolvedValue(ok());
    await act(async () => {
      show();
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/learner/lessons/5/start',
      '/api/learner/topics/9/complete',
    ]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Ngữ pháp · Gia đình',
    );
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1 }),
    );
  });

  // Pha C debt 3a: leaving before the topic is saved would show the unit
  // as not done on the units screen.
  it('keeps Về bài and Đơn vị tiếp closed while progress is saving', async () => {
    let finish: (response: Response) => void = () => {};
    fetchMock.mockResolvedValueOnce(ok()).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => {
      show();
    });
    for (const name of ['Về bài', 'Đơn vị tiếp']) {
      const link = screen.getByRole('link', { name });
      expect(link).toHaveAttribute('aria-disabled', 'true');
      // fireEvent returns false when the click was prevented.
      expect(fireEvent.click(link)).toBe(false);
    }
    await act(async () => {
      finish(ok());
    });
    for (const name of ['Về bài', 'Đơn vị tiếp']) {
      const link = screen.getByRole('link', { name });
      expect(link).not.toHaveAttribute('aria-disabled');
    }
  });

  it('lets the learner leave after a failed save, with a retry', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await act(async () => {
      show();
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Chưa lưu được tiến độ.',
    );
    expect(screen.getByRole('link', { name: 'Về bài' })).not.toHaveAttribute(
      'aria-disabled',
    );
  });
});
