import { describe, expect, it, vi } from 'vitest';

import { createExamTransport } from './exam-take-transport';
import type { SaveRequest } from './exam-save-queue';

const VIEW = (version: number) => ({
  questionKey: 'q1',
  answer: { choice: 'b' },
  isFlagged: true,
  version,
  answeredAt: '2026-10-27T09:00:00.000Z',
  lastSavedAt: '2026-10-27T09:00:00.000Z',
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const request: SaveRequest = {
  answer: { choice: 'b' },
  isFlagged: true,
  expectedVersion: null,
  idempotencyKey: '11111111-1111-4111-8111-111111111111',
};

describe('exam take transport (B1)', () => {
  it('reads the nested view of a batch result and the conflict current view', async () => {
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      void input;
      void init;
      return json(200, {
        success: true,
        data: {
          results: [
            {
              questionKey: 'q1',
              status: 'saved',
              answer: VIEW(2),
            },
            {
              questionKey: 'q2',
              status: 'conflict',
              current: { ...VIEW(5), questionKey: 'q2' },
            },
          ],
          serverNow: '2026-10-27T09:00:00.000Z',
          remainingSeconds: 300,
        },
      });
    });
    const transport = createExamTransport(7, fetcher);
    const response = await transport.saveBatch([
      { questionKey: 'q1', ...request },
    ]);
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init?.method).toBe('PUT');
    expect(init?.keepalive).toBe(true);
    expect(response).toMatchObject({
      kind: 'ok',
      remainingSeconds: 300,
      results: [
        {
          questionKey: 'q1',
          status: 'saved',
          version: 2,
          answer: { choice: 'b' },
          isFlagged: true,
        },
        {
          questionKey: 'q2',
          status: 'conflict',
          current: { version: 5, answer: { choice: 'b' }, isFlagged: true },
        },
      ],
    });
  });

  it('maps saved and replayed single responses', async () => {
    for (const version of [2, 3]) {
      const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
        void input;
        void init;
        return json(200, {
          success: true,
          data: { ...VIEW(version), serverNow: 'x', remainingSeconds: 10 },
        });
      });
      const response = await createExamTransport(7, fetcher).saveOne(
        'q1',
        request,
      );
      expect(fetcher.mock.calls[0]?.[1]?.keepalive).toBe(true);
      expect(response).toMatchObject({
        kind: 'saved',
        version,
        answer: { choice: 'b' },
        isFlagged: true,
        remainingSeconds: 10,
      });
    }
  });

  it('maps status codes to the queue failure kinds', async () => {
    const cases: Array<[number, string, string?]> = [
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [404, 'not_found'],
      [429, 'rate_limited'],
      [503, 'unavailable'],
      [409, 'expired', 'EXAM_ATTEMPT_EXPIRED'],
      [409, 'closed', 'EXAM_ATTEMPT_CLOSED'],
      [409, 'invalid', 'EXAM_ANSWER_INVALID'],
    ];
    for (const [status, kind, code] of cases) {
      const fetcher = vi.fn(async () =>
        json(status, {
          success: false,
          error: { kind: 'x', message: 'x', ...(code ? { code } : {}) },
        }),
      );
      await expect(
        createExamTransport(7, fetcher).saveOne('q1', request),
      ).resolves.toMatchObject({ kind });
    }
  });

  it('treats an unreadable 2xx body as an unknown outcome (network)', async () => {
    for (const body of [null, { success: true, data: {} }]) {
      const fetcher = vi.fn(async () => json(200, body));
      await expect(
        createExamTransport(7, fetcher).saveOne('q1', request),
      ).resolves.toEqual({ kind: 'network' });
    }
  });

  it('maps a network throw to network', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      createExamTransport(7, fetcher).saveOne('q1', request),
    ).resolves.toEqual({ kind: 'network' });
  });

  it('aborts a hanging autosave and maps the abort to network', async () => {
    const hanging = vi.fn((input: string, init?: RequestInit) => {
      void input;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    const transport = createExamTransport(7, hanging, 20);
    await expect(transport.saveOne('q1', request)).resolves.toEqual({
      kind: 'network',
    });
    await expect(
      transport.saveBatch([{ questionKey: 'q1', ...request }]),
    ).resolves.toEqual({ kind: 'network' });
    expect(hanging.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  }, 500);

  it('reads one batch result per mapping row (B1)', async () => {
    const rows: Array<[number, unknown, Record<string, unknown>]> = [
      [
        200,
        {
          success: true,
          data: {
            results: [
              {
                questionKey: 'q1',
                status: 'conflict',
                current: { ...VIEW(5), questionKey: 'q1' },
              },
            ],
          },
        },
        { kind: 'ok' },
      ],
      [
        401,
        { success: false, error: { kind: 'x', message: 'x' } },
        { kind: 'unauthorized' },
      ],
      [
        403,
        { success: false, error: { kind: 'x', message: 'x' } },
        { kind: 'unauthorized' },
      ],
      [
        404,
        { success: false, error: { kind: 'x', message: 'x' } },
        { kind: 'not_found' },
      ],
      [
        409,
        {
          success: false,
          error: { kind: 'x', message: 'x', code: 'EXAM_ATTEMPT_EXPIRED' },
        },
        { kind: 'expired' },
      ],
      [
        409,
        {
          success: false,
          error: { kind: 'x', message: 'x', code: 'EXAM_ATTEMPT_CLOSED' },
        },
        { kind: 'closed' },
      ],
      [
        429,
        { success: false, error: { kind: 'x', message: 'x' } },
        { kind: 'rate_limited' },
      ],
      [
        503,
        { success: false, error: { kind: 'x', message: 'x' } },
        { kind: 'unavailable' },
      ],
      [200, { success: true, data: {} }, { kind: 'unavailable' }],
    ];
    for (const [status, payload, expected] of rows) {
      const fetcher = vi.fn(async () => json(status, payload));
      const response = await createExamTransport(7, fetcher).saveBatch([
        { questionKey: 'q1', ...request },
      ]);
      expect(response).toMatchObject(expected);
    }
    const conflictFetcher = vi.fn(async () =>
      json(200, {
        success: true,
        data: {
          results: [
            {
              questionKey: 'q1',
              status: 'conflict',
              current: { ...VIEW(5), questionKey: 'q1' },
            },
          ],
        },
      }),
    );
    const conflict = await createExamTransport(7, conflictFetcher).saveBatch([
      { questionKey: 'q1', ...request },
    ]);
    expect(conflict).toMatchObject({
      kind: 'ok',
      results: [
        {
          questionKey: 'q1',
          status: 'conflict',
          current: { version: 5, answer: { choice: 'b' }, isFlagged: true },
        },
      ],
    });
  });
});
