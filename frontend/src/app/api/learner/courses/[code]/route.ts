import type { NextRequest } from 'next/server';

import { courseDependencies } from '@/features/learner-course/course-dependencies';
import { handleCourseDetail } from '@/features/learner-course/course-route-handler';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  ctx: RouteContext<'/api/learner/courses/[code]'>,
) {
  const { code } = await ctx.params;
  return handleCourseDetail(request, code, courseDependencies());
}
