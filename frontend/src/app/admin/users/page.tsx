import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AdminAuditSection } from '@/features/admin-users/admin-audit-section';
import {
  loadAdminUsers,
  loadAuditLogs,
} from '@/features/admin-users/admin-users-service';
import {
  adminUsersHref,
  parseAdminUsersQuery,
} from '@/features/admin-users/admin-users-query';
import { AdminUsersTable } from '@/features/admin-users/admin-users-table';
import {
  AdminUsersFilters,
  AdminUsersPagination,
  AdminUsersTabs,
} from '@/features/admin-users/admin-users-tools';
import { ADMIN_USERS_PAGE_LIMIT } from '@/features/admin-users/admin-users-values';
import { getServerAdminSession } from '@/features/auth/server-session';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { BackendRequestError } from '@/lib/api/api-error';

import '../admin-users.css';

export const metadata: Metadata = { title: 'Người dùng' };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseAdminUsersQuery(await searchParams);
  const session = await getServerAdminSession();
  if (session.state === 'unauthenticated') redirectToSessionLogin();
  if (session.state === 'forbidden') redirect('/forbidden');

  let result;
  try {
    result = await Promise.all([loadAdminUsers(query), loadAuditLogs(query)]);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    // Layouts do not re-render on client navigation, so the admin layout's
    // role check can be stale; the backend's per-request 403 is authoritative.
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    throw error;
  }
  const [users, audit] = result;

  return (
    <div className="adm-page-stack uo-page">
      <header className="adm-page-head">
        <div>
          <h1>Người dùng</h1>
          <p>
            Đổi vai trò, khoá hoặc mở khoá tài khoản và theo dõi nhật ký hoạt
            động quản trị.
          </p>
        </div>
      </header>

      <AdminUsersTabs query={query} />
      <AdminUsersFilters query={query} />

      <div className="adm-card uo-users-card">
        <AdminUsersTable users={users.data} currentUserId={session.user.id} />
        <AdminUsersPagination
          page={query.page}
          limit={ADMIN_USERS_PAGE_LIMIT}
          total={users.meta.total}
          totalPages={users.meta.totalPages}
          pageHref={(page) => adminUsersHref(query, { page })}
          label="Phân trang người dùng"
        />
      </div>

      <AdminAuditSection
        rows={audit.data}
        query={query}
        total={audit.meta.total}
        totalPages={audit.meta.totalPages}
      />
    </div>
  );
}
