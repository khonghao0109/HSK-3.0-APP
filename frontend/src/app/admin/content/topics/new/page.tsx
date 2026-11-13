import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { loadLesson } from '@/features/content/content-service';
import { parseRouteId } from '@/features/content/content-values';
import { TopicForm } from '@/features/content/topic-form';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../../admin-content-topic.css';

export const metadata: Metadata = { title: 'Thêm chủ đề' };

export default async function NewTopicPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawLessonId = (await searchParams).lessonId;
  const lessonId = parseRouteId(
    typeof rawLessonId === 'string' ? rawLessonId : undefined,
  );
  if (lessonId === null) notFound();

  let lessonTitle: string;
  let lessonArchived: boolean;
  try {
    const detail = await loadLesson(lessonId);
    lessonTitle = detail.lesson.title;
    lessonArchived = detail.lesson.status === 'archived';
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
  // R8: bài học đã lưu trữ không nhận chủ đề mới.
  if (lessonArchived) notFound();

  return (
    <div className="adm-page-stack">
      <nav className="adm-breadcrumb" aria-label="Đường dẫn">
        <Link href="/admin/content">Nội dung</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/admin/content/lessons/${lessonId}`}>{lessonTitle}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Thêm chủ đề</span>
      </nav>
      <section className="adm-card adm-panel">
        <div className="adm-panel__head">
          <h1 className="adm-panel__title">Thêm chủ đề</h1>
        </div>
        <TopicForm mode="create" lessonId={lessonId} />
      </section>
    </div>
  );
}
