'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useRef, useState } from 'react';

import { LearnerAuthAlternatives } from './learner-auth-alternatives';
import { LEARNER_AUTH_ERROR_MESSAGES } from './learner-auth-messages';
import { LearnerPasswordField } from './learner-password-field';

function getErrorKind(body: unknown): string | null {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'kind' in body.error &&
    typeof body.error.kind === 'string'
  ) {
    return body.error.kind;
  }
  return null;
}

type RegisterError =
  { kind: 'email_taken'; message: string } | { kind: 'other'; message: string };

type InvalidField = 'email' | 'password' | null;

export function LearnerRegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<RegisterError | null>(null);
  const [invalidField, setInvalidField] = useState<InvalidField>(null);
  const [pending, setPending] = useState(false);

  const submitting = useRef(false);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    setError(null);
    setInvalidField(null);

    const form = new FormData(event.currentTarget);
    const email = form.get('email');
    const password = form.get('password');

    const emailStr = typeof email === 'string' ? email.trim() : '';
    const passwordStr = typeof password === 'string' ? password : '';

    if (!emailStr || !/^\S+@\S+\.\S+$/.test(emailStr)) {
      setInvalidField('email');
      setError({
        kind: 'other',
        message: LEARNER_AUTH_ERROR_MESSAGES.invalidEmail,
      });
      emailInputRef.current?.focus();
      return;
    }

    if (passwordStr.length < 6) {
      setInvalidField('password');
      setError({
        kind: 'other',
        message: LEARNER_AUTH_ERROR_MESSAGES.shortPassword,
      });
      passwordInputRef.current?.focus();
      return;
    }

    submitting.current = true;
    setPending(true);

    try {
      const response = await fetch('/api/learner/session/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: emailStr, password: passwordStr }),
      });

      if (response.status === 201) {
        router.replace('/learn');
        router.refresh();
        return;
      }

      submitting.current = false;
      setPending(false);

      if (response.status === 409) {
        setInvalidField('email');
        setError({
          kind: 'email_taken',
          message: LEARNER_AUTH_ERROR_MESSAGES.emailTaken,
        });
      } else if (response.status === 400) {
        setInvalidField(null);
        const body: unknown = await response.json().catch(() => null);
        const kind = getErrorKind(body);
        if (kind === 'weak_password') {
          setError({
            kind: 'other',
            message: LEARNER_AUTH_ERROR_MESSAGES.weakPassword,
          });
        } else {
          setError({
            kind: 'other',
            message: LEARNER_AUTH_ERROR_MESSAGES.generic,
          });
        }
      } else if (response.status === 429) {
        setInvalidField(null);
        setError({
          kind: 'other',
          message: LEARNER_AUTH_ERROR_MESSAGES.rateLimited,
        });
      } else {
        setInvalidField(null);
        setError({
          kind: 'other',
          message: LEARNER_AUTH_ERROR_MESSAGES.generic,
        });
      }
    } catch {
      submitting.current = false;
      setPending(false);
      setInvalidField(null);
      setError({
        kind: 'other',
        message: LEARNER_AUTH_ERROR_MESSAGES.network,
      });
    }
  }

  return (
    <>
      <form className="auth__form" onSubmit={submit} noValidate>
        <div className="field">
          <label className="field__label" htmlFor="email">
            Email
          </label>
          <div className="input-wrap">
            <svg className="icon" aria-hidden="true">
              <use href="#i-mail" />
            </svg>
            <input
              ref={emailInputRef}
              className="input"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="Nhập email của bạn"
              aria-describedby="auth-alert"
              aria-invalid={invalidField === 'email' ? 'true' : undefined}
              disabled={pending}
              required
            />
          </div>
        </div>

        <LearnerPasswordField
          autoComplete="new-password"
          invalid={invalidField === 'password'}
          inputRef={passwordInputRef}
          disabled={pending}
        />

        <div
          className="alert alert--error"
          id="auth-alert"
          role="alert"
          hidden={!error}
        >
          {error && (
            <>
              <svg className="icon icon--sm" aria-hidden="true">
                <use href="#i-alert-triangle" />
              </svg>
              <span>
                {error.message}
                {error.kind === 'email_taken' && (
                  <>
                    {' '}
                    <Link href="/sign-in">Đăng nhập</Link>
                  </>
                )}
              </span>
            </>
          )}
        </div>

        <button
          className="btn btn--primary btn--block auth__submit"
          type="submit"
          disabled={pending}
          aria-disabled={pending ? 'true' : undefined}
        >
          {pending ? 'Đang tạo tài khoản…' : 'Tạo tài khoản'}
        </button>
      </form>

      <LearnerAuthAlternatives />
    </>
  );
}
