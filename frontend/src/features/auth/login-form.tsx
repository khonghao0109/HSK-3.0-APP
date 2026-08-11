'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';

export function LoginForm({
  sessionEnded = false,
}: {
  sessionEnded?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(
    sessionEnded ? 'Your session ended. Sign in again to continue.' : null,
  );
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
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
        router.replace('/forbidden');
        return;
      }
      if (response.status === 429) {
        setError('Too many sign-in attempts. Wait a moment and try again.');
      } else if (response.status === 401) {
        setError('Email or password is incorrect.');
      } else {
        setError('Sign-in is unavailable right now. Try again shortly.');
      }
    } catch {
      setError(
        'The console cannot reach the service. Check your connection and retry.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="field-stack">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
        />
      </div>
      <div className="field-stack">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={6}
          required
        />
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="button button--primary button--full"
        type="submit"
        disabled={pending}
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
