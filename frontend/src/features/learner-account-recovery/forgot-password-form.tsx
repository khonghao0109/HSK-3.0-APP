'use client';

import Link from 'next/link';
import { FormEvent, useRef, useState } from 'react';

import { LEARNER_AUTH_ERROR_MESSAGES } from '@/features/learner-auth/learner-auth-messages';

import { useView } from './use-hash-token';

export function ForgotPasswordForm() {
  const { view, go, heading } = useView<'sent'>();
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setError(null);
    setInvalid(false);

    const raw = new FormData(event.currentTarget).get('email');
    const email = typeof raw === 'string' ? raw.trim() : '';
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setInvalid(true);
      setError(LEARNER_AUTH_ERROR_MESSAGES.invalidEmail);
      emailRef.current?.focus();
      return;
    }

    busy.current = true;
    setPending(true);
    try {
      const response = await fetch('/api/learner/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (response.status === 204) {
        setSentTo(email.toLowerCase());
        go('sent');
      } else if (response.status === 429) {
        setError(LEARNER_AUTH_ERROR_MESSAGES.rateLimited);
      } else {
        setError(LEARNER_AUTH_ERROR_MESSAGES.generic);
      }
    } catch {
      setError(LEARNER_AUTH_ERROR_MESSAGES.network);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (view === 'sent') {
    return (
      <section>
        <div className="auth-result__icon" aria-hidden="true">
          <svg className="icon">
            <use href="#i-mail" />
          </svg>
        </div>
        <h1 className="auth__title" tabIndex={-1} ref={heading}>
          Kiểm tra email của bạn
        </h1>
        <p className="auth__subtitle">
          Nếu <strong>{sentTo}</strong> có tài khoản Hán Lộ, chúng tôi đã gửi
          liên kết đặt lại mật khẩu. Liên kết có hiệu lực trong 30 phút.
        </p>
        <div className="auth__actions">
          <Link className="btn btn--primary btn--block" href="/sign-in">
            Về đăng nhập
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h1 className="auth__title" tabIndex={-1} ref={heading}>
        Quên mật khẩu
      </h1>
      <p className="auth__subtitle">
        Nhập email đã đăng ký. Chúng tôi sẽ gửi liên kết để bạn đặt mật khẩu
        mới.
      </p>
      <form
        className="auth__form"
        onSubmit={submit}
        noValidate
        aria-busy={pending || undefined}
      >
        <div className="field">
          <label className="field__label" htmlFor="email">
            Email
          </label>
          <div className="input-wrap">
            <svg className="icon" aria-hidden="true">
              <use href="#i-mail" />
            </svg>
            <input
              ref={emailRef}
              className="input"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="Nhập email của bạn"
              aria-describedby="auth-alert"
              aria-invalid={invalid ? 'true' : undefined}
              required
            />
          </div>
        </div>
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
          Gửi liên kết
        </button>
      </form>
    </section>
  );
}
