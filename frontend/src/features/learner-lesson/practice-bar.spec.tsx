import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PracticeBar } from './practice-bar';

class FakeRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x']) });
    this.onstop?.();
  }
}

const getUserMedia = vi.fn();
const played: string[] = [];
const fetchMock = vi.fn();

beforeEach(() => {
  played.length = 0;
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:take',
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal(
    'Audio',
    class {
      constructor(readonly src: string) {}
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
      pause() {}
    },
  );
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderBar(props: Partial<Parameters<typeof PracticeBar>[0]> = {}) {
  const speak = vi.fn();
  const onNext = vi.fn();
  const view = render(
    <PracticeBar
      hanzi="我"
      pinyin="wǒ"
      length="word"
      voice
      speak={speak}
      onNext={onNext}
      {...props}
    />,
  );
  return { ...view, speak, onNext };
}

const status = () => screen.getByRole('status').textContent;

describe('PracticeBar (Pha G2b)', () => {
  it('shows Nghe, Nói, Tiếp and no Viết (G2d)', () => {
    renderBar();
    const group = screen.getByRole('group', { name: 'Luyện từ này' });
    expect(
      Array.from(group.querySelectorAll('button')).map((b) => b.textContent),
    ).toEqual(['Nghe', 'Nói', 'Tiếp']);
    expect(screen.queryByText('Viết')).toBeNull();
  });

  it('hides Nói where the browser cannot record, and Nghe without a zh voice', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    renderBar({ voice: false });
    expect(screen.queryByRole('button', { name: 'Nói' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nghe' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tiếp' })).toBeInTheDocument();
  });

  it('Nói records the word for up to 5 s, then plays it back with nothing sent', async () => {
    vi.useFakeTimers();
    const { speak } = renderBar();
    const say = screen.getByRole('button', { name: 'Nói' });
    expect(say).toHaveAttribute('aria-pressed', 'false');
    await act(async () => fireEvent.click(say));

    expect(say).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.g-sheet__title')?.textContent).toBe(
      'Đang ghi âm 0:00, tối đa 5 giây',
    );
    expect(screen.getByText(', tối đa 5 giây')).toHaveClass('sr-only');
    expect(document.querySelector('.g-sheet__text')?.textContent).toBe(
      'Đọc to 我 (wǒ). Tự dừng sau 5 giây.',
    );
    expect(status()).toBe('Đang ghi âm');

    act(() => vi.advanceTimersByTime(5000));
    expect(say).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Đã ghi xong')).toBeInTheDocument();
    expect(status()).toBe('Đã ghi xong. Bấm Bạn đọc để so với giọng mẫu.');
    expect(
      screen.getByText(
        'Bản ghi chỉ nằm trên máy này, không gửi đi và mất khi rời màn hình.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bạn đọc' }));
    expect(played).toEqual(['blob:take']);
    fireEvent.click(screen.getByRole('button', { name: 'Giọng mẫu' }));
    expect(speak).toHaveBeenCalledWith('我', 0.9);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Dừng ghi stops early; a sentence allows 10 s', async () => {
    renderBar({
      hanzi: '我是学生。',
      pinyin: 'Wǒ shì xuéshēng.',
      length: 'sentence',
    });
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Nói' })),
    );
    expect(document.querySelector('.g-sheet__text')?.textContent).toBe(
      'Đọc to 我是学生。 (Wǒ shì xuéshēng.). Tự dừng sau 10 giây.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dừng ghi' }));
    expect(screen.getByText('Đã ghi xong')).toBeInTheDocument();
  });

  it('Giọng mẫu is left out without a zh voice', async () => {
    renderBar({ voice: false });
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Nói' })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dừng ghi' }));
    expect(screen.queryByRole('button', { name: 'Giọng mẫu' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Bạn đọc' })).toBeInTheDocument();
  });

  it('a refused microphone says so and the flow goes on', async () => {
    getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
    const { onNext } = renderBar();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Nói' })),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Chưa có quyền dùng micro',
    );
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
