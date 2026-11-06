import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AdminIcon } from '@/features/admin-shell/admin-icon';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { ContentFilters } from '@/features/content/content-filters';
import {
  parseContentQuery,
  serializeContentQuery,
} from '@/features/content/content-query';
import { loadLessons, loadLevels } from '@/features/content/content-service';
import {
  ContentPagination,
  ContentTable,
} from '@/features/content/content-table';
import { BackendRequestError } from '@/lib/api/api-error';

import '../admin-content-list.css';

export const metadata: Metadata = { title: 'Nội dung' };

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseContentQuery(await searchParams);
  let result;
  try {
    result = await Promise.all([
      loadLevels(),
      loadLessons(serializeContentQuery(query)),
    ]);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    // Layouts do not re-render on client navigation, so the admin layout's
    // role check can be stale; the backend's per-request 403 is authoritative.
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    throw error;
  }
  const [levels, list] = result;
  return (
    <div className="adm-page-stack">
      <header className="adm-page-head">
        <div>
          <h1>Nội dung</h1>
          <p>
            Quản lý bài học: tạo mới, theo dõi trạng thái duyệt và xuất bản.
          </p>
        </div>
        <div className="adm-page-head__actions">
          <Link
            className="adm-btn adm-btn--primary"
            href="/admin/content/lessons/new"
          >
            <AdminIcon name="plus" className="adm-icon adm-icon--sm" />
            Tạo bài học
          </Link>
        </div>
      </header>
      <ContentFilters query={query} levels={levels} />
      <div className="adm-card adm-card--clip">
        <ContentTable lessons={list.data} levels={levels} />
        <ContentPagination
          query={query}
          total={list.meta.total}
          totalPages={list.meta.totalPages}
        />
      </div>
    </div>
  );
}
