'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { recoverSession } from './session-recovery';

type RecoveryStatus = 'not-required' | 'checking' | 'ready' | 'failed';

export const LOGIN_ERROR_MESSAGES = {
  invalidCredentials: 'Email hoặc mật khẩu không đúng.',
  accountLocked:
    'Tài khoản tạm khoá do đăng nhập sai nhiều lần. Vui lòng thử lại sau.',
  rateLimited: 'Quá nhiều lần thử đăng nhập. Chờ một lúc rồi thử lại.',
} as const;

function isAccountLocked(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'kind' in body.error &&
    body.error.kind === 'account_locked'
  );
}

export function LoginForm({
  sessionEnded = false,
}: {
  sessionEnded?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(
    sessionEnded ? 'Phiên đã kết thúc. Đăng nhập lại để tiếp tục.' : null,
  );
  const [pending, setPending] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>(
    sessionEnded ? 'checking' : 'not-required',
  );
  const mounted = useRef(true);
  const recoveryController = useRef<AbortController | null>(null);
  const recoveryPromise = useRef<Promise<boolean> | null>(null);
  const submitting = useRef(false);

  const startRecovery = useCallback((): Promise<boolean> => {
    if (recoveryPromise.current) return recoveryPromise.current;

    const controller = new AbortController();
    recoveryController.current = controller;
    setRecoveryStatus('checking');
    const operation = recoverSession(controller.signal)
      .then(() => {
        if (mounted.current && recoveryController.current === controller) {
          setRecoveryStatus('ready');
        }
        return true;
      })
      .catch(() => {
        if (
          mounted.current &&
          recoveryController.current === controller &&
          !controller.signal.aborted
        ) {
          setRecoveryStatus('failed');
          setError(
            'Không kiểm tra được phiên trước đó một cách an toàn. Hãy thử lại trước khi đăng nhập.',
          );
        }
        return false;
      });
    recoveryPromise.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (sessionEnded) void startRecovery();
    return () => {
      mounted.current = false;
      recoveryController.current?.abort();
      recoveryController.current = null;
      recoveryPromise.current = null;
    };
  }, [sessionEnded, startRecovery]);

  function retryRecovery() {
    recoveryController.current?.abort();
    recoveryController.current = null;
    recoveryPromise.current = null;
    setError('Phiên đã kết thúc. Đăng nhập lại để tiếp tục.');
    void startRecovery();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      if (sessionEnded) {
        const recovered = await startRecovery();
        if (!recovered || !mounted.current) return;
      }
      setError(null);
      const response = await fetch('/api/session/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
      });
      if (response.ok) {
        router.replace('/admin/exercises');
        router.refresh();
        return;
      }
      if (response.status === 403) {
        // 403 is either a locked account (show why) or a non-admin identity.
        const body: unknown = await response.json().catch(() => null);
        if (isAccountLocked(body)) {
          setError(LOGIN_ERROR_MESSAGES.accountLocked);
        } else {
          router.replace('/forbidden');
        }
        return;
      }
      if (response.status === 429) {
        setError(LOGIN_ERROR_MESSAGES.rateLimited);
      } else if (response.status === 401) {
        setError(LOGIN_ERROR_MESSAGES.invalidCredentials);
      } else {
        setError('Không đăng nhập được lúc này. Hãy thử lại sau ít phút.');
      }
    } catch {
      setError(
        'Không kết nối được máy chủ. Kiểm tra kết nối mạng rồi thử lại.',
      );
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  const checkingSession = recoveryStatus === 'checking';
  const recoveryFailed = recoveryStatus === 'failed';

  return (
    <form className="adm-page-stack" onSubmit={submit}>
      <div className="adm-field">
        <label className="adm-field__label" htmlFor="email">
          Email
        </label>
        <input
          className="adm-input"
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </div>
      <div className="adm-field">
        <label className="adm-field__label" htmlFor="password">
          Mật khẩu
        </label>
        <input
          className="adm-input"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={6}
          required
        />
      </div>
      {error ? (
        <p className="adm-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {recoveryFailed ? (
        <button
          className="adm-btn adm-btn--ghost adm-btn--block"
          type="button"
          onClick={retryRecovery}
        >
          Thử lại
        </button>
      ) : null}
      <button
        className="adm-btn adm-btn--primary adm-btn--block"
        type="submit"
        disabled={pending || recoveryFailed}
      >
        {pending && checkingSession
          ? 'Đang kiểm tra phiên…'
          : pending
            ? 'Đang đăng nhập…'
            : 'Đăng nhập'}
      </button>
    </form>
  );
}
