import type { NextRequest } from 'next/server';

import { courseDependencies } from '@/features/learner-course/course-dependencies';
import { handleCurrentCourse } from '@/features/learner-course/course-route-handler';

export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest) {
  return handleCurrentCourse(request, courseDependencies());
}
