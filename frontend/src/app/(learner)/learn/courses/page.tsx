import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { LearnerBackButton } from '@/features/learner-auth/learner-back-button';
import { getServerLearnerSession } from '@/features/learner-auth/server-learner-session';
import { CourseList } from '@/features/learner-course/course-list';
import { loadCourses } from '@/features/learner-course/course-page-data';
import { LearnerWebTopbar } from '@/features/learner-shell/learner-web-topbar';

import './courses.css';

export const metadata: Metadata = {
  title: 'Khoá học',
};

/** "Khoá học" (ADR-009 C3b-UI; mẫu web/courses.html, mobile/courses.html). */
export default async function LearnerCoursesPage() {
  const session = await getServerLearnerSession();
  if (session.state !== 'learner' || !session.token) {
    redirect('/sign-in');
  }
  const load = await loadCourses(session.token);
  if (load.kind === 'auth') redirect('/sign-in');

  return (
    <>
      <LearnerWebTopbar />
      <header className="m02-head m02-bar m-only">
        <LearnerBackButton
          fallbackHref="/learn"
          ariaLabel="Quay lại Trang chủ"
        />
        <p className="m02-bar__title">Khoá học</p>
      </header>

      <main className="m02-sheet crs-page">
        <div className="w-pagehead crs-pagehead">
          <div>
            <h1 className="w-h1 crs-h1">
              <span className="w-only">Khoá học</span>
              <span className="m-only">Chọn khoá để học</span>
            </h1>
            <p className="w-lead crs-lead">
              <span className="w-only">
                Theo nhiều khoá cùng lúc, chọn một khoá để học tiếp.
              </span>
              <span className="m-only">
                Theo nhiều khoá, học tiếp một khoá.
              </span>
            </p>
          </div>
        </div>

        {load.kind === 'error' ? (
          <section
            className="crs-state is-error"
            role="alert"
            aria-labelledby="courses-error-title"
          >
            <span className="crs-state__art" aria-hidden="true">
              <Icon name="alert-triangle" />
            </span>
            <h2 id="courses-error-title">Không tải được danh sách khoá</h2>
            <p>
              Kiểm tra kết nối mạng rồi thử lại. Tiến độ học
              <span className="w-only"> của bạn</span> không bị ảnh hưởng.
            </p>
            <Link className="btn btn--primary" href="/learn/courses">
              <Icon name="refresh" />
              Thử lại
            </Link>
          </section>
        ) : (
          <>
            {load.courses.length > 0 && (
              <p className="crs-note">
                <Icon name="info" />
                <span className="w-only">
                  <b>Đang học</b> là khoá mà Trang chủ và nút “Học tiếp” dùng.{' '}
                  <b>Đang theo</b> là khoá bạn đã thêm. Đổi khoá hoặc bỏ theo
                  dõi đều giữ nguyên tiến độ.
                </span>
                <span className="m-only">
                  <b>Đang học</b>: khoá Trang chủ dùng cho “Học tiếp”.{' '}
                  <b>Đang theo</b>: khoá bạn đã thêm. Đổi khoá hay bỏ theo dõi
                  đều giữ tiến độ.
                </span>
              </p>
            )}
            <CourseList
              courses={load.courses}
              continueHref={load.continueHref}
            />
          </>
        )}
      </main>
    </>
  );
}
