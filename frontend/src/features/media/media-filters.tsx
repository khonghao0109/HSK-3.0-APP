import Link from 'next/link';

import {
  mediaLifecycles,
  mediaProcessingStatuses,
  mediaTypes,
} from './media-contract';
import type { MediaQuery } from './media-query';

function label(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function MediaFilters({ query }: { query: MediaQuery }) {
  return (
    <form className="filter-bar" method="get" action="/admin/media">
      <input type="hidden" name="page" value="1" />
      <input type="hidden" name="limit" value={query.limit} />
      <div className="field-inline">
        <label htmlFor="media-type">Type</label>
        <select id="media-type" name="type" defaultValue={query.type ?? ''}>
          <option value="">All types</option>
          {mediaTypes.map((value) => (
            <option key={value} value={value}>
              {label(value)}
            </option>
          ))}
        </select>
      </div>
      <div className="field-inline">
        <label htmlFor="processing-status">Processing</label>
        <select
          id="processing-status"
          name="processingStatus"
          defaultValue={query.processingStatus ?? ''}
        >
          <option value="">All processing states</option>
          {mediaProcessingStatuses.map((value) => (
            <option key={value} value={value}>
              {label(value)}
            </option>
          ))}
        </select>
      </div>
      <div className="field-inline">
        <label htmlFor="media-lifecycle">Lifecycle</label>
        <select
          id="media-lifecycle"
          name="lifecycle"
          defaultValue={query.lifecycle ?? ''}
        >
          <option value="">All lifecycle states</option>
          {mediaLifecycles.map((value) => (
            <option key={value} value={value}>
              {label(value)}
            </option>
          ))}
        </select>
      </div>
      <div className="field-inline field-inline--short">
        <label htmlFor="dataSourceId">Source ID</label>
        <input
          id="dataSourceId"
          name="dataSourceId"
          type="number"
          min="1"
          defaultValue={query.dataSourceId}
          placeholder="Any"
        />
      </div>
      <button className="button button--primary" type="submit">
        Apply filters
      </button>
      <Link className="button button--ghost" href="/admin/media">
        Clear
      </Link>
    </form>
  );
}
