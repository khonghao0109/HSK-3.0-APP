'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  ADMIN_ACTION,
  adminDateTime,
  questionConflictMessage,
  questionPublishReasonLabel,
  reviewDecisionLabel,
} from '@/features/admin-shell/admin-labels';

import type { QuestionDetail } from './question-contract';
import { questionActorLabel } from './question-values';

type Announcement =
  | { tone: 'ok'; text: string; reasons?: never }
  | {
      tone: 'error';
      text: string;
      reasons?: Array<{ code: string; field: string }>;
    };

const REVIEW_OPTIONS = [
  { value: 'approved', label: 'Duyệt' },
  { value: 'changes_requested', label: 'Yêu cầu sửa' },
  { value: 'rejected', label: 'Từ chối' },
] as const;

const REVIEW_REQUIRED = 'Vui lòng chọn quyết định đánh giá.';
const GENERIC_ERROR = 'Thao tác tạm thời không khả dụng. Hãy thử lại.';

type ReviewDecision = (typeof REVIEW_OPTIONS)[number]['value'];

/**
 * Khối thao tác trang chi tiết câu hỏi (TL-91): duyệt / xuất bản / lưu trữ.
 * Lưu trữ dùng dialog xác nhận native (focus phần tử đầu, Esc đóng, trả focus
 * về nút đã mở). Mọi kết quả hiện ở vùng live.
 */
