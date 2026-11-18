'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { levelLabel } from '@/features/admin-shell/admin-labels';

import type { TestLevelOption, TestPublishReason } from './test-values';
import {
  testPublishReasonLabel,
  testPublishReasonLocation,
} from './test-values';

/**
 * Dialog native của builder (TL-108): focus vào phần tử đầu khi mở, Esc đóng,
 * trả focus về nút đã mở. Dùng chung hook để ba dialog có cùng hành vi.
 */
function useNativeDialog(
  open: boolean,
  dialogRef: RefObject<HTMLDialogElement | null>,
  firstFocusRef: RefObject<HTMLElement | null>,
  openerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      firstFocusRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, dialogRef, firstFocusRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClose = () => openerRef.current?.focus();
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, [dialogRef, openerRef]);
}

function DialogShell({
  dialogRef,
  labelId,
  className,
  busy,
  onCancel,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  labelId: string;
  className: string;
  busy: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <dialog
      className={className}
      ref={dialogRef}
      aria-labelledby={labelId}
      onCancel={(event) => {
        event.preventDefault();
        // C8: đang xử lý thì Esc không đóng dialog.
        if (!busy) onCancel();
      }}
    >
      {children}
    </dialog>
  );
}

export type MetaFormValue = {
  title: string;
  levelId: number;
  duration: number;
  passScore: string;
  instruction: string;
};

