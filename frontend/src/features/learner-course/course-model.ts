// Zod-free course types and helpers (docs/api/api.md A.7c). Client
// components import this module, never course-contract.ts.

export type CourseKind = 'topic' | 'textbook' | 'specialty';
export type CourseLessonState = 'done' | 'current' | 'available' | 'locked';

export type CourseSummary = {
  code: string;
  kind: CourseKind;
  curriculumVersion: string | null;
  title: string;
  description: string | null;
  enrolled: boolean;
  isCurrent: boolean;
  progress: { completedLessons: number; totalLessons: number };
};

export type CourseLesson = {
  id: number;
  title: string;
  slug: string;
  position: number;
  state: CourseLessonState;
  completionPercent: number;
};

export type CourseUnit = {
  orderIndex: number;
  title: string;
  gradeNumber: number | null;
  volume: 'upper' | 'lower' | null;
  levelCode: string | null;
  lessons: CourseLesson[];
};

export type CourseDetail = CourseSummary & { units: CourseUnit[] };

export type CourseEnrollment = {
  courseCode: string;
  status: 'active' | 'left';
  isCurrent: boolean;
  enrolledAt: string;
  leftAt: string | null;
};

/** Backend course code rule; anything else is answered 404 by the BFF. */
export const COURSE_CODE_PATTERN = /^[A-Z0-9_]{3,40}$/;

export const COURSE_KIND_LABEL: Record<CourseKind, string> = {
  topic: 'Chủ đề',
  textbook: 'Giáo trình',
  specialty: 'Chuyên ngành',
};

/** `HSK_2_0` → `HSK 2.0`; other values are shown as sent. */
export function curriculumLabel(version: string | null): string | null {
  if (version === null) return null;
  const match = /^HSK_(\d+)_(\d+)$/.exec(version);
  return match ? `HSK ${match[1]}.${match[2]}` : version;
}

export function progressPercent(progress: CourseSummary['progress']): number {
  if (progress.totalLessons <= 0) return 0;
  return Math.round((progress.completedLessons / progress.totalLessons) * 100);
}

/** The lesson "Học tiếp" opens: the first `current`, else the first open one. */
export function nextCourseLesson(
  course: Pick<CourseDetail, 'units'>,
): { unit: CourseUnit; lesson: CourseLesson; unitIndex: number } | null {
  for (const state of ['current', 'available'] as const) {
    for (const [unitIndex, unit] of course.units.entries()) {
      const lesson = unit.lessons.find((item) => item.state === state);
      if (lesson) return { unit, lesson, unitIndex };
    }
  }
  return null;
}

// Copy of the course screens (mẫu web/courses.html, course-detail.html).

export const quoted = (title: string) => `“${title}”`;

export const courseCurrentToast = (title: string) =>
  `Đã đặt ${quoted(title)} làm khoá đang học. Tiến độ các khoá giữ nguyên.`;
export const courseFollowToast = (title: string) =>
  `Đã theo dõi ${quoted(title)}.`;
export const COURSE_LEAVE_TOAST = 'Đã bỏ theo dõi. Tiến độ vẫn được giữ.';
export const COURSE_ACTION_FAILED = 'Chưa thực hiện được. Hãy thử lại.';
export const COURSE_LOCKED_TOAST = 'Hoàn thành bài trước để mở khoá.';

export const courseLeaveTitle = (title: string) =>
  `Bỏ theo dõi ${quoted(title)}?`;
export const courseLeaveText = (done: number, total: number) =>
  `Khoá chuyển về “Chưa theo”. Tiến độ ${done}/${total} bài vẫn được giữ; theo dõi lại thì học tiếp từ chỗ cũ.`;

export const COURSE_RULE: Record<'sequential' | 'per-unit', string> = {
  sequential:
    'Bài mở lần lượt trong cả khoá: xong bài cuối của một quyển thì quyển sau mới mở. Bài đã học dở luôn vào lại được.',
  'per-unit':
    'Mỗi cấp mở sẵn bài đầu tiên; trong một cấp, xong bài trước thì bài sau mở. Bài đã học dở luôn vào lại được.',
};

export const VOLUME_LABEL = {
  upper: ['上', 'Quyển thượng'],
  lower: ['下', 'Quyển hạ'],
} as const;

/** "Cấp 1 · Bài 5 · đã học 40%" for the next-lesson boxes. */
export function lessonMeta(
  next: { unit: CourseUnit; lesson: CourseLesson },
  separator = ' · ',
): string {
  const unit = next.unit.volume
    ? `${next.unit.title} ${VOLUME_LABEL[next.unit.volume][0]}`
    : next.unit.title;
  const learnt = next.lesson.completionPercent;
  return (
    `${unit}${separator}Bài ${next.lesson.position}` +
    (learnt > 0 ? ` · đã học ${Math.round(learnt)}%` : '')
  );
}

/** How lessons open, per kind (api.md A.7c, TL 23/11). */
export function courseRule(kind: CourseKind): string {
  return COURSE_RULE[kind === 'topic' ? 'per-unit' : 'sequential'];
}
