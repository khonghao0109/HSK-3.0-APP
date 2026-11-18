'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { AdminIcon } from './admin-icon';
import { ADMIN_ACTION } from './admin-labels';

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

  const label = pending
    ? 'Đang đăng xuất…'
    : failed
      ? 'Thử đăng xuất lại'
      : ADMIN_ACTION.signOut;
  return (
    <>
      <button
        ref={buttonRef}
        className="adm-btn adm-btn--outline adm-topbar__logout"
        type="button"
        disabled={pending}
        onClick={() => void logOut()}
      >
        <AdminIcon name="log-out" className="adm-icon adm-icon--sm" />
        <span>{label}</span>
      </button>
      {failed ? (
        <span className="sr-only" role="alert">
          Đăng xuất không thành công. Phiên của bạn vẫn đang mở. Hãy thử lại.
        </span>
      ) : null}
    </>
  );
}
