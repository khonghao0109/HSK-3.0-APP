import 'server-only';

import { cookies } from 'next/headers';

import { sessionDependencies } from './session-dependencies';
import { resolveAdminSession } from './admin-session';

export async function getServerAdminSession() {
  const deps = sessionDependencies();
  const token = (await cookies()).get(deps.cookieName)?.value ?? null;
  const result = await resolveAdminSession(token, deps.loadCurrentUser);
  return { ...result, token };
}
