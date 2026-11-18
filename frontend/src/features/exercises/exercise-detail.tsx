import { AdminBadge } from '@/features/admin-shell/admin-badge';
import {
  adminDateTime,
  exerciseStatusLabel,
  exerciseTypeLabel,
  mediaTypeLabel,
  processingStatusLabel,
  reviewDecisionLabel,
} from '@/features/admin-shell/admin-labels';

import type { AdminExerciseDetail } from './exercise-contract';

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function ExerciseDetail({
  exercise,
  canViewAnswer,
}: {
  exercise: AdminExerciseDetail;
  canViewAnswer: boolean;
}) {
  return (
    <article className="adm-page-stack">
      <header className="adm-hero">
        <div>
          <h1>Bài tập {exercise.id}</h1>
          <p className="adm-hero__prompt">{exercise.prompt}</p>
        </div>
        <div className="adm-hero__meta">
          <AdminBadge
            status={exercise.status}
            label={exerciseStatusLabel(exercise.status)}
          />
          <span className="adm-badge adm-badge--muted adm-mono">
            Phiên bản {exercise.version}
          </span>
        </div>
      </header>

      <section className="adm-detail-grid" aria-label="Tổng quan bài tập">
        <div className="adm-card adm-panel">
          <div className="adm-panel__head">
            <h2 className="adm-panel__title">Nội dung</h2>
          </div>
          <pre className="adm-json">
            <code>{json(exercise.content)}</code>
          </pre>
          <div className="adm-panel-section">
            <h3 className="adm-subhead">Đáp án</h3>
            {canViewAnswer ? (
              <pre className="adm-json">
                <code>{json(exercise.answer)}</code>
              </pre>
            ) : (
              <p className="adm-muted">
                Dữ liệu đáp án chỉ dành cho quản trị viên đã đăng nhập.
              </p>
            )}
          </div>
          {exercise.explanation ? (
            <div className="adm-panel-section">
              <h3 className="adm-subhead">Giải thích</h3>
              <p>{exercise.explanation}</p>
            </div>
          ) : null}
        </div>

        <aside className="adm-card adm-panel" aria-label="Ngữ cảnh bài tập">
          <div className="adm-panel__head">
            <h2 className="adm-panel__title">Ngữ cảnh</h2>
          </div>
          <dl className="adm-facts">
            <div>
              <dt>Bài học</dt>
              <dd>{exercise.lesson.title}</dd>
            </div>
            <div>
              <dt>Chủ đề</dt>
              <dd>{exercise.topic?.title ?? 'Cấp bài học'}</dd>
            </div>
            <div>
              <dt>Loại</dt>
              <dd>{exerciseTypeLabel(exercise.type)}</dd>
            </div>
            <div>
              <dt>Thứ tự</dt>
              <dd className="adm-mono">{exercise.orderIndex}</dd>
            </div>
            <div>
              <dt>Xuất bản</dt>
              <dd>{adminDateTime(exercise.publishedAt)}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="adm-detail-grid adm-detail-grid--balanced">
        <div className="adm-card adm-panel">
          <div className="adm-panel__head">
            <h2 className="adm-panel__title">Nguồn gốc</h2>
          </div>
          <dl className="adm-facts">
            <div>
              <dt>Nguồn dữ liệu</dt>
              <dd>{exercise.dataSource?.name ?? 'Soạn thủ công'}</dd>
            </div>
            <div>
              <dt>Mã nguồn</dt>
              <dd className="adm-mono">{exercise.dataSource?.code ?? '—'}</dd>
            </div>
            <div>
              <dt>Khoá nguồn</dt>
              <dd className="adm-mono adm-break-anywhere">
                {exercise.sourceKey ?? '—'}
              </dd>
            </div>
            <div>
              <dt>Ngày tạo</dt>
              <dd>{adminDateTime(exercise.createdAt)}</dd>
            </div>
            <div>
              <dt>Ngày cập nhật</dt>
              <dd>{adminDateTime(exercise.updatedAt)}</dd>
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
                <dt>Loại</dt>
                <dd>{mediaTypeLabel(exercise.media.type)}</dd>
              </div>
              <div>
                <dt>MIME</dt>
                <dd>{exercise.media.mimeType ?? '—'}</dd>
              </div>
              <div>
                <dt>Thời lượng</dt>
                <dd>
                  {exercise.media.duration
                    ? `${exercise.media.duration}s`
                    : '—'}
                </dd>
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
            <p className="adm-muted">Bài tập này không có media.</p>
          )}
        </div>
      </section>

      <section className="adm-card adm-panel">
        <div className="adm-panel__head">
          <h2 className="adm-panel__title">Lịch sử bản sửa</h2>
        </div>
        {exercise.revisions.length === 0 ? (
          <p className="adm-muted">Chưa có bản sửa nào.</p>
        ) : (
          <ol className="adm-timeline">
            {exercise.revisions.map((revision) => (
              <li key={revision.id}>
                <div className="adm-timeline__rail" aria-hidden="true" />
                <div className="adm-timeline__content">
                  <div className="adm-timeline__title">
                    <strong>Bản sửa {revision.revision}</strong>
                    <span>{adminDateTime(revision.createdAt)}</span>
                  </div>
                  <span className="adm-mono adm-hash">
                    {revision.contentHash ?? 'Không có hash'}
                  </span>
                  {revision.reviews.map((review) => (
                    <div className="adm-review" key={review.id}>
                      <AdminBadge
                        status={review.decision}
                        label={reviewDecisionLabel(review.decision)}
                      />
                      {review.note ? <span>{review.note}</span> : null}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}
