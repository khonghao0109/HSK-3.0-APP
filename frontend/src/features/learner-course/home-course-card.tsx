import Link from 'next/link';

import { Icon } from '@/components/ui/icon';

import { CourseMeta, CourseProgress } from './course-badges';
import {
  findCourseLesson,
  lessonMeta,
  nextCourseLesson,
  type CourseDetail,
  type CourseSummary,
} from './course-model';

/**
 * "Khoá đang học" on Home (mẫu web/home-course.html, mobile/home-course.html).
 * PO 24/11: no cart image, a large 汉 on the course token instead; no XP.
 */
export function HomeCourseCard({
  course,
  nextLessonId = null,
}: {
  course: CourseDetail;
  /** C3b-UI2: `/learning/home` lesson to continue; the unit comes from here. */
  nextLessonId?: number | null;
}) {
  const next =
    findCourseLesson(course, nextLessonId) ?? nextCourseLesson(course);
  const detailHref = `/learn/courses/${course.code}`;
  return (
    <section className="crs-home" aria-labelledby="home-course-title">
      <span className="crs-home__art" aria-hidden="true" lang="zh-Hans">
        汉
      </span>
      <div className="crs-home__body">
        <div className="crs-home__top">
          <p className="crs-home__tag">Khoá đang học</p>
          <Link className="crs-link" href="/learn/courses">
            Đổi khoá
            <Icon name="chevron-right" />
          </Link>
        </div>
        <h2 className="crs-home__title" id="home-course-title">
          {course.title}
        </h2>
        <div className="w-only">
          <CourseMeta course={course} withStatus={false} />
        </div>
        <CourseProgress label="Tiến độ khoá" progress={course.progress} />
        {next && (
          <Link
            className="crs-home__next"
            href={`/learn/lessons/${next.lesson.id}`}
          >
            <span className="crs-lesson__no" aria-hidden="true">
              {next.lesson.position}
            </span>
            <span className="grow">
              <small>{lessonMeta(next)}</small>
              <b>{next.lesson.title}</b>
            </span>
            <Icon name="chevron-right" className="m-only" />
          </Link>
        )}
        <div className="crs-home__cta">
          {next && (
            <Link
              className="btn btn--primary"
              href={`/learn/lessons/${next.lesson.id}`}
            >
              Học tiếp
              <Icon name="arrow-right" />
              <span className="sr-only">{` bài ${next.lesson.title}`}</span>
            </Link>
          )}
          <Link className="crs-link w-only" href={detailHref}>
            Xem lộ trình khoá
          </Link>
        </div>
      </div>
    </section>
  );
}

/**
 * Web aside "Khoá đang theo" (mẫu web/home-course.html; mobile has none):
 * the first other followed course, "Xem" opens the course list.
 */
export function HomeFollowingCard({ courses }: { courses: CourseSummary[] }) {
  const [first] = courses;
  if (!first) return null;
  const { completedLessons, totalLessons } = first.progress;
  return (
    <section
      className="home-stat crs-follow w-only"
      aria-labelledby="home-following-title"
    >
      <span className="crs-follow__icon" aria-hidden="true">
        <Icon name="layers" />
      </span>
      <div>
        <h2 id="home-following-title">Khoá đang theo</h2>
        <p>
          {`${first.title} · ${completedLessons}/${totalLessons} bài · `}
          <Link className="crs-link" href="/learn/courses">
            Xem
          </Link>
        </p>
      </div>
    </section>
  );
}
