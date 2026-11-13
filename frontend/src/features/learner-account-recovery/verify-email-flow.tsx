'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { LEARNER_AUTH_ERROR_MESSAGES } from '@/features/learner-auth/learner-auth-messages';

import { useHashToken, useView } from './use-hash-token';

type View = 'confirm' | 'done' | 'invalid' | 'sent';

function ResultIcon({ icon = 'mail' }: { icon?: string }) {
  return (
    <div className="auth-result__icon" aria-hidden="true">
      <svg className="icon">
        <use href={`#i-${icon}`} />
      </svg>
    </div>
  );
}

function Alert({ message }: { message: string | null }) {
  return (
    <div className="alert alert--error" role="alert" hidden={!message}>
      {message}
    </div>
  );
}

/** Remounts the view for every email link read (fresh state, no focus move). */
export function VerifyEmailFlow({ signedIn }: { signedIn: boolean }) {
  const link = useHashToken();
  if (!link) return null;
  return (
    <VerifyEmailView key={link.id} token={link.token} signedIn={signedIn} />
  );
}

function VerifyEmailView({
  token,
  signedIn,
}: {
  token: string | null;
  signedIn: boolean;
}) {
  const router = useRouter();
  const { view, go, heading } = useView<View>();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);

  // Q72: opening the link never calls the API; the learner has to press the button.
  const shown: View = view ?? (token ? 'confirm' : 'invalid');

  async function post(
    path: string,
    body: unknown,
    onStatus: (status: number) => void,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status === 429)
        setError(LEARNER_AUTH_ERROR_MESSAGES.rateLimited);
      else onStatus(response.status);
    } catch {
      setError(LEARNER_AUTH_ERROR_MESSAGES.network);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const confirm = () =>
    post('/api/learner/email-verification/confirm', { token }, (status) => {
      if (status === 204) go('done');
      else if (status === 400) go('invalid');
      else setError(LEARNER_AUTH_ERROR_MESSAGES.generic);
    });

  const resend = () =>
    post('/api/learner/email-verification/request', {}, (status) => {
      if (status === 204) go('sent');
      else if (status === 401) router.replace('/sign-in?next=verify-email');
      else setError(LEARNER_AUTH_ERROR_MESSAGES.generic);
    });

  if (shown === 'confirm') {
    return (
      <section>
        <ResultIcon />
        <h1 className="auth__title" tabIndex={-1} ref={heading}>
          Xác thực email
        </h1>
        <p className="auth__subtitle">
          Bấm nút bên dưới để hoàn tất xác thực email cho tài khoản Hán Lộ của
          bạn.
        </p>
        <div className="auth__actions">
          <Alert message={error} />
          <button
            className="btn btn--primary btn--block"
            type="button"
            aria-busy={pending || undefined}
            onClick={confirm}
          >
            Xác thực email
          </button>
        </div>
      </section>
    );
  }

  if (shown === 'done') {
    return (
      <section>
        <ResultIcon icon="check" />
        <h1 className="auth__title" tabIndex={-1} ref={heading}>
          Email đã được xác thực
        </h1>
        <p className="auth__subtitle">
          Cảm ơn bạn. Tài khoản của bạn đã sẵn sàng.
        </p>
        <div className="auth__actions">
          <Link className="btn btn--primary btn--block" href="/learn">
            Vào học
          </Link>
        </div>
      </section>
    );
  }

  if (shown === 'invalid') {
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
          Liên kết xác thực đã hết hạn, đã được dùng hoặc không đầy đủ.
        </p>
        <div className="auth__actions">
          <Alert message={error} />
          {signedIn ? (
            <button
              className="btn btn--primary btn--block"
              type="button"
              aria-busy={pending || undefined}
              onClick={resend}
            >
              Gửi lại email xác thực
            </button>
          ) : (
            <Link
              className="btn btn--primary btn--block"
              href="/sign-in?next=verify-email"
            >
              Đăng nhập để gửi lại
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section>
      <ResultIcon />
      <h1 className="auth__title" tabIndex={-1} ref={heading}>
        Đã gửi lại email
      </h1>
      <p className="auth__subtitle">
        Mở liên kết mới trong hộp thư (kể cả mục Spam). Liên kết có hiệu lực
        trong 24 giờ.
      </p>
      <div className="auth__actions">
        <Link className="btn btn--primary btn--block" href="/learn">
          Vào học
        </Link>
      </div>
    </section>
  );
}
