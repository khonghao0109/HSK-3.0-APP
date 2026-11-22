import type { NextRequest } from 'next/server';

import { handleDictionaryStrokes } from '@/features/learner-dictionary/dictionary-route-handler';
import { dictionaryDependencies } from '@/features/learner-dictionary/dictionary-service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleDictionaryStrokes(request, dictionaryDependencies());
}
