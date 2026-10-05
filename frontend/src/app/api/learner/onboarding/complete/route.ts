import type { NextRequest } from 'next/server';

import { onboardingDependencies } from '@/features/onboarding/onboarding-dependencies';
import { handleOnboardingComplete } from '@/features/onboarding/onboarding-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleOnboardingComplete(request, onboardingDependencies());
}
