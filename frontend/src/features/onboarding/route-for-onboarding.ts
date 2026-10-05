import type { OnboardingStatus, UserGoal } from './onboarding-contract';

export function routeForOnboarding(
  status: Pick<OnboardingStatus, 'nextStep'>,
  goal?: Pick<UserGoal, 'learningPurpose' | 'targetBand'> | null,
): string | null {
  switch (status.nextStep) {
    case 'set_goal':
      return '/onboarding/goal';
    case 'content_unavailable':
      return '/onboarding/goal?notice=content_unavailable';
    case 'generate_plan': {
      if (goal && goal.learningPurpose && goal.targetBand) {
        return `/onboarding/plan?purpose=${goal.learningPurpose}&band=${goal.targetBand}`;
      }
      if (goal && goal.targetBand) {
        return `/onboarding/goal?band=${goal.targetBand}`;
      }
      return '/onboarding/goal';
    }
    case 'ready':
      return null;
    default:
      return '/onboarding/goal';
  }
}
