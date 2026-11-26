'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { useRouter } from 'next/navigation';

import { LearnerLogoutButton } from '@/features/learner-auth/learner-logout-button';

import type { DataExportItem } from './privacy-values';

/**
 * M1.7b2 B2b (Q189): what a learner may still do while blocked on consent:
 * export their data, delete the account (M1.7c, password + 7-day grace) and
 * sign out. Dialogs follow web/account-settings.html "Quyền riêng tư & dữ
 * liệu". Shared so the profile page (Q195) can reuse it.
 */

const COPY = {
  exportRequested:
    'Đã gửi yêu cầu. Khi tệp sẵn sàng, nút Tải về hiện trong danh sách; tải lại trang để kiểm tra.',
  exportLimited:
    'Bạn đã yêu cầu xuất dữ liệu trong 24 giờ qua. Hãy tải tệp đã có hoặc thử lại sau.',
  exportFailed: 'Chưa gửi được yêu cầu. Thử lại sau ít phút.',
  listFailed: 'Chưa tải được danh sách tệp xuất. Thử lại sau ít phút.',
  network: 'Không kết nối được. Kiểm tra mạng rồi thử lại.',
  passwordMissing: 'Nhập mật khẩu hiện tại để xác nhận.',
  passwordWrong: 'Mật khẩu không đúng.',
  deleteLimited: 'Bạn đã thử quá nhiều lần. Thử lại sau 15 phút.',
  deleteFailed: 'Chưa gửi được yêu cầu xoá. Thử lại sau ít phút.',
} as const;

const DATE = new Intl.DateTimeFormat('vi-VN', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Asia/Ho_Chi_Minh',
});

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE.format(date);
}

/** Only the four `DataExportJob` statuses exist (M1.7b1). */
function exportState(item: DataExportItem): string {
  if (item.status === 'completed') {
    return item.downloadable
      ? `Sẵn sàng${item.outputExpiresAt ? ` · tải trước ${when(item.outputExpiresAt)}` : ''}`
      : 'Đã hết hạn';
  }
  if (item.status === 'failed') return 'Không tạo được';
  return 'Đang chuẩn bị';
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => null);
  const code =
    typeof body === 'object' && body !== null && 'error' in body
      ? (body as { error?: { code?: unknown } }).error?.code
      : undefined;
  return typeof code === 'string' ? code : undefined;
}

function DownloadIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" />
    </svg>
  );
}

