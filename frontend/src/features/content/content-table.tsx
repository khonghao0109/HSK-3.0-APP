import Link from 'next/link';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import { AdminIcon } from '@/features/admin-shell/admin-icon';
import {
  ADMIN_ACTION,
  adminDateTime,
  contentStatusLabel,
  levelLabel,
  revisionReviewStateLabel,
  revisionReviewStateTone,
} from '@/features/admin-shell/admin-labels';

import type { AdminLessonListItem, LevelItem } from './content-contract';
import { withContentPage, type ContentQuery } from './content-query';

/**
 * Bảng danh sách bài học của trang Nội dung (M5.0, TL-11): bảng `adm-table`
 * trên desktop, danh sách `adm-record-list` khi ≤900px (hai khối render song
 * song, swap bằng class `--swap` đã có trong admin.css). Server component
 * thuần; type lấy từ content-contract qua `import type` để không kéo Zod.
 */

/** levelId → mã cấp (HSK1, HSK7_9…), nguồn: `loadLevels()` (TL-12). */
function levelText(
  lesson: AdminLessonListItem,
  levelCodeById: ReadonlyMap<number, string>,
): string {
  const code = levelCodeById.get(lesson.levelId);
  return code ? levelLabel(code) : '—';
}

/**
 * Badge "Trạng thái duyệt" lấy từ bản sửa mới nhất (TL-11): tông và nhãn đều
 * qua revisionReviewState{Label,Tone}. Không có bản sửa → '—' trần, không
 * badge.
 */
function ReviewState({
  latestRevision,
}: {
  latestRevision: AdminLessonListItem['latestRevision'];
}) {
  if (!latestRevision) {
    return <span className="adm-muted">{revisionReviewStateLabel(null)}</span>;
  }
  return (
    <AdminBadge
      tone={revisionReviewStateTone(latestRevision)}
      label={revisionReviewStateLabel(latestRevision)}
    />
  );
}

export function ContentTable({
  lessons,
  levels,
}: {
  lessons: AdminLessonListItem[];
  levels: LevelItem[];
}) {
  const levelCodeById: ReadonlyMap<number, string> = new Map(
    levels.map((level) => [level.id, level.code]),
  );
  if (lessons.length === 0) {
    return (
      <div className="adm-empty" role="status">
        <AdminIcon name="search" />
        <p>Không có bài học nào khớp bộ lọc.</p>
        <Link
          className="adm-btn adm-btn--outline adm-btn--sm"
          href="/admin/content"
        >
          Xoá lọc
        </Link>
      </div>
    );
  }
  return (
    <>
      <div className="adm-table-wrap adm-table-wrap--swap">
        <table className="adm-table">
          <caption className="sr-only">
            Danh sách bài học, trang hiện tại
          </caption>
          <thead>
            <tr>
              <th scope="col">Tiêu đề</th>
              <th scope="col">Cấp độ</th>
              <th scope="col">Thứ tự</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Trạng thái duyệt</th>
              <th scope="col">Cập nhật gần nhất</th>
              <th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((lesson) => (
              <tr key={lesson.id} aria-label={`Bài học ${lesson.title}`}>
                <td>
                  <span className="adm-table__strong">{lesson.title}</span>
                  <span className="adm-table__sub">{lesson.slug}</span>
                </td>
                <td>{levelText(lesson, levelCodeById)}</td>
                <td>
                  <span className="adm-mono">{lesson.orderIndex}</span>
                </td>
                <td>
                  <AdminBadge
                    status={lesson.status}
                    label={contentStatusLabel(lesson.status)}
                  />
                </td>
                <td>
                  <ReviewState latestRevision={lesson.latestRevision} />
                </td>
                <td className="adm-content-date">
                  {adminDateTime(lesson.updatedAt)}
                </td>
                <td>
                  <Link
                    className="adm-link"
                    href={`/admin/content/lessons/${lesson.id}`}
                    aria-label={`Sửa ${lesson.title}`}
                  >
                    Sửa
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol
        className="adm-record-list adm-record-list--swap"
        aria-label="Danh sách bài học cho màn hẹp"
      >
        {lessons.map((lesson) => (
          <li key={lesson.id} aria-label={`Bài học ${lesson.title}`}>
            <div className="adm-record-list__head">
              <div>
                <strong>{lesson.title}</strong>
                <span className="adm-table__sub">{lesson.slug}</span>
              </div>
              <AdminBadge
                status={lesson.status}
                label={contentStatusLabel(lesson.status)}
              />
            </div>
            <dl className="adm-record-list__facts">
              <div>
                <dt>Cấp độ</dt>
                <dd>{levelText(lesson, levelCodeById)}</dd>
              </div>
              <div>
                <dt>Thứ tự</dt>
                <dd className="adm-mono">{lesson.orderIndex}</dd>
              </div>
              <div>
                <dt>Trạng thái duyệt</dt>
                <dd>
                  <ReviewState latestRevision={lesson.latestRevision} />
                </dd>
              </div>
              <div>
                <dt>Cập nhật gần nhất</dt>
                <dd>{adminDateTime(lesson.updatedAt)}</dd>
              </div>
            </dl>
            <Link
              className="adm-link"
              href={`/admin/content/lessons/${lesson.id}`}
              aria-label={`Sửa ${lesson.title}`}
            >
              Sửa
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * Phân trang server của trang Nội dung — cùng markup với
 * `features/exercises/pagination.tsx` nhưng theo `ContentQuery` (props của
 * Pagination exercises không khớp nên không tái dùng trực tiếp).
 */
export function ContentPagination({
  query,
  total,
  totalPages,
}: {
  query: ContentQuery;
  total: number;
  totalPages: number;
}) {
  const from = total === 0 ? 0 : (query.page - 1) * query.limit + 1;
  const to = Math.min(query.page * query.limit, total);
  return (
    <nav className="adm-pagination" aria-label="Phân trang bài học">
      <p className="adm-pagination__info" aria-live="polite">
        Hiển thị {from} đến {to} của {total} kết quả
      </p>
      <div className="adm-pagination__pages">
        {query.page > 1 ? (
          <Link
            className="adm-page-btn"
            href={withContentPage(query, query.page - 1)}
          >
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
        {query.page < totalPages ? (
          <Link
            className="adm-page-btn"
            href={withContentPage(query, query.page + 1)}
          >
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
