import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  getCurrentGoal,
  getPublicLevels,
} from '@/features/onboarding/onboarding-service';
import type {
  LevelItem,
  UserGoal,
} from '@/features/onboarding/onboarding-contract';
import {
  parseGoalPageSearchParams,
  type LearningPurpose,
} from '@/features/onboarding/onboarding-values';
import { OnboardingGoalForm } from '@/features/onboarding/onboarding-goal-form';
import { BackendRequestError } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Mục tiêu học tập',
};

export default async function OnboardingGoalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  const rawParams = await searchParams;
  const parsedParams = parseGoalPageSearchParams(rawParams);

  let authFailed = false;
  let levels: LevelItem[] = [];
  let currentGoal: UserGoal | null = null;

  try {
    const [fetchedLevels, fetchedGoal] = await Promise.all([
      getPublicLevels(session.token),
      getCurrentGoal(session.token),
    ]);
    levels = fetchedLevels;
    currentGoal = fetchedGoal;
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

  const purpose: LearningPurpose =
    parsedParams.purpose ?? currentGoal?.learningPurpose ?? 'communication';

  const band: number = parsedParams.band ?? currentGoal?.targetBand ?? 3;

  const hasGoal = currentGoal !== null;

  return (
    <OnboardingGoalForm
      initialPurpose={purpose}
      initialBand={band}
      hasGoal={hasGoal}
      levels={levels}
      notice={parsedParams.notice}
    />
  );
}
