import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { LessonForm } from '@/features/content/lesson-form';
import { loadLevels } from '@/features/content/content-service';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../../admin-content-editor.css';

export const metadata: Metadata = { title: 'Tạo bài học' };

export default async function LessonCreatePage() {
  let levels;
  try {
    levels = await loadLevels();
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
      <nav className="adm-breadcrumb" aria-label="Đường dẫn">
        <Link href="/admin/content">Nội dung</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Tạo bài học</span>
      </nav>
      <header className="adm-page-head">
        <div>
          <h1>Tạo bài học</h1>
          <p>Bài học mới tạo ở trạng thái bản nháp, kèm bản sửa đầu tiên.</p>
        </div>
      </header>
      <section
        className="adm-card adm-panel"
        aria-labelledby="lesson-info-title"
      >
        <div className="adm-panel__head">
          <h2 className="adm-panel__title" id="lesson-info-title">
            Thông tin chung
          </h2>
        </div>
        <LessonForm mode="create" levels={levels} />
      </section>
    </div>
  );
}
