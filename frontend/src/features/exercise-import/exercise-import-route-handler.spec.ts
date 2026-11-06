import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '@/lib/api/api-error';

const { backendRequest } = vi.hoisted(() => ({ backendRequest: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));

import {
  INVALID_IDEMPOTENCY_KEY,
  handleExerciseImportCommit,
  handleExerciseImportPreview,
} from './exercise-import-route-handler';

const ORIGIN = 'http://127.0.0.1:3200';
const PREVIEW_URL = `${ORIGIN}/api/admin/exercise-imports/preview`;
const COMMIT_URL = `${ORIGIN}/api/admin/exercise-imports`;
const PREVIEW_HASH = 'a'.repeat(64);

const validBody = {
  dataSourceId: 11,
  fileName: 'bai-tap.json',
  rows: [{ sourceKey: 'row-1' }],
};

function meta(requestId: string) {
  return { requestId, timestamp: '2026-10-21T00:00:00.000Z' };
}

function previewEnvelope(errors: unknown[] = [], invalidRows = 0) {
  return {
    success: true,
    data: {
      totalRows: 2,
      validRows: invalidRows > 0 ? 0 : 2,
      invalidRows,
      errors,
      previewHash: PREVIEW_HASH,
    },
    meta: meta('req-preview'),
  };
}

const commitEnvelope = {
  success: true,
  data: {
    importJob: {
      id: 3,
      status: 'completed',
      dataSourceId: 11,
      fileName: 'bai-tap.json',
      totalRows: 1,
      validRows: 1,
      errorRows: 0,
      importedRows: 1,
    },
    exercises: [
      {
        id: 41,
        lessonId: 2,
        topicId: null,
        type: 'mcq',
        prompt: 'Chọn đáp án',
        status: 'draft',
        version: 1,
        orderIndex: 1,
        dataSourceId: 11,
        sourceKey: 'row-1',
        createdAt: '2026-10-21T00:00:00.000Z',
        updatedAt: '2026-10-21T00:00:00.000Z',
      },
    ],
    importedRows: 1,
    idempotent: false,
  },
  meta: meta('req-commit'),
};

function post(
  url: string,
  options: {
    origin?: string | null;
    cookie?: string | null;
    body?: unknown | string;
    idempotencyKey?: string | null;
    contentLength?: string | null;
  } = {},
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.origin !== null) headers.set('origin', options.origin ?? ORIGIN);
  if (options.cookie !== null) {
    headers.set('cookie', options.cookie ?? 'hsk_admin_session=test-token');
  }
  if (options.idempotencyKey !== null && options.idempotencyKey !== undefined) {
    headers.set('idempotency-key', options.idempotencyKey);
  }
  if (options.contentLength !== null && options.contentLength !== undefined) {
    headers.set('content-length', options.contentLength);
  }
  const body =
    options.body === undefined
      ? JSON.stringify(validBody)
      : typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body);
  return new NextRequest(url, { method: 'POST', headers, body });
}

