import { NextRequest, type NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError, normalizeApiFailure } from '@/lib/api/api-error';
import { getRefreshCookieName } from '@/lib/auth/session-cookie';

import {
  handleDictionarySave,
  handleDictionarySearch,
  type DictionaryHandlerDependencies,
} from './dictionary-route-handler';

const appOrigin = 'http://127.0.0.1:3200';
const learnerCookieName = 'hsk_learner_session';
const meta = { requestId: 'r', timestamp: 't' };
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const item = {
  id: 12,
  hanzi: '学习',
  pinyin: 'xue2 xi2',
  pinyinTone: 'xuéxí',
  meanings: [{ en: 'to learn', vi: 'học tập' }],
  level: 'HSK 1',
};

function deps(
  requestBackend: DictionaryHandlerDependencies['requestBackend'],
): DictionaryHandlerDependencies {
  return { appOrigin, learnerCookieName, production: false, requestBackend };
}

function backendError(status: number) {
  return new BackendRequestError(normalizeApiFailure({ status }));
}

function searchRequest(q: string | null, cookie = true) {
  const url = new URL('/api/learner/dictionary', appOrigin);
  if (q !== null) url.searchParams.set('q', q);
  const headers = new Headers();
  if (cookie) headers.set('cookie', `${learnerCookieName}=learner-token`);
  return new NextRequest(url, { headers });
}

function saveRequest(
  id: string,
  method: 'POST' | 'DELETE',
  options: { origin?: string | null; cookie?: boolean } = {},
) {
  const headers = new Headers();
  if (options.origin !== null)
    headers.set('origin', options.origin ?? appOrigin);
  if (options.cookie !== false)
    headers.set('cookie', `${learnerCookieName}=learner-token`);
  return new NextRequest(
    new URL(`/api/learner/dictionary/words/${id}/save`, appOrigin),
    { method, headers },
  );
}

async function expectFailure(
  response: NextResponse,
  status: number,
  kind: string,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({
    success: false,
    error: { kind },
  });
}

function expectCookiesCleared(response: NextResponse): void {
  expect(response.cookies.get(learnerCookieName)?.maxAge).toBe(0);
  expect(
    response.cookies.get(getRefreshCookieName(learnerCookieName))?.maxAge,
  ).toBe(0);
}

