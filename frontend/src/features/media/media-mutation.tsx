'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Operation = 'archive' | 'quarantine';

export function MediaLifecycleActions({
  mediaId,
  lifecycle,
  processingStatus,
}: {
  mediaId: number;
  lifecycle: 'active' | 'archived';
  processingStatus: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function mutate(operation: Operation) {
    setPending(operation);
    setError(null);
    try {
      const response = await fetch(`/api/admin/media/${mediaId}/${operation}`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        setError(
          response.status === 409
            ? 'This asset changed before the operation completed. Refresh and review its current state.'
            : 'The media operation is temporarily unavailable. Try again.',
        );
        return;
      }
      router.refresh();
    } catch {
      setError('The media operation is temporarily unavailable. Try again.');
    } finally {
      setPending(null);
    }
  }

  if (lifecycle === 'archived') {
    return (
      <p className="muted">
        Archived assets are retained for history and cannot be modified.
      </p>
    );
  }
  return (
    <div className="media-actions">
      <p>
        Quarantine immediately hides unsafe content. Archive retires the asset
        while retaining references and history.
      </p>
      <div className="media-actions__buttons">
        <button
          className="button button--ghost"
          type="button"
          disabled={pending !== null || processingStatus === 'quarantined'}
          onClick={() => void mutate('quarantine')}
        >
          {pending === 'quarantine' ? 'Quarantining…' : 'Quarantine asset'}
        </button>
        {confirmArchive ? (
          <div
            className="media-actions__confirmation"
            role="group"
            aria-label="Confirm archive asset"
          >
            <button
              className="button button--danger"
              type="button"
              disabled={pending !== null}
              onClick={() => void mutate('archive')}
            >
              {pending === 'archive' ? 'Archiving…' : 'Confirm archive'}
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={pending !== null}
              onClick={() => setConfirmArchive(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="button button--danger"
            type="button"
            disabled={pending !== null}
            onClick={() => setConfirmArchive(true)}
          >
            Archive asset
          </button>
        )}
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
