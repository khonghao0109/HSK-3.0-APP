import type { NextRequest } from 'next/server';

import { courseDependencies } from '@/features/learner-course/course-dependencies';
import {
  handleCourseEnroll,
  handleCourseLeave,
} from '@/features/learner-course/course-route-handler';

export const dynamic = 'force-dynamic';

type Context = RouteContext<'/api/learner/courses/[code]/enrollment'>;

export async function POST(request: NextRequest, ctx: Context) {
  const { code } = await ctx.params;
  return handleCourseEnroll(request, code, courseDependencies());
}

export async function DELETE(request: NextRequest, ctx: Context) {
  const { code } = await ctx.params;
  return handleCourseLeave(request, code, courseDependencies());
}
