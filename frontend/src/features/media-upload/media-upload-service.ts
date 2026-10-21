import 'server-only';

import { cookies } from 'next/headers';

import { exerciseImportDataSourceListSchema } from '@/features/exercise-import/exercise-import-contract';
import type { ExerciseImportDataSource } from '@/features/exercise-import/exercise-import-values';
import { backendMediaListSchema } from '@/features/media/media-contract';
import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

export type MediaUploadContext = {
  ingestionEnabled: boolean;
  /** Q103: chỉ nguồn đủ điều kiện nhận media. */
  dataSources: ExerciseImportDataSource[];
};

/** TL-42: lấy song song nguồn đủ điều kiện và cờ bật/tắt ingestion. */
export async function loadMediaUploadContext(): Promise<MediaUploadContext> {
  const token = (await cookies()).get(serverEnv.SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new BackendRequestError({
      status: 401,
      kind: 'session_expired',
      message: 'Your session has expired.',
      retryable: false,
    });
  }
  const [sources, media] = await Promise.all([
    backend.request(
      '/api/v1/admin/cms/data-sources?page=1&limit=100&eligibleFor=media',
      { token },
    ),
    backend.request('/api/v1/admin/cms/media?page=1&limit=1', { token }),
  ]);
  return {
    // shortcut: 100 nguồn đầu, chuyển sang ô tìm kiếm khi > 100 nguồn đủ điều kiện.
    dataSources: exerciseImportDataSourceListSchema.parse(sources).data,
    ingestionEnabled: backendMediaListSchema.parse(media).ingestionEnabled,
  };
}
