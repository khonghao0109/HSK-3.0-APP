import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import { AdminIcon } from '@/features/admin-shell/admin-icon';
import {
  adminDateTime,
  contentStatusLabel,
  levelLabel,
  skillLabel,
} from '@/features/admin-shell/admin-labels';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { parseTestQuery, testListHref } from '@/features/tests/test-query';
import { loadTestLevels, loadTests } from '@/features/tests/test-service';
import {
  formatPassScore,
  formatTestDuration,
  formatTestSkills,
  type TestListQuery,
  type TestStatus,
} from '@/features/tests/test-values';
import { BackendRequestError } from '@/lib/api/api-error';

import '../admin-tests-list.css';

export const metadata: Metadata = { title: 'Đề thi' };

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: '' | TestStatus;
  label: string;
}> = [
  { value: '', label: 'Tất cả (ẩn lưu trữ)' },
  { value: 'draft', label: 'Nháp' },
  { value: 'published', label: 'Đã xuất bản' },
  { value: 'archived', label: 'Lưu trữ' },
];

function hasFilters(query: TestListQuery): boolean {
  return (
    query.levelId !== undefined ||
    query.status !== undefined ||
    query.q !== undefined
  );
}

/**
 * Danh sách đề thi (TL-107): filter là form GET thuần, mọi trạng thái nằm trên
 * URL search params; bảng ở desktop và card ở ≤900px (pattern M4.1a).
 */
