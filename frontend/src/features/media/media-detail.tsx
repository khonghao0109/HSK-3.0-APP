import Link from 'next/link';

import { StatusBadge } from '@/components/ui/status-badge';

import type { AdminMediaDetail } from './media-contract';
import { MediaLifecycleActions } from './media-mutation';

function label(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function date(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function size(value: number | null): string {
  if (value === null) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaDetail({ asset }: { asset: AdminMediaDetail }) {
  return (
    <article className="detail-stack">
      <header className="detail-hero media-detail-hero">
        <div>
          <p className="eyebrow mono">MEDIA ASSET / MD-{asset.id}</p>
          <h1>{asset.filename ?? `Media asset ${asset.id}`}</h1>
          <p className="detail-hero__prompt">
            Operational metadata only. Delivery URL and storage credentials are
            intentionally restricted.
          </p>
        </div>
        <div className="detail-hero__meta">
          <StatusBadge status={asset.processingStatus}>
            {label(asset.processingStatus)}
          </StatusBadge>
          <StatusBadge status={asset.lifecycle}>
            {label(asset.lifecycle)}
          </StatusBadge>
        </div>
      </header>

      <section className="detail-grid" aria-label="Media asset overview">
        <div className="panel detail-main">
          <div className="section-heading">
            <p className="eyebrow">Asset profile</p>
            <h2>Technical metadata</h2>
          </div>
          <dl className="fact-list fact-list--two-columns">
            <div>
              <dt>Type</dt>
              <dd>{label(asset.type)}</dd>
            </div>
            <div>
              <dt>MIME</dt>
              <dd className="mono">{asset.mimeType ?? '—'}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{size(asset.size)}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{asset.duration === null ? '—' : `${asset.duration}s`}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{date(asset.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{date(asset.updatedAt)}</dd>
            </div>
          </dl>
        </div>
        <aside className="panel fact-panel" aria-label="Media provenance">
          <div className="section-heading">
            <p className="eyebrow">Traceability</p>
            <h2>Provenance</h2>
          </div>
          <dl className="fact-list">
            <div>
              <dt>Source</dt>
              <dd>{asset.dataSource?.name ?? 'Manual ingestion'}</dd>
            </div>
            <div>
              <dt>Source code</dt>
              <dd className="mono">{asset.dataSource?.code ?? '—'}</dd>
            </div>
            <div>
              <dt>Source version</dt>
              <dd className="mono">{asset.dataSource?.version ?? '—'}</dd>
            </div>
            <div>
              <dt>Uploader ID</dt>
              <dd className="mono">{asset.uploadedById ?? '—'}</dd>
            </div>
            <div>
              <dt>Last operator ID</dt>
              <dd className="mono">{asset.updatedById ?? '—'}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="detail-grid detail-grid--balanced">
        <div className="panel">
          <div className="section-heading">
            <p className="eyebrow">Content graph</p>
            <h2>References</h2>
          </div>
          <p className="muted">
            {asset.usageCount} total content reference
            {asset.usageCount === 1 ? '' : 's'}.
          </p>
          {asset.usage.lessonExercises.length > 0 ? (
            <ul className="media-usage-list">
              {asset.usage.lessonExercises.map((exercise) => (
                <li key={exercise.id}>
                  <div>
                    <span className="mono">EX-{exercise.id}</span>
                    <strong>{exercise.prompt}</strong>
                  </div>
                  <Link
                    className="row-link"
                    href={`/admin/exercises/${exercise.id}`}
                  >
                    Open exercise {exercise.id} →
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No lesson exercises reference this asset.</p>
          )}
          {asset.usage.counts.otherContent > 0 ? (
            <p className="muted">
              {asset.usage.counts.otherContent} additional reference
              {asset.usage.counts.otherContent === 1 ? '' : 's'} belongs to
              other content types.
            </p>
          ) : null}
        </div>
        <div className="panel">
          <div className="section-heading">
            <p className="eyebrow">Safety workflow</p>
            <h2>Lifecycle operations</h2>
          </div>
          <MediaLifecycleActions
            mediaId={asset.id}
            lifecycle={asset.lifecycle}
            processingStatus={asset.processingStatus}
          />
        </div>
      </section>
    </article>
  );
}
