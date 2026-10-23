import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { MediaUploadScreen } from '@/features/media-upload/media-upload-screen';
import { loadMediaUploadContext } from '@/features/media-upload/media-upload-service';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../admin-import.css';

export const metadata: Metadata = { title: 'Tải media lên' };

/** M5.2a (TL-42) — trang tải media; tự map 401/403 như trang Nhập dữ liệu. */
export default async function MediaUploadPage() {
  let context;
  try {
    context = await loadMediaUploadContext();
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401) {
      redirectToSessionLogin();
    }
    if (error instanceof BackendRequestError && error.status === 403) {
      redirect('/forbidden');
    }
    throw error;
  }
  return (
    <div className="adm-page-stack">
      <MediaUploadScreen
        ingestionEnabled={context.ingestionEnabled}
        dataSources={context.dataSources}
      />
    </div>
  );
}
