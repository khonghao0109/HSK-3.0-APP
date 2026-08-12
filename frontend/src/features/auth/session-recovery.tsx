export class SessionRecoveryError extends Error {
  constructor() {
    super('The previous session could not be recovered safely.');
    this.name = 'SessionRecoveryError';
  }
}

async function postSessionMutation(path: string, signal: AbortSignal) {
  return fetch(path, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    signal,
  });
}

export async function recoverSession(signal: AbortSignal): Promise<void> {
  const response = await postSessionMutation('/api/session/recover', signal);
  if (!response.ok) throw new SessionRecoveryError();
  const state = response.headers.get('x-session-recovery');
  if (state === 'ready') return;
  if (state !== 'invalid') throw new SessionRecoveryError();

  const cleared = await postSessionMutation('/api/session/logout', signal);
  if (!cleared.ok) throw new SessionRecoveryError();
}
