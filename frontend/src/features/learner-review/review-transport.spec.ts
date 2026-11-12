import { describe, expect, it, vi } from 'vitest';

import {
  createReviewTransport,
  REVIEW_GRADE_RETRIES,
} from './review-transport';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function transport(fetcher: typeof fetch) {
  return createReviewTransport(fetcher, () => Promise.resolve());
}

describe('review transport (M3.3a)', () => {
  it('reads the current session, and 404 means no session', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json(200, {
          success: true,
          data: { session: { sessionId: 1 }, items: [] },
        }),
      )
      .mockResolvedValueOnce(json(404, { success: false, error: {} }));
    const t = transport(fetcher);
    expect(await t.current()).toEqual({
      ok: true,
      data: { session: { sessionId: 1 }, items: [] },
    });
    expect(await t.current()).toEqual({ ok: false, status: 404, code: null });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/learner/review/sessions/current',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('creates with the Idempotency-Key header and returns the 409 code', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json(409, { success: false, error: { code: 'REVIEW_NOTHING_DUE' } }),
      );
    const result = await transport(fetcher).create('key-00000001');
    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'REVIEW_NOTHING_DUE',
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('/api/learner/review/sessions');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      'key-00000001',
    );
    expect(init?.body).toBe('{}');
  });

  it('retries a network failure or 5xx with the same key, at most 3 times', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json(503, { success: false, error: {} }))
      .mockResolvedValueOnce(
        json(200, {
          success: true,
          data: { cardId: 7, session: { reviewedCount: 1 } },
        }),
      );
    const result = await transport(fetcher).grade(
      41,
      { cardId: 7, grade: 'good', durationMs: 900 },
      'key-00000002',
    );
    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('/api/learner/review/sessions/41/reviews');
      expect(new Headers(init?.headers).get('idempotency-key')).toBe(
        'key-00000002',
      );
      expect(init?.body).toBe('{"cardId":7,"grade":"good","durationMs":900}');
    }
  });

  it('gives up after 1 + 3 attempts', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('offline'));
    const result = await transport(fetcher).grade(
      41,
      { cardId: 7, grade: 'again', durationMs: 0 },
      'key-00000003',
    );
    expect(result).toEqual({ ok: false, status: 0, code: null });
    expect(fetcher).toHaveBeenCalledTimes(1 + REVIEW_GRADE_RETRIES);
  });

  it('does not retry a 409', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json(409, {
        success: false,
        error: { code: 'REVIEW_CARD_UNAVAILABLE' },
      }),
    );
    const result = await transport(fetcher).grade(
      41,
      { cardId: 7, grade: 'hard', durationMs: 1 },
      'key-00000004',
    );
    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'REVIEW_CARD_UNAVAILABLE',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats an unreadable 2xx body as a network failure', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('<html>', { status: 200 }));
    expect(await transport(fetcher).complete(41)).toEqual({
      ok: false,
      status: 0,
      code: null,
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/learner/review/sessions/41/complete',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
