import 'server-only';

import { cookies } from 'next/headers';

import { BackendRequestError } from '@/lib/api/api-error';
import { backend } from '@/lib/api/server-backend';
import { serverEnv } from '@/lib/config/server-env';

import {
  backendAdminAuditPageSchema,
  backendAdminUsersPageSchema,
  type AdminAuditListPage,
  type AdminUsersListPage,
} from './admin-users-contract';
import {
  serializeAuditSearch,
  serializeUsersSearch,
  type AdminUsersQuery,
} from './admin-users-query';

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

/** TL-70: danh sách user đọc trong server component, không qua BFF. */
export async function loadAdminUsers(
  query: AdminUsersQuery,
): Promise<AdminUsersListPage> {
  const token = await sessionToken();
  return backendAdminUsersPageSchema.parse(
    await backend.request(
      `/api/v1/admin/users?${serializeUsersSearch(query).toString()}`,
      { token },
    ),
  );
}

/** TL-73: nhật ký audit phân trang riêng, cũng đọc ở server component. */
export async function loadAuditLogs(
  query: AdminUsersQuery,
): Promise<AdminAuditListPage> {
  const token = await sessionToken();
  return backendAdminAuditPageSchema.parse(
    await backend.request(
      `/api/v1/admin/audit-logs?${serializeAuditSearch(query).toString()}`,
      { token },
    ),
  );
}
