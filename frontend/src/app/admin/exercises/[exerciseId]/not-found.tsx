import Link from 'next/link';

import { AdminIcon } from '@/features/admin-shell/admin-icon';

export default function ExerciseNotFound() {
  return (
    <div className="adm-card">
      <div className="adm-empty adm-empty--stack">
        <AdminIcon name="file-question" />
        <h1>Không tìm thấy bài tập</h1>
        <p>Bài tập không tồn tại hoặc không còn truy cập được.</p>
        <Link className="adm-btn adm-btn--primary" href="/admin/exercises">
          Về danh sách bài tập
        </Link>
      </div>
    </div>
  );
}
