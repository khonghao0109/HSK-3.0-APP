import { isAuthFailure } from '@/lib/api/api-error';

import {
  nextCourseLesson,
  type CourseDetail,
  type CourseSummary,
} from './course-model';
import { getCourse, getCourses } from './course-service';

export type CoursesLoad =
  | { kind: 'auth' }
  | { kind: 'error' }
  | { kind: 'ok'; courses: CourseSummary[]; continueHref: string | null };

/**
 * List plus the lesson "Học tiếp" opens for the current course. A failing
 * detail read only drops the link target (the card then links to the course).
 */
export async function loadCourses(token: string): Promise<CoursesLoad> {
  let courses: CourseSummary[];
  try {
    courses = await getCourses(token);
  } catch (error) {
    return isAuthFailure(error) ? { kind: 'auth' } : { kind: 'error' };
  }
  const current = courses.find((course) => course.isCurrent);
  if (!current) return { kind: 'ok', courses, continueHref: null };
  try {
    const next = nextCourseLesson(await getCourse(token, current.code));
    return {
      kind: 'ok',
      courses,
      continueHref: next ? `/learn/lessons/${next.lesson.id}` : null,
    };
  } catch (error) {
    if (isAuthFailure(error)) return { kind: 'auth' };
    return { kind: 'ok', courses, continueHref: null };
  }
}

/** Home course blocks: the current course and the other followed ones. */
export type HomeCourses = {
  course: CourseDetail;
  following: CourseSummary[];
};

/**
 * Home "Khoá đang học" (+ web "Khoá đang theo"): `null` when there is no
 * current course or the read fails (Home keeps its other blocks), `auth` on
 * 401/403.
 */
export async function loadHomeCourse(
  token: string,
): Promise<HomeCourses | null | 'auth'> {
  try {
    const courses = await getCourses(token);
    const current = courses.find((c) => c.isCurrent);
    if (!current) return null;
    return {
      course: await getCourse(token, current.code),
      following: courses.filter((c) => c.enrolled && !c.isCurrent),
    };
  } catch (error) {
    return isAuthFailure(error) ? 'auth' : null;
  }
}

/** Code of the current course for "Xem theo khoá"; any failure hides the link. */
export async function currentCourseCode(token: string): Promise<string | null> {
  try {
    return (await getCourses(token)).find((c) => c.isCurrent)?.code ?? null;
  } catch {
    return null;
  }
}