export default async function TestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseTestQuery(await searchParams);
  let result;
  let levels;
  try {
    [result, levels] = await Promise.all([loadTests(query), loadTestLevels()]);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    // Layouts do not re-render on client navigation, so the admin layout's
    // role check can be stale; the backend's per-request 403 is authoritative.
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    throw error;
  }

  const { page, totalPages, total } = result.meta.pagination;
  const tests = result.data;
  const filtered = hasFilters(query);
  return (
    <div className="adm-page-stack">
      <header className="adm-page-head">
        <div>
          <h1>Đề thi</h1>
          <p>
            Tạo đề nháp theo cấp HSK, soạn cấu trúc phần rồi xuất bản khi đề đủ
            điều kiện.
          </p>
        </div>
        <div className="adm-page-head__actions">
          <Link className="adm-btn adm-btn--primary" href="/admin/tests/new">
            <AdminIcon name="plus" className="adm-icon adm-icon--sm" />
            Tạo đề thi
          </Link>
        </div>
      </header>

      <form
        className="adm-filters tst-list-filters"
        method="get"
        action="/admin/tests"
        role="search"
        aria-label="Lọc danh sách đề thi"
      >
        <label className="sr-only" htmlFor="tst-level">
          Cấp HSK
        </label>
        <select
          className="adm-input"
          id="tst-level"
          name="levelId"
          defaultValue={query.levelId ? String(query.levelId) : ''}
        >
          <option value="">Tất cả cấp HSK</option>
          {levels.map((level) => (
            <option key={level.id} value={level.id}>
              {levelLabel(level.code)}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="tst-status">
          Trạng thái
        </label>
        <select
          className="adm-input"
          id="tst-status"
          name="status"
          defaultValue={query.status ?? ''}
        >
          {STATUS_FILTER_OPTIONS.map((option) => (
            <option key={option.value || 'all'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="tst-q">
          Tìm theo tên đề
        </label>
        <input
          className="adm-input tst-list-filters__search"
          id="tst-q"
          name="q"
          type="search"
          maxLength={100}
          defaultValue={query.q ?? ''}
          placeholder="Tìm theo tên đề"
        />
        <input type="hidden" name="limit" value={query.limit} />

        <button className="adm-btn adm-btn--primary" type="submit">
          Lọc
        </button>
        <Link className="adm-btn adm-btn--ghost" href="/admin/tests">
          Xoá lọc
        </Link>
      </form>

      <div className="adm-card tst-list-card">
        {tests.length === 0 ? (
          <div className="adm-empty" role="status">
            <AdminIcon name="search" />
            <p>
              {filtered
                ? 'Không có đề thi nào khớp bộ lọc.'
                : 'Chưa có đề thi nào.'}
            </p>
            {filtered ? (
              <Link
                className="adm-btn adm-btn--outline adm-btn--sm"
                href="/admin/tests"
              >
                Xoá lọc
              </Link>
            ) : (
              <Link
                className="adm-btn adm-btn--outline adm-btn--sm"
                href="/admin/tests/new"
              >
                Tạo đề thi
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="adm-table-wrap adm-table-wrap--swap">
              <table className="adm-table tst-list-table">
                <caption className="sr-only">
                  Danh sách đề thi, trang hiện tại
                </caption>
                <thead>
                  <tr>
                    <th scope="col">ID</th>
                    <th scope="col">Tên đề</th>
                    <th scope="col">HSK</th>
                    <th scope="col">Kỹ năng</th>
                    <th scope="col">Số câu</th>
                    <th scope="col">Thời gian</th>
                    <th scope="col">Điểm đỗ</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">Cập nhật</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((test) => {
                    const href = `/admin/tests/${String(test.id)}`;
                    return (
                      <tr key={test.id} className="tst-list-table__row">
                        <td>
                          <Link
                            className="adm-link tst-list-table__id"
                            href={href}
                            aria-label={`Xem đề thi ${String(test.id)}`}
                          >
                            T{test.id}
                          </Link>
                        </td>
                        <td>
                          <Link
                            className="tst-list-table__title"
                            href={href}
                            title={test.title}
                            tabIndex={-1}
                          >
                            {test.title}
                          </Link>
                        </td>
                        <td>{levelLabel(test.levelCode)}</td>
                        <td>{formatTestSkills(test.skills, skillLabel)}</td>
                        <td>{test.questionCount}</td>
                        <td>{formatTestDuration(test.duration)}</td>
                        <td>
                          {formatPassScore(test.passScore, test.maxScore)}
                        </td>
                        <td>
                          <AdminBadge
                            status={test.status}
                            label={contentStatusLabel(test.status)}
                          />
                        </td>
                        <td>{adminDateTime(test.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ol
              className="adm-record-list adm-record-list--swap tst-list-record"
              aria-label="Danh sách đề thi cho màn hẹp"
            >
              {tests.map((test) => (
                <li key={test.id}>
                  <div className="adm-record-list__head">
                    <div>
                      <span className="tst-list-record__id">T{test.id}</span>
                      <Link
                        className="tst-list-record__title"
                        href={`/admin/tests/${String(test.id)}`}
                        title={test.title}
                      >
                        {test.title}
                      </Link>
                    </div>
                  </div>
                  <dl className="adm-record-list__facts tst-list-record__facts">
                    <div>
                      <dt>HSK</dt>
                      <dd>{levelLabel(test.levelCode)}</dd>
                    </div>
                    <div>
                      <dt>Kỹ năng</dt>
                      <dd>{formatTestSkills(test.skills, skillLabel)}</dd>
                    </div>
                    <div>
                      <dt>Số câu</dt>
                      <dd>{test.questionCount}</dd>
                    </div>
                    <div>
                      <dt>Thời gian</dt>
                      <dd>{formatTestDuration(test.duration)}</dd>
                    </div>
                    <div>
                      <dt>Điểm đỗ</dt>
                      <dd>{formatPassScore(test.passScore, test.maxScore)}</dd>
                    </div>
                    <div>
                      <dt>Trạng thái</dt>
                      <dd>
                        <AdminBadge
                          status={test.status}
                          label={contentStatusLabel(test.status)}
                        />
                      </dd>
                    </div>
                    <div>
                      <dt>Cập nhật</dt>
                      <dd>{adminDateTime(test.updatedAt)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          </>
        )}
        {tests.length > 0 ? (
          <nav
            className="adm-pagination tst-list-pagination"
            aria-label="Phân trang đề thi"
          >
            <p className="adm-pagination__info" aria-live="polite">
              Trang {page}/{totalPages} · {total} đề thi
            </p>
            <div className="adm-pagination__pages">
              {page > 1 ? (
                <Link
                  className="adm-page-btn"
                  href={testListHref(query, { page: page - 1 })}
                >
                  <AdminIcon
                    name="chevron-left"
                    className="adm-icon adm-icon--sm"
                  />
                  Trước
                </Link>
              ) : (
                <span
                  className="adm-page-btn adm-page-btn--disabled"
                  aria-disabled="true"
                >
                  <AdminIcon
                    name="chevron-left"
                    className="adm-icon adm-icon--sm"
                  />
                  Trước
                </span>
              )}
              {page < totalPages ? (
                <Link
                  className="adm-page-btn"
                  href={testListHref(query, { page: page + 1 })}
                >
                  Sau
                  <AdminIcon
                    name="chevron-right"
                    className="adm-icon adm-icon--sm"
                  />
                </Link>
              ) : (
                <span
                  className="adm-page-btn adm-page-btn--disabled"
                  aria-disabled="true"
                >
                  Sau
                  <AdminIcon
                    name="chevron-right"
                    className="adm-icon adm-icon--sm"
                  />
                </span>
              )}
            </div>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
