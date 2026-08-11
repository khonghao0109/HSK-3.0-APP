import type { AuthUser } from './auth-contract';

export type AdminSessionState =
  | { state: 'admin'; user: AuthUser }
  | { state: 'forbidden' }
  | { state: 'unauthenticated' };

export async function resolveAdminSession(
  token: string | null,
  loadCurrentUser: (token: string) => Promise<AuthUser>,
): Promise<AdminSessionState> {
  if (!token) return { state: 'unauthenticated' };
  try {
    const user = await loadCurrentUser(token);
    return user.role === 'admin'
      ? { state: 'admin', user }
      : { state: 'forbidden' };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      ((error as { status?: unknown }).status === 401 ||
        (error as { status?: unknown }).status === 403)
    ) {
      return { state: 'unauthenticated' };
    }
    throw error;
  }
}
