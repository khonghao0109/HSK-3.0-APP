import { NextRequest } from 'next/server';

import { handleAdminUserRole } from '@/features/admin-users/admin-users-route-handler';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleAdminUserRole(request, (await params).id);
}
