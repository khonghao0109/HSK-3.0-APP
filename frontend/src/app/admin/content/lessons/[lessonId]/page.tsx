import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import {
  contentStatusLabel,
  levelLabel,
} from '@/features/admin-shell/admin-labels';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { ContentWorkflow } from '@/features/content/content-workflow';
import {
  loadLesson,
  loadLevels,
  loadSessionAdminId,
} from '@/features/content/content-service';
import { LessonForm } from '@/features/content/lesson-form';
import { parseRouteId } from '@/features/content/content-values';
import { lessonPrefillFromSnapshot } from '@/features/content/lesson-values';
import { LessonTopics } from '@/features/content/lesson-topics';
import { RevisionHistory } from '@/features/content/revision-history';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../../admin-content-editor.css';

export const metadata: Metadata = { title: 'Sửa bài học' };

export default async function LessonDetailPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const lessonId = parseRouteId((await params).lessonId);
  if (lessonId === null) notFound();
  let data;
  let sessionAdminId;
  let levels;
  try {
    [data, sessionAdminId, levels] = await Promise.all([
      loadLesson(lessonId),
      loadSessionAdminId(),
      loadLevels(),
    ]);
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
  const { lesson, revisions, topics } = data;
  // Backend trả revisions desc theo revision (cms.service getLesson) nên
  // phần tử đầu là bản sửa mới nhất.
  const latestRevision = revisions[0] ?? null;
  const initial = (latestRevision &&
    lessonPrefillFromSnapshot(latestRevision.snapshot)) ?? {
    title: lesson.title,
    description: lesson.description ?? '',
    orderIndex: lesson.orderIndex,
    slug: lesson.slug,
  };
  const levelCode = levels.find((level) => level.id === lesson.levelId)?.code;
  return (
    <div className="adm-page-stack">
      <nav className="adm-breadcrumb" aria-label="Đường dẫn">
        <Link href="/admin/content">Nội dung</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{lesson.title}</span>
      </nav>
      <header className="adm-page-head">
        <div>
          <h1>{lesson.title}</h1>
          <p>
            Slug <span className="adm-mono">{lesson.slug}</span> · thứ tự{' '}
            {lesson.orderIndex}
          </p>
        </div>
        <AdminBadge
          status={lesson.status}
          label={contentStatusLabel(lesson.status)}
        />
      </header>
      <div className="adm-detail-grid">
        <div className="adm-page-stack">
          <section
            className="adm-card adm-panel"
            aria-labelledby="lesson-info-title"
          >
            <div className="adm-panel__head">
              <h2 className="adm-panel__title" id="lesson-info-title">
                Thông tin chung
              </h2>
            </div>
            <LessonForm
              mode="edit"
              lessonId={lesson.id}
              levelText={levelCode ? levelLabel(levelCode) : '—'}
              archived={lesson.status === 'archived'}
              initial={initial}
            />
          </section>
          <section
            className="adm-card adm-panel"
            aria-labelledby="lesson-topics-title"
          >
            <div className="adm-panel__head adm-panel__head--row">
              <h2 className="adm-panel__title" id="lesson-topics-title">
                Chủ đề của bài
              </h2>
              {lesson.status === 'archived' ? null : (
                <div className="adm-page-head__actions">
                  <Link
                    className="adm-btn adm-btn--outline adm-btn--sm"
                    href={`/admin/content/topics/new?lessonId=${lesson.id}`}
                  >
                    Thêm chủ đề
                  </Link>
                  <Link
                    className="adm-btn adm-btn--outline adm-btn--sm"
                    href={`/admin/exercises/new?lessonId=${lesson.id}`}
                  >
                    Thêm bài tập
                  </Link>
                </div>
              )}
            </div>
            <LessonTopics topics={topics} />
          </section>
          <RevisionHistory
            revisions={revisions}
            sessionAdminId={sessionAdminId}
          />
        </div>
        <section
          className="adm-card adm-panel"
          aria-labelledby="lesson-workflow-title"
        >
          <div className="adm-panel__head">
            <h2 className="adm-panel__title" id="lesson-workflow-title">
              Quy trình xuất bản
            </h2>
          </div>
          <ContentWorkflow
            entity="lessons"
            entityId={lesson.id}
            status={lesson.status}
            publishedAt={lesson.publishedAt}
            publishedById={lesson.publishedById}
            latestRevision={latestRevision}
            live={lesson}
            snapshot={latestRevision?.snapshot ?? null}
            sessionAdminId={sessionAdminId}
          />
        </section>
      </div>
    </div>
  );
}
