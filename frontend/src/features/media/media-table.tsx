import Link from 'next/link';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import { AdminIcon } from '@/features/admin-shell/admin-icon';
import {
  lifecycleLabel,
  mediaTypeLabel,
  processingStatusLabel,
} from '@/features/admin-shell/admin-labels';

import type { AdminMedia } from './media-contract';

function fileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaTable({ media }: { media: AdminMedia[] }) {
  if (media.length === 0) {
    return (
      <div className="adm-empty" role="status">
        <AdminIcon name="search" />
        <p>Không có media nào khớp bộ lọc.</p>
        <Link
          className="adm-btn adm-btn--outline adm-btn--sm"
          href="/admin/media"
        >
          Xoá lọc
        </Link>
      </div>
    );
  }
  return (
    <>
      <div className="adm-table-wrap adm-table-wrap--swap">
        <table className="adm-table">
          <caption className="sr-only">Danh sách media, trang hiện tại</caption>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Tệp</th>
              <th scope="col">Loại</th>
              <th scope="col">Dung lượng / Thời lượng</th>
              <th scope="col">Xử lý</th>
              <th scope="col">Lượt dùng</th>
              <th scope="col">Vòng đời</th>
              <th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {media.map((asset) => (
              <tr key={asset.id} aria-label={`Media ${asset.id}`}>
                <td>
                  <span className="adm-mono">MD-{asset.id}</span>
                </td>
                <td>
                  <strong className="adm-table__strong">
                    {asset.filename ?? `Media ${asset.id}`}
                  </strong>
                  <span className="adm-table__sub adm-mono">
                    {asset.mimeType ?? '—'}
                  </span>
                </td>
                <td>{mediaTypeLabel(asset.type)}</td>
                <td>
                  {fileSize(asset.size)}
                  <span className="adm-table__sub">
                    {asset.duration === null ? '—' : `${asset.duration}s`}
                  </span>
                </td>
                <td>
                  <AdminBadge
                    status={asset.processingStatus}
                    label={processingStatusLabel(asset.processingStatus)}
                  />
                </td>
                <td className="adm-mono">{asset.usageCount}</td>
                <td>
                  <AdminBadge
                    status={asset.lifecycle}
                    label={lifecycleLabel(asset.lifecycle)}
                  />
                </td>
                <td>
                  <Link className="adm-link" href={`/admin/media/${asset.id}`}>
                    Mở media {asset.id}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol
        className="adm-record-list adm-record-list--swap"
        aria-label="Danh sách media cho màn hẹp"
      >
        {media.map((asset) => (
          <li key={asset.id} aria-label={`Media ${asset.id}`}>
            <div className="adm-record-list__head">
              <div>
                <span className="adm-mono">MD-{asset.id}</span>{' '}
                <strong>{asset.filename ?? `Media ${asset.id}`}</strong>
              </div>
              <AdminBadge
                status={asset.processingStatus}
                label={processingStatusLabel(asset.processingStatus)}
              />
            </div>
            <dl className="adm-record-list__facts">
              <div>
                <dt>Loại</dt>
                <dd>{mediaTypeLabel(asset.type)}</dd>
              </div>
              <div>
                <dt>Dung lượng</dt>
                <dd>{fileSize(asset.size)}</dd>
              </div>
              <div>
                <dt>Lượt dùng</dt>
                <dd className="adm-mono">{asset.usageCount}</dd>
              </div>
              <div>
                <dt>Vòng đời</dt>
                <dd>{lifecycleLabel(asset.lifecycle)}</dd>
              </div>
            </dl>
            <Link className="adm-link" href={`/admin/media/${asset.id}`}>
              Mở media {asset.id}
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
