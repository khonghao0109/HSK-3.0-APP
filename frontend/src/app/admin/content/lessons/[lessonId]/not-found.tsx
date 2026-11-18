import Link from 'next/link';

import { AdminIcon } from '@/features/admin-shell/admin-icon';

export default function LessonNotFound() {
  return (
    <div className="adm-state-card">
      <span className="adm-state-card__mark" aria-hidden="true">
        <AdminIcon name="file-question" />
      </span>
      <h1>Không tìm thấy bài học</h1>
      <p>Bài học không tồn tại hoặc không còn truy cập được.</p>
      <div className="adm-state-card__actions">
        <Link className="adm-btn adm-btn--primary" href="/admin/content">
          Về danh sách nội dung
        </Link>
      </div>
    </div>
  );
}
