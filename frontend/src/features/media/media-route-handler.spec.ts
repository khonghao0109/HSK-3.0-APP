import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const { backendRequest } = vi.hoisted(() => ({
  backendRequest: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/api/server-backend', () => ({
  backend: { request: backendRequest },
}));

import { handleMediaMutation } from './media-route-handler';

const BACKEND_META = {
  requestId: '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f',
  timestamp: '2026-09-14T05:00:00.000Z',
};

describe('Media BFF mutation boundary', () => {
  it.each([undefined, 'https://attacker.example'])(
    'rejects missing or cross-origin mutation before session/backend access',
    async (origin) => {
      const headers = new Headers();
      if (origin) headers.set('origin', origin);
      const response = await handleMediaMutation(
        new NextRequest('http://127.0.0.1:3200/api/admin/media/41/archive', {
          method: 'POST',
          headers,
        }),
        '41',
        'archive',
      );
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).not.toContain('attacker.example');
    },
  );

  it('parses a safe mutation projection instead of reflecting the raw backend body', async () => {
    backendRequest.mockResolvedValueOnce({
      success: true,
      data: {
        idempotent: false,
        media: {
          id: 41,
          filename: 'lesson.mp3',
          type: 'audio',
          mimeType: 'audio/mpeg',
          size: 2048,
          duration: 8,
          processingStatus: 'quarantined',
          lifecycle: 'active',
          usageCount: 1,
          dataSourceId: null,
          uploadedById: 1,
          updatedById: 1,
          deletedAt: null,
          createdAt: '2026-08-12T00:00:00.000Z',
          updatedAt: '2026-08-12T01:00:00.000Z',
          dataSource: null,
          storageKey: 'must-not-survive',
        },
      },
      meta: BACKEND_META,
    });
    const response = await handleMediaMutation(
      new NextRequest('http://127.0.0.1:3200/api/admin/media/41/quarantine', {
        method: 'POST',
        headers: {
          origin: 'http://127.0.0.1:3200',
          cookie: 'hsk_admin_session=test-token',
        },
      }),
      '41',
      'quarantine',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).not.toContain('must-not-survive');
    // Backend envelope meta stays on the server.
    expect(text).not.toContain(BACKEND_META.requestId);
    expect(JSON.parse(text)).toMatchObject({
      success: true,
      data: { idempotent: false, media: { id: 41 } },
    });
  });

  it('fails closed when the backend body is not the response envelope', async () => {
    backendRequest.mockResolvedValueOnce({
      success: true,
      data: { idempotent: false, media: null },
    });
    const response = await handleMediaMutation(
      new NextRequest('http://127.0.0.1:3200/api/admin/media/41/archive', {
        method: 'POST',
        headers: {
          origin: 'http://127.0.0.1:3200',
          cookie: 'hsk_admin_session=test-token',
        },
      }),
      '41',
      'archive',
    );

    expect(response.status).toBe(503);
  });
});
