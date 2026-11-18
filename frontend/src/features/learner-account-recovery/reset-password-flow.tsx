'use client';

import Link from 'next/link';
import { FormEvent, useRef, useState } from 'react';

import { LEARNER_AUTH_ERROR_MESSAGES } from '@/features/learner-auth/learner-auth-messages';
import { LearnerPasswordField } from '@/features/learner-auth/learner-password-field';

import { useHashToken, useView } from './use-hash-token';

type View = 'form' | 'done' | 'invalid';

async function errorCode(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: { code?: unknown } }).error;
  return typeof error?.code === 'string' ? error.code : null;
}

/** Remounts the view for every email link read (fresh state, no focus move). */
export function ResetPasswordFlow() {
  const link = useHashToken();
  if (!link) return null;
  return <ResetPasswordView key={link.id} token={link.token} />;
}

function ResetPasswordView({ token }: { token: string | null }) {
  const { view, go, heading } = useView<View>();
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const shown: View = view ?? (token ? 'form' : 'invalid');

  function fail(message: string, field: boolean) {
    setError(message);
    setInvalid(field);
    if (field) passwordRef.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !token) return;
    setError(null);
    setInvalid(false);

    const raw = new FormData(event.currentTarget).get('password');
    const newPassword = typeof raw === 'string' ? raw : '';
    if (newPassword.length < 6) {
      fail(LEARNER_AUTH_ERROR_MESSAGES.shortPassword, true);
      return;
    }

    busy.current = true;
    setPending(true);
    try {
      const response = await fetch('/api/learner/password-reset/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      if (response.status === 204) {
        go('done');
      } else if (response.status === 400) {
        const code = await errorCode(response);
        if (code === 'INVALID_RESET_TOKEN') go('invalid');
        else if (code === 'WEAK_PASSWORD')
          fail(LEARNER_AUTH_ERROR_MESSAGES.weakPassword, true);
        else fail(LEARNER_AUTH_ERROR_MESSAGES.generic, false);
      } else if (response.status === 429) {
        fail(LEARNER_AUTH_ERROR_MESSAGES.rateLimited, false);
      } else {
        fail(LEARNER_AUTH_ERROR_MESSAGES.generic, false);
      }
    } catch {
      fail(LEARNER_AUTH_ERROR_MESSAGES.network, false);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (shown === 'form') {
    return (
      <section>
        <h1 className="auth__title" tabIndex={-1} ref={heading}>
          Đặt mật khẩu mới
        </h1>
        <p className="auth__subtitle">
          Mật khẩu mới cần ít nhất 6 ký tự. Sau khi đổi, bạn sẽ được đăng xuất
          khỏi mọi thiết bị.
        </p>
        <form
          className="auth__form"
          onSubmit={submit}
          noValidate
          aria-busy={pending || undefined}
        >
          <LearnerPasswordField
            autoComplete="new-password"
            label="Mật khẩu mới"
            placeholder="Nhập mật khẩu mới"
            invalid={invalid}
            inputRef={passwordRef}
          />
          <div
            className="alert alert--error"
            id="auth-alert"
            role="alert"
            hidden={!error}
          >
            {error}
          </div>
          <button
            className="btn btn--primary btn--block auth__submit"
            type="submit"
          >
            Đặt lại mật khẩu
          </button>
        </form>
      </section>
    );
  }

  if (shown === 'done') {
    return (
      <section>
        <div className="auth-result__icon" aria-hidden="true">
          <svg className="icon">
            <use href="#i-check" />
          </svg>
        </div>
        <h1 className="auth__title" tabIndex={-1} ref={heading}>
          Đã đặt lại mật khẩu
        </h1>
        <p className="auth__subtitle">Hãy đăng nhập bằng mật khẩu mới.</p>
        <div className="auth__actions">
          <Link className="btn btn--primary btn--block" href="/sign-in">
            Đăng nhập
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div
        className="auth-result__icon auth-result__icon--warn"
        aria-hidden="true"
      >
        <svg className="icon">
          <use href="#i-alert-triangle" />
        </svg>
      </div>
      <h1 className="auth__title" tabIndex={-1} ref={heading}>
        Liên kết không còn hiệu lực
      </h1>
      <p className="auth__subtitle">
        Liên kết đặt lại mật khẩu đã hết hạn, đã được dùng hoặc không đầy đủ.
        Hãy yêu cầu liên kết mới.
      </p>
      <div className="auth__actions">
        <Link className="btn btn--primary btn--block" href="/forgot-password">
          Gửi liên kết mới
        </Link>
      </div>
    </section>
  );
}
