/**
 * M4.2b R12 (TL-145): tải trước audio của cả đề vào bộ nhớ dưới dạng `Blob`.
 *
 * Module thuần TypeScript: không React, không Zod, không tự đọc `window` —
 * mọi phụ thuộc (fetch, object URL, sleep, trạng thái mạng, cách lấy `src`)
 * được tiêm vào để unit test điều khiển được thời gian và lỗi.
 *
 * Ràng buộc nghiệp vụ:
 * - Tuần tự từng item (concurrency 1) và cách nhau `gapMs` để một học viên
 *   không vượt ngưỡng content 600 request/phút **mỗi IP** của backend.
 * - Chỉ tải byte audio thật (`content-type` bắt đầu bằng `audio/`), tôn trọng
 *   ngân sách tổng; lỗi của một item không làm hỏng cả hàng.
 * - Không đụng DOM: nơi gọi nhận URL qua `onReady` và tự quyết định hiển thị.
 */

export type AudioPreloadState =
  'idle' | 'loading' | 'paused' | 'complete' | 'partial' | 'stopped';

export type AudioPreloadDependencies = {
  /** `fetch` same-origin của BFF; luôn gọi với `cache: 'no-store'`. */
  fetch: (
    input: string,
    init: { cache: 'no-store'; signal: AbortSignal },
  ) => Promise<Response>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  sleep: (ms: number) => Promise<void>;
  isOnline: () => boolean;
  /** Lấy `src` same-origin của một mediaId (grant hiện tại hoặc vừa refresh). */
  getSrc: (mediaId: number) => Promise<string | null>;
  onReady: (mediaId: number, url: string) => void;
  maxTotalBytes?: number;
  gapMs?: number;
};

export type AudioPreload = {
  start: (mediaIds: readonly number[]) => void;
  pause: () => void;
  resume: () => void;
  abort: () => void;
  dispose: () => void;
  drop: (mediaId: number) => void;
  get: (mediaId: number) => string | undefined;
  state: () => AudioPreloadState;
};

export const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const DEFAULT_GAP_MS = 6_000;

/** Bọc một loader để mọi lời gọi đồng thời dùng chung promise đang bay. */
export function createSingleFlight<T>(
  load: () => Promise<T>,
): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  return () => {
    if (inflight !== null) return inflight;
    const started = load();
    inflight = started;
    // `finally` được gắn TRƯỚC mọi caller khác nên nó chạy trước các callback
    // `.then` của caller trong cùng microtask queue: caller kế tiếp (ví dụ
    // preloader ngay sau lần load đầu) thấy `inflight === null` và refresh thật,
    // thay vì nhận lại promise đã resolve rồi bỏ qua.
    void started
      .finally(() => {
        if (inflight === started) inflight = null;
      })
      .catch(() => undefined);
    return started;
  };
}

type ItemResult = 'ok' | 'skip' | 'pause' | 'stop';

const SKIPPED_STATUSES = new Set([400, 403, 404]);
const STOPPED_STATUSES = new Set([401, 429, 503]);

