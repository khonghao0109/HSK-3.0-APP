import 'server-only';

import { backend } from '@/lib/api/server-backend';

import {
  currentGoalResponseSchema,
  levelsResponseSchema,
  onboardingStatusResponseSchema,
  type LevelItem,
  type OnboardingStatus,
  type UserGoal,
} from './onboarding-contract';

export async function getOnboardingStatus(
  token: string,
): Promise<OnboardingStatus> {
  const response = await backend.request('/api/v1/onboarding/status', {
    token,
  });
  return onboardingStatusResponseSchema.parse(response).data;
}

export async function getCurrentGoal(token: string): Promise<UserGoal | null> {
  const response = await backend.request('/api/v1/onboarding/goals/current', {
    token,
  });
  return currentGoalResponseSchema.parse(response).data;
}

export async function getPublicLevels(token: string): Promise<LevelItem[]> {
  const response = await backend.request('/api/v1/levels', { token });
  return levelsResponseSchema.parse(response).data;
}
