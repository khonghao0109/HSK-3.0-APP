import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { LearnerLogoutButton } from '@/features/learner-auth/learner-logout-button';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  getCurrentGoal,
  getOnboardingStatus,
} from '@/features/onboarding/onboarding-service';
import { routeForOnboarding } from '@/features/onboarding/route-for-onboarding';
import { BackendRequestError } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Góc học tập',
};

export default async function LearnerHomePage() {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  let redirectTarget: string | null = null;
  let authFailed = false;

  try {
    const status = await getOnboardingStatus(session.token);
    let goal = null;
    if (status.nextStep === 'generate_plan') {
      goal = await getCurrentGoal(session.token);
    }
    redirectTarget = routeForOnboarding(status, goal);
  } catch (error) {
    if (
      error instanceof BackendRequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      authFailed = true;
    } else {
      throw error;
    }
  }

  if (authFailed) {
    redirect('/sign-in');
  }

  if (redirectTarget) {
    redirect(redirectTarget);
  }

  return (
    <main className="app auth">
      <h1 className="auth__title">
        Xin chào, <span>{session.user.email}</span>
      </h1>
      <p className="auth__subtitle">
        Chào mừng bạn đã trở lại với Hán Lộ. Hãy sẵn sàng cho bài học tiếp theo!
      </p>

      <LearnerLogoutButton />
    </main>
  );
}
