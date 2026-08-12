import Link from 'next/link';

import { StatusBadge } from '@/components/ui/status-badge';

import type { AdminMedia } from './media-contract';

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function fileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaTable({ media }: { media: AdminMedia[] }) {
  if (media.length === 0) {
    return (
      <div className="empty-state" role="status">
        <span className="empty-state__mark" aria-hidden="true">
          影
        </span>
        <h2>No media assets match</h2>
        <p>Adjust the filters or clear them to return to the full library.</p>
      </div>
    );
  }
  return (
    <>
      <div className="table-frame desktop-inventory">
        <table className="exercise-table media-table">
          <caption className="sr-only">
            Media assets in the content library
          </caption>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Asset</th>
              <th scope="col">Type</th>
              <th scope="col">Size / duration</th>
              <th scope="col">Processing</th>
              <th scope="col">Usage</th>
              <th scope="col">Lifecycle</th>
              <th scope="col">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {media.map((asset) => (
              <tr key={asset.id} aria-label={`Media ${asset.id}`}>
                <td>
                  <span className="mono">MD-{asset.id}</span>
                </td>
                <td>
                  <strong>{asset.filename ?? `Media asset ${asset.id}`}</strong>
                  <span className="table-subline mono">
                    {asset.mimeType ?? 'Unknown MIME'}
                  </span>
                </td>
                <td>{titleCase(asset.type)}</td>
                <td>
                  {fileSize(asset.size)}
                  <span className="table-subline">
                    {asset.duration === null ? '—' : `${asset.duration}s`}
                  </span>
                </td>
                <td>
                  <StatusBadge status={asset.processingStatus}>
                    {titleCase(asset.processingStatus)}
                  </StatusBadge>
                </td>
                <td className="mono">{asset.usageCount}</td>
                <td>
                  <StatusBadge status={asset.lifecycle}>
                    {titleCase(asset.lifecycle)}
                  </StatusBadge>
                </td>
                <td>
                  <Link className="row-link" href={`/admin/media/${asset.id}`}>
                    Open media {asset.id}
                    <span aria-hidden="true"> →</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol
        className="exercise-record-list media-record-list"
        aria-label="Media for narrow screens"
      >
        {media.map((asset) => (
          <li key={asset.id} aria-label={`Media ${asset.id}`}>
            <div className="exercise-record__header">
              <div>
                <span className="mono exercise-record__id">MD-{asset.id}</span>
                <strong>{asset.filename ?? `Media asset ${asset.id}`}</strong>
              </div>
              <StatusBadge status={asset.processingStatus}>
                {titleCase(asset.processingStatus)}
              </StatusBadge>
            </div>
            <dl className="exercise-record__facts">
              <div>
                <dt>Type</dt>
                <dd>{titleCase(asset.type)}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{fileSize(asset.size)}</dd>
              </div>
              <div>
                <dt>Usage</dt>
                <dd className="mono">{asset.usageCount}</dd>
              </div>
              <div>
                <dt>Lifecycle</dt>
                <dd>{titleCase(asset.lifecycle)}</dd>
              </div>
            </dl>
            <Link
              className="row-link exercise-record__action"
              href={`/admin/media/${asset.id}`}
            >
              Open media {asset.id}
              <span aria-hidden="true"> →</span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
