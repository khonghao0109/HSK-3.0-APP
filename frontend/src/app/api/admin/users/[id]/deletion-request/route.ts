import { NextRequest } from 'next/server';

import { handleAdminUserDeletionRequest } from '@/features/admin-users/admin-users-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleAdminUserDeletionRequest(request, (await params).id);
}
