import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { MediaFilters } from '@/features/media/media-filters';
import { MediaPagination } from '@/features/media/media-pagination';
import { parseMediaQuery } from '@/features/media/media-query';
import { loadMedia } from '@/features/media/media-service';
import { MediaTable } from '@/features/media/media-table';
import { BackendRequestError } from '@/lib/api/api-error';

import '../admin-media.css';

export const metadata: Metadata = { title: 'Thư viện media' };

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
    // Layouts do not re-render on client navigation, so the admin layout's
    // role check can be stale; the backend's per-request 403 is authoritative.
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    throw error;
  }
  return (
    <div className="adm-page-stack">
      <header className="adm-page-head">
        <div>
          <h1>Thư viện media</h1>
          <p>
            Xem trạng thái xử lý, nguồn gốc và tham chiếu nội dung của media.
          </p>
        </div>
      </header>
      <MediaFilters query={query} />
      <div className="adm-card adm-media-card">
        <MediaTable media={result.data} />
        <MediaPagination
          query={query}
          total={result.meta.total}
          totalPages={result.meta.totalPages}
        />
      </div>
    </div>
  );
}
