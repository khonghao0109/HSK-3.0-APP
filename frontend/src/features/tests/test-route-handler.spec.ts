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

import {
  handleTestArchive,
  handleTestCreate,
  handleTestDuplicate,
  handleTestPublish,
  handleTestStructureReplace,
  handleTestUpdate,
} from './test-route-handler';

const ORIGIN = 'http://127.0.0.1:3200';
const CREATE_URL = `${ORIGIN}/api/admin/tests`;
const UPDATE_URL = `${ORIGIN}/api/admin/tests/9`;
const STRUCTURE_URL = `${ORIGIN}/api/admin/tests/9/structure`;
const PUBLISH_URL = `${ORIGIN}/api/admin/tests/9/publish`;
const ARCHIVE_URL = `${ORIGIN}/api/admin/tests/9/archive`;
const DUPLICATE_URL = `${ORIGIN}/api/admin/tests/9/duplicate`;
const UPDATED_AT = '2026-10-01T00:00:00.000Z';

function mutate(
  url: string,
  method: 'POST' | 'PATCH' | 'PUT',
  body: string | null,
  options: { origin?: string; cookie?: boolean } = {},
): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      origin: options.origin ?? ORIGIN,
      ...(options.cookie === false
        ? {}
        : { cookie: 'hsk_admin_session=test-token' }),
    },
    ...(body === null ? {} : { body }),
  });
}

function detailResponse() {
  return {
    success: true,
    data: {
      id: 9,
      levelId: 1,
      levelCode: 'HSK1',
      title: 'Đề HSK 1',
      instruction: null,
      duration: 30,
      passScore: null,
      maxScore: 100,
      status: 'draft',
      version: 1,
      sectionCount: 1,
      questionCount: 1,
      skills: ['reading'],
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
      publishedAt: null,
      sections: [],
    },
  };
}

const CREATE_PAYLOAD = JSON.stringify({
  levelId: 1,
  title: 'Đề HSK 1',
  instruction: 'Làm hết các phần',
  duration: 30,
  passScore: 60,
});