export function QuestionWorkflow({
  question,
  sessionAdminId,
}: {
  question: QuestionDetail;
  sessionAdminId: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<
    'review' | 'publish' | 'archive' | null
  >(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [decision, setDecision] = useState<'' | ReviewDecision>('');
  const [note, setNote] = useState('');
  const [decisionError, setDecisionError] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const reviewSubmitRef = useRef<HTMLButtonElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const firstDecisionRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const latestRevision = question.revisions[0] ?? null;
  const latestReview = latestRevision?.reviews[0] ?? null;
  const archived = question.status === 'archived';
  const alreadyPublished =
    question.status === 'published' &&
    latestRevision !== null &&
    latestRevision.revision === question.version;
  const publishable =
    !archived &&
    latestRevision !== null &&
    latestReview?.decision === 'approved' &&
    !alreadyPublished;
  const publishBlockReason = archived
    ? 'Câu hỏi đã lưu trữ.'
    : latestRevision === null
      ? 'Chưa có bản sửa nào để xuất bản.'
      : !latestReview
        ? 'Bản sửa mới nhất đang chờ duyệt.'
        : latestReview.decision !== 'approved'
          ? `Đánh giá mới nhất: ${reviewDecisionLabel(latestReview.decision)} — cần bản sửa được duyệt.`
          : alreadyPublished
            ? 'Bản sửa mới nhất đã được xuất bản.'
            : null;
  const busy = pending !== null;

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (dialogOpen) {
      if (!element.open) element.showModal();
      cancelRef.current?.focus();
    } else if (element.open) {
      element.close();
    }
  }, [dialogOpen]);

  function closeDialog(): void {
    dialogRef.current?.close();
  }

  function onDialogClosed(): void {
    const opener = openerRef.current;
    openerRef.current = null;
    setDialogOpen(false);
    setPending(null);
    opener?.focus();
  }

  async function mutate(
    operation: 'review' | 'publish' | 'archive',
    url: string,
    body?: unknown,
  ): Promise<void> {
    setPending(operation);
    setAnnouncement(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        ...(body === undefined
          ? {}
          : {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
      });
      if (response.status === 401) {
        router.replace('/login?reason=session');
        return;
      }
      if (!response.ok) {
        const failure = await readFailure(response);
        if (failure.code === 'QUESTION_NOT_PUBLISHABLE' && failure.reasons) {
          setAnnouncement({
            tone: 'error',
            text: questionConflictMessage(failure.code),
            reasons: failure.reasons,
          });
        } else {
          setAnnouncement({
            tone: 'error',
            text: questionConflictMessage(failure.code),
          });
        }
        if (operation === 'archive') {
          setDialogError(questionConflictMessage(failure.code));
        }
        liveRef.current?.focus();
        return;
      }
      const text =
        operation === 'review'
          ? 'Đã gửi đánh giá.'
          : operation === 'publish'
            ? 'Đã xuất bản câu hỏi.'
            : 'Đã lưu trữ câu hỏi.';
      setAnnouncement({ tone: 'ok', text });
      if (operation === 'review') {
        setDecision('');
        setNote('');
      }
      if (operation === 'archive') setDialogOpen(false);
      router.refresh();
    } catch {
      setAnnouncement({ tone: 'error', text: GENERIC_ERROR });
    } finally {
      setPending(null);
    }
  }

  function submitReview(): void {
    if (!latestRevision) return;
    if (decision === '') {
      setDecisionError(true);
      firstDecisionRef.current?.focus();
      return;
    }
    void mutate(
      'review',
      `/api/admin/questions/${question.id}/revisions/${latestRevision.id}/reviews`,
      note.trim().length > 0 ? { decision, note } : { decision },
    );
  }

  return (
    <div className="qn-workflow">
      <div
        className={`qn-live${announcement ? ` qn-live--${announcement.tone}` : ''}`}
        ref={liveRef}
        tabIndex={-1}
      >
        {announcement ? (
          <>
            <p role="status" aria-live="polite">
              {announcement.text}
            </p>
            {announcement.reasons ? (
              <ul className="qn-reasons" role="alert">
                {announcement.reasons.map((reason) => (
                  <li key={`${reason.code}-${reason.field}`}>
                    {questionPublishReasonLabel(reason.code)}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </div>

      <dl className="adm-facts">
        <div>
          <dt>Bản sửa mới nhất</dt>
          <dd>
            {latestRevision
              ? `Bản sửa ${latestRevision.revision} · ${adminDateTime(latestRevision.createdAt)}`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Người viết</dt>
          <dd>
            {latestRevision
              ? questionActorLabel(latestRevision.author, sessionAdminId)
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Đánh giá gần nhất</dt>
          <dd>
            {latestReview
              ? `${reviewDecisionLabel(latestReview.decision)} · ${adminDateTime(latestReview.createdAt)}`
              : '—'}
          </dd>
        </div>
      </dl>

      {archived ? (
        <p className="adm-muted">Câu hỏi đã lưu trữ — không thể thay đổi.</p>
      ) : (
        <>
          {latestRevision ? (
            <fieldset className="adm-review-form" disabled={busy}>
              <legend>Đánh giá bản sửa {latestRevision.revision}</legend>
              <div className="adm-review-form__options" role="presentation">
                {REVIEW_OPTIONS.map((option, index) => (
                  <label key={option.value} className="adm-review-form__option">
                    <input
                      ref={index === 0 ? firstDecisionRef : undefined}
                      type="radio"
                      name="qn-review-decision"
                      value={option.value}
                      checked={decision === option.value}
                      aria-describedby={
                        decisionError ? 'qn-review-decision-error' : undefined
                      }
                      onChange={() => {
                        setDecision(option.value);
                        setDecisionError(false);
                      }}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              {decisionError ? (
                <p
                  className="adm-review-form__error"
                  id="qn-review-decision-error"
                  role="alert"
                >
                  {REVIEW_REQUIRED}
                </p>
              ) : null}
              <label className="adm-field">
                <span className="adm-field__label">Ghi chú đánh giá</span>
                <textarea
                  className="adm-input"
                  rows={3}
                  maxLength={2000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
              <button
                ref={reviewSubmitRef}
                className="adm-btn adm-btn--primary"
                type="button"
                disabled={busy}
                onClick={submitReview}
              >
                {pending === 'review' ? 'Đang gửi đánh giá…' : 'Gửi đánh giá'}
              </button>
            </fieldset>
          ) : null}

          <div className="adm-content-workflow__publish">
            <button
              ref={publishRef}
              className="adm-btn adm-btn--primary"
              type="button"
              disabled={busy || !publishable}
              onClick={() => {
                if (!latestRevision) return;
                void mutate(
                  'publish',
                  `/api/admin/questions/${question.id}/revisions/${latestRevision.id}/publish`,
                );
              }}
            >
              {pending === 'publish' ? 'Đang xuất bản…' : 'Xuất bản'}
            </button>
            {!publishable && publishBlockReason ? (
              <p className="adm-muted">{publishBlockReason}</p>
            ) : null}
          </div>

          <div className="adm-content-workflow__archive">
            <button
              className="adm-btn adm-btn--danger"
              type="button"
              disabled={busy}
              onClick={(event) => {
                openerRef.current = event.currentTarget;
                setDialogError(null);
                setDialogOpen(true);
              }}
            >
              {ADMIN_ACTION.archive}
            </button>
          </div>
        </>
      )}

      <dialog
        className="qn-dialog"
        ref={dialogRef}
        aria-labelledby="qn-archive-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClose={onDialogClosed}
      >
        {dialogOpen ? (
          <div className="qn-dialog__body">
            <h2 className="qn-dialog__title" id="qn-archive-title">
              Lưu trữ câu hỏi
            </h2>
            <p className="adm-muted">
              Lưu trữ không hoàn tác được; câu hỏi ẩn khỏi đề thi mới nhưng giữ
              lịch sử phiên bản.
            </p>
            {dialogError ? (
              <p className="adm-form-error" role="alert">
                {dialogError}
              </p>
            ) : null}
            <div className="qn-dialog__actions">
              <button
                ref={cancelRef}
                className="adm-btn adm-btn--ghost"
                type="button"
                disabled={busy}
                onClick={closeDialog}
              >
                {ADMIN_ACTION.cancel}
              </button>
              <button
                className="adm-btn adm-btn--danger"
                type="button"
                disabled={busy}
                onClick={() => {
                  setDialogError(null);
                  void mutate(
                    'archive',
                    `/api/admin/questions/${question.id}/archive`,
                  );
                }}
              >
                {pending === 'archive' ? 'Đang lưu trữ…' : 'Xác nhận lưu trữ'}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}

async function readFailure(response: Response): Promise<{
  code?: string;
  reasons?: Array<{ code: string; field: string }>;
}> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return {};
    const error = (body as { error?: unknown }).error;
    if (typeof error !== 'object' || error === null) return {};
    const record = error as {
      code?: unknown;
      details?: { reasons?: unknown };
    };
    const reasons = Array.isArray(record.details?.reasons)
      ? record.details.reasons.flatMap((item) => {
          if (typeof item !== 'object' || item === null) return [];
          const code = (item as { code?: unknown }).code;
          const field = (item as { field?: unknown }).field;
          return typeof code === 'string' && typeof field === 'string'
            ? [{ code, field }]
            : [];
        })
      : undefined;
    return {
      ...(typeof record.code === 'string' ? { code: record.code } : {}),
      ...(reasons && reasons.length > 0 ? { reasons } : {}),
    };
  } catch {
    return {};
  }
}
