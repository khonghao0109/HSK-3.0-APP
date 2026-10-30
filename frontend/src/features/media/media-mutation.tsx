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
            ? 'Nội dung đã thay đổi trước khi thao tác hoàn tất. Hãy tải lại và kiểm tra trạng thái hiện tại.'
            : 'Thao tác media tạm thời không khả dụng. Hãy thử lại.',
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
      setError('Thao tác media tạm thời không khả dụng. Hãy thử lại.');
    } finally {
      setPending(null);
    }
  }

  if (lifecycle === 'archived') {
    return (
      <p className="adm-muted" ref={archivedNoticeRef} tabIndex={-1}>
        Media đã lưu trữ được giữ lại cho lịch sử, không thể thao tác thêm.
      </p>
    );
  }
  return (
    <div className="adm-media-actions">
      <p>
        Cách ly ẩn ngay nội dung không an toàn. Lưu trữ rút media khỏi sử dụng
        nhưng giữ lại tham chiếu và lịch sử.
      </p>
      <div className="adm-media-actions__buttons">
        <button
          ref={quarantineRef}
          className="adm-btn adm-btn--outline"
          type="button"
          disabled={pending !== null || processingStatus === 'quarantined'}
          onClick={() => void mutate('quarantine')}
        >
          {pending === 'quarantine' ? 'Đang cách ly…' : 'Cách ly'}
        </button>
        {confirmArchive ? (
          <div
            className="adm-media-actions__confirmation"
            role="group"
            aria-label="Xác nhận lưu trữ media"
          >
            <button
              ref={archiveConfirmRef}
              className="adm-btn adm-btn--danger"
              type="button"
              disabled={pending !== null}
              onClick={() => void mutate('archive')}
            >
              {pending === 'archive' ? 'Đang lưu trữ…' : 'Xác nhận lưu trữ'}
            </button>
            <button
              ref={archiveCancelRef}
              className="adm-btn adm-btn--ghost"
              type="button"
              disabled={pending !== null}
              onClick={cancelArchive}
            >
              Huỷ
            </button>
          </div>
        ) : (
          <button
            ref={archiveTriggerRef}
            className="adm-btn adm-btn--danger"
            type="button"
            disabled={pending !== null}
            onClick={openArchiveConfirmation}
          >
            Lưu trữ
          </button>
        )}
      </div>
      {error ? (
        <p className="adm-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
