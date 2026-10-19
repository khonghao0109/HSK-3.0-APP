import { AdminBadge } from '@/features/admin-shell/admin-badge';
import {
  adminDateTime,
  reviewDecisionLabel,
} from '@/features/admin-shell/admin-labels';

import { actorLabel, type WorkflowRevision } from './content-values';

/**
 * "Lịch sử bản sửa" dùng chung cho lesson/topic (M5.1a) — cùng cấu trúc
 * timeline với trang chi tiết Bài tập (M5.0). Server component thuần; type
 * revision tối thiểu để không kéo Zod contract vào đồ thị render chung.
 */
export function RevisionHistory({
  revisions,
  sessionAdminId,
}: {
  revisions: WorkflowRevision[];
  sessionAdminId: number;
}) {
  return (
    <section className="adm-card adm-panel">
      <div className="adm-panel__head">
        <h2 className="adm-panel__title">Lịch sử bản sửa</h2>
      </div>
      {revisions.length === 0 ? (
        <p className="adm-muted">Chưa có bản sửa nào.</p>
      ) : (
        <ol className="adm-timeline">
          {revisions.map((revision) => (
            <li key={revision.id}>
              <div className="adm-timeline__rail" aria-hidden="true" />
              <div className="adm-timeline__content">
                <div className="adm-timeline__title">
                  <strong>Bản sửa {revision.revision}</strong>
                  <span>{adminDateTime(revision.createdAt)}</span>
                </div>
                <span className="adm-muted">
                  {actorLabel(revision.authorId, sessionAdminId)}
                </span>
                {revision.reviews.map((review, index) => (
                  <div
                    className="adm-review-record"
                    key={`${revision.id}-${index}`}
                  >
                    <AdminBadge
                      status={review.decision}
                      label={reviewDecisionLabel(review.decision)}
                    />
                    <span className="adm-muted">
                      {actorLabel(review.reviewerId, sessionAdminId)} ·{' '}
                      {adminDateTime(review.createdAt)}
                    </span>
                    {review.note ? <span>{review.note}</span> : null}
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
