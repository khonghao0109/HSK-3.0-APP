'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { AdminIcon } from '@/features/admin-shell/admin-icon';
import { adminDateTime } from '@/features/admin-shell/admin-labels';

import {
  ADMIN_USER_STATUSES,
  SUSPEND_REASON_MAX_LENGTH,
  adminUserErrorMessage,
  adminUserRoleLabel,
  adminUserStatusLabel,
  adminUserStatusTone,
  type AdminUserRow,
} from './admin-users-values';

type DialogState =
  | { kind: 'role'; user: AdminUserRow }
  | { kind: 'suspend'; user: AdminUserRow }
  | { kind: 'unsuspend'; user: AdminUserRow }
  | { kind: 'deletion'; user: AdminUserRow };

type Announcement = { tone: 'ok' | 'error'; text: string };

type MutationResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; code: string | null };

/** M1.7d: copy của dialog xoá; PO chốt Q203–Q208. */
export const DELETION_DIALOG_TITLE = 'Xoá tài khoản người dưới 16 tuổi?';
export const DELETION_CONFIRM_LABEL = 'Xoá tài khoản';
export const DELETION_VERIFY_LABEL = 'Tôi đã xác minh người dùng dưới 16 tuổi.';
export const DELETION_ACTIVE_COPY =
  'Tài khoản bị khoá ngay và mọi phiên đăng nhập bị thu hồi. Sau 7 ngày, ' +
  'dữ liệu cá nhân được ẩn danh. Người dùng nhận email thông báo kèm kênh ' +
  'liên hệ ở trang Quyền riêng tư. Quản trị viên không huỷ được yêu cầu này.';
export const DELETION_PENDING_COPY =
  'Tài khoản đang chờ xoá theo yêu cầu của người dùng. Xác nhận sẽ ghi lý do ' +
  'dưới 16 tuổi; ngày xoá giữ nguyên và người dùng không còn tự huỷ được bằng ' +
  'cách đăng nhập. Quản trị viên không huỷ được yêu cầu này.';

function userLabel(user: AdminUserRow): string {
  return user.name ?? user.email;
}

async function mutate(
  path: string,
  method: 'PATCH' | 'POST',
  body?: unknown,
): Promise<MutationResult> {
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
    if (response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { ok: true, body };
    }
    let code: string | null = null;
    try {
      const parsed: unknown = await response.json();
      const error =
        typeof parsed === 'object' && parsed !== null
          ? (parsed as { error?: unknown }).error
          : null;
      const candidate =
        typeof error === 'object' && error !== null
          ? (error as { code?: unknown }).code
          : null;
      code = typeof candidate === 'string' ? candidate : null;
    } catch {
      code = null;
    }
    return { ok: false, status: response.status, code };
  } catch {
    return { ok: false, status: 0, code: null };
  }
}

/** Lý do không thao tác được, hiện ngay dưới nút (đọc được, không chỉ tooltip). */
function disabledReason(
  user: AdminUserRow,
  currentUserId: number | null,
): string | null {
  if (user.id === currentUserId) return 'Không thể thao tác trên chính mình.';
  if (user.status === 'deletion_pending') {
    return 'Tài khoản đang chờ xoá, không thể thao tác.';
  }
  return null;
}

/**
 * M1.7d: nút "Xoá tài khoản" mở cho cả 3 trạng thái của contract (Q206: chỉ
 * admin không huỷ được, không có nút huỷ); chặn tự xoá mình ở UI và để backend
 * trả lỗi "admin cuối cùng".
 */
function deletionDisabledReason(
  user: AdminUserRow,
  currentUserId: number | null,
): string | null {
  if (user.id === currentUserId) return 'Không thể thao tác trên chính mình.';
  if (!ADMIN_USER_STATUSES.some((status) => status === user.status)) {
    return 'Trạng thái tài khoản không cho phép xoá.';
  }
  return null;
}

/** Đọc `data.scheduledAt` từ body BFF; shape lạ trả null để fail-closed. */
function readScheduledAt(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as { scheduledAt?: unknown }).scheduledAt;
  return typeof value === 'string' ? value : null;
}

