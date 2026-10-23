import Link from 'next/link';

import { adminDateTime } from '@/features/admin-shell/admin-labels';

import { adminUsersHref, type AdminUsersQuery } from './admin-users-query';
import { AdminUsersPagination } from './admin-users-tools';
import {
  ADMIN_AUDIT_PAGE_LIMIT,
  auditActionLabel,
  auditRoleTransitionLabel,
  type AdminAuditRow,
} from './admin-users-values';

function auditTarget(row: AdminAuditRow): string {
  if (row.target) return row.target.email;
  if (row.targetId) return `${row.targetType} #${row.targetId}`;
  return '—';
}

function auditDetail(row: AdminAuditRow): string {
  return row.reason ?? auditRoleTransitionLabel(row.roleChange) ?? '—';
}

/** TL-73: khối Nhật ký hoạt động (Audit) dưới bảng user, phân trang riêng. */
export function AdminAuditSection({
  rows,
  query,
  total,
  totalPages,
}: {
  rows: AdminAuditRow[];
  query: AdminUsersQuery;
  total: number;
  totalPages: number;
}) {
  return (
    <section className="uo-audit" aria-labelledby="uo-audit-title">
      <div className="uo-audit__head">
        <h2 id="uo-audit-title">Nhật ký hoạt động (Audit)</h2>
      </div>
      <div className="adm-card uo-audit-card">
        <div className="adm-table-wrap adm-table-wrap--swap">
          <table className="adm-table uo-audit-table">
            <caption className="sr-only">
              Nhật ký hoạt động quản trị, trang hiện tại
            </caption>
            <thead>
              <tr>
                <th scope="col">Thời gian</th>
                <th scope="col">Người thực hiện</th>
                <th scope="col">Hành động</th>
                <th scope="col">Đối tượng</th>
                <th scope="col">Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>Chưa có hoạt động nào.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{adminDateTime(row.createdAt)}</td>
                    <td>
                      {row.actor
                        ? (row.actor.name ?? row.actor.email)
                        : 'Hệ thống'}
                    </td>
                    <td>{auditActionLabel(row.action)}</td>
                    <td className="uo-break-anywhere">{auditTarget(row)}</td>
                    <td>{auditDetail(row)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <ol
          className="adm-record-list adm-record-list--swap uo-audit-record-list"
          aria-label="Nhật ký hoạt động cho màn hẹp"
        >
          {rows.length === 0 ? <li>Chưa có hoạt động nào.</li> : null}
          {rows.map((row) => (
            <li key={row.id}>
              <div className="adm-record-list__head">
                <div className="uo-user-cell">
                  <strong>{auditActionLabel(row.action)}</strong>
                  <span className="adm-muted">
                    {adminDateTime(row.createdAt)}
                  </span>
                </div>
              </div>
              <dl className="adm-record-list__facts">
                <div>
                  <dt>Người thực hiện</dt>
                  <dd>
                    {row.actor
                      ? (row.actor.name ?? row.actor.email)
                      : 'Hệ thống'}
                  </dd>
                </div>
                <div>
                  <dt>Đối tượng</dt>
                  <dd className="uo-break-anywhere">{auditTarget(row)}</dd>
                </div>
                <div>
                  <dt>Chi tiết</dt>
                  <dd>{auditDetail(row)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ol>

        <AdminUsersPagination
          page={query.auditPage}
          limit={ADMIN_AUDIT_PAGE_LIMIT}
          total={total}
          totalPages={totalPages}
          pageHref={(page) => adminUsersHref(query, { auditPage: page })}
          label="Phân trang nhật ký hoạt động"
        />
      </div>
      {rows.length === 0 ? (
        <p className="uo-audit-empty">
          Hoạt động quản trị sẽ xuất hiện ở đây sau thao tác đầu tiên.{' '}
          <Link className="adm-link" href="/admin/users">
            Về trang 1
          </Link>
        </p>
      ) : null}
    </section>
  );
}
