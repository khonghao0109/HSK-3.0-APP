import 'server-only';

import { cookies } from 'next/headers';

import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import { exerciseImportDataSourceListSchema } from './exercise-import-contract';
import type { ExerciseImportDataSource } from './exercise-import-values';

export type ExerciseImportDataSourceList = {
  data: ExerciseImportDataSource[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

/** TL-26/TL-33: trang Nhập dữ liệu cần toàn bộ nguồn (limit 100). */
export async function loadDataSources(): Promise<ExerciseImportDataSourceList> {
  const token = (await cookies()).get(serverEnv.SESSION_COOKIE_NAME)?.value;
  if (!token) {
    throw new BackendRequestError({
      status: 401,
      kind: 'session_expired',
      message: 'Your session has expired.',
      retryable: false,
    });
  }
  return exerciseImportDataSourceListSchema.parse(
    await backend.request('/api/v1/admin/cms/data-sources?page=1&limit=100', {
      token,
    }),
  );
}
