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
    expect(await response.text()).not.toContain('must-not-survive');
  });
});
