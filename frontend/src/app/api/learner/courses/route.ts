import type { NextRequest } from 'next/server';

import { courseDependencies } from '@/features/learner-course/course-dependencies';
import { handleCourseList } from '@/features/learner-course/course-route-handler';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handleCourseList(request, courseDependencies());
}
