import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { MediaDetail } from '@/features/media/media-detail';
import { loadMediaAsset } from '@/features/media/media-service';
import { BackendRequestError } from '@/lib/api/api-error';

export const metadata: Metadata = { title: 'Media detail' };

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
    if (error instanceof BackendRequestError && error.status === 404)
      notFound();
    throw error;
  }
  return (
    <div className="page-stack">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/admin/media">Media</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">MD-{asset.id}</span>
      </nav>
      <MediaDetail asset={asset} />
    </div>
  );
}
