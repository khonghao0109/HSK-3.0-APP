import type { Metadata } from 'next';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { MediaFilters } from '@/features/media/media-filters';
import { MediaPagination } from '@/features/media/media-pagination';
import { parseMediaQuery } from '@/features/media/media-query';
import { loadMedia } from '@/features/media/media-service';
import { MediaTable } from '@/features/media/media-table';
import { BackendRequestError } from '@/lib/api/api-error';

export const metadata: Metadata = { title: 'Media library' };

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseMediaQuery(await searchParams);
  let result;
  try {
    result = await loadMedia(query);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    throw error;
  }
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">ASSET OPERATIONS</p>
          <h1>Media library</h1>
          <p>
            Inspect processing state, provenance and content references without
            exposing delivery or storage credentials.
          </p>
        </div>
        <div className="read-only-chip">
          <span aria-hidden="true">◇</span>
          <span>
            <strong>Safety operations V1</strong>
            <small>Upload pipeline is not enabled</small>
          </span>
        </div>
      </header>
      <MediaFilters query={query} />
      <section
        className="content-panel"
        aria-labelledby="media-results-heading"
      >
        <div className="content-panel__header">
          <div>
            <p className="eyebrow">CURRENT VIEW</p>
            <h2 id="media-results-heading">Asset inventory</h2>
          </div>
          <p className="record-count mono">
            {result.meta.total.toLocaleString('en')} TOTAL
          </p>
        </div>
        <MediaTable media={result.data} />
        <MediaPagination
          query={query}
          total={result.meta.total}
          totalPages={result.meta.totalPages}
        />
      </section>
    </div>
  );
}