export function AdminUsersTable({
  users,
  currentUserId,
}: {
  users: AdminUserRow[];
  currentUserId: number | null;
}) {
  const router = useRouter();
  const listId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const verifyRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [roleDraft, setRoleDraft] = useState<'user' | 'admin'>('user');
  const [reasonDraft, setReasonDraft] = useState('');
  const [deletionVerified, setDeletionVerified] = useState(false);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (!dialog) {
      if (element.open) element.close();
      return;
    }
    if (!element.open) element.showModal();
    // Focus phần tử đầu tiên của nội dung (TL-72), sau khi dialog đã mở.
    if (dialog.kind === 'role') selectRef.current?.focus();
    else if (dialog.kind === 'suspend') reasonRef.current?.focus();
    else if (dialog.kind === 'deletion') verifyRef.current?.focus();
    else confirmRef.current?.focus();
  }, [dialog]);

  function openDialog(
    next: DialogState,
    opener: HTMLButtonElement | null,
  ): void {
    openerRef.current = opener;
    setDialogError(null);
    setReasonDraft('');
    setDeletionVerified(false);
    setRoleDraft(next.user.role);
    setDialog(next);
  }

  function closeDialog(): void {
    dialogRef.current?.close();
  }

  function onDialogClosed(): void {
    const opener = openerRef.current;
    openerRef.current = null;
    setDialog(null);
    setPending(false);
    setDeletionVerified(false);
    // TL-72: đóng xong focus quay về đúng nút đã mở dialog.
    opener?.focus();
  }

  async function confirm(): Promise<void> {
    if (!dialog || pending) return;
    const { kind, user } = dialog;
    if (kind === 'role' && roleDraft === user.role) return;
    if (kind === 'suspend' && reasonDraft.trim().length === 0) return;
    if (kind === 'deletion' && !deletionVerified) return;

    setPending(true);
    setDialogError(null);
    setAnnouncement(null);

    const result =
      kind === 'role'
        ? await mutate(`/api/admin/users/${user.id}/role`, 'PATCH', {
            role: roleDraft,
          })
        : kind === 'suspend'
          ? await mutate(`/api/admin/users/${user.id}/suspend`, 'POST', {
              reason: reasonDraft,
            })
          : kind === 'deletion'
            ? await mutate(
                `/api/admin/users/${user.id}/deletion-request`,
                'POST',
                { reason: 'under_age' },
              )
            : await mutate(`/api/admin/users/${user.id}/unsuspend`, 'POST');

    if (!result.ok) {
      setPending(false);
      if (result.status === 401) {
        router.push('/login');
        return;
      }
      const text = adminUserErrorMessage(result.status, result.code);
      setDialogError(text);
      setAnnouncement({ tone: 'error', text });
      return;
    }

    const label = userLabel(user);
    if (kind === 'deletion') {
      const scheduledAt = readScheduledAt(result.body);
      if (scheduledAt === null) {
        // Backend đã 201 nhưng BFF trả thiếu scheduledAt: fail-closed, không
        // báo thành công và giữ dialog để người dùng thử lại.
        setPending(false);
        const text = adminUserErrorMessage(0, null);
        setDialogError(text);
        setAnnouncement({ tone: 'error', text });
        return;
      }
      closeDialog();
      setAnnouncement({
        tone: 'ok',
        text: `Đã lên lịch xoá tài khoản ${label} vào ${adminDateTime(scheduledAt)}.`,
      });
      router.refresh();
      return;
    }

    const text =
      kind === 'role'
        ? `Đã đổi vai trò của ${label} thành ${adminUserRoleLabel(roleDraft)}.`
        : kind === 'suspend'
          ? `Đã khoá tài khoản ${label}.`
          : `Đã mở khoá tài khoản ${label}.`;
    closeDialog();
    setAnnouncement({ tone: 'ok', text });
    router.refresh();
  }

  function renderActions(user: AdminUserRow) {
    const reason = disabledReason(user, currentUserId);
    const disabled = reason !== null || pending;
    const reasonId = `${listId}-${user.id}-reason`;
    const deletionReason = deletionDisabledReason(user, currentUserId);
    const deletionReasonId = `${listId}-${user.id}-deletion-reason`;
    const deletionDescribedBy =
      deletionReason === null
        ? undefined
        : deletionReason === reason
          ? reasonId
          : deletionReasonId;
    return (
      <div className="uo-actions">
        <button
          className="adm-btn adm-btn--outline adm-btn--sm"
          type="button"
          disabled={disabled}
          aria-describedby={reason === null ? undefined : reasonId}
          aria-label={`Đổi vai trò của ${userLabel(user)}`}
          onClick={(event) =>
            openDialog({ kind: 'role', user }, event.currentTarget)
          }
        >
          Đổi vai trò
        </button>
        {user.status === 'suspended' ? (
          <button
            className="adm-btn adm-btn--outline adm-btn--sm"
            type="button"
            disabled={disabled}
            aria-describedby={reason === null ? undefined : reasonId}
            aria-label={`Mở khoá tài khoản ${userLabel(user)}`}
            onClick={(event) =>
              openDialog({ kind: 'unsuspend', user }, event.currentTarget)
            }
          >
            Mở khoá
          </button>
        ) : (
          <button
            className="adm-btn adm-btn--outline adm-btn--sm"
            type="button"
            disabled={disabled}
            aria-describedby={reason === null ? undefined : reasonId}
            aria-label={`Khoá tài khoản ${userLabel(user)}`}
            onClick={(event) =>
              openDialog({ kind: 'suspend', user }, event.currentTarget)
            }
          >
            Khoá
          </button>
        )}
        <button
          className="adm-btn adm-btn--danger adm-btn--sm"
          type="button"
          disabled={deletionReason !== null || pending}
          aria-describedby={deletionDescribedBy}
          aria-label={`Xoá tài khoản ${userLabel(user)}`}
          onClick={(event) =>
            openDialog({ kind: 'deletion', user }, event.currentTarget)
          }
        >
          Xoá tài khoản
        </button>
        {reason !== null ? (
          <p className="uo-action-note" id={reasonId}>
            {reason}
          </p>
        ) : null}
        {deletionReason !== null && deletionReason !== reason ? (
          <p className="uo-action-note" id={deletionReasonId}>
            {deletionReason}
          </p>
        ) : null}
      </div>
    );
  }

  /**
   * R2: mỗi cột là một `<td>` — 6 ô cho 6 `<th scope="col">`. Trả fragment
   * của `<td>` để React đặt thẳng vào `<tr>`, không có `<div>`/`<span>` trần
   * trong hàng bảng (trước đây làm bảng vỡ ở desktop).
   * R4: cột "Người dùng" chỉ có tên; email chỉ ở cột Email như mockup.
   */
  function renderUserCells(user: AdminUserRow) {
    return (
      <>
        <td className="uo-user-name">
          <strong>{user.name ?? 'Chưa đặt tên'}</strong>
        </td>
        <td className="uo-nowrap">{adminUserRoleLabel(user.role)}</td>
        <td className="uo-email-cell">{user.email}</td>
        <td>
          <span
            className={`uo-status uo-status--${adminUserStatusTone(user.status)}`}
          >
            {adminUserStatusLabel(user.status)}
          </span>
        </td>
        <td>{adminDateTime(user.lastLoginAt)}</td>
      </>
    );
  }

  return (
    <section aria-labelledby="uo-list-title">
      <h2 className="sr-only" id="uo-list-title">
        Danh sách người dùng
      </h2>
      <p
        className={`uo-live${announcement ? ` uo-live--${announcement.tone}` : ''}`}
        role="status"
        aria-live="polite"
      >
        {announcement ? announcement.text : null}
      </p>

      <div className="adm-table-wrap adm-table-wrap--swap">
        <table className="adm-table uo-table">
          <caption className="sr-only">
            Danh sách người dùng, trang hiện tại
          </caption>
          <thead>
            <tr>
              <th scope="col">Người dùng</th>
              <th scope="col">Vai trò</th>
              <th scope="col">Email</th>
              <th scope="col">Trạng thái</th>
              <th scope="col">Lần đăng nhập cuối</th>
              <th scope="col">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={6}>Không có người dùng nào khớp bộ lọc.</td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id}>
                  {renderUserCells(user)}
                  <td>{renderActions(user)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ol
        className="adm-record-list adm-record-list--swap uo-record-list"
        aria-label="Danh sách người dùng cho màn hẹp"
      >
        {users.length === 0 ? (
          <li>Không có người dùng nào khớp bộ lọc.</li>
        ) : null}
        {users.map((user) => (
          <li key={user.id}>
            <div className="adm-record-list__head">
              <div className="uo-user-cell">
                <strong>{user.name ?? 'Chưa đặt tên'}</strong>
                <span className="adm-muted uo-email">{user.email}</span>
              </div>
              <span
                className={`uo-status uo-status--${adminUserStatusTone(user.status)}`}
              >
                {adminUserStatusLabel(user.status)}
              </span>
            </div>
            <dl className="adm-record-list__facts">
              <div>
                <dt>Vai trò</dt>
                <dd>{adminUserRoleLabel(user.role)}</dd>
              </div>
              <div>
                <dt>Lần đăng nhập cuối</dt>
                <dd>{adminDateTime(user.lastLoginAt)}</dd>
              </div>
            </dl>
            {renderActions(user)}
          </li>
        ))}
      </ol>

      <dialog
        className="uo-dialog"
        ref={dialogRef}
        aria-labelledby="uo-dialog-title"
        onCancel={(event) => {
          // Esc đóng dialog; việc trả focus nằm trong sự kiện close.
          event.preventDefault();
          closeDialog();
        }}
        onClose={onDialogClosed}
      >
        {dialog ? (
          <div className="uo-dialog__body">
            <h2 className="uo-dialog__title" id="uo-dialog-title">
              {dialog.kind === 'role'
                ? 'Đổi vai trò'
                : dialog.kind === 'suspend'
                  ? 'Khoá tài khoản'
                  : dialog.kind === 'deletion'
                    ? DELETION_DIALOG_TITLE
                    : 'Mở khoá tài khoản'}
            </h2>
            <p className="uo-dialog__who">
              <strong>{userLabel(dialog.user)}</strong>
              <span className="adm-muted">{dialog.user.email}</span>
            </p>

            {dialog.kind === 'role' ? (
              <div className="uo-field">
                <label className="uo-label" htmlFor="uo-role">
                  Vai trò mới
                </label>
                <select
                  className="adm-input"
                  id="uo-role"
                  ref={selectRef}
                  value={roleDraft}
                  onChange={(event) =>
                    setRoleDraft(
                      event.target.value === 'admin' ? 'admin' : 'user',
                    )
                  }
                >
                  <option value="user">Người học</option>
                  <option value="admin">Quản trị viên</option>
                </select>
                <p className="uo-dialog__text">
                  Người dùng sẽ nhận quyền theo vai trò mới ngay sau khi xác
                  nhận.
                </p>
              </div>
            ) : null}

            {dialog.kind === 'suspend' ? (
              <div className="uo-field">
                <label className="uo-label" htmlFor="uo-reason">
                  Lý do khoá <span aria-hidden="true">*</span>
                </label>
                <textarea
                  className="adm-input uo-textarea"
                  id="uo-reason"
                  ref={reasonRef}
                  rows={4}
                  maxLength={SUSPEND_REASON_MAX_LENGTH}
                  value={reasonDraft}
                  aria-describedby="uo-reason-hint uo-suspend-warning"
                  onChange={(event) => setReasonDraft(event.target.value)}
                />
                <p className="uo-hint" id="uo-reason-hint">
                  <span aria-live="polite">
                    {reasonDraft.length}/{SUSPEND_REASON_MAX_LENGTH}
                  </span>
                </p>
                <p className="uo-warning" id="uo-suspend-warning">
                  <AdminIcon
                    name="alert-triangle"
                    className="adm-icon adm-icon--sm"
                  />
                  Người dùng sẽ bị đăng xuất khỏi mọi thiết bị.
                </p>
              </div>
            ) : null}

            {dialog.kind === 'unsuspend' ? (
              <p className="uo-dialog__text">
                Người dùng sẽ có thể đăng nhập lại ngay sau khi mở khoá.
              </p>
            ) : null}

            {dialog.kind === 'deletion' ? (
              <div className="uo-field">
                <p className="uo-dialog__text">
                  {dialog.user.status === 'deletion_pending'
                    ? DELETION_PENDING_COPY
                    : DELETION_ACTIVE_COPY}
                </p>
                <label className="uo-check" htmlFor="uo-deletion-verify">
                  <input
                    className="uo-checkbox"
                    id="uo-deletion-verify"
                    ref={verifyRef}
                    type="checkbox"
                    checked={deletionVerified}
                    onChange={(event) =>
                      setDeletionVerified(event.target.checked)
                    }
                  />
                  <span>{DELETION_VERIFY_LABEL}</span>
                </label>
              </div>
            ) : null}

            {dialogError ? (
              <p className="uo-dialog__error" role="alert">
                {dialogError}
              </p>
            ) : null}

            <div className="uo-dialog__actions">
              <button
                className="adm-btn adm-btn--outline"
                type="button"
                onClick={closeDialog}
                disabled={pending}
              >
                Huỷ
              </button>
              <button
                className="adm-btn adm-btn--danger"
                type="button"
                ref={confirmRef}
                disabled={
                  pending ||
                  (dialog.kind === 'role' && roleDraft === dialog.user.role) ||
                  (dialog.kind === 'suspend' &&
                    reasonDraft.trim().length === 0) ||
                  (dialog.kind === 'deletion' && !deletionVerified)
                }
                onClick={() => void confirm()}
              >
                {pending
                  ? 'Đang xử lý…'
                  : dialog.kind === 'role'
                    ? 'Xác nhận đổi vai trò'
                    : dialog.kind === 'suspend'
                      ? 'Khoá tài khoản'
                      : dialog.kind === 'deletion'
                        ? DELETION_CONFIRM_LABEL
                        : 'Mở khoá tài khoản'}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
