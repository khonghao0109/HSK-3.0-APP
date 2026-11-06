import {
  ADMIN_AUDIT_PAGE_LIMIT,
  ADMIN_USER_STATUSES,
  ADMIN_USER_TABS,
  ADMIN_USERS_PAGE_LIMIT,
  type AdminUserStatus,
  type AdminUserTab,
} from './admin-users-values';

/** URL search params của trang Người dùng (TL-71: mọi bộ lọc nằm trên URL). */
export type AdminUsersQuery = {
  tab: AdminUserTab;
  status?: AdminUserStatus;
  q?: string;
  page: number;
  auditPage: number;
};

type SearchInput = Record<string, string | string[] | undefined>;

const TAB_KEYS = ADMIN_USER_TABS.map((tab) => tab.key);

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseAdminUsersQuery(input: SearchInput): AdminUsersQuery {
  const rawTab = first(input.tab);
  const tab = TAB_KEYS.includes(rawTab as AdminUserTab)
    ? (rawTab as AdminUserTab)
    : 'all';

  const rawStatus = first(input.status);
  const status = ADMIN_USER_STATUSES.includes(rawStatus as AdminUserStatus)
    ? (rawStatus as AdminUserStatus)
    : undefined;

  const rawQ = first(input.q)?.trim();
  const q = rawQ && rawQ.length <= 100 ? rawQ : undefined;

  return {
    tab,
    ...(status ? { status } : {}),
    ...(q ? { q } : {}),
    page: positiveInteger(first(input.page)) ?? 1,
    auditPage: positiveInteger(first(input.auditPage)) ?? 1,
  };
}

/** Tham số gửi backend `GET /admin/users`. */
export function serializeUsersSearch(query: AdminUsersQuery): URLSearchParams {
  const params = new URLSearchParams({
    page: String(query.page),
    limit: String(ADMIN_USERS_PAGE_LIMIT),
  });
  if (query.tab === 'learner') params.set('role', 'user');
  if (query.tab === 'admin') params.set('role', 'admin');
  if (query.status) params.set('status', query.status);
  if (query.q) params.set('q', query.q);
  return params;
}

/** Tham số gửi backend `GET /admin/audit-logs`. */
export function serializeAuditSearch(query: AdminUsersQuery): URLSearchParams {
  return new URLSearchParams({
    page: String(query.auditPage),
    limit: String(ADMIN_AUDIT_PAGE_LIMIT),
  });
}

/** Link giữ bộ lọc hiện tại, chỉ đổi tham số được yêu cầu. */
export function adminUsersHref(
  query: AdminUsersQuery,
  next: Partial<Pick<AdminUsersQuery, 'tab' | 'page' | 'auditPage'>>,
): string {
  const merged: AdminUsersQuery = { ...query, ...next };
  const params = new URLSearchParams();
  if (merged.tab !== 'all') params.set('tab', merged.tab);
  if (merged.status) params.set('status', merged.status);
  if (merged.q) params.set('q', merged.q);
  if (merged.page > 1) params.set('page', String(merged.page));
  if (merged.auditPage > 1) params.set('auditPage', String(merged.auditPage));
  const search = params.toString();
  return search ? `/admin/users?${search}` : '/admin/users';
}

/** Tab đổi vai trò thì quay về trang 1 nhưng giữ bộ lọc trạng thái/tìm kiếm. */
export function adminUsersTabHref(
  query: AdminUsersQuery,
  tab: AdminUserTab,
): string {
  return adminUsersHref({ ...query, tab }, { tab, page: 1 });
}