export function createExamAudioPreloader(
  deps: AudioPreloadDependencies,
): AudioPreload {
  const maxTotalBytes = deps.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const gapMs = deps.gapMs ?? DEFAULT_GAP_MS;
  const controller = new AbortController();
  const urls = new Map<number, string>();
  let queue: number[] = [];
  let cursor = 0;
  let phase: AudioPreloadState = 'idle';
  let started = false;
  let running = false;
  let paused = false;
  let aborted = false;
  let disposed = false;
  /** 401/429/503 dừng cả phiên: resume() không được khởi động lại. */
  let halted = false;
  let usedBytes = 0;
  let skippedAny = false;

  const stopped = (): boolean => aborted || disposed || halted;

  /** Huỷ body của response bị bỏ (không đọc byte nào). */
  async function discard(response: Response): Promise<void> {
    await response.body?.cancel().catch(() => undefined);
  }

  async function loadItem(mediaId: number): Promise<ItemResult> {
    let src: string | null;
    try {
      src = await deps.getSrc(mediaId);
    } catch {
      // Grant không lấy được (mạng/route): coi như item này không tải trước
      // được, học viên vẫn phát trực tuyến như trước R12.
      return stopped() ? 'stop' : 'skip';
    }
    if (stopped()) return 'stop';
    if (src === null) return 'skip';

    let response: Response;
    try {
      response = await deps.fetch(src, {
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (error) {
      if (stopped()) return 'stop';
      // Lỗi mạng: offline thì giữ item để resume(), còn online thì bỏ item.
      if (error instanceof TypeError) return deps.isOnline() ? 'skip' : 'pause';
      return 'skip';
    }

    if (stopped()) {
      await discard(response);
      return 'stop';
    }
    if (STOPPED_STATUSES.has(response.status)) {
      await discard(response);
      return 'stop';
    }
    if (!response.ok) {
      await discard(response);
      return SKIPPED_STATUSES.has(response.status) ? 'skip' : 'stop';
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('audio/')) {
      await discard(response);
      return 'skip';
    }

    // Kiểm ngân sách bằng header trước khi đọc body để không kéo byte thừa.
    const contentLength = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(contentLength) && contentLength > 0) {
      if (contentLength > maxTotalBytes - usedBytes) {
        await discard(response);
        return 'skip';
      }
    }

    let blob: Blob;
    try {
      blob = await response.blob();
    } catch {
      return stopped() ? 'stop' : 'skip';
    }
    if (stopped()) return 'stop';
    if (blob.size > maxTotalBytes - usedBytes) return 'skip';

    usedBytes += blob.size;
    const url = deps.createObjectURL(blob);
    urls.set(mediaId, url);
    deps.onReady(mediaId, url);
    return 'ok';
  }

  async function run(): Promise<void> {
    if (running || stopped()) return;
    running = true;
    try {
      while (cursor < queue.length) {
        if (stopped()) {
          phase = 'stopped';
          return;
        }
        if (paused) {
          phase = 'paused';
          return;
        }
        if (usedBytes >= maxTotalBytes) {
          // Ngân sách đã hết: giữ những gì đã có, không bắt đầu item mới.
          skippedAny = true;
          phase = 'partial';
          return;
        }
        const result = await loadItem(queue[cursor] as number);
        if (result === 'stop') {
          halted = true;
          phase = 'stopped';
          return;
        }
        if (result === 'pause') {
          phase = 'paused';
          return;
        }
        if (result === 'skip') skippedAny = true;
        cursor += 1;
        if (cursor >= queue.length) break;
        if (stopped()) {
          phase = 'stopped';
          return;
        }
        phase = 'loading';
        await deps.sleep(gapMs);
      }
      if (stopped()) {
        phase = 'stopped';
        return;
      }
      phase = skippedAny ? 'partial' : 'complete';
    } finally {
      running = false;
    }
  }

  return {
    start(mediaIds) {
      if (started || stopped()) return;
      started = true;
      queue = [...new Set(mediaIds)];
      cursor = 0;
      paused = false;
      if (queue.length === 0) {
        phase = 'complete';
        return;
      }
      phase = 'loading';
      void run();
    },
    pause() {
      if (!started || stopped()) return;
      paused = true;
      if (phase === 'loading') phase = 'paused';
    },
    resume() {
      if (!started || stopped()) return;
      paused = false;
      if (running) return;
      if (cursor >= queue.length) return;
      phase = 'loading';
      void run();
    },
    abort() {
      if (stopped()) return;
      aborted = true;
      paused = false;
      controller.abort();
      phase = 'stopped';
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      aborted = true;
      controller.abort();
      for (const url of urls.values()) deps.revokeObjectURL(url);
      urls.clear();
      phase = 'stopped';
    },
    drop(mediaId) {
      const url = urls.get(mediaId);
      if (url === undefined) return;
      urls.delete(mediaId);
      deps.revokeObjectURL(url);
    },
    get(mediaId) {
      return urls.get(mediaId);
    },
    state() {
      return phase;
    },
  };
}
