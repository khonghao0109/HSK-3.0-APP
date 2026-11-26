import type { NextRequest } from 'next/server';

import { privacyDependencies } from '@/features/privacy/privacy-dependencies';
import { handleDataExportDownload } from '@/features/privacy/privacy-route-handler';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/data-exports/[id]/download'>,
) {
  const { id } = await ctx.params;
  return handleDataExportDownload(request, id, privacyDependencies());
}