export function BuilderMetaDialog({
  open,
  value,
  levels,
  busy,
  errors,
  openerRef,
  onClose,
  onSave,
}: {
  open: boolean;
  value: MetaFormValue;
  levels: TestLevelOption[];
  busy: boolean;
  errors: Record<string, string>;
  openerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSave: (value: MetaFormValue) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState<MetaFormValue>(value);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(value);
  }
  useNativeDialog(open, dialogRef, titleRef, openerRef);

  return (
    <DialogShell
      dialogRef={dialogRef}
      labelId={titleId}
      className="tst-dialog"
      busy={busy}
      onCancel={onClose}
    >
      <div className="tst-dialog__body">
        <h2 className="tst-dialog__title" id={titleId}>
          Sửa thông tin đề
        </h2>
        {errors._form ? (
          <p className="adm-form-error" role="alert">
            {errors._form}
          </p>
        ) : null}
        <label className="tst-field">
          <span>Tên đề</span>
          <input
            ref={titleRef}
            className="adm-input"
            value={draft.title}
            maxLength={200}
            onChange={(event) =>
              setDraft({ ...draft, title: event.target.value })
            }
          />
          {errors.title ? (
            <span className="adm-form-error" role="alert">
              {errors.title}
            </span>
          ) : null}
        </label>
        <label className="tst-field">
          <span>Cấp HSK</span>
          <select
            className="adm-input"
            value={String(draft.levelId)}
            onChange={(event) =>
              setDraft({ ...draft, levelId: Number(event.target.value) })
            }
          >
            {levels.map((level) => (
              <option value={level.id} key={level.id}>
                {levelLabel(level.code)}
              </option>
            ))}
          </select>
          {errors.levelId ? (
            <span className="adm-form-error" role="alert">
              {errors.levelId}
            </span>
          ) : null}
        </label>
        <label className="tst-field">
          <span>Thời gian (phút)</span>
          <input
            className="adm-input"
            type="number"
            min={1}
            max={300}
            value={String(draft.duration)}
            onChange={(event) =>
              setDraft({ ...draft, duration: Number(event.target.value) })
            }
          />
          {errors.duration ? (
            <span className="adm-form-error" role="alert">
              {errors.duration}
            </span>
          ) : null}
        </label>
        <label className="tst-field">
          <span>Điểm đỗ (không bắt buộc)</span>
          <input
            className="adm-input"
            type="number"
            min={0}
            value={draft.passScore}
            onChange={(event) =>
              setDraft({ ...draft, passScore: event.target.value })
            }
          />
          {errors.passScore ? (
            <span className="adm-form-error" role="alert">
              {errors.passScore}
            </span>
          ) : null}
        </label>
        <label className="tst-field">
          <span>Hướng dẫn</span>
          <textarea
            className="adm-input tst-textarea"
            value={draft.instruction}
            maxLength={2000}
            rows={3}
            onChange={(event) =>
              setDraft({ ...draft, instruction: event.target.value })
            }
          />
        </label>
        <div className="tst-dialog__actions">
          <button
            className="adm-btn adm-btn--ghost"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Hủy
          </button>
          <button
            className="adm-btn adm-btn--primary"
            type="button"
            disabled={busy}
            onClick={() => onSave(draft)}
          >
            {busy ? 'Đang lưu…' : 'Lưu thông tin'}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

export function BuilderAddSectionDialog({
  open,
  busy,
  count,
  maxSections,
  openerRef,
  onClose,
  onAdd,
}: {
  open: boolean;
  busy: boolean;
  count: number;
  maxSections: number;
  openerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onAdd: (skill: string, title: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [skill, setSkill] = useState('reading');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSkill('reading');
      setTitle('');
      setError(null);
    }
  }
  useNativeDialog(open, dialogRef, titleRef, openerRef);

  return (
    <DialogShell
      dialogRef={dialogRef}
      labelId={titleId}
      className="tst-dialog"
      busy={busy}
      onCancel={onClose}
    >
      <div className="tst-dialog__body">
        <h2 className="tst-dialog__title" id={titleId}>
          Thêm phần
        </h2>
        <p className="adm-muted">{`Đề đang có ${String(count)}/${String(maxSections)} phần.`}</p>
        <label className="tst-field">
          <span>Kỹ năng</span>
          <select
            className="adm-input"
            value={skill}
            onChange={(event) => setSkill(event.target.value)}
          >
            <option value="listening">Nghe hiểu</option>
            <option value="reading">Đọc hiểu</option>
            <option value="writing">Viết</option>
            <option value="speaking">Nói</option>
          </select>
        </label>
        <label className="tst-field">
          <span>Tên phần</span>
          <input
            ref={titleRef}
            className="adm-input"
            value={title}
            maxLength={100}
            placeholder="Ví dụ: Phần 1: Nghe & Chọn hình"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {error ? (
          <p className="adm-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="tst-dialog__actions">
          <button
            className="adm-btn adm-btn--ghost"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Hủy
          </button>
          <button
            className="adm-btn adm-btn--primary"
            type="button"
            disabled={busy}
            onClick={() => {
              const trimmed = title.trim();
              if (!trimmed) {
                setError('Vui lòng nhập tên phần.');
                return;
              }
              onAdd(skill, trimmed);
            }}
          >
            {busy ? 'Đang thêm…' : 'Thêm phần'}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

export type PublishFailure = {
  reasons: TestPublishReason[];
  concurrent: boolean;
};

export function BuilderConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  busy,
  openerRef,
  failure,
  onReload,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  busy: boolean;
  openerRef: RefObject<HTMLElement | null>;
  failure?: PublishFailure | null;
  onReload?: () => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useNativeDialog(open, dialogRef, cancelRef, openerRef);

  return (
    <DialogShell
      dialogRef={dialogRef}
      labelId={titleId}
      className="tst-dialog"
      busy={busy}
      onCancel={onClose}
    >
      <div className="tst-dialog__body">
        <h2 className="tst-dialog__title" id={titleId}>
          {title}
        </h2>
        <p className="adm-muted">{description}</p>
        {failure && failure.concurrent ? (
          <div className="tst-dialog__failure" role="alert">
            <p>Đề vừa được người khác sửa. Tải lại để xem bản mới nhất.</p>
            <button
              className="adm-btn adm-btn--outline"
              type="button"
              onClick={onReload}
            >
              Tải lại
            </button>
          </div>
        ) : null}
        {failure && !failure.concurrent && failure.reasons.length === 0 ? (
          <p className="adm-form-error" role="alert">
            Không xuất bản được đề thi. Hãy thử lại.
          </p>
        ) : null}
        {failure && failure.reasons.length > 0 ? (
          <div className="tst-dialog__failure" role="alert">
            <p>Đề chưa đủ điều kiện xuất bản:</p>
            <ul className="tst-reasons">
              {failure.reasons.map((reason, index) => {
                const location = testPublishReasonLocation(reason.field);
                // U8: nội dung lý do và vị trí nối bằng " — ".
                return (
                  <li key={`${reason.code}-${reason.field}-${String(index)}`}>
                    {`${testPublishReasonLabel(reason.code)}${
                      location ? ` — ${location}` : ''
                    }`}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        <div className="tst-dialog__actions">
          <button
            ref={cancelRef}
            className="adm-btn adm-btn--ghost"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Đóng
          </button>
          <button
            className={
              tone === 'danger'
                ? 'adm-btn adm-btn--danger'
                : 'adm-btn adm-btn--primary'
            }
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Đang xử lý…' : confirmLabel}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
