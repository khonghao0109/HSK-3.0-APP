import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { MEDIA_UPLOAD_BFF_MAX_BYTES } from '@/features/media-upload/media-upload-values';
import { BackendRequestError } from '@/lib/api/api-error';

const { backendUpload } = vi.hoisted(() => ({ backendUpload: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { upload: backendUpload },
}));

import { handleMediaUpload } from './media-upload-route-handler';

const ORIGIN = 'http://127.0.0.1:3200';
const KEY = '8f6c1d4e-2b7a-4c39-9e51-0a3f6b2d7c18';
const CONTENT_TYPE = 'multipart/form-data; boundary=----hsk';
const BODY = new Uint8Array([1, 2, 3, 4]);

type Overrides = {
  origin?: string | null;
  cookie?: boolean;
  contentType?: string | null;
  contentLength?: string | null;
  key?: string | null;
  query?: string;
  body?: Uint8Array<ArrayBuffer>;
};

function upload(overrides: Overrides = {}) {
  const headers = new Headers();
  const origin = overrides.origin === undefined ? ORIGIN : overrides.origin;
  if (origin !== null) headers.set('origin', origin);
  if (overrides.cookie !== false)
    headers.set('cookie', 'hsk_admin_session=token-1');
  const contentType =
    overrides.contentType === undefined ? CONTENT_TYPE : overrides.contentType;
  if (contentType !== null) headers.set('content-type', contentType);
  const body = overrides.body ?? BODY;
  const contentLength =
    overrides.contentLength === undefined
      ? String(body.byteLength)
      : overrides.contentLength;
  if (contentLength !== null) headers.set('content-length', contentLength);
  const key = overrides.key === undefined ? KEY : overrides.key;
  if (key !== null) headers.set('idempotency-key', key);
  return new NextRequest(
    `${ORIGIN}/api/admin/media/ingestions${overrides.query ?? '?dataSourceId=12'}`,
    { method: 'POST', headers, body },
  );
}

const ingested = {
  success: true,
  data: {
    idempotent: false,
    media: {
      id: 77,
      type: 'audio',
      mimeType: 'audio/wav',
      size: 4,
      processingStatus: 'ready',
    },
  },
  meta: { requestId: 'req-1', timestamp: '2026-10-21T00:00:00.000Z' },
};

async function codeOf(response: Response) {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

describe('handleMediaUpload (TL-40)', () => {
  it('checks in order Origin → cookie → content-type → length → key → dataSourceId', async () => {
    backendUpload.mockResolvedValue(ingested);
    const broken: Overrides = {
      origin: 'http://evil.example',
      cookie: false,
      contentType: 'application/json',
      contentLength: String(MEDIA_UPLOAD_BFF_MAX_BYTES + 1),
      key: 'short',
      query: '?dataSourceId=0',
    };
    const statuses: number[] = [];
    for (const fix of [
      'origin',
      'cookie',
      'contentType',
      'contentLength',
      'key',
      'query',
    ] as const) {
      statuses.push((await handleMediaUpload(upload(broken))).status);
      delete broken[fix];
    }
    statuses.push((await handleMediaUpload(upload(broken))).status);

    expect(statuses).toEqual([403, 401, 415, 413, 400, 400, 201]);
    expect(backendUpload).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['multipart without boundary', 'multipart/form-data'],
    ['text/plain', 'text/plain'],
  ])('rejects %s with 415 MULTIPART_INVALID', async (_, contentType) => {
    const response = await handleMediaUpload(upload({ contentType }));
    expect(response.status).toBe(415);
    expect(await codeOf(response)).toBe('MULTIPART_INVALID');
  });

  it('requires Content-Length (411) before reading the body', async () => {
    const response = await handleMediaUpload(upload({ contentLength: null }));
    expect(response.status).toBe(411);
  });

  it('rejects a body larger than declared once read (413) without calling the backend', async () => {
    backendUpload.mockClear();
    const response = await handleMediaUpload(
      upload({
        contentLength: '4',
        body: new Uint8Array(MEDIA_UPLOAD_BFF_MAX_BYTES + 1),
      }),
    );
    expect(response.status).toBe(413);
    expect(await codeOf(response)).toBe('UPLOAD_TOO_LARGE');
    expect(backendUpload).not.toHaveBeenCalled();
  });

  it('rejects a body shorter than Content-Length (400 UPLOAD_BODY_INCOMPLETE) without calling the backend', async () => {
    backendUpload.mockClear();
    const response = await handleMediaUpload(upload({ contentLength: '10' }));
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('UPLOAD_BODY_INCOMPLETE');
    expect(backendUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['too short', 'a'.repeat(31)],
    ['unsafe char', `${'a'.repeat(32)}/x`],
  ])('rejects a %s Idempotency-Key with 400', async (_, key) => {
    const response = await handleMediaUpload(upload({ key }));
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it.each(['', '?dataSourceId=abc', '?dataSourceId=-1', '?dataSourceId=1&x=2'])(
    'rejects query %j with 400',
    async (query) => {
      expect((await handleMediaUpload(upload({ query }))).status).toBe(400);
    },
  );

  it('forwards only content-type, key, bearer and the exact bytes', async () => {
    backendUpload.mockClear();
    backendUpload.mockResolvedValue(ingested);
    const response = await handleMediaUpload(upload());

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      success: true,
      data: ingested.data,
    });
    const [path, options] = backendUpload.mock.calls[0] as [
      string,
      { body: ArrayBuffer },
    ];
    expect(path).toBe('/api/v1/admin/cms/media/ingestions?dataSourceId=12');
    expect(Object.keys(options).sort()).toEqual([
      'body',
      'contentType',
      'idempotencyKey',
      'token',
    ]);
    expect(options).toMatchObject({
      token: 'token-1',
      idempotencyKey: KEY,
      contentType: CONTENT_TYPE,
    });
    expect([...new Uint8Array(options.body)]).toEqual([...BODY]);
  });

  it('relays backend status and code (422, 409, BFF timeout 503)', async () => {
    for (const [status, code] of [
      [422, 'MIME_SIGNATURE_MISMATCH'],
      [409, 'IDEMPOTENCY_KEY_IN_USE'],
      [503, 'MEDIA_UPLOAD_BFF_TIMEOUT'],
    ] as const) {
      backendUpload.mockRejectedValueOnce(
        new BackendRequestError({
          status,
          kind: 'unknown',
          message: 'x',
          retryable: false,
          code,
        }),
      );
      const response = await handleMediaUpload(upload());
      expect(response.status).toBe(status);
      expect(await codeOf(response)).toBe(code);
    }
  });
});
