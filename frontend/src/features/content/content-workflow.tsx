'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import {
  ADMIN_ACTION,
  adminDateTime,
  contentConflictMessage,
  reviewDecisionLabel,
} from '@/features/admin-shell/admin-labels';

import {
  actorLabel,
  FORBIDDEN_MESSAGE,
  SESSION_LOGIN_PATH,
  workflowStep,
  type WorkflowRevision,
} from './content-values';

/**
 * Khối "Quy trình xuất bản" dùng chung cho trang lesson và topic (M5.1a).
 * Client thuần: không import module nào kéo Zod (client-bundle-guard); type
 * và helper dùng chung với server nằm ở content-values.ts.
 */
export type { WorkflowRevision } from './content-values';

type Operation = 'review' | 'publish' | 'archive';

type FocusTarget =
  | 'review-submit'
  | 'publish'
  | 'archive-trigger'
  | 'archive-cancel'
  | 'archive-confirm'
  | 'archived-notice'
  | 'first-decision';

const REVIEW_OPTIONS = [
  { value: 'approved', label: 'Duyệt' },
  { value: 'changes_requested', label: 'Yêu cầu sửa' },
  { value: 'rejected', label: 'Từ chối' },
] as const;

/** TL-16: 4 bước như lesson-editor.html; nhãn thẻ trạng thái theo STATES của mẫu. */
const FLOW_STEPS = [
  {
    label: 'Bản nháp',
    description: 'Đang chỉnh sửa nội dung',
    state: 'Bản nháp',
    key: 'draft',
  },
  {
    label: 'Gửi duyệt',
    description: 'Gửi nội dung để kiểm duyệt',
    state: 'Chờ duyệt',
    key: 'review',
  },
  {
    label: 'Đã duyệt',
    description: 'Nội dung đã được duyệt',
    state: 'Đã duyệt',
    key: 'approved',
  },
  {
    label: 'Đã xuất bản',
    description: 'Hiển thị cho người học',
    state: 'Đã xuất bản',
    key: 'published',
  },
] as const;

const REVIEW_DECISION_ERROR = 'Vui lòng chọn quyết định đánh giá.';

function bffPath(
  entity: 'lessons' | 'topics',
  entityId: number,
  tail: string,
): string {
  return `/api/admin/content/${entity}/${entityId}/${tail}`;
}

