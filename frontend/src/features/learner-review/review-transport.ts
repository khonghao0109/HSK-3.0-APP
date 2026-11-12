import type { ReviewGrade } from './review-model';

// Zod-free BFF calls of the review island (M3.3a). `status` 0 is a network
// failure or an unreadable 2xx body.

export type ReviewCall<T> =
  { ok: true; data: T } | { ok: false; status: number; code: string | null };

/** R4/Q262: a failed grade is resent with the same key at most this often. */
export const REVIEW_GRADE_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 15_000;

type Fetcher = typeof fetch;
type Wait = (ms: number) => Promise<void>;

const defaultWait: Wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createReviewTransport(
  fetcher: Fetcher = (...args) => fetch(...args),
  wait: Wait = defaultWait,
) {
  async function call<T>(
    url: string,
    init: { method?: 'POST'; key?: string; body?: unknown } = {},
  ): Promise<ReviewCall<T>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.key) headers['idempotency-key'] = init.key;
    if (init.method === 'POST') headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await fetcher(url, {
        method: init.method ?? 'GET',
        headers,
        body:
          init.method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, status: 0, code: null };
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = record(record(payload)?.error)?.code;
      return {
        ok: false,
        status: response.status,
        code: typeof code === 'string' ? code : null,
      };
    }
    const data = record(payload)?.data;
    if (record(data) === null) return { ok: false, status: 0, code: null };
    return { ok: true, data: data as T };
  }

  const session = (id: number, suffix: string) =>
    `/api/learner/review/sessions/${String(id)}/${suffix}`;

  return {
    current<T>() {
      return call<T>('/api/learner/review/sessions/current');
    },
    create<T>(key: string) {
      return call<T>('/api/learner/review/sessions', { method: 'POST', key });
    },
    async grade<T>(
      sessionId: number,
      body: { cardId: number; grade: ReviewGrade; durationMs: number },
      key: string,
    ): Promise<ReviewCall<T>> {
      let result = await call<T>(session(sessionId, 'reviews'), {
        method: 'POST',
        key,
        body,
      });
      for (
        let attempt = 1;
        attempt <= REVIEW_GRADE_RETRIES &&
        !result.ok &&
        (result.status === 0 || result.status >= 500);
        attempt += 1
      ) {
        await wait(400 * attempt);
        result = await call<T>(session(sessionId, 'reviews'), {
          method: 'POST',
          key,
          body,
        });
      }
      return result;
    },
    complete<T>(sessionId: number) {
      return call<T>(session(sessionId, 'complete'), { method: 'POST' });
    },
    /** M3.3b (Q268): read once by /learn/review. */
    overview<T>() {
      return call<T>('/api/learner/review/overview');
    },
  };
}

export type ReviewTransport = ReturnType<typeof createReviewTransport>;
