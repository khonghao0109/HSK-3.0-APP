import { StatusBadge } from '@/components/ui/status-badge';

import type { AdminExerciseDetail } from './exercise-contract';

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function decisionLabel(value: string): string {
  return value
    .split('_')
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');
}

export function ExerciseDetail({
  exercise,
  canViewAnswer,
}: {
  exercise: AdminExerciseDetail;
  canViewAnswer: boolean;
}) {
  return (
    <article className="detail-stack">
      <header className="detail-hero">
        <div>
          <p className="eyebrow mono">LESSON EXERCISE / EX-{exercise.id}</p>
          <h1>Exercise {exercise.id}</h1>
          <p className="detail-hero__prompt">{exercise.prompt}</p>
        </div>
        <div className="detail-hero__meta">
          <StatusBadge status={exercise.status}>
            {decisionLabel(exercise.status)}
          </StatusBadge>
          <span className="version-chip mono">Version {exercise.version}</span>
        </div>
      </header>

      <section className="detail-grid" aria-label="Exercise overview">
        <div className="panel detail-main">
          <div className="section-heading">
            <p className="eyebrow">Canonical payload</p>
            <h2>Content</h2>
          </div>
          <pre className="json-block">
            <code>{json(exercise.content)}</code>
          </pre>
          <div className="answer-block">
            <h3>Authoritative answer</h3>
            {canViewAnswer ? (
              <pre className="json-block json-block--answer">
                <code>{json(exercise.answer)}</code>
              </pre>
            ) : (
              <p>Answer data is restricted to authenticated administrators.</p>
            )}
          </div>
          {exercise.explanation ? (
            <div className="prose-block">
              <h3>Explanation</h3>
              <p>{exercise.explanation}</p>
            </div>
          ) : null}
        </div>

        <aside className="panel fact-panel" aria-label="Exercise metadata">
          <div className="section-heading">
            <p className="eyebrow">Placement</p>
            <h2>Context</h2>
          </div>
          <dl className="fact-list">
            <div>
              <dt>Lesson</dt>
              <dd>{exercise.lesson.title}</dd>
            </div>
            <div>
              <dt>Topic</dt>
              <dd>{exercise.topic?.title ?? 'Lesson level'}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{decisionLabel(exercise.type)}</dd>
            </div>
            <div>
              <dt>Order</dt>
              <dd className="mono">{exercise.orderIndex}</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>{formatDate(exercise.publishedAt)}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="detail-grid detail-grid--balanced">
        <div className="panel">
          <div className="section-heading">
            <p className="eyebrow">Traceability</p>
            <h2>Provenance</h2>
          </div>
          <dl className="fact-list">
            <div>
              <dt>Data source</dt>
              <dd>{exercise.dataSource?.name ?? 'Manual authoring'}</dd>
            </div>
            <div>
              <dt>Source code</dt>
              <dd className="mono">{exercise.dataSource?.code ?? '—'}</dd>
            </div>
            <div>
              <dt>Source key</dt>
              <dd className="mono break-anywhere">
                {exercise.sourceKey ?? '—'}
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(exercise.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(exercise.updatedAt)}</dd>
            </div>
          </dl>
        </div>
        <div className="panel">
          <div className="section-heading">
            <p className="eyebrow">Safe asset view</p>
            <h2>Media</h2>
          </div>
          {exercise.media ? (
            <dl className="fact-list">
              <div>
                <dt>Type</dt>
                <dd>{exercise.media.type}</dd>
              </div>
              <div>
                <dt>MIME</dt>
                <dd>{exercise.media.mimeType ?? '—'}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>
                  {exercise.media.duration
                    ? `${exercise.media.duration}s`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Processing</dt>
                <dd>
                  <StatusBadge status={exercise.media.processingStatus}>
                    {decisionLabel(exercise.media.processingStatus)}
                  </StatusBadge>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="muted">No media is attached to this exercise.</p>
          )}
        </div>
      </section>

      <section className="panel revision-panel">
        <div className="section-heading">
          <p className="eyebrow">Immutable audit trail</p>
          <h2>Revision history</h2>
        </div>
        {exercise.revisions.length === 0 ? (
          <p className="muted">No revisions recorded.</p>
        ) : (
          <ol className="timeline">
            {exercise.revisions.map((revision) => (
              <li key={revision.id}>
                <div className="timeline__rail" aria-hidden="true" />
                <div className="timeline__content">
                  <div className="timeline__title">
                    <strong>Revision {revision.revision}</strong>
                    <span>{formatDate(revision.createdAt)}</span>
                  </div>
                  <span className="mono hash">
                    {revision.contentHash ?? 'Hash unavailable'}
                  </span>
                  {revision.reviews.map((review) => (
                    <div className="review-record" key={review.id}>
                      <StatusBadge status={review.decision}>
                        {decisionLabel(review.decision)}
                      </StatusBadge>
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