export function ContentWorkflow({
  entity,
  entityId,
  status,
  publishedAt = null,
  publishedById = null,
  latestRevision,
  live = null,
  snapshot = null,
  sessionAdminId,
}: {
  entity: 'lessons' | 'topics';
  entityId: number;
  status: string;
  publishedAt?: string | null;
  publishedById?: number | null;
  latestRevision: WorkflowRevision | null;
  /** S1: nội dung live + snapshot bản sửa mới nhất để nhận biết bước 4. */
  live?: unknown;
  snapshot?: unknown;
  sessionAdminId: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Operation | null>(null);
  // R12: giữ pending tới khi router.refresh() xong (transition), không mở
  // lại nút với props cũ.
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // TL-17: không chọn sẵn quyết định.
  const [decision, setDecision] = useState<string>('');
  const [decisionError, setDecisionError] = useState(false);
  const [note, setNote] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const focusTarget = useRef<FocusTarget | null>(null);
  const reviewSubmitRef = useRef<HTMLButtonElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);
  const archiveTriggerRef = useRef<HTMLButtonElement>(null);
  const archiveCancelRef = useRef<HTMLButtonElement>(null);
  const archiveConfirmRef = useRef<HTMLButtonElement>(null);
  const archivedNoticeRef = useRef<HTMLParagraphElement>(null);
  const firstDecisionRef = useRef<HTMLInputElement>(null);
  const busy = pending !== null || refreshing;

  useEffect(() => {
    if (focusTarget.current === null) return;
    const element = {
      'review-submit': reviewSubmitRef,
      publish: publishRef,
      'archive-trigger': archiveTriggerRef,
      'archive-cancel': archiveCancelRef,
      'archive-confirm': archiveConfirmRef,
      'archived-notice': archivedNoticeRef,
      'first-decision': firstDecisionRef,
    }[focusTarget.current].current;
    if (!element || ('disabled' in element && element.disabled)) return;
    element.focus();
    focusTarget.current = null;
  });

  const latestReview = latestRevision?.reviews[0] ?? null;
  // S1: bước 4 cả khi nội dung live vẫn trùng snapshot bản sửa mới nhất
  // (publish idempotent, publishedAt cũ hơn bản sửa).
  const flow = workflowStep(
    status,
    { at: publishedAt, byId: publishedById },
    latestRevision,
    { entity: entity === 'lessons' ? 'lesson' : 'topic', live, snapshot },
  );
  const currentStep = flow ? FLOW_STEPS[flow.step - 1] : null;
  const alreadyPublished = flow?.step === 4;
  const publishable =
    latestReview?.decision === 'approved' && !alreadyPublished;
  const publishBlockReason = alreadyPublished
    ? 'Bản sửa mới nhất đã được xuất bản.'
    : !latestRevision
      ? 'Chưa có bản sửa nào để xuất bản.'
      : !latestReview
        ? 'Bản sửa mới nhất đang chờ duyệt.'
        : latestReview.decision !== 'approved'
          ? `Đánh giá mới nhất: ${reviewDecisionLabel(latestReview.decision)} — cần bản sửa được duyệt.`
          : null;
  // Q89: tự duyệt được phép, cảnh báo tĩnh khi người viết bản sửa mới nhất
  // chính là admin đang đăng nhập.
  const selfAuthored =
    latestRevision !== null && latestRevision.authorId === sessionAdminId;

  async function mutate(
    operation: Operation,
    tail: string,
    body?: unknown,
  ): Promise<void> {
    focusTarget.current = null;
    setPending(operation);
    setError(null);
    let refreshed = false;
    try {
      const response = await fetch(bffPath(entity, entityId, tail), {
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
        refreshed = true;
        router.replace(SESSION_LOGIN_PATH);
        return;
      }
      if (!response.ok) {
        let code: string | undefined;
        try {
          const payload = (await response.json()) as {
            error?: { code?: unknown };
          };
          code =
            typeof payload.error?.code === 'string'
              ? payload.error.code
              : undefined;
        } catch {
          code = undefined;
        }
        focusTarget.current =
          operation === 'review'
            ? 'review-submit'
            : operation === 'publish'
              ? 'publish'
              : 'archive-confirm';
        setError(
          response.status === 409
            ? contentConflictMessage(code)
            : response.status === 403
              ? FORBIDDEN_MESSAGE
              : 'Thao tác tạm thời không khả dụng. Hãy thử lại.',
        );
        return;
      }
      // Archive gỡ mọi hành động → focus về thông báo; còn lại refresh làm
      // mới dữ liệu server và giữ focus ở nhóm hành động.
      focusTarget.current =
        operation === 'archive' ? 'archived-notice' : 'review-submit';
      refreshed = true;
      startRefresh(() => {
        router.refresh();
        if (operation === 'archive') setConfirmArchive(false);
        if (operation === 'review') {
          setNote('');
          setDecision('');
        }
        setPending(null);
      });
    } catch {
      focusTarget.current =
        operation === 'review'
          ? 'review-submit'
          : operation === 'publish'
            ? 'publish'
            : 'archive-confirm';
      setError('Thao tác tạm thời không khả dụng. Hãy thử lại.');
    } finally {
      if (!refreshed) setPending(null);
    }
  }

  function submitReview(revisionId: number) {
    if (decision === '') {
      setDecisionError(true);
      focusTarget.current = 'first-decision';
      firstDecisionRef.current?.focus();
      return;
    }
    void mutate(
      'review',
      `revisions/${revisionId}/reviews`,
      note ? { decision, note } : { decision },
    );
  }

  function openArchiveConfirmation() {
    focusTarget.current = 'archive-cancel';
    setConfirmArchive(true);
  }

  function cancelArchive() {
    focusTarget.current = 'archive-trigger';
    setConfirmArchive(false);
  }

  if (status === 'archived') {
    return (
      <p className="adm-muted" ref={archivedNoticeRef} tabIndex={-1}>
        Đã lưu trữ — không thể thay đổi.
      </p>
    );
  }

  return (
    <div className="adm-content-workflow">
      {flow && currentStep ? (
        <>
          <ol className="adm-flow" aria-label="Các bước xuất bản">
            {FLOW_STEPS.map((item, index) => {
              const stepNumber = index + 1;
              const current = stepNumber === flow.step;
              const done = stepNumber < flow.step;
              return (
                <li
                  key={item.key}
                  className={done ? 'adm-flow__step is-done' : 'adm-flow__step'}
                  aria-current={current ? 'step' : undefined}
                >
                  <span className="adm-flow__dot" aria-hidden="true">
                    {done ? '✓' : stepNumber}
                  </span>
                  <div>
                    <b>
                      {done ? <span className="sr-only">Đã xong: </span> : null}
                      {item.label}
                    </b>
                    <small>
                      {current && flow.note ? flow.note : item.description}
                    </small>
                  </div>
                </li>
              );
            })}
          </ol>
          <section
            className="adm-flow-current"
            aria-labelledby={`${entity}-${entityId}-flow-current`}
          >
            <h3 id={`${entity}-${entityId}-flow-current`}>
              Trạng thái hiện tại
            </h3>
            <p
              className="adm-flow-current__state"
              data-state={currentStep.key}
              aria-live="polite"
            >
              {currentStep.state}
            </p>
            <p className="adm-flow-current__meta">
              Cập nhật: {adminDateTime(flow.updatedAt)}
            </p>
            <p className="adm-flow-current__meta">
              Bởi: {actorLabel(flow.updatedById, sessionAdminId)}
            </p>
          </section>
        </>
      ) : null}
      <dl className="adm-facts">
        {/* S2: bỏ dòng "Trạng thái" — thẻ "Trạng thái hiện tại" phía trên và
            badge ở tiêu đề trang đã thể hiện trạng thái nội dung. */}
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
              ? actorLabel(latestRevision.authorId, sessionAdminId)
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Người duyệt gần nhất</dt>
          <dd>
            {latestReview
              ? `${actorLabel(latestReview.reviewerId, sessionAdminId)} · ${reviewDecisionLabel(latestReview.decision)}`
              : '—'}
          </dd>
        </div>
      </dl>

      {latestRevision ? (
        <fieldset className="adm-review-form" disabled={busy}>
          <legend>Đánh giá bản sửa {latestRevision.revision}</legend>
          <div className="adm-review-form__options" role="presentation">
            {REVIEW_OPTIONS.map((option, index) => (
              <label key={option.value} className="adm-review-form__option">
                <input
                  ref={index === 0 ? firstDecisionRef : undefined}
                  type="radio"
                  name="review-decision"
                  value={option.value}
                  checked={decision === option.value}
                  aria-describedby={
                    decisionError ? 'review-decision-error' : undefined
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
              id="review-decision-error"
              role="alert"
            >
              {REVIEW_DECISION_ERROR}
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
          {selfAuthored ? (
            <p className="adm-review-form__self-warning" role="note">
              Bạn là người viết bản sửa này. Tự duyệt được phép và sẽ được ghi
              lại.
            </p>
          ) : null}
          <button
            ref={reviewSubmitRef}
            className="adm-btn adm-btn--primary"
            type="button"
            disabled={busy}
            onClick={() => submitReview(latestRevision.id)}
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
          onClick={() =>
            void mutate(
              'publish',
              `revisions/${latestRevision?.id ?? 0}/publish`,
            )
          }
        >
          {pending === 'publish' ? 'Đang xuất bản…' : 'Xuất bản'}
        </button>
        {!publishable && publishBlockReason ? (
          <p className="adm-muted">{publishBlockReason}</p>
        ) : null}
      </div>

      <div className="adm-content-workflow__archive">
        {confirmArchive ? (
          <div
            className="adm-content-workflow__confirm"
            role="group"
            aria-label="Xác nhận lưu trữ nội dung"
          >
            <p className="adm-muted">
              Lưu trữ không hoàn tác được; nội dung ẩn khỏi học viên nhưng giữ
              lại lịch sử.
            </p>
            <button
              ref={archiveConfirmRef}
              className="adm-btn adm-btn--danger"
              type="button"
              disabled={busy}
              onClick={() => void mutate('archive', 'archive')}
            >
              {pending === 'archive' ? 'Đang lưu trữ…' : 'Xác nhận lưu trữ'}
            </button>
            <button
              ref={archiveCancelRef}
              className="adm-btn adm-btn--ghost"
              type="button"
              disabled={busy}
              onClick={cancelArchive}
            >
              {ADMIN_ACTION.cancel}
            </button>
          </div>
        ) : (
          <button
            ref={archiveTriggerRef}
            className="adm-btn adm-btn--danger"
            type="button"
            disabled={busy}
            onClick={openArchiveConfirmation}
          >
            {ADMIN_ACTION.archive}
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