describe('Test builder BFF mutations (M4.1b, TL-105)', () => {
  beforeEach(() => {
    backendRequest.mockReset();
  });

  it('rejects cross-origin and missing-session requests before the backend', async () => {
    expect(
      (
        await handleTestCreate(
          mutate(CREATE_URL, 'POST', CREATE_PAYLOAD, {
            origin: 'https://attacker.example',
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleTestUpdate(
          mutate(UPDATE_URL, 'PATCH', '{}', {
            origin: 'https://attacker.example',
          }),
          '9',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleTestCreate(
          mutate(CREATE_URL, 'POST', CREATE_PAYLOAD, { cookie: false }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleTestArchive(
          mutate(ARCHIVE_URL, 'POST', null, { cookie: false }),
          '9',
        )
      ).status,
    ).toBe(401);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects non-positive, too-large and non-numeric ids with 400', async () => {
    for (const id of ['0', '-1', 'abc', '2147483648', '1.5']) {
      for (const response of [
        await handleTestUpdate(mutate(UPDATE_URL, 'PATCH', '{}'), id),
        await handleTestStructureReplace(
          mutate(STRUCTURE_URL, 'PUT', '{}'),
          id,
        ),
        await handleTestPublish(mutate(PUBLISH_URL, 'POST', '{}'), id),
        await handleTestArchive(mutate(ARCHIVE_URL, 'POST', null), id),
        await handleTestDuplicate(mutate(DUPLICATE_URL, 'POST', null), id),
      ]) {
        expect(response.status).toBe(400);
      }
    }
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('forwards only allowlisted create keys, drops extras and returns 201', async () => {
    backendRequest.mockResolvedValueOnce(detailResponse());
    const response = await handleTestCreate(
      mutate(
        CREATE_URL,
        'POST',
        JSON.stringify({
          ...JSON.parse(CREATE_PAYLOAD),
          status: 'published',
          maxScore: 999,
          secret: 'AUTHORITATIVEANSWERSECRET',
        }),
      ),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backendRequest).toHaveBeenCalledTimes(1);
    const [path, options] = backendRequest.mock.calls[0] as [
      string,
      { method: string; token: string; body: Record<string, unknown> },
    ];
    expect(path).toBe('/api/v1/admin/cms/tests');
    expect(options.method).toBe('POST');
    expect(options.token).toBe('test-token');
    expect(options.body).not.toHaveProperty('secret');
    expect(options.body).not.toHaveProperty('status');
    expect(options.body).not.toHaveProperty('maxScore');
    expect(options.body).toEqual({
      levelId: 1,
      title: 'Đề HSK 1',
      instruction: 'Làm hết các phần',
      duration: 30,
      passScore: 60,
    });
  });

  it('rejects non-object, malformed and oversized bodies with 400', async () => {
    for (const body of ['[]', 'null', 'not-json', '']) {
      expect(
        (await handleTestCreate(mutate(CREATE_URL, 'POST', body))).status,
      ).toBe(400);
    }
    const oversized = JSON.stringify({ title: 'a'.repeat(70_000) });
    expect(
      (await handleTestCreate(mutate(CREATE_URL, 'POST', oversized))).status,
    ).toBe(400);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('patches with expectedUpdatedAt only plus allowlisted meta keys and returns 200', async () => {
    backendRequest.mockResolvedValueOnce(detailResponse());
    const response = await handleTestUpdate(
      mutate(
        UPDATE_URL,
        'PATCH',
        JSON.stringify({
          expectedUpdatedAt: UPDATED_AT,
          title: 'Đề sửa',
          duration: 45,
          passScore: null,
          status: 'published',
          id: 99,
          secret: 'AUTHORITATIVEANSWERSECRET',
        }),
      ),
      '9',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const [path, options] = backendRequest.mock.calls[0] as [
      string,
      { method: string; body: Record<string, unknown> },
    ];
    expect(path).toBe('/api/v1/admin/cms/tests/9');
    expect(options.method).toBe('PATCH');
    expect(options.body).toEqual({
      expectedUpdatedAt: UPDATED_AT,
      title: 'Đề sửa',
      duration: 45,
      passScore: null,
    });
    expect(options.body).not.toHaveProperty('status');
    expect(options.body).not.toHaveProperty('id');
    expect(options.body).not.toHaveProperty('secret');

    expect(
      (
        await handleTestUpdate(
          mutate(UPDATE_URL, 'PATCH', JSON.stringify({ title: 'Thiếu mốc' })),
          '9',
        )
      ).status,
    ).toBe(400);
  });

  it('rebuilds the nested structure tree from whitelisted keys only', async () => {
    backendRequest.mockResolvedValueOnce(detailResponse());
    const response = await handleTestStructureReplace(
      mutate(
        STRUCTURE_URL,
        'PUT',
        JSON.stringify({
          expectedUpdatedAt: UPDATED_AT,
          status: 'published',
          sections: [
            {
              id: 100,
              orderIndex: 1,
              skill: 'reading',
              title: 'Đọc hiểu',
              instruction: 'Chọn đáp án đúng',
              questionCount: 2,
              groups: [
                {
                  id: 200,
                  orderIndex: 1,
                  title: 'Nhóm 1',
                  instruction: null,
                  audioId: 3,
                  imageId: null,
                  questionIds: [11, 12],
                  secret: 'AUTHORITATIVEANSWERSECRET',
                },
              ],
            },
            {
              skill: 'listening',
              title: 'Nghe hiểu',
              groups: [{ questionIds: [13] }],
            },
          ],
        }),
      ),
      '9',
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const [path, options] = backendRequest.mock.calls[0] as [
      string,
      { method: string; body: Record<string, unknown> },
    ];
    expect(path).toBe('/api/v1/admin/cms/tests/9/structure');
    expect(options.method).toBe('PUT');
    expect(options.body).toEqual({
      expectedUpdatedAt: UPDATED_AT,
      sections: [
        {
          skill: 'reading',
          title: 'Đọc hiểu',
          instruction: 'Chọn đáp án đúng',
          groups: [
            {
              title: 'Nhóm 1',
              instruction: null,
              audioId: 3,
              imageId: null,
              questionIds: [11, 12],
            },
          ],
        },
        {
          skill: 'listening',
          title: 'Nghe hiểu',
          groups: [{ questionIds: [13] }],
        },
      ],
    });
    expect(JSON.stringify(options.body)).not.toContain(
      'AUTHORITATIVEANSWERSECRET',
    );
  });

  it('rejects malformed nested structure entries with 400', async () => {
    const cases = [
      { expectedUpdatedAt: UPDATED_AT },
      { expectedUpdatedAt: UPDATED_AT, sections: {} },
      { expectedUpdatedAt: UPDATED_AT, sections: [null] },
      { expectedUpdatedAt: UPDATED_AT, sections: ['x'] },
      {
        expectedUpdatedAt: UPDATED_AT,
        sections: [{ skill: 'reading', title: 'Đọc', groups: {} }],
      },
      {
        expectedUpdatedAt: UPDATED_AT,
        sections: [
          { skill: 'reading', title: 'Đọc', groups: [{ questionIds: [1] }, 5] },
        ],
      },
      { sections: [] },
    ];
    for (const body of cases) {
      expect(
        (
          await handleTestStructureReplace(
            mutate(STRUCTURE_URL, 'PUT', JSON.stringify(body)),
            '9',
          )
        ).status,
      ).toBe(400);
    }
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('publishes with expectedUpdatedAt only and returns 201', async () => {
    backendRequest.mockResolvedValueOnce(detailResponse());
    const response = await handleTestPublish(
      mutate(
        PUBLISH_URL,
        'POST',
        JSON.stringify({
          expectedUpdatedAt: UPDATED_AT,
          status: 'published',
          secret: 'AUTHORITATIVEANSWERSECRET',
        }),
      ),
      '9',
    );
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const [path, options] = backendRequest.mock.calls[0] as [
      string,
      { method: string; body: Record<string, unknown> },
    ];
    expect(path).toBe('/api/v1/admin/cms/tests/9/publish');
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({ expectedUpdatedAt: UPDATED_AT });

    expect(
      (
        await handleTestPublish(
          mutate(PUBLISH_URL, 'POST', JSON.stringify({ status: 'published' })),
          '9',
        )
      ).status,
    ).toBe(400);
  });

  it('archives and duplicates with no forwarded body and returns 201', async () => {
    backendRequest.mockResolvedValue(detailResponse());
    const archived = await handleTestArchive(
      mutate(ARCHIVE_URL, 'POST', JSON.stringify({ secret: 'AUTHORITATIVE' })),
      '9',
    );
    expect(archived.status).toBe(201);
    expect(archived.headers.get('cache-control')).toBe('no-store');
    const duplicated = await handleTestDuplicate(
      mutate(DUPLICATE_URL, 'POST', null),
      '9',
    );
    expect(duplicated.status).toBe(201);
    const [archivePath, archiveOptions] = backendRequest.mock.calls[0] as [
      string,
      { method: string; body?: unknown },
    ];
    const [duplicatePath, duplicateOptions] = backendRequest.mock.calls[1] as [
      string,
      { method: string; body?: unknown },
    ];
    expect(archivePath).toBe('/api/v1/admin/cms/tests/9/archive');
    expect(archiveOptions.method).toBe('POST');
    expect(archiveOptions.body).toBeUndefined();
    expect(duplicatePath).toBe('/api/v1/admin/cms/tests/9/duplicate');
    expect(duplicateOptions.method).toBe('POST');
    expect(duplicateOptions.body).toBeUndefined();
  });

  it('maps backend conflicts with code/details and unexpected errors to 503', async () => {
    backendRequest.mockRejectedValueOnce(
      new BackendRequestError({
        status: 409,
        kind: 'conflict',
        message: 'conflict',
        retryable: false,
        code: 'TEST_CONCURRENT_UPDATE',
        details: { path: 'expectedUpdatedAt' },
      }),
    );
    const conflict = await handleTestUpdate(
      mutate(
        UPDATE_URL,
        'PATCH',
        JSON.stringify({ expectedUpdatedAt: UPDATED_AT, title: 'Đề sửa' }),
      ),
      '9',
    );
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get('cache-control')).toBe('no-store');
    const body = (await conflict.json()) as {
      error: { code: string; details: { path: string } };
    };
    expect(body.error.code).toBe('TEST_CONCURRENT_UPDATE');
    expect(body.error.details.path).toBe('expectedUpdatedAt');

    backendRequest.mockRejectedValueOnce(new Error('boom'));
    expect(
      (await handleTestDuplicate(mutate(DUPLICATE_URL, 'POST', null), '9'))
        .status,
    ).toBe(503);
  });
});
