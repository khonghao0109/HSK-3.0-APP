import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loginResponseSchema } from '@/features/auth/auth-contract';

import { backendEnvelope, backendPage } from './backend-envelope';

const meta = {
  requestId: '7d1f4a9e-3b2c-4d5e-8f60-1a2b3c4d5e6f',
  timestamp: '2026-09-14T05:00:00.000Z',
};
const user = { id: 7, email: 'admin@example.test', role: 'admin', name: 'Lan' };
const pagination = { page: 2, limit: 20, total: 41, totalPages: 3 };

describe('backend response envelope', () => {
  const login = backendEnvelope(loginResponseSchema);
  const page = backendPage(z.object({ id: z.number() }));

  it('resolves a success envelope to its data without backend meta', () => {
    expect(
      login.parse({
        success: true,
        data: { user, accessToken: 'header.payload.sig' },
        meta,
      }),
    ).toEqual({
      success: true,
      data: { user, accessToken: 'header.payload.sig' },
    });
  });

  it.each([
    ['the pre-envelope body', { user, accessToken: 'header.payload.sig' }],
    [
      'an envelope without meta',
      { success: true, data: { user, accessToken: 't' } },
    ],
    [
      'an envelope without a request id',
      {
        success: true,
        data: { user, accessToken: 't' },
        meta: { timestamp: meta.timestamp },
      },
    ],
    [
      'an error envelope',
      {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
        meta,
      },
    ],
  ])('rejects %s', (_, body) => {
    expect(login.safeParse(body).success).toBe(false);
  });

  it('moves list pagination back to the BFF meta shape', () => {
    expect(
      page.parse({
        success: true,
        data: [{ id: 1, secret: 'must-not-survive' }],
        meta: { ...meta, pagination },
      }),
    ).toEqual({ success: true, data: [{ id: 1 }], meta: pagination });
  });

  it.each([
    [
      'legacy top-level pagination',
      { success: true, data: [], meta: pagination },
    ],
    ['no pagination', { success: true, data: [], meta }],
    [
      'invalid pagination',
      {
        success: true,
        data: [],
        meta: { ...meta, pagination: { ...pagination, page: 0 } },
      },
    ],
  ])('rejects a list with %s', (_, body) => {
    expect(page.safeParse(body).success).toBe(false);
  });
});
