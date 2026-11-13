import Link from 'next/link';

import { AdminIcon } from '@/features/admin-shell/admin-icon';
import { ADMIN_ACTION } from '@/features/admin-shell/admin-labels';

import { adminUsersTabHref, type AdminUsersQuery } from './admin-users-query';
import {
  ADMIN_USER_STATUSES,
  ADMIN_USER_TABS,
  adminUserStatusLabel,
} from './admin-users-values';

/** TL-71/Q108: chỉ ba tab, không có vai trò Giáo viên; tab nằm trên URL. */
export function AdminUsersTabs({ query }: { query: AdminUsersQuery }) {
  return (
    <nav className="uo-tabs" aria-label="Lọc theo vai trò">
      {ADMIN_USER_TABS.map((tab) => (
        <Link
          className="uo-tab"
          key={tab.key}
          href={adminUsersTabHref(query, tab.key)}
          aria-current={query.tab === tab.key ? 'page' : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/** TL-71: bộ lọc trạng thái và ô tìm kiếm, server-driven qua GET + URL. */
export function AdminUsersFilters({ query }: { query: AdminUsersQuery }) {
  const clearHref = adminUsersTabHref(
    { ...query, status: undefined, q: undefined },
    query.tab,
  );
  return (
    <form
      className="adm-filters uo-filters"
      method="get"
      action="/admin/users"
      role="search"
      aria-label="Lọc người dùng"
    >
      <input type="hidden" name="tab" value={query.tab} />
      <input type="hidden" name="page" value="1" />
      <input type="hidden" name="auditPage" value={query.auditPage} />
      <label className="sr-only" htmlFor="uo-status-filter">
        Trạng thái
      </label>
      <select
        className="adm-input uo-select"
        id="uo-status-filter"
        name="status"
        defaultValue={query.status ?? ''}
      >
        <option value="">Tất cả trạng thái</option>
        {ADMIN_USER_STATUSES.map((status) => (
          <option key={status} value={status}>
            {adminUserStatusLabel(status)}
          </option>
        ))}
      </select>
      <div className="adm-search uo-search">
        <AdminIcon name="search" className="adm-icon adm-icon--sm" />
        <label className="sr-only" htmlFor="uo-search">
          Tìm kiếm theo tên hoặc email
        </label>
        <input
          className="adm-input"
          id="uo-search"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={query.q ?? ''}
          placeholder="Tìm kiếm người dùng…"
          autoComplete="off"
        />
      </div>
      <button className="adm-btn adm-btn--primary" type="submit">
        Lọc
      </button>
      <Link className="adm-btn adm-btn--ghost" href={clearHref}>
        Xoá lọc
      </Link>
    </form>
  );
}

/** Phân trang dùng chung cho bảng user và khối audit (mỗi khối một state). */
export function AdminUsersPagination({
  page,
  limit,
  total,
  totalPages,
  pageHref,
  label,
}: {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  pageHref: (page: number) => string;
  label: string;
}) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  if (from > total) return null;
  return (
    <nav className="adm-pagination uo-pagination" aria-label={label}>
      <p className="adm-pagination__info" aria-live="polite">
        Hiển thị {from} đến {to} của {total} kết quả
      </p>
      <div className="adm-pagination__pages">
        {page > 1 ? (
          <Link className="adm-page-btn" href={pageHref(page - 1)}>
            <AdminIcon name="chevron-left" className="adm-icon adm-icon--sm" />
            {ADMIN_ACTION.previous}
          </Link>
        ) : (
          <span
            className="adm-page-btn adm-page-btn--disabled"
            aria-disabled="true"
          >
            <AdminIcon name="chevron-left" className="adm-icon adm-icon--sm" />
            {ADMIN_ACTION.previous}
          </span>
        )}
        {page < totalPages ? (
          <Link className="adm-page-btn" href={pageHref(page + 1)}>
            {ADMIN_ACTION.next}
            <AdminIcon name="chevron-right" className="adm-icon adm-icon--sm" />
          </Link>
        ) : (
          <span
            className="adm-page-btn adm-page-btn--disabled"
            aria-disabled="true"
          >
            {ADMIN_ACTION.next}
            <AdminIcon name="chevron-right" className="adm-icon adm-icon--sm" />
          </span>
        )}
      </div>
    </nav>
  );
}
