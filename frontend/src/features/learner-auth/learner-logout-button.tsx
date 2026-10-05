'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { LEARNER_AUTH_ERROR_MESSAGES } from './learner-auth-messages';

export function LearnerLogoutButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/learner/session/logout', {
        method: 'POST',
      });
      if (response.status === 204 || response.ok) {
        router.replace('/');
        router.refresh();
        return;
      }
      setPending(false);
      setError(LEARNER_AUTH_ERROR_MESSAGES.generic);
    } catch {
      setPending(false);
      setError(LEARNER_AUTH_ERROR_MESSAGES.network);
    }
  }

  return (
    <div>
      {error && (
        <div className="alert alert--error" role="alert">
          <svg className="icon icon--sm" aria-hidden="true">
            <use href="#i-alert-triangle" />
          </svg>
          <span>{error}</span>
        </div>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={handleLogout}
        className="btn btn--outline-navy btn--block auth__submit"
      >
        {pending ? 'Đang đăng xuất…' : 'Đăng xuất'}
      </button>
    </div>
  );
}
