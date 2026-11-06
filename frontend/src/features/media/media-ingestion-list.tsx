'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { AdminBadge } from '@/features/admin-shell/admin-badge';
import {
  adminDateTime,
  mediaCleanupResultLabel,
  mediaIngestionFailureLabel,
  mediaIngestionStatusLabel,
  mediaIngestionStatusTone,
} from '@/features/admin-shell/admin-labels';

import type { AdminMediaIngestion } from './media-contract';
import { formatMediaBytes } from './media-format';

type CleanupOutcome = Parameters<typeof mediaCleanupResultLabel>[1];

// Statuses after which the list may have changed (TL-52).
function shouldRefresh(outcome: CleanupOutcome): boolean {
  if (outcome.kind !== 'error') return true;
  return (
    outcome.status === 409 ||
    (outcome.status === 503 && outcome.code === 'MEDIA_CLEANUP_REQUIRED')
  );
}

async function readOutcome(response: Response): Promise<CleanupOutcome> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  if (response.ok) {
    const data = record.data as Record<string, unknown> | undefined;
    if (data?.cleanupCompleted === true) return { kind: 'completed' };
    if (data?.settling === true) return { kind: 'settling' };
    return { kind: 'error', status: 503, code: null };
  }
  const error = record.error as Record<string, unknown> | undefined;
  return {
    kind: 'error',
    status: response.status,
    code: typeof error?.code === 'string' ? error.code : null,
  };
}

function IngestionFailure({ code }: { code: string }) {
  const label = mediaIngestionFailureLabel(code);
  return label ? (
    <>
      {label} <span className="adm-mono">{code}</span>
    </>
  ) : (
    <span className="adm-mono">{code}</span>
  );
}

export function MediaIngestionList({
  ingestions,
  total,
}: {
  ingestions: AdminMediaIngestion[];
  total: number;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // After router.refresh() the card may be gone; focus then falls back to the
  // list heading so keyboard focus never lands on <body> (media-mutation.tsx).
  // A refreshing outcome waits for the new list before moving focus.
  const focusTarget = useRef<{ id: number; afterRefresh: boolean } | null>(
    null,
  );
  const renderedList = useRef(ingestions);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const target = focusTarget.current;
    const listChanged = renderedList.current !== ingestions;
    renderedList.current = ingestions;
    if (target === null || pendingId !== null) return;
    if (target.afterRefresh && !listChanged) return;
    const button = buttons.current.get(target.id);
    if (button && !button.disabled) button.focus();
    else headingRef.current?.focus();
    focusTarget.current = null;
  });

  async function cleanup(id: number) {
    setPendingId(id);
    setAnnouncement('');
    let outcome: CleanupOutcome;
    try {
      const response = await fetch(
        `/api/admin/media/ingestions/${id}/cleanup`,
        { method: 'POST', credentials: 'same-origin' },
      );
      if (response.status === 401) {
        router.push('/login');
        return;
      }
      outcome = await readOutcome(response);
    } catch {
      outcome = { kind: 'error', status: 0, code: null };
    } finally {
      setPendingId(null);
    }
    const refreshes = shouldRefresh(outcome);
    focusTarget.current = { id, afterRefresh: refreshes };
    setAnnouncement(mediaCleanupResultLabel(id, outcome));
    if (refreshes) router.refresh();
  }

  return (
    <section
      className="adm-card adm-panel"
      aria-labelledby="ingestion-list-title"
    >
      <div className="adm-panel__head">
        <h2
          className="adm-panel__title"
          id="ingestion-list-title"
          ref={headingRef}
          tabIndex={-1}
        >
          Danh sách tải lên
        </h2>
      </div>
      <p className="adm-muted" aria-live="polite">
        {announcement}
      </p>
      {ingestions.length === 0 ? (
        total === 0 ? (
          <p>Không có bản ghi tải lên cần xử lý.</p>
        ) : (
          <p>
            Trang này không có bản ghi.{' '}
            <Link className="adm-link" href="/admin/media/ingestions?page=1">
              Về trang 1
            </Link>
          </p>
        )
      ) : (
        <ul className="adm-ingestion-list">
          {ingestions.map((ingestion) => (
            <li className="adm-ingestion" key={ingestion.id}>
              <div className="adm-ingestion__head">
                <strong className="adm-break-anywhere">
                  {ingestion.filename ?? `Tệp #${ingestion.id}`}
                </strong>
                <AdminBadge
                  tone={mediaIngestionStatusTone(ingestion.status)}
                  label={mediaIngestionStatusLabel(ingestion.status)}
                />
              </div>
              <dl className="adm-facts adm-facts--two-col">
                <div>
                  <dt>Mã bản ghi</dt>
                  <dd className="adm-mono">{ingestion.id}</dd>
                </div>
                <div>
                  <dt>Nguồn</dt>
                  <dd className="adm-mono">
                    {ingestion.dataSource.code} · {ingestion.dataSource.version}
                  </dd>
                </div>
                <div>
                  <dt>Kích thước</dt>
                  <dd>{formatMediaBytes(ingestion.size)}</dd>
                </div>
                <div>
                  <dt>Mã lỗi</dt>
                  <dd>
                    {ingestion.failureCode ? (
                      <IngestionFailure code={ingestion.failureCode} />
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                {ingestion.status === 'cleanup_required' ? (
                  <div>
                    <dt>Cần dọn từ</dt>
                    <dd>{adminDateTime(ingestion.cleanupRequiredAt)}</dd>
                  </div>
                ) : (
                  <div>
                    <dt>Bắt đầu xử lý</dt>
                    <dd>{adminDateTime(ingestion.processingStartedAt)}</dd>
                  </div>
                )}
                <div>
                  <dt>Số lần dọn</dt>
                  <dd>{ingestion.cleanupAttempts}</dd>
                </div>
              </dl>
              {ingestion.cleanupAvailable ? (
                <button
                  ref={(element) => {
                    if (element) buttons.current.set(ingestion.id, element);
                    else buttons.current.delete(ingestion.id);
                  }}
                  className="adm-btn adm-btn--outline"
                  type="button"
                  disabled={pendingId !== null}
                  onClick={() => void cleanup(ingestion.id)}
                >
                  {pendingId === ingestion.id ? 'Đang dọn dẹp…' : 'Dọn dẹp'}
                </button>
              ) : (
                <p className="adm-muted">
                  Liên hệ vận hành để đối soát thủ công.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
