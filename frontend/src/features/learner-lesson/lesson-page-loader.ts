import { notFound, redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  getCurrentGoal,
  getOnboardingStatus,
} from '@/features/onboarding/onboarding-service';
import { routeForOnboarding } from '@/features/onboarding/route-for-onboarding';
import { BackendRequestError, isAuthFailure } from '@/lib/api/api-error';

import { parseLessonId } from './lesson-sections';

/**
 * Shared guard of the lesson page and the player (Q40, Q41): a bad id or a
 * backend 404 is `notFound()`, no session or a 401/403 goes to `/sign-in`,
 * an unfinished onboarding goes back to it. Every `notFound()` and
 * `redirect()` runs before anything renders: the segments have no
 * `loading.tsx` or Suspense, so the response keeps its real 404 / 307 status.
 */
export async function loadLearnerLesson<T>(
  rawId: string,
  read: (token: string, lessonId: number) => Promise<T>,
): Promise<{ lessonId: number; data: T }> {
  const lessonId = parseLessonId(rawId);
  if (lessonId === null) notFound();

  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  let data: T | null = null;
  let redirectTarget: string | null = null;
  let authFailed = false;
  let missing = false;
  try {
    const status = await getOnboardingStatus(session.token);
    if (status.nextStep !== 'ready') {
      const goal =
        status.nextStep === 'generate_plan'
          ? await getCurrentGoal(session.token)
          : null;
      redirectTarget = routeForOnboarding(status, goal) ?? '/onboarding/goal';
    } else {
      data = await read(session.token, lessonId);
    }
  } catch (error) {
    if (isAuthFailure(error)) authFailed = true;
    else if (error instanceof BackendRequestError && error.status === 404)
      missing = true;
    else throw error;
  }

  if (authFailed) redirect('/sign-in');
  if (redirectTarget) redirect(redirectTarget);
  if (missing || data === null) notFound();
  return { lessonId, data };
}
