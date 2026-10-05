import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { getCurrentGoal } from '@/features/onboarding/onboarding-service';
import {
  planPageSearchParamsSchema,
  type UserGoal,
} from '@/features/onboarding/onboarding-contract';
import { OnboardingPlanForm } from '@/features/onboarding/onboarding-plan-form';
import { BackendRequestError } from '@/lib/api/api-error';

export const metadata: Metadata = {
  title: 'Kế hoạch học mỗi ngày',
};

export default async function OnboardingPlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  const rawParams = await searchParams;
  const parsed = planPageSearchParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    redirect('/onboarding/goal');
  }

  const { purpose, band } = parsed.data;

  let authFailed = false;
  let currentGoal: UserGoal | null = null;

  try {
    currentGoal = await getCurrentGoal(session.token);
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

  const hasValidGoal =
    currentGoal !== null &&
    (currentGoal.dailyMinutes === 10 ||
      currentGoal.dailyMinutes === 15 ||
      currentGoal.dailyMinutes === 30);

  const initialDailyMinutes: 10 | 15 | 30 =
    currentGoal !== null && hasValidGoal
      ? (currentGoal.dailyMinutes as 10 | 15 | 30)
      : 15;

  const initialReminderEnabled =
    currentGoal !== null && hasValidGoal ? currentGoal.reminderEnabled : true;

  const initialReminderTime =
    currentGoal !== null && hasValidGoal && currentGoal.reminderTime
      ? currentGoal.reminderTime
      : '19:00';

  return (
    <OnboardingPlanForm
      purpose={purpose}
      band={band}
      initialDailyMinutes={initialDailyMinutes}
      initialReminderEnabled={initialReminderEnabled}
      initialReminderTime={initialReminderTime}
    />
  );
}
