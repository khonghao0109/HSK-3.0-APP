import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GAP_MS,
  DEFAULT_MAX_TOTAL_BYTES,
  createExamAudioPreloader,
  createSingleFlight,
  type AudioPreloadDependencies,
} from './exam-audio-preload';

const AUDIO = 'audio/mpeg';

function audioResponse(bytes: number, status = 200): Response {
  return new Response(new Uint8Array(bytes), {
    status,
    headers: { 'content-type': AUDIO, 'content-length': String(bytes) },
  });
}

function textResponse(status = 200): Response {
  return new Response('not audio', {
    status,
    headers: { 'content-type': 'text/plain' },
  });
}

type Mock = ReturnType<typeof vi.fn>;

type HarnessOptions = {
  isOnline?: () => boolean;
  maxTotalBytes?: number;
  gapMs?: number;
};

type Harness = {
  deps: AudioPreloadDependencies;
  fetch: Mock;
  sleep: Mock;
  getSrc: Mock;
  onReady: Mock;
  revoke: Mock;
  createObjectURL: Mock;
};

/**
 * Mọi phụ thuộc của preloader được tiêm qua wrapper có type thật (không dùng
 * ép kiểu kép — SKILL §4 cấm trong file mới); test điều khiển qua các mock phía
 * sau wrapper.
 */
function harness(options: HarnessOptions = {}): Harness {
  const fetchMock = vi.fn(
    async (
      _input: string,
      _init: { cache: 'no-store'; signal: AbortSignal },
    ): Promise<Response> => audioResponse(10),
  );
  const sleepMock = vi.fn(async (_ms: number): Promise<void> => undefined);
  const getSrcMock = vi.fn(
    async (mediaId: number): Promise<string | null> => `/media/${mediaId}`,
  );
  const onReadyMock = vi.fn(
    (_mediaId: number, _url: string): void => undefined,
  );
  const revokeMock = vi.fn((_url: string): void => undefined);
  const createMock = vi.fn(
    (_blob: Blob): string =>
      `blob:test-${String(createMock.mock.calls.length)}`,
  );
  const deps: AudioPreloadDependencies = {
    fetch: (input, init) => fetchMock(input, init),
    createObjectURL: (blob) => createMock(blob),
    revokeObjectURL: (url) => revokeMock(url),
    sleep: (ms) => sleepMock(ms),
    isOnline: options.isOnline ?? (() => true),
    getSrc: (mediaId) => getSrcMock(mediaId),
    onReady: (mediaId, url) => onReadyMock(mediaId, url),
    ...(options.maxTotalBytes === undefined
      ? {}
      : { maxTotalBytes: options.maxTotalBytes }),
    ...(options.gapMs === undefined ? {} : { gapMs: options.gapMs }),
  };
  return {
    deps,
    fetch: fetchMock,
    sleep: sleepMock,
    getSrc: getSrcMock,
    onReady: onReadyMock,
    revoke: revokeMock,
    createObjectURL: createMock,
  };
}

/** Flush microtask queue: preloader thuần async, không dùng timer thật. */
async function settle(): Promise<void> {
  for (let index = 0; index < 2_000; index += 1) {
    await Promise.resolve();
  }
}

