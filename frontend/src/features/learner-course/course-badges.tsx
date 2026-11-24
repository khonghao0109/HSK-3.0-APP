import { Icon } from '@/components/ui/icon';
import { percentClass } from '@/features/learner-home/percent';

import {
  COURSE_KIND_LABEL,
  curriculumLabel,
  progressPercent,
  type CourseKind,
  type CourseSummary,
} from './course-model';

const KIND_ICON: Record<CourseKind, string> = {
  topic: 'layers',
  textbook: 'book',
  specialty: 'award',
};

/** Status is text plus icon, never colour alone. */
export function CourseStatus({
  course,
}: {
  course: Pick<CourseSummary, 'enrolled' | 'isCurrent'>;
}) {
  if (course.isCurrent) {
    return (
      <span className="crs-status is-current">
        <Icon name="check" size={16} />
        Đang học
      </span>
    );
  }
  if (course.enrolled) {
    return (
      <span className="crs-status is-following">
        <Icon name="bookmark" size={16} />
        Đang theo
      </span>
    );
  }
  return <span className="crs-status is-none">Chưa theo</span>;
}

export function CourseMeta({
  course,
  withStatus = true,
}: {
  course: CourseSummary;
  withStatus?: boolean;
}) {
  const version = curriculumLabel(course.curriculumVersion);
  return (
    <div className="crs-meta">
      <span className="crs-kind">
        <Icon name={KIND_ICON[course.kind]} size={16} />
        {COURSE_KIND_LABEL[course.kind]}
      </span>
      {version && <span className="crs-ver">{version}</span>}
      {withStatus && <CourseStatus course={course} />}
    </div>
  );
}

/** Progress bar without inline style (CSP): width from the `pct-N` class. */
export function CourseProgress({
  label,
  progress,
}: {
  label: string;
  progress: CourseSummary['progress'];
}) {
  const percent = progressPercent(progress);
  return (
    <div className="crs-prog">
      <div className="crs-prog__meta">
        <span>
          <b>{progress.completedLessons}</b>/{progress.totalLessons} bài đã xong
        </span>
        <span>{percent}%</span>
      </div>
      <div
        className="progress crs-bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className={percentClass(percent)} />
      </div>
    </div>
  );
}
