import { NextRequest } from 'next/server';

import { handleExerciseImportPreview } from '@/features/exercise-import/exercise-import-route-handler';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  return handleExerciseImportPreview(request);
}