/** Native modal dialog: the browser traps focus; Esc runs `onClose`. */
function PrivacyDialog({
  open,
  onClose,
  labelledBy,
  describedBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  describedBy: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="privacy-dialog"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

export function PrivacyRightsPanel({
  variant = 'consent',
}: {
  /** `profile`: the page has its own heading and sign-out (Q195). */
  variant?: 'consent' | 'profile';
} = {}) {
  const onConsent = variant === 'consent';
  const router = useRouter();
  const titleId = useId();
  const passwordId = useId();
  const passwordErrorId = useId();
  const [exports, setExports] = useState<DataExportItem[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'export' | 'delete' | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  function openDialog(which: 'export' | 'delete', button: HTMLButtonElement) {
    opener.current = button;
    setDialog(which);
  }

  function closeDialog() {
    setDialog(null);
    opener.current?.focus();
  }

  function readExports(): Promise<string | DataExportItem[]> {
    return fetch('/api/learner/data-exports', { cache: 'no-store' })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { data: DataExportItem[] }).data
          : COPY.listFailed,
      )
      .catch(() => COPY.network);
  }

  function showExports(result: string | DataExportItem[]) {
    if (typeof result === 'string') setNotice(result);
    else setExports(result);
  }

  useEffect(() => {
    // Read once on mount; a new request refreshes it.
    void readExports().then(showExports);
  }, []);

  async function requestExport() {
    if (sending) return;
    setSending(true);
    try {
      const response = await fetch('/api/learner/data-exports', {
        method: 'POST',
      });
      closeDialog();
      if (response.ok) {
        setNotice(COPY.exportRequested);
        showExports(await readExports());
      } else if (
        response.status === 429 &&
        (await errorCode(response)) === 'EXPORT_RATE_LIMITED'
      ) {
        setNotice(COPY.exportLimited);
      } else {
        setNotice(COPY.exportFailed);
      }
    } catch {
      closeDialog();
      setNotice(COPY.network);
    }
    setSending(false);
  }

  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    if (password.length === 0) {
      setPasswordError(COPY.passwordMissing);
      return;
    }
    setSending(true);
    setPasswordError(null);
    try {
      const response = await fetch('/api/learner/account-deletion', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        // The BFF cleared the session: the account is gone in 7 days.
        router.replace('/sign-in');
        router.refresh();
        return;
      }
      const code = await errorCode(response);
      setPasswordError(
        code === 'INVALID_PASSWORD'
          ? COPY.passwordWrong
          : response.status === 429
            ? COPY.deleteLimited
            : COPY.deleteFailed,
      );
    } catch {
      setPasswordError(COPY.network);
    }
    setSending(false);
  }

  return (
    <section
      className="privacy-rights"
      aria-labelledby={onConsent ? titleId : undefined}
    >
      {onConsent && (
        <>
          <h2 className="consent__h2" id={titleId}>
            Quyền của bạn
          </h2>
          <p className="consent__fine">
            Bạn vẫn xuất được dữ liệu, xoá tài khoản hoặc đăng xuất khi chưa
            đồng ý.
          </p>
        </>
      )}
      <button
        className="privacy-rights__link"
        type="button"
        onClick={(event) => openDialog('export', event.currentTarget)}
      >
        <DownloadIcon />
        <span className="grow">
          <b>Xuất dữ liệu</b>
          <small>Tải về dữ liệu cá nhân dạng JSON</small>
        </span>
        <svg className="icon privacy-rights__chev" aria-hidden="true">
          <use href="#i-chevron-right" />
        </svg>
      </button>
      {exports && exports.length > 0 && (
        <ul className="privacy-rights__exports">
          {exports.map((item) => (
            <li key={item.id}>
              <span>
                <b>Yêu cầu {when(item.createdAt)}</b>
                <small>{exportState(item)}</small>
              </span>
              {item.status === 'completed' && item.downloadable && (
                <a
                  className="btn btn--outline privacy-rights__download"
                  href={`/api/learner/data-exports/${item.id}/download`}
                  download
                >
                  Tải về
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="consent__fine" role="status">
        {notice}
      </p>
      <button
        className="privacy-rights__link privacy-rights__link--danger"
        type="button"
        onClick={(event) => {
          setPassword('');
          setPasswordError(null);
          openDialog('delete', event.currentTarget);
        }}
      >
        <TrashIcon />
        <span className="grow">
          <b>Xoá tài khoản</b>
          <small>Xoá vĩnh viễn tài khoản và dữ liệu học</small>
        </span>
        <svg className="icon privacy-rights__chev" aria-hidden="true">
          <use href="#i-chevron-right" />
        </svg>
      </button>
      {onConsent && <LearnerLogoutButton />}

      <PrivacyDialog
        open={dialog === 'export'}
        onClose={closeDialog}
        labelledBy={`${titleId}-export`}
        describedBy={`${titleId}-export-desc`}
      >
        <div className="privacy-dialog__body">
          <h2 id={`${titleId}-export`}>Yêu cầu xuất dữ liệu</h2>
          <p className="muted" id={`${titleId}-export-desc`}>
            Chúng tôi sẽ chuẩn bị một tệp JSON gồm hồ sơ, tiến độ học, lịch sử
            thi thử và cài đặt của bạn. Khi tệp sẵn sàng, liên kết tải về hiện ở
            đây và có hiệu lực 24 giờ.
          </p>
          <div className="modal__actions">
            <button
              className="btn btn--outline"
              type="button"
              onClick={closeDialog}
            >
              Huỷ
            </button>
            <button
              className="btn btn--primary"
              type="button"
              aria-busy={sending || undefined}
              onClick={() => void requestExport()}
            >
              Gửi yêu cầu
            </button>
          </div>
        </div>
      </PrivacyDialog>

      <PrivacyDialog
        open={dialog === 'delete'}
        onClose={closeDialog}
        labelledBy={`${titleId}-delete`}
        describedBy={`${titleId}-delete-desc`}
      >
        <form
          className="privacy-dialog__body"
          noValidate
          onSubmit={(event) => void requestDeletion(event)}
        >
          <span className="privacy-dialog__ico" aria-hidden="true">
            <TrashIcon />
          </span>
          <h2 id={`${titleId}-delete`}>Xoá tài khoản?</h2>
          <p className="muted" id={`${titleId}-delete-desc`}>
            Tài khoản của bạn sẽ được lên lịch xoá sau 7 ngày. Sau thời điểm đó,
            hồ sơ và tiến độ học sẽ bị xoá vĩnh viễn. Bạn có thể huỷ bằng cách
            đăng nhập lại trong 7 ngày.
          </p>
          <div className="field">
            <label className="field__label" htmlFor={passwordId}>
              Nhập mật khẩu hiện tại để xác nhận
            </label>
            <div className="input-wrap">
              <input
                className="input input--icon-end"
                id={passwordId}
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby={passwordErrorId}
                aria-invalid={passwordError ? 'true' : undefined}
              />
              <button
                className="icon-btn"
                type="button"
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                <svg className="icon" aria-hidden="true">
                  <use href={showPassword ? '#i-eye-off' : '#i-eye'} />
                </svg>
              </button>
            </div>
          </div>
          <p className="field__error" id={passwordErrorId} role="alert">
            {passwordError}
          </p>
          <div className="modal__actions">
            <button
              className="btn btn--outline"
              type="button"
              onClick={closeDialog}
            >
              Huỷ
            </button>
            <button
              className="btn btn--danger"
              type="submit"
              aria-busy={sending || undefined}
            >
              Xoá tài khoản
            </button>
          </div>
        </form>
      </PrivacyDialog>
    </section>
  );
}
