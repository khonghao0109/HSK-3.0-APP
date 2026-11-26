import type { NextRequest } from 'next/server';

import { privacyDependencies } from '@/features/privacy/privacy-dependencies';
import {
  handleCreateDataExport,
  handleListDataExports,
} from '@/features/privacy/privacy-route-handler';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleListDataExports(request, privacyDependencies());
}

export async function POST(request: NextRequest) {
  return handleCreateDataExport(request, privacyDependencies());
}
