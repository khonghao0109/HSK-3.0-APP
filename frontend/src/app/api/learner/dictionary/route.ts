import type { NextRequest } from 'next/server';

import { handleDictionarySearch } from '@/features/learner-dictionary/dictionary-route-handler';
import { dictionaryDependencies } from '@/features/learner-dictionary/dictionary-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleDictionarySearch(request, dictionaryDependencies());
}