describe('handleDictionarySearch', () => {
  it('searches with the learner token and returns the rows with no-store', async () => {
    const requestBackend = vi
      .fn()
      .mockResolvedValue({ success: true, data: [item], meta });

    const response = await handleDictionarySearch(
      searchRequest('  学习 '),
      deps(requestBackend),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ success: true, data: [item] });
    expect(requestBackend).toHaveBeenCalledWith(
      `/api/v1/dictionary?query=${encodeURIComponent('学习')}`,
      { token: 'learner-token' },
    );
  });

  it('encodes & and # so the query cannot add backend parameters', async () => {
    const requestBackend = vi
      .fn()
      .mockResolvedValue({ success: true, data: [], meta });

    await handleDictionarySearch(
      searchRequest('a&x=1#b'),
      deps(requestBackend),
    );

    expect(requestBackend).toHaveBeenCalledWith(
      '/api/v1/dictionary?query=a%26x%3D1%23b',
      { token: 'learner-token' },
    );
  });

  it('answers 401 without a cookie and never calls the backend', async () => {
    const requestBackend = vi.fn();
    const response = await handleDictionarySearch(
      searchRequest('学习', false),
      deps(requestBackend),
    );
    await expectFailure(response, 401, 'session_expired');
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['blank', '   '],
    ['65 characters', 'a'.repeat(65)],
  ])('answers 400 for a %s query', async (_label, q) => {
    const requestBackend = vi.fn();
    const response = await handleDictionarySearch(
      searchRequest(q),
      deps(requestBackend),
    );
    await expectFailure(response, 400, 'invalid_request');
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('accepts a 64-character query', async () => {
    const requestBackend = vi
      .fn()
      .mockResolvedValue({ success: true, data: [], meta });
    const response = await handleDictionarySearch(
      searchRequest('a'.repeat(64)),
      deps(requestBackend),
    );
    expect(response.status).toBe(200);
  });

  it.each([
    ['a row without meanings', { success: true, data: [{ id: 1 }], meta }],
    ['no envelope', [item]],
    ['a negative id', { success: true, data: [{ ...item, id: -1 }], meta }],
  ])('answers 502 when the backend sends %s', async (_label, body) => {
    const response = await handleDictionarySearch(
      searchRequest('学习'),
      deps(vi.fn().mockResolvedValue(body)),
    );
    await expectFailure(response, 502, 'unknown');
  });

  it.each([401, 403])(
    'clears the learner cookies on backend %s',
    async (status) => {
      const response = await handleDictionarySearch(
        searchRequest('学习'),
        deps(vi.fn().mockRejectedValue(backendError(status))),
      );
      expect(response.status).toBe(status);
      expectCookiesCleared(response);
    },
  );

  it.each([
    [429, 429, 'rate_limited'],
    [400, 400, 'invalid_request'],
    [404, 404, 'not_found'],
    [500, 503, 'unavailable'],
    [503, 503, 'unavailable'],
  ])('maps backend %s to %s', async (backendStatus, status, kind) => {
    const response = await handleDictionarySearch(
      searchRequest('学习'),
      deps(vi.fn().mockRejectedValue(backendError(backendStatus))),
    );
    await expectFailure(response, status, kind);
    expect(response.cookies.get(learnerCookieName)).toBeUndefined();
  });

  it('maps a thrown non-backend error to 503', async () => {
    const response = await handleDictionarySearch(
      searchRequest('学习'),
      deps(vi.fn().mockRejectedValue(new TypeError('fetch failed'))),
    );
    await expectFailure(response, 503, 'unavailable');
  });
});

describe('handleDictionarySave', () => {
  const saved = (value: boolean) => ({
    success: true,
    data: { wordId: 12, saved: value, eventId: null, occurredAt: null },
    meta,
  });

  it('POST saves with a fresh server-side UUID Idempotency-Key each time', async () => {
    const requestBackend = vi.fn().mockResolvedValue(saved(true));

    const first = await handleDictionarySave(
      saveRequest('12', 'POST'),
      '12',
      'POST',
      deps(requestBackend),
    );
    await handleDictionarySave(
      saveRequest('12', 'POST'),
      '12',
      'POST',
      deps(requestBackend),
    );

    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(await first.json()).toEqual({
      success: true,
      data: { saved: true },
    });
    const calls = requestBackend.mock.calls as Array<
      [string, { token?: string; method?: string; idempotencyKey?: string }]
    >;
    const keys = calls.map(([path, options]) => {
      expect(path).toBe('/api/v1/dictionary/words/12/save');
      expect(options).toMatchObject({ token: 'learner-token', method: 'POST' });
      return options.idempotencyKey;
    });
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(key).toMatch(UUID);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('DELETE unsaves without an Idempotency-Key', async () => {
    const requestBackend = vi.fn().mockResolvedValue({
      success: true,
      data: { wordId: 12, saved: false },
      meta,
    });

    const response = await handleDictionarySave(
      saveRequest('12', 'DELETE'),
      '12',
      'DELETE',
      deps(requestBackend),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { saved: false },
    });
    expect(requestBackend).toHaveBeenCalledWith(
      '/api/v1/dictionary/words/12/save',
      { token: 'learner-token', method: 'DELETE' },
    );
  });

  it.each(['POST', 'DELETE'] as const)(
    '%s answers 403 for another origin or no origin',
    async (method) => {
      const requestBackend = vi.fn();
      for (const origin of ['https://evil.example', null]) {
        const response = await handleDictionarySave(
          saveRequest('12', method, { origin }),
          '12',
          method,
          deps(requestBackend),
        );
        await expectFailure(response, 403, 'forbidden');
      }
      expect(requestBackend).not.toHaveBeenCalled();
    },
  );

  it.each(['abc', '0', '-1', '1.5', '012', '2147483648'])(
    'answers 404 for id %s without calling the backend',
    async (id) => {
      const requestBackend = vi.fn();
      const response = await handleDictionarySave(
        saveRequest(id, 'POST'),
        id,
        'POST',
        deps(requestBackend),
      );
      await expectFailure(response, 404, 'not_found');
      expect(requestBackend).not.toHaveBeenCalled();
    },
  );

  it('accepts the largest int4 id', async () => {
    const requestBackend = vi.fn().mockResolvedValue(saved(true));
    const response = await handleDictionarySave(
      saveRequest('2147483647', 'POST'),
      '2147483647',
      'POST',
      deps(requestBackend),
    );
    expect(response.status).toBe(200);
  });

  it('answers 401 without a cookie', async () => {
    const requestBackend = vi.fn();
    const response = await handleDictionarySave(
      saveRequest('12', 'POST', { cookie: false }),
      '12',
      'POST',
      deps(requestBackend),
    );
    await expectFailure(response, 401, 'session_expired');
    expect(requestBackend).not.toHaveBeenCalled();
  });

  it('passes WORD_NOT_FOUND through as 404', async () => {
    const response = await handleDictionarySave(
      saveRequest('12', 'POST'),
      '12',
      'POST',
      deps(vi.fn().mockRejectedValue(backendError(404))),
    );
    await expectFailure(response, 404, 'not_found');
  });

  it.each([401, 403])(
    'clears the learner cookies on backend %s',
    async (status) => {
      const response = await handleDictionarySave(
        saveRequest('12', 'DELETE'),
        '12',
        'DELETE',
        deps(vi.fn().mockRejectedValue(backendError(status))),
      );
      expect(response.status).toBe(status);
      expectCookiesCleared(response);
    },
  );

  it.each([
    [429, 429, 'rate_limited'],
    [500, 503, 'unavailable'],
  ])('maps backend %s to %s', async (backendStatus, status, kind) => {
    const response = await handleDictionarySave(
      saveRequest('12', 'POST'),
      '12',
      'POST',
      deps(vi.fn().mockRejectedValue(backendError(backendStatus))),
    );
    await expectFailure(response, status, kind);
  });

  it('answers 502 when the backend body is malformed', async () => {
    const response = await handleDictionarySave(
      saveRequest('12', 'POST'),
      '12',
      'POST',
      deps(vi.fn().mockResolvedValue({ success: true, data: {}, meta })),
    );
    await expectFailure(response, 502, 'unknown');
  });
});
