import type { NextRequest } from 'next/server';

import { privacyDependencies } from '@/features/privacy/privacy-dependencies';
import { handleAccountDeletion } from '@/features/privacy/privacy-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleAccountDeletion(request, privacyDependencies());
}
