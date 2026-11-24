import 'server-only';

import { backend } from '@/lib/api/server-backend';

import {
  courseDetailEnvelopeSchema,
  courseListEnvelopeSchema,
} from './course-contract';
import type { CourseDetail, CourseSummary } from './course-model';

export async function getCourses(token: string): Promise<CourseSummary[]> {
  const response = await backend.request('/api/v1/learning/courses', { token });
  return courseListEnvelopeSchema.parse(response).data.courses;
}

export async function getCourse(
  token: string,
  code: string,
): Promise<CourseDetail> {
  const response = await backend.request(`/api/v1/learning/courses/${code}`, {
    token,
  });
  return courseDetailEnvelopeSchema.parse(response).data;
}