describe('createExamAudioPreloader (R12 / TL-145)', () => {
  it('dùng mặc định 64 MiB và gap 6 s (TL-145)', () => {
    expect(DEFAULT_GAP_MS).toBe(6_000);
    expect(DEFAULT_MAX_TOTAL_BYTES).toBe(64 * 1024 * 1024);
  });

  it('tải đúng thứ tự hiển thị và bỏ mediaId trùng', async () => {
    const h = harness();
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([3, 3, 1, 2]);
    await settle();

    expect(h.getSrc.mock.calls.map(([id]) => id)).toEqual([3, 1, 2]);
    expect(h.fetch.mock.calls.map(([url]) => url)).toEqual([
      '/media/3',
      '/media/1',
      '/media/2',
    ]);
    expect(h.onReady.mock.calls.map(([id]) => id)).toEqual([3, 1, 2]);
    expect(preloader.state()).toBe('complete');
    expect(preloader.get(1)).toBeDefined();
  });

  it('chạy tuần tự (concurrency 1) và chờ gapMs giữa hai item, item đầu không chờ', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const trace: string[] = [];
    const h = harness();
    h.fetch.mockImplementation(async (url: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      trace.push(`fetch:${url}`);
      await Promise.resolve();
      inFlight -= 1;
      return audioResponse(10);
    });
    h.sleep.mockImplementation(async (ms: number) => {
      trace.push(`sleep:${String(ms)}`);
    });
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2, 3]);
    await settle();

    expect(maxInFlight).toBe(1);
    expect(h.sleep).toHaveBeenCalledTimes(2);
    expect(h.sleep).toHaveBeenCalledWith(DEFAULT_GAP_MS);
    expect(trace[0]).toBe('fetch:/media/1');
    expect(trace.filter((entry) => entry.startsWith('sleep'))).toHaveLength(2);
  });

  it.each([400, 403, 404])(
    'bỏ item khi content trả %i rồi đi tiếp, không gọi lại loader',
    async (status) => {
      let call = 0;
      const h = harness();
      h.fetch.mockImplementation(async () => {
        call += 1;
        return call === 1 ? textResponse(status) : audioResponse(10);
      });
      const preloader = createExamAudioPreloader(h.deps);
      preloader.start([1, 2]);
      await settle();

      // Mỗi item gọi getSrc đúng một lần: item bị bỏ không kéo theo lần gọi
      // grant thứ hai.
      expect(h.getSrc).toHaveBeenCalledTimes(2);
      expect(h.onReady.mock.calls.map(([id]) => id)).toEqual([2]);
      expect(preloader.state()).toBe('partial');
    },
  );

  it('bỏ item khi content-type không phải audio/*', async () => {
    const h = harness();
    h.fetch.mockResolvedValueOnce(textResponse());
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2]);
    await settle();

    expect(h.onReady.mock.calls.map(([id]) => id)).toEqual([2]);
  });

  it('401 dừng cả hàng, không gọi loader cho item sau', async () => {
    const h = harness();
    h.fetch.mockResolvedValueOnce(audioResponse(10, 401));
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2]);
    await settle();

    expect(h.getSrc).toHaveBeenCalledTimes(1);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(preloader.state()).toBe('stopped');
  });

  it.each([429, 503])(
    'dừng cả phiên khi content trả %i, không retry',
    async (status) => {
      const h = harness();
      h.fetch.mockResolvedValueOnce(audioResponse(10, status));
      const preloader = createExamAudioPreloader(h.deps);
      preloader.start([1, 2, 3]);
      await settle();

      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(h.getSrc).toHaveBeenCalledTimes(1);
      expect(preloader.state()).toBe('stopped');
    },
  );

  it('stop là trạng thái cuối: resume() sau 429 không khởi động lại', async () => {
    const h = harness();
    h.fetch.mockResolvedValueOnce(audioResponse(10, 429));
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2]);
    await settle();

    preloader.resume();
    await settle();

    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.getSrc).toHaveBeenCalledTimes(1);
    expect(preloader.state()).toBe('stopped');
  });

  it('stop là trạng thái cuối: resume() sau 401 không khởi động lại', async () => {
    const h = harness();
    h.fetch.mockResolvedValueOnce(audioResponse(10, 401));
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2]);
    await settle();

    preloader.resume();
    await settle();

    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(preloader.state()).toBe('stopped');
  });

  it('TypeError khi vẫn online thì bỏ item và đi tiếp', async () => {
    const h = harness({ isOnline: () => true });
    h.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2]);
    await settle();

    expect(h.onReady.mock.calls.map(([id]) => id)).toEqual([2]);
    expect(preloader.state()).toBe('partial');
  });

  it('offline thì pause giữ item; resume tải tiếp đúng item đó', async () => {
    let online = false;
    const h = harness({ isOnline: () => online });
    h.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2]);
    await settle();

    expect(preloader.state()).toBe('paused');
    expect(h.onReady).not.toHaveBeenCalled();
    expect(h.getSrc).toHaveBeenCalledTimes(1);

    online = true;
    preloader.resume();
    await settle();

    expect(h.getSrc.mock.calls.map(([id]) => id)).toEqual([1, 1, 2]);
    expect(h.onReady.mock.calls.map(([id]) => id)).toEqual([1, 2]);
    expect(preloader.state()).toBe('complete');
  });

  it('ngân sách: content-length vượt mức thì bỏ item trước khi đọc body', async () => {
    const h = harness({ maxTotalBytes: 8 });
    const response = new Response(new Uint8Array(10), {
      headers: { 'content-type': AUDIO, 'content-length': '50' },
    });
    const blob = vi.spyOn(response, 'blob');
    h.fetch.mockResolvedValueOnce(response);
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1]);
    await settle();

    expect(blob).not.toHaveBeenCalled();
    expect(h.onReady).not.toHaveBeenCalled();
    expect(preloader.state()).toBe('partial');
  });

  it('ngân sách: kiểm blob.size khi không có content-length', async () => {
    const h = harness({ maxTotalBytes: 8 });
    h.fetch.mockResolvedValueOnce(
      new Response(new Uint8Array(20), { headers: { 'content-type': AUDIO } }),
    );
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1]);
    await settle();

    expect(h.onReady).not.toHaveBeenCalled();
    expect(h.createObjectURL).not.toHaveBeenCalled();
  });

  it('ngân sách hết thì không bắt đầu item mới, giữ item đã có', async () => {
    const h = harness({ maxTotalBytes: 10 });
    h.fetch.mockResolvedValue(audioResponse(10));
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2]);
    await settle();

    expect(h.onReady.mock.calls.map(([id]) => id)).toEqual([1]);
    expect(h.getSrc).toHaveBeenCalledTimes(1);
    expect(preloader.get(1)).toBeDefined();
    expect(preloader.state()).toBe('partial');
  });

  it('abort giữa chừng dừng hàng và không onReady', async () => {
    let release: ((value: Response) => void) | undefined;
    const h = harness();
    h.fetch.mockImplementationOnce(
      async () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2]);
    await settle();
    expect(h.fetch).toHaveBeenCalledTimes(1);

    preloader.abort();
    release?.(audioResponse(10));
    await settle();

    expect(preloader.state()).toBe('stopped');
    expect(h.onReady).not.toHaveBeenCalled();
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it('dispose revoke đúng mọi URL đã tạo và xoá map', async () => {
    const h = harness();
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2]);
    await settle();
    expect(h.createObjectURL).toHaveBeenCalledTimes(2);

    preloader.dispose();

    expect(h.revoke).toHaveBeenCalledTimes(h.createObjectURL.mock.calls.length);
    expect(preloader.get(1)).toBeUndefined();
    expect(preloader.state()).toBe('stopped');
  });

  it('drop chỉ revoke URL của mediaId đó', async () => {
    const h = harness();
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start([1, 2]);
    await settle();

    preloader.drop(1);

    expect(h.revoke).toHaveBeenCalledTimes(1);
    expect(preloader.get(1)).toBeUndefined();
    expect(preloader.get(2)).toBeDefined();
  });

  it('tải 40 item tuần tự đúng thứ tự', async () => {
    const h = harness();
    const ids = Array.from({ length: 40 }, (_, index) => index + 1);
    const preloader = createExamAudioPreloader(h.deps);
    preloader.start(ids);
    await settle();

    expect(h.onReady.mock.calls.map(([id]) => id)).toEqual(ids);
    expect(h.sleep).toHaveBeenCalledTimes(39);
    expect(preloader.state()).toBe('complete');
  });
});

describe('createSingleFlight (TL-146)', () => {
  it('các lời gọi đồng thời dùng chung một promise đang bay', async () => {
    let release: ((value: string) => void) | undefined;
    const load = vi.fn(
      async () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const single = createSingleFlight(load);

    const first = single();
    const second = single();
    expect(load).toHaveBeenCalledTimes(1);
    release?.('fresh');
    await expect(first).resolves.toBe('fresh');
    await expect(second).resolves.toBe('fresh');

    const third = single();
    release?.('again');
    await expect(third).resolves.toBe('again');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caller gọi ngay sau khi promise trước resolve vẫn nhận promise mới', async () => {
    const load = vi.fn(async () => 1);
    const single = createSingleFlight(load);
    const first = single();
    await first;
    const second = single();
    await second;
    expect(load).toHaveBeenCalledTimes(2);
  });
});
