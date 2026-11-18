import Link from 'next/link';

import { AdminIcon } from '@/features/admin-shell/admin-icon';

export default function TopicNotFound() {
  return (
    <div className="adm-card">
      <div className="adm-empty adm-empty--stack">
        <AdminIcon name="file-question" />
        <h1>Không tìm thấy chủ đề</h1>
        <p>Chủ đề không tồn tại hoặc không còn truy cập được.</p>
        <Link className="adm-btn adm-btn--primary" href="/admin/content">
          Về trang Nội dung
        </Link>
      </div>
    </div>
  );
}
