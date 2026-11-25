import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import {
  CourseMeta,
  CourseProgress,
} from '@/features/learner-course/course-badges';
import { CourseMakeCurrent } from '@/features/learner-course/course-make-current';
import {
  COURSE_CODE_PATTERN,
  courseRule,
  lessonMeta,
  nextCourseLesson,
  type CourseDetail,
} from '@/features/learner-course/course-model';
import { getCourse } from '@/features/learner-course/course-service';
import { CourseUnits } from '@/features/learner-course/course-units';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';
import { BackendRequestError, isAuthFailure } from '@/lib/api/api-error';

import '../courses.css';

export const metadata: Metadata = {
  title: 'Lộ trình khoá',
};

/** Course detail (ADR-009 C3b-UI; mẫu web/course-detail.html). */
export default async function LearnerCourseDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  if (!COURSE_CODE_PATTERN.test(code)) notFound();
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }

  let course: CourseDetail | null = null;
  let outcome: 'ok' | 'auth' | 'missing' = 'ok';
  try {
    course = await getCourse(session.token, code);
  } catch (error) {
    if (isAuthFailure(error)) outcome = 'auth';
    else if (error instanceof BackendRequestError && error.status === 404)
      outcome = 'missing';
    else throw error;
  }
  if (outcome === 'auth') redirect('/sign-in');
  if (outcome === 'missing' || !course) notFound();

  const next = nextCourseLesson(course);
  const rule = courseRule(course.kind);
  const nextMeta = next ? lessonMeta(next, ' • ') : null;
  const nextHref = next ? `/learn/lessons/${next.lesson.id}` : null;

  return (
    <>
      <LearnerWebTopbar />
      <header className="m02-head m02-bar m-only">
        <LearnerBackButton
          fallbackHref="/learn/courses"
          ariaLabel="Quay lại danh sách khoá"
        />
        <p className="m02-bar__title">Lộ trình khoá</p>
      </header>

      <main className="m02-sheet crs-page crs-detail">
        <section className="crs-head" aria-labelledby="course-title">
          <nav className="w-crumbs w-only" aria-label="Vị trí">
            <Link href="/learn/courses">Khoá học</Link>
            <Icon name="chevron-right" size={16} />
            <span aria-current="page">{course.title}</span>
          </nav>
          <CourseMeta course={course} />
          <div className="crs-head__row">
            <div>
              <h1 className="w-h1 crs-h1" id="course-title" tabIndex={-1}>
                {course.title}
              </h1>
              {course.description && (
                <p className="w-lead crs-lead w-only">{course.description}</p>
              )}
            </div>
            {!course.isCurrent && (
              <CourseMakeCurrent code={course.code} title={course.title} />
            )}
          </div>
          <div className="m-only crs-head__sum">
            <CourseProgress label="Tiến độ khoá" progress={course.progress} />
            <p className="crs-rule__text">{rule}</p>
          </div>
        </section>

        <div className="crs-layout">
          <section className="crs-layout__main" aria-labelledby="units-title">
            <h2 className="sr-only" id="units-title">
              Các cấp và bài học
            </h2>
            <CourseUnits units={course.units} />
          </section>

          <div className="crs-layout__aside w-only">
            {next && nextHref && (
              <section className="crs-next" aria-labelledby="next-title">
                <span
                  className="crs-next__art"
                  aria-hidden="true"
                  lang="zh-Hans"
                >
                  汉
                </span>
                <p className="w-tag">Bài tiếp theo</p>
                <h2 className="w-h2" id="next-title">
                  {next.lesson.title}
                </h2>
                <p className="w-muted">{nextMeta}</p>
                <Link className="btn btn--primary" href={nextHref}>
                  Học tiếp
                  <Icon name="arrow-right" />
                  <span className="sr-only">{` bài ${next.lesson.title}`}</span>
                </Link>
              </section>
            )}
            <section className="crs-sum" aria-labelledby="sum-title">
              <h2 className="w-h3" id="sum-title">
                Tiến độ khoá
              </h2>
              <CourseProgress label="Tiến độ khoá" progress={course.progress} />
              <div className="crs-rule">
                <h3 className="w-h3">Cách mở bài</h3>
                <p>{rule}</p>
              </div>
            </section>
          </div>
        </div>
      </main>

      {next && nextHref && (
        <aside className="path-next m-only" aria-label="Bài tiếp theo">
          <div className="grow">
            <p className="path-next__label">Bài tiếp theo</p>
            <p className="path-next__title">{next.lesson.title}</p>
          </div>
          <Link className="path-next__btn" href={nextHref}>
            Học tiếp
            <Icon name="arrow-right" />
            <span className="sr-only">{` bài ${next.lesson.title}`}</span>
          </Link>
        </aside>
      )}
    </>
  );
}
