import { describe, expect, it, vi } from 'vitest';

// `createBackendClient` binds `fetch` when `server-backend` is imported, nên
// phải thay fetch trước khi import service (cùng cách recovery-service.spec).
const { fetchMock } = vi.hoisted(() => {
  const fetchMock = vi.fn<typeof fetch>();
  globalThis.fetch = fetchMock;
  return { fetchMock };
});

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => ({ value: 'admin-session-token' }),
  }),
  headers: async () => new Headers(),
}));
vi.mock('@/lib/config/server-env', () => ({
  serverEnv: {
    APP_ORIGIN: 'http://127.0.0.1:3200',
    NODE_ENV: 'test',
    BACKEND_API_URL: 'http://backend.example.test',
    BFF_REQUEST_TIMEOUT_MS: 1000,
    SESSION_COOKIE_NAME: 'hsk_admin_session',
  },
}));

import { loadExerciseLessonOptions } from './exercise-admin-service';

const envelopeMeta = {
  requestId: 'req-1',
  timestamp: '2026-10-20T10:00:00.000Z',
};

function lesson(overrides: {
  id: number;
  levelId: number;
  title: string;
  orderIndex: number;
  status: 'draft' | 'published' | 'archived';
}) {
  return {
    ...overrides,
    description: null,
    slug: `lesson-${overrides.id}`,
    createdById: null,
    updatedById: null,
    publishedById: null,
    publishedAt: null,
    deletedAt: null,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
    latestRevision: null,
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubBackend() {
  const lessons = {
    success: true,
    data: [
      lesson({
        id: 1,
        levelId: 1,
        title: 'Bài lưu trữ',
        orderIndex: 1,
        status: 'archived',
      }),
      lesson({
        id: 2,
        levelId: 1,
        title: 'Bài nháp',
        orderIndex: 2,
        status: 'draft',
      }),
      lesson({
        id: 3,
        levelId: 2,
        title: 'Bài đã xuất bản',
        orderIndex: 1,
        status: 'published',
      }),
    ],
    meta: {
      ...envelopeMeta,
      pagination: { page: 1, limit: 100, total: 3, totalPages: 1 },
    },
  };
  const levels = {
    success: true,
    data: [
      {
        id: 1,
        name: 'HSK 1',
        orderIndex: 1,
        code: 'HSK1',
        minBand: 1,
        maxBand: 1,
      },
      {
        id: 2,
        name: 'HSK 2',
        orderIndex: 2,
        code: 'HSK2',
        minBand: 2,
        maxBand: 2,
      },
    ],
    meta: envelopeMeta,
  };
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/api/v1/admin/cms/lessons?')) return json(lessons);
    if (url.includes('/api/v1/levels')) return json(levels);
    throw new Error(`unexpected backend request: ${url}`);
  });
}

describe('loadExerciseLessonOptions (Y7)', () => {
  it('bỏ bài học đã lưu trữ, giữ draft/published và sắp theo cấp độ/thứ tự', async () => {
    stubBackend();

    const options = await loadExerciseLessonOptions();

    expect(options).toEqual([
      { id: 2, title: 'Bài nháp', levelCode: 'HSK1' },
      { id: 3, title: 'Bài đã xuất bản', levelCode: 'HSK2' },
    ]);
    expect(options.some((option) => option.title === 'Bài lưu trữ')).toBe(
      false,
    );
    const requested = fetchMock.mock.calls.map(([input]) => String(input));
    expect(requested).toContain(
      'http://backend.example.test/api/v1/admin/cms/lessons?page=1&limit=100',
    );
  });
});
