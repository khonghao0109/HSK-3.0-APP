import Link from 'next/link';

import { AdminIcon } from '@/features/admin-shell/admin-icon';

/** TL-43/Q104: chỉ hiện khi backend báo ingestion đang bật. */
export function MediaUploadLink({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <div className="adm-page-head__actions">
      <Link className="adm-btn adm-btn--primary" href="/admin/media/upload">
        <AdminIcon name="upload" className="adm-icon adm-icon--sm" />
        Tải lên
      </Link>
    </div>
  );
}
