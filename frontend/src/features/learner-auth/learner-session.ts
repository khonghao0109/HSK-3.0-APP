import type { AuthUser } from '@/features/auth/auth-contract';

export type LearnerSessionState =
  | { state: 'learner'; user: AuthUser }
  | { state: 'unauthenticated' };

type ErrorWithStatus = { status: unknown };

function hasStatus(err: object): err is ErrorWithStatus {
  return 'status' in err;
}

export async function resolveLearnerSession(
  token: string | null,
  loadCurrentUser: (token: string) => Promise<AuthUser>,
): Promise<LearnerSessionState> {
  if (!token) return { state: 'unauthenticated' };
  try {
    const user = await loadCurrentUser(token);
    return user.role === 'user'
      ? { state: 'learner', user }
      : { state: 'unauthenticated' };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      hasStatus(error) &&
      (error.status === 401 || error.status === 403)
    ) {
      return { state: 'unauthenticated' };
    }
    throw error;
  }
}
