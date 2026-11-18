import type { NextRequest } from 'next/server';

import { handlePasswordResetRequest } from '@/features/learner-account-recovery/recovery-route-handler';
import { recoveryDependencies } from '@/features/learner-account-recovery/recovery-service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handlePasswordResetRequest(request, recoveryDependencies());
}
