'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { recoverSession } from './session-recovery';

type RecoveryStatus = 'not-required' | 'checking' | 'ready' | 'failed';

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
            'The previous session could not be checked safely. Retry before signing in.',
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
    setError('Your session ended. Sign in again to continue.');
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
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }

  const checkingSession = recoveryStatus === 'checking';
  const recoveryFailed = recoveryStatus === 'failed';

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
      {recoveryFailed ? (
        <button
          className="button button--ghost button--full"
          type="button"
          onClick={retryRecovery}
        >
          Retry session check
        </button>
      ) : null}
      <button
        className="button button--primary button--full"
        type="submit"
        disabled={pending || recoveryFailed}
      >
        {pending && checkingSession
          ? 'Checking session…'
          : pending
            ? 'Signing in…'
            : 'Sign in'}
      </button>
    </form>
  );
}
