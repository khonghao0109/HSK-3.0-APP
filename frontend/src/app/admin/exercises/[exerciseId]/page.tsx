import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import {
  exerciseStatusLabel,
  mediaTypeLabel,
  processingStatusLabel,
} from '@/features/admin-shell/admin-labels';
import { redirectToSessionLogin } from '@/features/auth/session-redirect';
import { loadSessionAdminId } from '@/features/content/content-service';
import { ContentWorkflow } from '@/features/content/content-workflow';
import {
  exercisePublishBlockReason,
  parseRouteId,
} from '@/features/content/content-values';
import { RevisionHistory } from '@/features/content/revision-history';
import { loadExerciseAudioOptions } from '@/features/exercises/exercise-admin-service';
import type { AdminExerciseDetail } from '@/features/exercises/exercise-contract';
import { ExerciseEditScreen } from '@/features/exercises/exercise-edit-screen';
import {
  exercisePrefillFromSnapshot,
  type ExerciseMediaOption,
} from '@/features/exercises/exercise-form-values';
import { loadExercise } from '@/features/exercises/exercise-service';
import { BackendRequestError } from '@/lib/api/api-error';

import '../../admin-exercise-form.css';
import '../../admin-exercises.css';

export const metadata: Metadata = { title: 'Sửa bài tập' };

export default async function ExerciseEditPage({
  params,
}: {
  params: Promise<{ exerciseId: string }>;
}) {
  const exerciseId = parseRouteId((await params).exerciseId);
  if (exerciseId === null) notFound();
  let exercise: AdminExerciseDetail;
  let sessionAdminId: number;
  let audio: ExerciseMediaOption[];
  try {
    [exercise, sessionAdminId, audio] = await Promise.all([
      loadExercise(exerciseId),
      loadSessionAdminId(),
      loadExerciseAudioOptions(),
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
  // Backend trả revisions desc theo revision (cms.service getExercise) nên
  // phần tử đầu là bản sửa mới nhất.
  const latestRevision = exercise.revisions[0] ?? null;
  const initial = exercisePrefillFromSnapshot(
    latestRevision?.snapshot ?? null,
    exercise,
  );
  // Danh sách audio đã tải (ready/active, 100 đầu) có filename; contract chi
  // tiết bài tập chỉ trả url nên tra filename theo mediaId.
  const mediaFilename =
    audio.find((option) => option.id === exercise.media?.id)?.filename ?? null;
  const title = exercise.prompt.trim() || `Bài tập ${exercise.id}`;
  return (
    <div className="adm-page-stack">
      <nav className="adm-breadcrumb" aria-label="Đường dẫn">
        <Link href="/admin/exercises">Bài tập</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Bài tập {exercise.id}</span>
      </nav>
      <header className="adm-page-head">
        <div>
          <h1 className="adm-exercise-form__heading">{title}</h1>
          <p>
            Bài học {exercise.lesson.title} · chủ đề{' '}
            {exercise.topic?.title ?? 'Cấp bài học'}
          </p>
        </div>
        <div className="adm-page-head__actions">
          <AdminBadge
            status={exercise.status}
            label={exerciseStatusLabel(exercise.status)}
          />
          <span className="adm-badge adm-badge--muted adm-mono">
            Phiên bản {exercise.version}
          </span>
        </div>
      </header>
      <div className="adm-detail-grid">
        <div className="adm-page-stack">
          <section
            className="adm-card adm-panel"
            aria-labelledby="exercise-form-title"
          >
            <div className="adm-panel__head">
              <h2 className="adm-panel__title" id="exercise-form-title">
                Nội dung bài tập
              </h2>
            </div>
            <ExerciseEditScreen
              initial={initial}
              lessonTitle={exercise.lesson.title}
              topicTitle={exercise.topic?.title ?? null}
              archived={exercise.status === 'archived'}
              audio={audio}
              submitPath={`/api/admin/exercises/${exercise.id}/revisions`}
            />
          </section>
          <RevisionHistory
            revisions={exercise.revisions}
            sessionAdminId={sessionAdminId}
            showContentHash
          />
        </div>
        <section
          className="adm-card adm-panel"
          aria-labelledby="exercise-workflow-title"
        >
          <div className="adm-panel__head">
            <h2 className="adm-panel__title" id="exercise-workflow-title">
              Quy trình xuất bản
            </h2>
          </div>
          <ContentWorkflow
            entity="exercises"
            entityId={exercise.id}
            status={exercise.status}
            publishedAt={exercise.publishedAt}
            publishedById={exercise.publishedById}
            latestRevision={latestRevision}
            live={exercise}
            snapshot={latestRevision?.snapshot ?? null}
            sessionAdminId={sessionAdminId}
            publishBlockedReason={exercisePublishBlockReason(exercise.type)}
          />
        </section>
      </div>
      <section
        className="adm-detail-grid adm-detail-grid--balanced"
        aria-label="Nguồn gốc và media"
      >
        <div className="adm-card adm-panel">
          <div className="adm-panel__head">
            <h2 className="adm-panel__title">Nguồn gốc</h2>
          </div>
          <dl className="adm-facts">
            <div>
              <dt>Nguồn dữ liệu</dt>
              <dd>{exercise.dataSource?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>Mã nguồn</dt>
              <dd className="adm-mono">{exercise.dataSource?.code ?? '—'}</dd>
            </div>
            <div>
              <dt>Phiên bản nguồn</dt>
              <dd className="adm-mono">
                {exercise.dataSource?.version ?? '—'}
              </dd>
            </div>
          </dl>
        </div>
        <div className="adm-card adm-panel">
          <div className="adm-panel__head">
            <h2 className="adm-panel__title">Media</h2>
          </div>
          {exercise.media ? (
            <dl className="adm-facts">
              <div>
                <dt>Tệp</dt>
                <dd className="adm-mono adm-break-anywhere">
                  {mediaFilename ?? '—'}
                </dd>
              </div>
              <div>
                <dt>Đường dẫn</dt>
                <dd className="adm-mono adm-break-anywhere">
                  {exercise.media.url}
                </dd>
              </div>
              <div>
                <dt>Loại</dt>
                <dd>{mediaTypeLabel(exercise.media.type)}</dd>
              </div>
              <div>
                <dt>MIME</dt>
                <dd>{exercise.media.mimeType ?? '—'}</dd>
              </div>
              <div>
                <dt>Xử lý</dt>
                <dd>
                  <AdminBadge
                    status={exercise.media.processingStatus}
                    label={processingStatusLabel(
                      exercise.media.processingStatus,
                    )}
                  />
                </dd>
              </div>
            </dl>
          ) : (
            <p className="adm-muted">Không có media.</p>
          )}
        </div>
      </section>
    </div>
  );
}
