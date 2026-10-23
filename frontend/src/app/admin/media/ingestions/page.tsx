import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { MediaIngestionList } from '@/features/media/media-ingestion-list';
import { MediaPagination } from '@/features/media/media-pagination';
import {
  loadMediaIngestions,
  MEDIA_INGESTION_PAGE_LIMIT,
} from '@/features/media/media-service';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../admin-media.css';

export const metadata: Metadata = { title: 'Tải lên cần xử lý' };

const PAGE = /^[1-9]\d{0,9}$/u;

/** TL-51: `?page=n` (số nguyên ≥ 1, ≤ int4); giá trị khác về trang 1. */
function parsePage(value: string | string[] | undefined): number {
  return typeof value === 'string' &&
    PAGE.test(value) &&
    Number(value) <= 2_147_483_647
    ? Number(value)
    : 1;
}

export default async function MediaIngestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const page = parsePage((await searchParams).page);
  let result;
  try {
    result = await loadMediaIngestions(page);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    throw error;
  }
  return (
    <div className="adm-page-stack">
      <header className="adm-page-head">
        <div>
          <h1>Tải lên cần xử lý</h1>
          <p>
            Bản ghi tải lên còn tệp cần dọn trong storage hoặc bị kẹt khi xử lý.
          </p>
        </div>
        <div className="adm-page-head__actions">
          <Link className="adm-btn adm-btn--outline" href="/admin/media">
            Thư viện media
          </Link>
        </div>
      </header>
      <MediaIngestionList ingestions={result.data} total={result.meta.total} />
      {result.meta.total > 0 ? (
        <MediaPagination
          query={{ page, limit: MEDIA_INGESTION_PAGE_LIMIT }}
          total={result.meta.total}
          totalPages={result.meta.totalPages}
          pageHref={(target) => `/admin/media/ingestions?page=${target}`}
          label="Phân trang tải lên cần xử lý"
        />
      ) : null}
    </div>
  );
}
