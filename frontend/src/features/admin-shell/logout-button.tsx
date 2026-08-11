'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      className="profile-button"
      type="button"
      disabled={pending}
      aria-label="Log out"
      onClick={async () => {
        setPending(true);
        try {
          await fetch('/api/session/logout', { method: 'POST' });
        } finally {
          router.replace('/login');
          router.refresh();
        }
      }}
    >
      <span aria-hidden="true">↪</span>
      <span>{pending ? 'Leaving…' : 'Log out'}</span>
    </button>
  );
}
