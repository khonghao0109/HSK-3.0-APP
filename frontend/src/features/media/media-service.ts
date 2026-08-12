import 'server-only';

import { cookies } from 'next/headers';

import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import {
  mediaDetailResponseSchema,
  mediaListResponseSchema,
  type AdminMediaDetail,
  type MediaListResponse,
} from './media-contract';
import { serializeMediaQuery, type MediaQuery } from './media-query';

async function sessionToken(): Promise<string> {
  const token = (await cookies()).get(serverEnv.SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new BackendRequestError({
      status: 401,
      kind: 'session_expired',
      message: 'Your session has expired.',
      retryable: false,
    });
  }
  return token;
}

export async function loadMedia(query: MediaQuery): Promise<MediaListResponse> {
  const token = await sessionToken();
  const params = serializeMediaQuery(query);
  return mediaListResponseSchema.parse(
    await backend.request(`/api/v1/admin/cms/media?${params.toString()}`, {
      token,
    }),
  );
}

export async function loadMediaAsset(
  mediaId: number,
): Promise<AdminMediaDetail> {
  const token = await sessionToken();
  return mediaDetailResponseSchema.parse(
    await backend.request(`/api/v1/admin/cms/media/${mediaId}`, { token }),
  ).data;
}
