import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RECORD_LIMIT_MS,
  recordingClock,
  recordingSupported,
  useRecorder,
} from './recording';

/** A MediaRecorder stand-in: stop() delivers one chunk, then onstop. */
class FakeRecorder {
  static made: FakeRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(readonly stream: unknown) {
    FakeRecorder.made.push(this);
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['x'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const stopTrack = vi.fn();
const getUserMedia = vi.fn();
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.made = [];
  stopTrack.mockReset();
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  let count = 0;
  createObjectURL.mockReset();
  createObjectURL.mockImplementation(() => `blob:rec-${(count += 1)}`);
  revokeObjectURL.mockReset();
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('recordingSupported', () => {
  it('needs both getUserMedia and MediaRecorder', () => {
    expect(recordingSupported()).toBe(true);
    vi.stubGlobal('MediaRecorder', undefined);
    expect(recordingSupported()).toBe(false);
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('navigator', {});
    expect(recordingSupported()).toBe(false);
  });
});

describe('recordingClock', () => {
  it('shows whole seconds as m:ss', () => {
    expect(recordingClock(0)).toBe('0:00');
    expect(recordingClock(3999)).toBe('0:03');
    expect(recordingClock(10_000)).toBe('0:10');
  });
});

describe('useRecorder', () => {
  it('limits a word to 5 s and a sentence to 10 s (Q-G10)', () => {
    expect(RECORD_LIMIT_MS).toEqual({ word: 5000, sentence: 10_000 });
  });

  it('stops by itself at the limit, frees the mic and keeps the take in memory', async () => {
    const { result } = renderHook(() => useRecorder(RECORD_LIMIT_MS.word));
    expect(result.current.state).toBe('idle');
    await act(() => result.current.start());
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(result.current.state).toBe('recording');

    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(3000);
    expect(result.current.state).toBe('recording');

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.state).toBe('recorded');
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(result.current.url).toBe('blob:rec-1');
  });

  it('a sentence keeps recording past 5 s until 10 s', async () => {
    const { result } = renderHook(() => useRecorder(RECORD_LIMIT_MS.sentence));
    await act(() => result.current.start());
    act(() => vi.advanceTimersByTime(9000));
    expect(result.current.state).toBe('recording');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.state).toBe('recorded');
  });

  it('stop() ends early; a new take revokes the old URL', async () => {
    const { result } = renderHook(() => useRecorder(RECORD_LIMIT_MS.word));
    await act(() => result.current.start());
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.stop());
    expect(result.current.state).toBe('recorded');
    expect(result.current.url).toBe('blob:rec-1');

    await act(() => result.current.start());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:rec-1');
    act(() => result.current.stop());
    expect(result.current.url).toBe('blob:rec-2');
  });

  it('a refused microphone is "denied", with nothing recorded', async () => {
    getUserMedia.mockRejectedValue(
      Object.assign(new Error('no'), { name: 'NotAllowedError' }),
    );
    const { result } = renderHook(() => useRecorder(RECORD_LIMIT_MS.word));
    await act(() => result.current.start());
    expect(result.current.state).toBe('denied');
    expect(FakeRecorder.made).toHaveLength(0);
  });

  it('leaving the screen stops the take, frees the mic and revokes the URL', async () => {
    const { result, unmount } = renderHook(() =>
      useRecorder(RECORD_LIMIT_MS.word),
    );
    await act(() => result.current.start());
    act(() => result.current.stop());
    await act(() => result.current.start());
    unmount();
    expect(stopTrack).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:rec-1');
    // The take cut off by unmount never becomes a URL.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a permission answer after leaving frees the mic at once', async () => {
    let grant: (value: unknown) => void = () => undefined;
    getUserMedia.mockReturnValue(new Promise((resolve) => (grant = resolve)));
    const { result, unmount } = renderHook(() =>
      useRecorder(RECORD_LIMIT_MS.word),
    );
    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = result.current.start();
    });
    unmount();
    grant({ getTracks: () => [{ stop: stopTrack }] });
    await started;
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.made).toHaveLength(0);
  });
});