describe('exercise import BFF boundary (M5.1b2, TL-27/TL-30; Z1/Z10/Z12)', () => {
  it.each([undefined, 'https://attacker.example'])(
    'chặn Origin thiếu hoặc khác trước khi đọc body/backend (origin=%s)',
    async (origin) => {
      const preview = await handleExerciseImportPreview(
        post(PREVIEW_URL, { origin: origin ?? null }),
      );
      expect(preview.status).toBe(403);
      const commit = await handleExerciseImportCommit(
        post(COMMIT_URL, {
          origin: origin ?? null,
          idempotencyKey: 'import-key-0001',
        }),
      );
      expect(commit.status).toBe(403);
      expect(backendRequest).not.toHaveBeenCalled();
    },
  );

  it('trả 401 khi thiếu cookie phiên admin', async () => {
    const response = await handleExerciseImportPreview(
      post(PREVIEW_URL, { cookie: null }),
    );
    expect(response.status).toBe(401);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('trả 413 khi body commit vượt 102 400 byte (TL-30)', async () => {
    const response = await handleExerciseImportCommit(
      post(COMMIT_URL, {
        body: { ...validBody, filler: 'x'.repeat(110_000) },
        idempotencyKey: 'import-key-0001',
      }),
    );
    expect(response.status).toBe(413);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('Z12: Content-Length > 102 400 → 413 trước khi đọc body', async () => {
    const response = await handleExerciseImportCommit(
      post(COMMIT_URL, {
        body: JSON.stringify(validBody),
        contentLength: '200000',
        idempotencyKey: 'import-key-0001',
      }),
    );
    expect(response.status).toBe(413);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('trả 400 khi body không phải JSON', async () => {
    const response = await handleExerciseImportPreview(
      post(PREVIEW_URL, { body: '{not-json' }),
    );
    expect(response.status).toBe(400);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('Z10: commit bắt buộc Idempotency-Key đúng pattern: thiếu/sai → 400 + mã máy', async () => {
    const cases = [undefined, 'short', 'import key with spaces'] as const;
    for (const key of cases) {
      const response = await handleExerciseImportCommit(
        post(COMMIT_URL, {
          ...(key === undefined ? {} : { idempotencyKey: key }),
        }),
      );
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe(INVALID_IDEMPOTENCY_KEY);
    }
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('preview chuyển tiếp body tới backend và trả data đã parse', async () => {
    backendRequest.mockResolvedValueOnce(previewEnvelope());
    const response = await handleExerciseImportPreview(post(PREVIEW_URL));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { totalRows: 2, validRows: 2, invalidRows: 0, errorsTotal: 0 },
    });
    expect(backendRequest).toHaveBeenCalledWith(
      '/api/v1/admin/cms/exercise-imports/preview',
      expect.objectContaining({ method: 'POST', body: validBody }),
    );
  });

  it('Z1: backend trả 250 lỗi → 200, giữ 100 lỗi đầu và errorsTotal=250', async () => {
    const errors = Array.from({ length: 250 }, (_, index) => ({
      rowNumber: (index % 100) + 1,
      code: 'REQUIRED_FIELD',
      path: `rows[${index}].prompt`,
    }));
    backendRequest.mockResolvedValueOnce(previewEnvelope(errors, 100));
    const response = await handleExerciseImportPreview(post(PREVIEW_URL));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        errors: { rowNumber: number; path: string }[];
        errorsTotal: number;
      };
    };
    expect(body.data.errorsTotal).toBe(250);
    expect(body.data.errors).toHaveLength(100);
    // Thứ tự backend giữ nguyên: 100 lỗi ĐẦU của mảng.
    expect(body.data.errors[0]).toMatchObject({
      rowNumber: 1,
      path: 'rows[0].prompt',
    });
    expect(body.data.errors[99]).toMatchObject({ rowNumber: 100 });
  });

  it('Z1: phần tử lỗi sai shape → fail closed 503 (validate từng phần tử)', async () => {
    backendRequest.mockResolvedValueOnce(
      previewEnvelope([{ rowNumber: 'not-a-number', code: 'X', path: 'p' }], 1),
    );
    const response = await handleExerciseImportPreview(post(PREVIEW_URL));
    expect(response.status).toBe(503);
  });

  it('commit chuyển tiếp đúng Idempotency-Key qua RequestOptions', async () => {
    backendRequest.mockResolvedValueOnce(commitEnvelope);
    const response = await handleExerciseImportCommit(
      post(COMMIT_URL, {
        body: { ...validBody, previewHash: PREVIEW_HASH },
        idempotencyKey: 'import-key-0001',
      }),
    );
    expect(response.status).toBe(200);
    expect(backendRequest).toHaveBeenCalledWith(
      '/api/v1/admin/cms/exercise-imports',
      expect.objectContaining({ idempotencyKey: 'import-key-0001' }),
    );
  });

  it('giữ details.errors của 422 IMPORT_VALIDATION_FAILED', async () => {
    backendRequest.mockRejectedValueOnce(
      new BackendRequestError({
        status: 422,
        kind: 'validation',
        message: 'Exercise import contains invalid rows.',
        retryable: false,
        code: 'IMPORT_VALIDATION_FAILED',
        details: {
          errors: [
            {
              rowNumber: 1,
              code: 'SOURCE_KEY_ALREADY_EXISTS',
              path: 'sourceKey',
            },
          ],
        },
      }),
    );
    const response = await handleExerciseImportCommit(
      post(COMMIT_URL, {
        body: { ...validBody, previewHash: PREVIEW_HASH },
        idempotencyKey: 'import-key-0001',
      }),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: 'IMPORT_VALIDATION_FAILED',
        details: {
          errors: [
            {
              rowNumber: 1,
              code: 'SOURCE_KEY_ALREADY_EXISTS',
              path: 'sourceKey',
            },
          ],
        },
      },
    });
  });

  it('giữ nguyên status 409 của backend (không mã riêng)', async () => {
    backendRequest.mockRejectedValueOnce(
      new BackendRequestError({
        status: 409,
        kind: 'conflict',
        message: 'Preview hash does not match; the import payload changed.',
        retryable: false,
      }),
    );
    const response = await handleExerciseImportCommit(
      post(COMMIT_URL, {
        body: { ...validBody, previewHash: PREVIEW_HASH },
        idempotencyKey: 'import-key-0001',
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBeUndefined();
  });
});
