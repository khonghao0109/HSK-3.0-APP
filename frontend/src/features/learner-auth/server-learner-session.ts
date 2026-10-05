import 'server-only';

import { cookies } from 'next/headers';

import { learnerSessionDependencies } from '@/features/auth/learner-session-dependencies';
import { resolveLearnerSession, type LearnerSessionState } from './learner-session';

export async function getServerLearnerSession(): Promise<
  LearnerSessionState & { token: string | null }
> {
  const deps = learnerSessionDependencies();
  const token = (await cookies()).get(deps.cookieName)?.value ?? null;
  const result = await resolveLearnerSession(token, deps.loadCurrentUser);
  return { ...result, token };
}
