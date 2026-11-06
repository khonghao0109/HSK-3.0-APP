import Link from 'next/link';

import {
  lifecycleLabel,
  mediaTypeLabel,
  processingStatusLabel,
} from '@/features/admin-shell/admin-labels';

import {
  mediaLifecycles,
  mediaProcessingStatuses,
  mediaTypes,
} from './media-contract';
import type { MediaQuery } from './media-query';

export function MediaFilters({ query }: { query: MediaQuery }) {
  return (
    <form className="adm-filters" method="get" action="/admin/media">
      <input type="hidden" name="page" value="1" />
      <input type="hidden" name="limit" value={query.limit} />
      <label className="sr-only" htmlFor="media-type">
        Loại
      </label>
      <select
        className="adm-input"
        id="media-type"
        name="type"
        defaultValue={query.type ?? ''}
      >
        <option value="">Tất cả loại</option>
        {mediaTypes.map((value) => (
          <option key={value} value={value}>
            {mediaTypeLabel(value)}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="processing-status">
        Xử lý
      </label>
      <select
        className="adm-input"
        id="processing-status"
        name="processingStatus"
        defaultValue={query.processingStatus ?? ''}
      >
        <option value="">Tất cả trạng thái xử lý</option>
        {mediaProcessingStatuses.map((value) => (
          <option key={value} value={value}>
            {processingStatusLabel(value)}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="media-lifecycle">
        Vòng đời
      </label>
      <select
        className="adm-input"
        id="media-lifecycle"
        name="lifecycle"
        defaultValue={query.lifecycle ?? ''}
      >
        <option value="">Tất cả vòng đời</option>
        {mediaLifecycles.map((value) => (
          <option key={value} value={value}>
            {lifecycleLabel(value)}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="dataSourceId">
        ID nguồn
      </label>
      <input
        className="adm-input"
        id="dataSourceId"
        name="dataSourceId"
        type="number"
        min="1"
        defaultValue={query.dataSourceId}
        placeholder="ID nguồn"
      />
      <button className="adm-btn adm-btn--primary" type="submit">
        Lọc
      </button>
      <Link className="adm-btn adm-btn--ghost" href="/admin/media">
        Xoá lọc
      </Link>
    </form>
  );
}
