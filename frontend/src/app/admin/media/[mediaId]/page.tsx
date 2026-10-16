import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { MediaDetail } from '@/features/media/media-detail';
import { loadMediaAsset } from '@/features/media/media-service';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../admin-media.css';

export const metadata: Metadata = { title: 'Chi tiết media' };

export default async function MediaDetailPage({
  params,
}: {
  params: Promise<{ mediaId: string }>;
}) {
  const rawId = (await params).mediaId;
  if (!/^\d+$/u.test(rawId)) notFound();
  let asset;
  try {
    asset = await loadMediaAsset(Number(rawId));
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401)
      redirectToSessionLogin();
    // Layouts do not re-render on client navigation, so the admin layout's
    // role check can be stale; the backend's per-request 403 is authoritative.
    if (error instanceof BackendRequestError && error.status === 403)
      redirect('/forbidden');
    if (error instanceof BackendRequestError && error.status === 404)
      notFound();
    throw error;
  }
  return (
    <div className="adm-page-stack">
      <nav className="adm-breadcrumb" aria-label="Đường dẫn">
        <Link href="/admin/media">Thư viện media</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">MD-{asset.id}</span>
      </nav>
      <MediaDetail asset={asset} />
    </div>
  );
}
