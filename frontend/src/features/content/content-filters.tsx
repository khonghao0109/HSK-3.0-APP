import Link from 'next/link';

import { AdminIcon } from '@/features/admin-shell/admin-icon';
import {
  contentStatusLabel,
  levelLabel,
} from '@/features/admin-shell/admin-labels';

import { contentStatuses, type LevelItem } from './content-contract';
import type { ContentQuery } from './content-query';

/**
 * Hàng lọc của trang Nội dung (TL-11): server-driven qua URL searchParams
 * (GET form), gồm Cấp độ (options từ `loadLevels()`, nhãn `levelLabel`),
 * Trạng thái và ô tìm kiếm tiêu đề/slug (≤ 200 ký tự). Server component;
 * `contentStatuses` là hằng runtime từ contract (không vào client graph).
 */
export function ContentFilters({
  query,
  levels,
}: {
  query: ContentQuery;
  levels: LevelItem[];
}) {
  return (
    <form
      className="adm-filters"
      method="get"
      action="/admin/content"
      role="search"
      aria-label="Lọc bài học"
    >
      <input type="hidden" name="page" value="1" />
      <input type="hidden" name="limit" value={query.limit} />
      <label className="sr-only" htmlFor="content-level">
        Cấp độ
      </label>
      <select
        className="adm-input"
        id="content-level"
        name="levelId"
        defaultValue={query.levelId ?? ''}
      >
        <option value="">Tất cả cấp độ</option>
        {levels.map((level) => (
          <option key={level.id} value={level.id}>
            {levelLabel(level.code)}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="content-status">
        Trạng thái
      </label>
      <select
        className="adm-input"
        id="content-status"
        name="status"
        defaultValue={query.status ?? ''}
      >
        <option value="">Tất cả trạng thái</option>
        {contentStatuses.map((status) => (
          <option key={status} value={status}>
            {contentStatusLabel(status)}
          </option>
        ))}
      </select>
      <div className="adm-search">
        <AdminIcon name="search" className="adm-icon adm-icon--sm" />
        <label className="sr-only" htmlFor="content-search">
          Tìm kiếm theo tiêu đề hoặc slug
        </label>
        <input
          className="adm-input"
          id="content-search"
          name="search"
          type="search"
          maxLength={200}
          defaultValue={query.search ?? ''}
          placeholder="Tìm theo tiêu đề hoặc slug…"
          autoComplete="off"
        />
      </div>
      <button className="adm-btn adm-btn--primary" type="submit">
        Lọc
      </button>
      <Link className="adm-btn adm-btn--ghost" href="/admin/content">
        Xoá lọc
      </Link>
    </form>
  );
}
