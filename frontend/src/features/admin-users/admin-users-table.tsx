'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { AdminIcon } from '@/features/admin-shell/admin-icon';
import { adminDateTime } from '@/features/admin-shell/admin-labels';

import {
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
  | { kind: 'unsuspend'; user: AdminUserRow };

type Announcement = { tone: 'ok' | 'error'; text: string };

type MutationResult =
  { ok: true } | { ok: false; status: number; code: string | null };

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
    if (response.ok) return { ok: true };
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
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [roleDraft, setRoleDraft] = useState<'user' | 'admin'>('user');
  const [reasonDraft, setReasonDraft] = useState('');
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
    else confirmRef.current?.focus();
  }, [dialog]);

  function openDialog(
    next: DialogState,
    opener: HTMLButtonElement | null,
  ): void {
    openerRef.current = opener;
    setDialogError(null);
    setReasonDraft('');
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
    // TL-72: đóng xong focus quay về đúng nút đã mở dialog.
    opener?.focus();
  }

  async function confirm(): Promise<void> {
    if (!dialog || pending) return;
    const { kind, user } = dialog;
    if (kind === 'role' && roleDraft === user.role) return;
    if (kind === 'suspend' && reasonDraft.trim().length === 0) return;

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
        {reason !== null ? (
          <p className="uo-action-note" id={reasonId}>
            {reason}
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
                  (dialog.kind === 'suspend' && reasonDraft.trim().length === 0)
                }
                onClick={() => void confirm()}
              >
                {pending
                  ? 'Đang xử lý…'
                  : dialog.kind === 'role'
                    ? 'Xác nhận đổi vai trò'
                    : dialog.kind === 'suspend'
                      ? 'Khoá tài khoản'
                      : 'Mở khoá tài khoản'}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
