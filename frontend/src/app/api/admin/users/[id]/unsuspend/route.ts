import { NextRequest } from 'next/server';

import { handleAdminUserUnsuspend } from '@/features/admin-users/admin-users-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleAdminUserUnsuspend(request, (await params).id);
}
