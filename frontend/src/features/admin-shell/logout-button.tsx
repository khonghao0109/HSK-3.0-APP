'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // The button is disabled while pending, which drops keyboard focus; give it
  // back so the retry is one keypress away.
  useEffect(() => {
    if (failed) buttonRef.current?.focus();
  }, [failed]);

  async function logOut() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch('/api/session/logout', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      // Only a confirmed 2xx means the BFF cleared the session cookie. Leaving
      // for /login otherwise would show a signed-out screen over a live session.
      if (response.ok) {
        router.replace('/login');
        router.refresh();
        return;
      }
    } catch {
      // Network failure: the cookie state is unknown, so stay and offer retry.
    }
    setFailed(true);
    setPending(false);
  }

  const label = pending ? 'Leaving…' : failed ? 'Retry log out' : 'Log out';
  return (
    <>
      <button
        ref={buttonRef}
        className="profile-button"
        type="button"
        disabled={pending}
        aria-label={failed && !pending ? 'Retry log out' : 'Log out'}
        onClick={() => void logOut()}
      >
        <span aria-hidden="true">↪</span>
        <span>{label}</span>
      </button>
      {failed ? (
        <span className="sr-only" role="alert">
          Log out failed. Your session is still active. Try again.
        </span>
      ) : null}
    </>
  );
}
