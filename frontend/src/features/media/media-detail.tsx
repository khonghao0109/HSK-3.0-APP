import Link from 'next/link';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import {
  adminDateTime,
  lifecycleLabel,
  mediaTypeLabel,
  processingStatusLabel,
} from '@/features/admin-shell/admin-labels';

import type { AdminMediaDetail } from './media-contract';
import { MediaLifecycleActions } from './media-mutation';

function fileSize(value: number | null): string {
  if (value === null) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaDetail({ asset }: { asset: AdminMediaDetail }) {
  return (
    <article className="adm-page-stack">
      <header className="adm-hero">
        <div>
          <h1 className="adm-break-anywhere">
            {asset.filename ?? `Media ${asset.id}`}
          </h1>
          <p className="adm-hero__prompt">
            Chỉ hiển thị metadata vận hành. URL phân phối và thông tin đăng nhập
            storage được giới hạn.
          </p>
        </div>
        <div className="adm-hero__meta">
          <AdminBadge
            status={asset.processingStatus}
            label={processingStatusLabel(asset.processingStatus)}
          />
          <AdminBadge
            status={asset.lifecycle}
            label={lifecycleLabel(asset.lifecycle)}
          />
        </div>
      </header>

      <section className="adm-detail-grid" aria-label="Tổng quan media">
        <div className="adm-card adm-panel">
          <div className="adm-panel__head">
            <h2 className="adm-panel__title">Thông tin kỹ thuật</h2>
          </div>
          <dl className="adm-facts adm-facts--two-col">
            <div>
              <dt>Loại</dt>
              <dd>{mediaTypeLabel(asset.type)}</dd>
            </div>
            <div>
              <dt>Định dạng MIME</dt>
              <dd className="adm-mono">{asset.mimeType ?? '—'}</dd>
            </div>
            <div>
              <dt>Dung lượng</dt>
              <dd>{fileSize(asset.size)}</dd>
            </div>
            <div>
              <dt>Thời lượng</dt>
              <dd>{asset.duration === null ? '—' : `${asset.duration}s`}</dd>
            </div>
            <div>
              <dt>Ngày tạo</dt>
              <dd>{adminDateTime(asset.createdAt)}</dd>
            </div>
            <div>
              <dt>Ngày cập nhật</dt>
              <dd>{adminDateTime(asset.updatedAt)}</dd>
            </div>
          </dl>
        </div>
        <aside className="adm-card adm-panel" aria-label="Nguồn gốc media">
          <div className="adm-panel__head">
            <h2 className="adm-panel__title">Nguồn gốc</h2>
          </div>
          <dl className="adm-facts">
            <div>
              <dt>Nguồn</dt>
              <dd>{asset.dataSource?.name ?? 'Nhập thủ công'}</dd>
            </div>
            <div>
              <dt>Mã nguồn</dt>
              <dd className="adm-mono">{asset.dataSource?.code ?? '—'}</dd>
            </div>
            <div>
              <dt>Phiên bản nguồn</dt>
              <dd className="adm-mono">{asset.dataSource?.version ?? '—'}</dd>
            </div>
            <div>
              <dt>ID người tải lên</dt>
              <dd className="adm-mono">{asset.uploadedById ?? '—'}</dd>
            </div>
            <div>
              <dt>ID người thao tác gần nhất</dt>
              <dd className="adm-mono">{asset.updatedById ?? '—'}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="adm-detail-grid adm-detail-grid--balanced">
        <div className="adm-card adm-panel">
          <div className="adm-panel__head">
            <h2 className="adm-panel__title">Tham chiếu</h2>
          </div>
          <p className="adm-muted">
            {asset.usageCount} lượt tham chiếu trong nội dung.
          </p>
          {asset.usage.lessonExercises.length > 0 ? (
            <ul className="adm-media-usage">
              {asset.usage.lessonExercises.map((exercise) => (
                <li key={exercise.id}>
                  <div>
                    <span className="adm-mono">EX-{exercise.id}</span>{' '}
                    <strong>{exercise.prompt}</strong>
                  </div>
                  <Link
                    className="adm-link"
                    href={`/admin/exercises/${exercise.id}`}
                  >
                    Mở bài tập {exercise.id}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="adm-muted">
              Không có bài tập nào tham chiếu media này.
            </p>
          )}
          {asset.usage.counts.otherContent > 0 ? (
            <p className="adm-muted">
              {asset.usage.counts.otherContent} tham chiếu thuộc loại nội dung
              khác.
            </p>
          ) : null}
        </div>
        <div className="adm-card adm-panel">
          <div className="adm-panel__head">
            <h2 className="adm-panel__title">Thao tác vòng đời</h2>
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
