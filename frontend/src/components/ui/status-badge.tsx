import type { ReactNode } from 'react';

export function StatusBadge({
  status,
  children,
}: {
  status: string;
  children?: ReactNode;
}) {
  return (
    <span className="status-badge" data-status={status}>
      <span aria-hidden="true" className="status-badge__dot" />
      {children ?? status.replaceAll('_', ' ')}
    </span>
  );
}
