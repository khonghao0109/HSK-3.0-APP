import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '@/lib/api/api-error';

const { backendRequest } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));

import { POST as createTopic } from './route';
import { POST as createTopicRevision } from './[topicId]/revisions/route';

function post(url: string, body: unknown, origin = 'http://127.0.0.1:3200') {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      origin,
      cookie: 'hsk_admin_session=test-token',
    },
    body: JSON.stringify(body),
  });
}

const CREATE_URL = 'http://127.0.0.1:3200/api/admin/content/topics';
const REVISION_URL =
  'http://127.0.0.1:3200/api/admin/content/topics/9/revisions';

async function runBoth(body: unknown) {
  return [
    await createTopic(post(CREATE_URL, body)),
    await createTopicRevision(post(REVISION_URL, body), {
      params: Promise.resolve({ topicId: '9' }),
    }),
  ];
}

describe('Topic BFF JSON boundary (M5.1a, Q90)', () => {
  it('rejects a cross-origin POST with 403 before touching the backend', async () => {
    for (const response of [
      await createTopic(
        post(CREATE_URL, { contentText: '[]' }, 'https://attacker.example'),
      ),
      await createTopicRevision(
        post(REVISION_URL, { contentText: '[]' }, 'https://attacker.example'),
        { params: Promise.resolve({ topicId: '9' }) },
      ),
    ]) {
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects a request without session cookie with 401', async () => {
    const request = new NextRequest(CREATE_URL, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3200' },
      body: JSON.stringify({ contentText: '[]' }),
    });
    const response = await createTopic(request);
    expect(response.status).toBe(401);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects oversized JSON with 400 JSON_TOO_LARGE before the backend', async () => {
    const big = `"${'字'.repeat(34_000)}"`; // ~102 KB UTF-8
    for (const response of await runBoth({
      lessonId: 1,
      title: 'Từ vựng',
      type: 'vocabulary',
      contentText: `[{"type":"text","value":${big}}]`,
      orderIndex: 1,
    })) {
      expect(response.status).toBe(400);
      expect(JSON.parse(await response.text()).error).toMatchObject({
        code: 'JSON_TOO_LARGE',
      });
    }
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects broken JSON with 400 INVALID_JSON and a line/column', async () => {
    const contentText = '[\n  { "type": "text" },\n  { bad\n]';
    for (const response of await runBoth({
      lessonId: 1,
      title: 'Từ vựng',
      type: 'vocabulary',
      contentText,
      orderIndex: 1,
    })) {
      expect(response.status).toBe(400);
      const error = JSON.parse(await response.text()).error;
      expect(error.code).toBe('INVALID_JSON');
      expect(error.message).toBe('Invalid JSON.');
      expect(typeof error.line).toBe('number');
      expect(typeof error.column).toBe('number');
    }
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects a non-string or missing contentText with 400', async () => {
    for (const body of [
      { lessonId: 1, title: 'x', type: 'vocabulary', orderIndex: 1 },
      {
        lessonId: 1,
        title: 'x',
        type: 'vocabulary',
        contentText: [{ type: 'text' }],
        orderIndex: 1,
      },
    ]) {
      for (const response of await runBoth(body)) {
        expect(response.status).toBe(400);
      }
    }
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric topicId on the revision route', async () => {
    const response = await createTopicRevision(
      post('http://127.0.0.1:3200/api/admin/content/topics/abc/revisions', {
        title: 'x',
        type: 'vocabulary',
        contentText: '[]',
        orderIndex: 1,
      }),
      { params: Promise.resolve({ topicId: 'abc' }) },
    );
    expect(response.status).toBe(400);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('passes a backend 409 error.code through unchanged (R15)', async () => {
    for (const code of [
      'CONTENT_CONSTRAINT_CONFLICT',
      'CONTENT_CONCURRENT_UPDATE',
    ]) {
      backendRequest.mockRejectedValue(
        new BackendRequestError({
          status: 409,
          kind: 'conflict',
          message: 'Conflict.',
          retryable: false,
          code,
        }),
      );
      for (const response of await runBoth({
        lessonId: 1,
        title: 'Từ vựng',
        type: 'vocabulary',
        contentText: '[]',
        orderIndex: 1,
      })) {
        expect(response.status).toBe(409);
        expect(JSON.parse(await response.text()).error.code).toBe(code);
      }
    }
    backendRequest.mockReset();
  });

  it('forwards the parsed content (not contentText) to the backend', async () => {
    backendRequest.mockResolvedValue({
      success: true,
      data: { idempotent: false, topic: { id: 9 } },
    });
    const create = await createTopic(
      post(CREATE_URL, {
        lessonId: 1,
        title: 'Từ vựng',
        subtitle: null,
        type: 'vocabulary',
        contentText: '[{"type":"text","value":"你好"}]',
        orderIndex: 1,
        isPremium: false,
        isLocked: false,
      }),
    );
    expect(create.status).toBe(200);
    expect(create.headers.get('cache-control')).toBe('no-store');
    const [path, init] = backendRequest.mock.calls.at(-1) ?? [];
    expect(path).toBe('/api/v1/admin/cms/topics');
    expect(init).toMatchObject({
      method: 'POST',
      body: {
        lessonId: 1,
        title: 'Từ vựng',
        content: [{ type: 'text', value: '你好' }],
      },
    });
    expect(init?.body).not.toHaveProperty('contentText');

    const revision = await createTopicRevision(
      post(REVISION_URL, {
        title: 'Từ vựng',
        subtitle: null,
        type: 'vocabulary',
        contentText: '[]',
        orderIndex: 1,
        isPremium: false,
        isLocked: false,
      }),
      { params: Promise.resolve({ topicId: '9' }) },
    );
    expect(revision.status).toBe(200);
    expect(backendRequest.mock.calls.at(-1)?.[0]).toBe(
      '/api/v1/admin/cms/topics/9/revisions',
    );
  });
});
