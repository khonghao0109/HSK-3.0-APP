import type { NextRequest } from 'next/server';

import { handlePasswordResetConfirm } from '@/features/learner-account-recovery/recovery-route-handler';
import { recoveryDependencies } from '@/features/learner-account-recovery/recovery-service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handlePasswordResetConfirm(request, recoveryDependencies());
}
