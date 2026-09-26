'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Operation = 'archive' | 'quarantine';

// Controls that unmount or become disabled would otherwise drop keyboard focus
// on <body> (E-02). After every render the pending target, once it is mounted
// and enabled, receives focus a single time. Each target is set together with
// a state or props change, so a render always follows.
type FocusTarget =
  | 'archive-trigger'
  | 'archive-cancel'
  | 'archive-confirm'
  | 'quarantine'
  | 'archived-notice';

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
  const focusTarget = useRef<FocusTarget | null>(null);
  const archiveTriggerRef = useRef<HTMLButtonElement>(null);
  const archiveCancelRef = useRef<HTMLButtonElement>(null);
  const archiveConfirmRef = useRef<HTMLButtonElement>(null);
  const quarantineRef = useRef<HTMLButtonElement>(null);
  const archivedNoticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (focusTarget.current === null) return;
    const element = {
      'archive-trigger': archiveTriggerRef,
      'archive-cancel': archiveCancelRef,
      'archive-confirm': archiveConfirmRef,
      quarantine: quarantineRef,
      'archived-notice': archivedNoticeRef,
    }[focusTarget.current].current;
    if (!element || ('disabled' in element && element.disabled)) return;
    element.focus();
    focusTarget.current = null;
  });

  function openArchiveConfirmation() {
    // Least destructive choice first, so a repeated Enter cannot archive.
    focusTarget.current = 'archive-cancel';
    setConfirmArchive(true);
  }

  function cancelArchive() {
    focusTarget.current = 'archive-trigger';
    setConfirmArchive(false);
  }

  async function mutate(operation: Operation) {
    focusTarget.current = null;
    setPending(operation);
    setError(null);
    try {
      const response = await fetch(`/api/admin/media/${mediaId}/${operation}`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        focusTarget.current =
          operation === 'archive' ? 'archive-confirm' : 'quarantine';
        setError(
          response.status === 409
            ? 'This asset changed before the operation completed. Refresh and review its current state.'
            : 'The media operation is temporarily unavailable. Try again.',
        );
        return;
      }
      // Archive removes every action; quarantine disables its own button, so
      // focus continues to the next control in the group.
      focusTarget.current =
        operation === 'archive' ? 'archived-notice' : 'archive-trigger';
      router.refresh();
    } catch {
      focusTarget.current =
        operation === 'archive' ? 'archive-confirm' : 'quarantine';
      setError('The media operation is temporarily unavailable. Try again.');
    } finally {
      setPending(null);
    }
  }

  if (lifecycle === 'archived') {
    return (
      <p className="muted" ref={archivedNoticeRef} tabIndex={-1}>
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
          ref={quarantineRef}
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
              ref={archiveConfirmRef}
              className="button button--danger"
              type="button"
              disabled={pending !== null}
              onClick={() => void mutate('archive')}
            >
              {pending === 'archive' ? 'Archiving…' : 'Confirm archive'}
            </button>
            <button
              ref={archiveCancelRef}
              className="button button--ghost"
              type="button"
              disabled={pending !== null}
              onClick={cancelArchive}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            ref={archiveTriggerRef}
            className="button button--danger"
            type="button"
            disabled={pending !== null}
            onClick={openArchiveConfirmation}
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
