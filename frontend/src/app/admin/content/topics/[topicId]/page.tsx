import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import { contentStatusLabel } from '@/features/admin-shell/admin-labels';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import {
  loadSessionAdminId,
  loadTopic,
} from '@/features/content/content-service';
import {
  parseRouteId,
  topicPrefillFromSnapshot,
} from '@/features/content/content-values';
import { ContentWorkflow } from '@/features/content/content-workflow';
import { RevisionHistory } from '@/features/content/revision-history';
import { TopicForm } from '@/features/content/topic-form';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../../admin-content-topic.css';

export const metadata: Metadata = { title: 'Chủ đề' };

export default async function TopicDetailPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const topicId = parseRouteId((await params).topicId);
  if (topicId === null) notFound();

  let detail;
  let sessionAdminId;
  try {
    [detail, sessionAdminId] = await Promise.all([
      loadTopic(topicId),
      loadSessionAdminId(),
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

  const { topic, revisions } = detail;
  // Backend trả revisions desc theo revision nên phần tử đầu là bản sửa mới
  // nhất (R1: prefill từ snapshot, không hợp lệ → bản live).
  const latestRevision = revisions[0] ?? null;
  const initial = (latestRevision &&
    topicPrefillFromSnapshot(latestRevision.snapshot)) ?? {
    title: topic.title,
    subtitle: topic.subtitle,
    type: topic.type,
    contentText: JSON.stringify(topic.content ?? null, null, 2),
    orderIndex: topic.orderIndex,
    isPremium: topic.isPremium,
    isLocked: topic.isLocked,
  };
  return (
    <div className="adm-page-stack">
      <nav className="adm-breadcrumb" aria-label="Đường dẫn">
        <Link href="/admin/content">Nội dung</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/admin/content/lessons/${topic.lessonId}`}>Bài học</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{topic.title}</span>
      </nav>
      <header className="adm-hero">
        <div>
          <h1>{topic.title}</h1>
        </div>
        <div className="adm-hero__meta">
          <AdminBadge
            status={topic.status}
            label={contentStatusLabel(topic.status)}
          />
        </div>
      </header>
      <div className="adm-detail-grid">
        <div className="adm-topic-detail__main">
          <section className="adm-card adm-panel">
            <div className="adm-panel__head">
              <h2 className="adm-panel__title">Thông tin chủ đề</h2>
            </div>
            <TopicForm
              mode="edit"
              lessonId={topic.lessonId}
              topicId={topic.id}
              archived={topic.status === 'archived'}
              initial={initial}
            />
          </section>
          <RevisionHistory
            revisions={revisions}
            sessionAdminId={sessionAdminId}
          />
        </div>
        <section
          className="adm-card adm-panel"
          aria-labelledby="topic-workflow-title"
        >
          <div className="adm-panel__head">
            <h2 className="adm-panel__title" id="topic-workflow-title">
              Quy trình xuất bản
            </h2>
          </div>
          <ContentWorkflow
            entity="topics"
            entityId={topic.id}
            status={topic.status}
            publishedAt={topic.publishedAt}
            publishedById={topic.publishedById}
            latestRevision={latestRevision}
            live={topic}
            snapshot={latestRevision?.snapshot ?? null}
            sessionAdminId={sessionAdminId}
          />
        </section>
      </div>
    </div>
  );
}
