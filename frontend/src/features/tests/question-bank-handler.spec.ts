import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendRequestError } from '@/lib/api/api-error';

const { backendRequest } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));

import { handleQuestionBankList } from './question-bank-handler';

const ORIGIN = 'http://127.0.0.1:3200';
const QUESTIONS_URL = `${ORIGIN}/api/admin/questions`;
const TIMESTAMP = '2026-10-01T00:00:00.000Z';

function get(query: string, options: { cookie?: boolean } = {}): NextRequest {
  return new NextRequest(`${QUESTIONS_URL}${query}`, {
    headers:
      options.cookie === false
        ? {}
        : { cookie: 'hsk_admin_session=test-token' },
  });
}

function bankResponse() {
  return {
    success: true,
    data: [
      {
        id: 41,
        content: 'Chọn đáp án đúng',
        type: 'mcq',
        skill: 'reading',
        audioId: null,
        imageId: null,
        answers: { options: [] },
        correctAnswer: { optionId: 'opt-1' },
        explanation: null,
        objective: null,
        levelId: 1,
        difficulty: 2,
        version: 1,
        contentHash: null,
        status: 'published',
        dataSourceId: null,
        createdById: null,
        updatedById: null,
        publishedById: null,
        publishedAt: TIMESTAMP,
        deletedAt: null,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
        level: { id: 1, code: 'HSK1' },
        tags: [{ slug: 'tu-vung', name: 'Từ vựng' }],
        latestRevision: null,
      },
    ],
    meta: {
      requestId: 'request-1',
      timestamp: TIMESTAMP,
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  };
}

describe('Question bank BFF GET for the test builder (M4.1b, TL-105)', () => {
  beforeEach(() => {
    backendRequest.mockReset();
  });

  it('requires a session cookie without checking Origin (read-only)', async () => {
    const response = await handleQuestionBankList(
      get('?levelId=1', { cookie: false }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('forwards only allowlisted query keys and keeps repeated tag order', async () => {
    backendRequest.mockResolvedValueOnce(bankResponse());
    const response = await handleQuestionBankList(
      get(
        '?status=published&page=2&limit=10&levelId=1&skill=reading' +
          '&type=mcq&tag=tu-vung&tag=ngu-phap&q=%20v%C4%83n%20',
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backendRequest).toHaveBeenCalledTimes(1);
    const [path, options] = backendRequest.mock.calls[0] as [
      string,
      { token?: string; method?: string },
    ];
    const url = new URL(path, 'http://backend.example.test');
    expect(url.pathname).toBe('/api/v1/admin/cms/questions');
    expect([...url.searchParams.keys()]).toEqual([
      'levelId',
      'skill',
      'type',
      'tag',
      'tag',
      'q',
      'page',
      'limit',
      'status',
    ]);
    expect(url.searchParams.getAll('tag')).toEqual(['tu-vung', 'ngu-phap']);
    expect(url.searchParams.get('q')).toBe('văn');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(options.token).toBe('test-token');
    expect(options.method).toBeUndefined();
    const body = (await response.json()) as {
      success: boolean;
      data: unknown[];
      meta: { pagination: { total: number } };
    };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.meta.pagination.total).toBe(1);
  });

  it('forwards no query string when the browser sends none', async () => {
    backendRequest.mockResolvedValueOnce(bankResponse());
    const response = await handleQuestionBankList(get(''));
    expect(response.status).toBe(200);
    expect(backendRequest.mock.calls[0]?.[0]).toBe(
      '/api/v1/admin/cms/questions',
    );
  });

  it('rejects unknown query keys with 400', async () => {
    for (const query of [
      '?difficulty=2',
      '?selected=3',
      '?Skill=reading',
      '?levelId=1&tag=tu-vung&unknown=1',
    ]) {
      expect((await handleQuestionBankList(get(query))).status).toBe(400);
    }
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid query values with 400', async () => {
    const invalid = [
      '?levelId=0',
      '?levelId=abc',
      '?levelId=2147483648',
      '?skill=grammar',
      '?type=essay',
      '?status=deleted',
      '?page=0',
      '?limit=0',
      '?limit=101',
      '?tag=',
      `?tag=${'a'.repeat(81)}`,
      '?tag=a&tag=b&tag=c&tag=d&tag=e&tag=f',
      '?q=',
      '?q=%20%20',
      `?q=${'a'.repeat(101)}`,
    ];
    for (const query of invalid) {
      expect((await handleQuestionBankList(get(query))).status).toBe(400);
    }
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('maps backend failures and unexpected errors to the BFF envelope', async () => {
    backendRequest.mockRejectedValueOnce(
      new BackendRequestError({
        status: 400,
        kind: 'invalid_request',
        message: 'The request is not valid.',
        retryable: false,
        code: 'REQUEST_VALIDATION_FAILED',
      }),
    );
    const rejected = await handleQuestionBankList(get('?skill=reading'));
    expect(rejected.status).toBe(400);
    expect(rejected.headers.get('cache-control')).toBe('no-store');
    const body = (await rejected.json()) as { error: { code: string } };
    expect(body.error.code).toBe('REQUEST_VALIDATION_FAILED');

    backendRequest.mockRejectedValueOnce(new Error('boom'));
    expect((await handleQuestionBankList(get('?skill=reading'))).status).toBe(
      503,
    );
  });
});
